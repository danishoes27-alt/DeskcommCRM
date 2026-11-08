/**
 * LER O ARQUIVO DE APARELHOS COM SEGURANÇA DE SAÍDA.
 *
 * Spec 23 §2. É o ÚNICO `fetch` da funcionalidade. Os passos, nesta ordem — falhou um, para:
 *
 *   1. a URL passa por `validarUrlDeAparelhos` (https, host dentro de `hosts` — a lista da
 *      configuração DA organização —, sem credencial/porta);
 *   2. `assertSafeOutboundUrl` — guarda textual do repositório;
 *   3. `assertDestinoResolvidoSeguro` — resolve o nome e recusa IP privado/loopback/link-local
 *      (falha de DNS = recusa);
 *   4. `fetch` GET, `redirect: "manual"` (qualquer 3xx é erro), timeout de 5 s no pedido E na
 *      leitura do corpo, sem cookie, sem Authorization, sem corpo;
 *   5. status 200; `Content-Type: application/json`;
 *   6. teto de 512 KB: o `Content-Length` declarado recusa sem ler, e a leitura em stream soma os
 *      bytes e ABORTA ao passar — o cabeçalho pode faltar ou mentir;
 *   7. `JSON.parse` e `validarArquivo`.
 *
 * Uma segunda tentativa só em erro de rede, timeout ou 5xx. 3xx, 4xx, tipo errado, tamanho e JSON
 * ruim não melhoram tentando de novo.
 *
 * A URL e os `hosts` vêm SÓ da configuração da organização (`lerConfiguracaoDeAparelhos`); este
 * módulo não tem como receber endereço do modelo. A janela de DNS-rebinding entre a resolução
 * (passo 3) e o `fetch` permanece declarada, como em `outbound-ip.ts`; ela é mitigada pela lista de
 * hosts: para explorá-la seria preciso controlar o DNS do domínio que o administrador declarou.
 *
 * Nunca lança, e nenhum resultado carrega a URL.
 */
import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";
import { classificarFalhaDeAlcance } from "@/lib/net/alcance";

import { validarUrlDeAparelhos } from "./configuracao";
import { validarArquivo } from "./schema";
import type { ResultadoDaLeitura } from "./tipos";

export const TIMEOUT_MS = 5000;
export const TETO_DO_ARQUIVO_BYTES = 512 * 1024;

export interface DepsDeLeitura {
  fetchImpl?: typeof fetch;
  agora?: () => Date;
  timeoutMs?: number;
}

const falha = (detalhe: string): ResultadoDaLeitura => ({ ok: false, erro: "falha_na_leitura", detalhe });
const invalido = (detalhe: string): ResultadoDaLeitura => ({ ok: false, erro: "arquivo_invalido", detalhe });

/** Resultado de UMA tentativa: pronto, ou falha com a marca de "vale tentar de novo". */
type Tentativa = { final: ResultadoDaLeitura } | { repetir: ResultadoDaLeitura };

function detalheDeRede(erro: unknown): string {
  switch (classificarFalhaDeAlcance(erro)) {
    case "endereco_nao_resolve":
      return "dns";
    case "tempo_esgotado":
      return "timeout";
    case "tls_recusado":
      return "tls";
    default:
      return "rede";
  }
}

/** Lê o corpo somando bytes; aborta no teto. `null` = estourou. */
async function lerCorpoComTeto(resposta: Response): Promise<string | null> {
  const declarado = Number(resposta.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > TETO_DO_ARQUIVO_BYTES) {
    await resposta.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!resposta.body) return "";

  const leitor = resposta.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > TETO_DO_ARQUIVO_BYTES) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    pedacos.push(value);
  }
  const todo = new Uint8Array(total);
  let posicao = 0;
  for (const p of pedacos) {
    todo.set(p, posicao);
    posicao += p.byteLength;
  }
  return new TextDecoder("utf-8").decode(todo);
}

async function tentarUmaVez(url: string, fetchImpl: typeof fetch, timeoutMs: number, agora: Date): Promise<Tentativa> {
  let resposta: Response;
  let corpo: string | null;
  try {
    resposta = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });

    if (resposta.status >= 300 && resposta.status < 400) {
      await resposta.body?.cancel().catch(() => undefined);
      return { final: falha("redirect") };
    }
    if (resposta.status >= 500) {
      await resposta.body?.cancel().catch(() => undefined);
      return { repetir: falha(`http_${resposta.status}`) };
    }
    if (resposta.status !== 200) {
      await resposta.body?.cancel().catch(() => undefined);
      return { final: falha(`http_${resposta.status}`) };
    }

    const tipo = (resposta.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (tipo !== "application/json") {
      await resposta.body?.cancel().catch(() => undefined);
      return { final: invalido("tipo_de_conteudo") };
    }

    corpo = await lerCorpoComTeto(resposta);
  } catch (erro) {
    return { repetir: falha(detalheDeRede(erro)) };
  }

  if (corpo === null) return { final: invalido("arquivo_grande") };

  let bruto: unknown;
  try {
    bruto = JSON.parse(corpo);
  } catch {
    return { final: invalido("json_invalido") };
  }
  const validado = validarArquivo(bruto, agora);
  if (!validado.ok) return { final: invalido(validado.detalhe) };
  return { final: { ok: true, arquivo: validado.arquivo, geradoEm: validado.geradoEm } };
}

export async function lerArquivoDeAparelhos(
  url: string,
  hosts: readonly string[],
  deps: DepsDeLeitura = {},
): Promise<ResultadoDaLeitura> {
  try {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const agora = (deps.agora ?? (() => new Date()))();
    const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;

    const permitida = validarUrlDeAparelhos(url, hosts);
    if (!permitida.ok) return falha("url_nao_permitida");

    try {
      assertSafeOutboundUrl(permitida.url);
    } catch {
      return falha("destino_bloqueado");
    }
    try {
      await assertDestinoResolvidoSeguro(new URL(permitida.url).hostname);
    } catch (erro) {
      const texto = erro instanceof Error ? erro.message : "";
      return falha(/dns_(failed|empty)/.test(texto) ? "dns" : "destino_bloqueado");
    }

    const primeira = await tentarUmaVez(permitida.url, fetchImpl, timeoutMs, agora);
    if ("final" in primeira) return primeira.final;
    const segunda = await tentarUmaVez(permitida.url, fetchImpl, timeoutMs, agora);
    return "final" in segunda ? segunda.final : segunda.repetir;
  } catch {
    // Última rede de segurança: este módulo roda no turno de um cliente e não pode lançar.
    return falha("rede");
  }
}
