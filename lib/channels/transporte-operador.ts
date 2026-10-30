/**
 * O QUE O OPERADOR DA PLATAFORMA FAZ COM O WAHA DE UMA EMPRESA.
 *
 * Quem cadastra o endereço e a chave do WAHA de cada empresa é o operador (o administrador da plataforma),
 * numa tela própria: o lojista só escaneia o QR e vê o estado. Este módulo é a lógica dessa tela, separada da
 * rota para ser testada sem HTTP:
 *
 *   testarConexaoComTransporte      pergunta ao WAHA se ele responde e aceita a chave (sem gravar nada);
 *   cadastrarTransporteDaEmpresa    grava o cadastro da empresa (chave CIFRADA) e, se pedido, o repassa aos canais
 *                             que ela já tem;
 *   lerEstadoDoTransporteDaEmpresa  o que a tela mostra: cadastro (sem a chave), canais e seus estados;
 *   reaplicarWebhookDosCanais põe o webhook por sessão (URL com token + segredo do canal) nas sessões que já
 *                             existem, quando a base pública mudou ou o segredo foi trocado;
 *   gerarChaveDeApi           chave nova e o hash para o contêiner (a chave só existe em memória);
 *   kitDoContainer            o passo a passo, em texto, para criar o contêiner da empresa (sem segredo).
 *
 * A chave de API NUNCA volta ao navegador, nunca entra em log nem em auditoria, e nunca é gravada em claro.
 */
import { createHash, randomBytes } from "node:crypto";

import { env } from "@/lib/env";
import type { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { wahaFriendlyError } from "@/lib/waha/client";

import { nomeDoCanal } from "./estado";
import {
  clienteDoWaha,
  enderecoDaLinha,
  limparCacheDoWaha,
  normalizarEnderecoDoWaha,
  registroDoWahaNasConfiguracoes,
  WahaDoCanalError,
  type EnderecoDoWaha,
} from "./waha-endpoint";
import { novoSegredoDoWebhook, TAMANHO_MINIMO_DO_SEGREDO_DO_WEBHOOK, webhookDaSessao } from "./waha-webhook";

/** Tudo aqui lê e grava com o cliente de serviço: a empresa é filtrada na mão, em cada consulta. */
type Admin = ReturnType<typeof createAdminClient>;

/** O ambiente que a tela do operador consulta. Lido AQUI para a rota não precisar nomear o provedor. */
export function ambienteDoApp(): { WAHA_API_BASE_URL?: string; WAHA_API_KEY?: string; WAHA_WEBHOOK_BASE_URL?: string } {
  return { WAHA_API_BASE_URL: env.WAHA_API_BASE_URL, WAHA_API_KEY: env.WAHA_API_KEY, WAHA_WEBHOOK_BASE_URL: env.WAHA_WEBHOOK_BASE_URL };
}

/** A base pública do webhook configurada neste servidor (vazia = não configurada). */
export function baseDoWebhookConfigurada(): string {
  return (env.WAHA_WEBHOOK_BASE_URL ?? "").trim();
}

// ─── Testar a conexão ───────────────────────────────────────────────────────

export type ResultadoDoTeste =
  | { ok: true; versao: string | null; motor: string | null }
  | { ok: false; motivo: string };

/** Pergunta ao WAHA se ele responde e aceita a chave. Não grava nada e nunca devolve a chave. */
export async function testarConexaoComTransporte(endereco: Pick<EnderecoDoWaha, "baseUrl" | "apiKey">): Promise<ResultadoDoTeste> {
  try {
    const caps = await clienteDoWaha({ ...endereco, origem: "canal" }).getServerVersion();
    return { ok: true, versao: caps.version, motor: caps.engine };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/waha_version_(401|403)/.test(msg)) return { ok: false, motivo: "A chave de acesso foi recusada pelo WhatsApp (WAHA) desta empresa." };
    if (/waha_version_\d{3}/.test(msg)) return { ok: false, motivo: "O endereço respondeu, mas não parece ser um WAHA." };
    return { ok: false, motivo: wahaFriendlyError(err) };
  }
}

export type ResultadoDoTesteDaEmpresa = ResultadoDoTeste | { ok: false; motivo: string; codigo: "endereco_invalido" | "chave_obrigatoria" };

/**
 * O botão "Testar conexão" da tela: valida o endereço, usa a chave digitada ou — sem ela — a já cadastrada
 * (decifrada AQUI; ela nunca sai do servidor) e pergunta ao servidor do WhatsApp se ele responde.
 */
export async function testarConexaoDaEmpresa(
  admin: Admin,
  entrada: { organizationId: string; baseUrl: string; apiKey?: string | null },
): Promise<ResultadoDoTesteDaEmpresa> {
  let baseUrl: string;
  try {
    baseUrl = normalizarEnderecoDoWaha(entrada.baseUrl);
  } catch (err) {
    const motivo = err instanceof WahaDoCanalError ? err.message.replace(/^waha_do_canal_[a-z_]+: /, "") : "Endereço inválido.";
    return { ok: false, motivo, codigo: "endereco_invalido" };
  }
  let apiKey = entrada.apiKey?.trim() || null;
  if (!apiKey) {
    const { data: org } = await admin.from("organizations").select("settings").eq("id", entrada.organizationId).maybeSingle();
    const registro = registroDoWahaNasConfiguracoes((org as { settings?: unknown } | null)?.settings);
    // A chave guardada só é usada contra o endereço a que ela pertence. Sem esta trava, "testar" com um endereço
    // digitado mandaria a chave cadastrada (no cabeçalho) para onde quer que o formulário apontasse.
    if (registro && registro.waha_base_url !== baseUrl) {
      return { ok: false, motivo: "Para testar um endereço diferente do cadastrado, informe também a chave de acesso.", codigo: "chave_obrigatoria" };
    }
    try {
      const achado = registro
        ? await enderecoDaLinha({ waha_base_url: baseUrl, waha_api_key_encrypted: registro.waha_api_key_encrypted }, (c) => decryptWebhookSecret(admin, c), {})
        : null;
      apiKey = achado?.apiKey ?? null;
    } catch {
      apiKey = null;
    }
  }
  if (!apiKey) return { ok: false, motivo: "Informe a chave de acesso para testar.", codigo: "chave_obrigatoria" };
  return testarConexaoComTransporte({ baseUrl, apiKey });
}

// ─── Cadastrar ──────────────────────────────────────────────────────────────

export class CadastroDoTransporteError extends Error {
  constructor(readonly code: "endereco_invalido" | "chave_obrigatoria" | "cifra_indisponivel" | "falha_ao_gravar", mensagem: string) {
    super(mensagem);
    this.name = "CadastroDoTransporteError";
  }
}

export interface EntradaDoCadastro {
  organizationId: string;
  baseUrl: string;
  /** Em claro, só aqui. Ausente = manter a chave já cadastrada (troca só o endereço). */
  apiKey?: string | null;
  /** Repassar o cadastro aos canais ativos que a empresa já tem. */
  atualizarCanais: boolean;
}

/**
 * Grava o WAHA da empresa em `organizations.settings.waha` (endereço + chave CIFRADA por `fn_encrypt_oauth`).
 * É o que cada número novo herda ao conectar. Com `atualizarCanais`, repassa o mesmo cadastro às colunas dos
 * canais ativos QUE JÁ USAM o servidor próprio da empresa — é como a troca de endereço passa a valer para quem já
 * está conectado nele. Canais em modo compartilhado não são tocados (ver o comentário no ponto da gravação).
 */
export async function cadastrarTransporteDaEmpresa(
  admin: Admin,
  entrada: EntradaDoCadastro,
): Promise<{ canaisAtualizados: number }> {
  let baseUrl: string;
  try {
    baseUrl = normalizarEnderecoDoWaha(entrada.baseUrl);
  } catch (err) {
    throw new CadastroDoTransporteError("endereco_invalido", err instanceof WahaDoCanalError ? err.message.replace(/^waha_do_canal_[a-z_]+: /, "") : "endereço inválido.");
  }

  const { data: org, error: erroDeLeitura } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", entrada.organizationId)
    .maybeSingle();
  if (erroDeLeitura || !org) throw new CadastroDoTransporteError("falha_ao_gravar", "empresa não encontrada.");
  const settings = ((org as { settings?: unknown }).settings ?? {}) as Record<string, unknown>;

  const atual = registroDoWahaNasConfiguracoes(settings);
  let chaveCifrada: string | null;
  if (entrada.apiKey && entrada.apiKey.trim() !== "") {
    chaveCifrada = await encryptWebhookSecret(admin, entrada.apiKey.trim());
    if (!chaveCifrada) throw new CadastroDoTransporteError("cifra_indisponivel", "a cifra de credenciais não está disponível neste servidor.");
  } else {
    chaveCifrada = atual?.waha_api_key_encrypted ?? null;
  }
  if (!chaveCifrada) throw new CadastroDoTransporteError("chave_obrigatoria", "informe a chave de acesso do WAHA desta empresa.");

  const { error: erroDeGravacao } = await admin
    .from("organizations")
    .update({ settings: { ...settings, waha: { base_url: baseUrl, api_key_encrypted: chaveCifrada, atualizado_em: new Date().toISOString() } } })
    .eq("id", entrada.organizationId);
  if (erroDeGravacao) throw new CadastroDoTransporteError("falha_ao_gravar", "não foi possível gravar o cadastro.");

  let canaisAtualizados = 0;
  if (entrada.atualizarCanais) {
    // SÓ os canais que JÁ moram no servidor próprio da empresa (endereço preenchido). Um canal em modo compartilhado
    // está pareado no contêiner antigo: apontá-lo para um servidor que não tem a sessão o derrubaria e deixaria as
    // mensagens dele sem destino. Esses canais seguem como estão até serem reconectados (o número novo já herda o cadastro).
    const { data, error } = await admin
      .from("channel_sessions")
      .update({ waha_base_url: baseUrl, waha_api_key_encrypted: chaveCifrada })
      .eq("organization_id", entrada.organizationId)
      .eq("provider", "waha")
      .is("archived_at", null)
      .not("waha_base_url", "is", null)
      .select("id");
    if (error) throw new CadastroDoTransporteError("falha_ao_gravar", "o cadastro da empresa foi gravado, mas não consegui repassá-lo aos canais.");
    canaisAtualizados = Array.isArray(data) ? data.length : 0;
  }

  // O cache do resolvedor lembra o endereço antigo por até 30 s: limpa o deste processo.
  limparCacheDoWaha();
  return { canaisAtualizados };
}

// ─── O estado que a tela mostra ─────────────────────────────────────────────

export interface CanalParaOperador {
  id: string;
  nome: string;
  status: string;
  /** O canal usa o WAHA da empresa (colunas preenchidas), e não o global. */
  transporte_proprio: boolean;
}

export interface EstadoDoTransporteDaEmpresa {
  /** Há cadastro da empresa? */
  cadastrado: boolean;
  /** O endereço cadastrado (nunca a chave). */
  endereco: string | null;
  /** Há chave cadastrada? Só o fato: o valor nunca sai do servidor. */
  tem_chave: boolean;
  /** A base pública do webhook está configurada neste servidor? Sem ela não se conecta WAHA próprio. */
  webhook_base_configurada: boolean;
  /** Existe WAHA global (modo compartilhado) neste servidor? */
  tem_transporte_global: boolean;
  canais: CanalParaOperador[];
  /** Quantos canais desta empresa estão caídos (STOPPED/FAILED): a lista de quedas do operador. */
  canais_com_falha: number;
}

export async function lerEstadoDoTransporteDaEmpresa(
  admin: Admin,
  organizationId: string,
  ambiente: { WAHA_API_BASE_URL?: string; WAHA_API_KEY?: string; WAHA_WEBHOOK_BASE_URL?: string } = ambienteDoApp(),
): Promise<EstadoDoTransporteDaEmpresa> {
  const [{ data: org, error: erroDaEmpresa }, { data: canais, error: erroDosCanais }] = await Promise.all([
    admin.from("organizations").select("settings").eq("id", organizationId).maybeSingle(),
    admin
      .from("channel_sessions")
      .select("id, display_name, phone_number, status, waha_base_url")
      .eq("organization_id", organizationId)
      .eq("provider", "waha")
      .is("archived_at", null)
      .order("created_at", { ascending: true }),
  ]);
  // Erro de leitura NÃO vira "nenhum canal / falta cadastrar": a tela mostraria que a empresa não tem nada, e o
  // operador poderia cadastrar por cima de um cadastro que existe. Quem chama responde com erro.
  if (erroDaEmpresa || erroDosCanais) throw new Error("consulta_falhou");
  const registro = registroDoWahaNasConfiguracoes((org as { settings?: unknown } | null)?.settings);
  const lista = ((canais ?? []) as Array<{ id: string; display_name: string | null; phone_number: string | null; status: string | null; waha_base_url: string | null }>).map(
    (c): CanalParaOperador => ({
      id: c.id,
      nome: nomeDoCanal(c),
      status: c.status ?? "",
      transporte_proprio: Boolean(c.waha_base_url),
    }),
  );
  return {
    cadastrado: Boolean(registro?.waha_base_url),
    endereco: registro?.waha_base_url ?? null,
    tem_chave: Boolean(registro?.waha_api_key_encrypted),
    webhook_base_configurada: Boolean(ambiente.WAHA_WEBHOOK_BASE_URL?.trim()),
    tem_transporte_global: Boolean(ambiente.WAHA_API_BASE_URL?.trim() && ambiente.WAHA_API_KEY?.trim()),
    canais: lista,
    canais_com_falha: lista.filter((c) => c.status === "STOPPED" || c.status === "FAILED").length,
  };
}

// ─── Reaplicar o webhook ────────────────────────────────────────────────────

export interface ResultadoPorCanal {
  canalId: string;
  resultado: "aplicado" | "ja_estava" | "falhou" | "pulado";
  /** Código curto, nunca endereço nem chave. */
  motivo?: string;
}

/**
 * Para cada canal ativo com WAHA próprio: garante o segredo do canal e reaplica o webhook na sessão. Um canal
 * que falha não interrompe os outros. Canais do modo compartilhado são pulados (o contêiner já traz o webhook).
 */
export async function reaplicarWebhookDosCanais(
  admin: Admin,
  entrada: { organizationId: string; urlBaseDoWebhook: string },
): Promise<ResultadoPorCanal[]> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select("id, waha_session_name, webhook_path_token, webhook_secret_encrypted, waha_base_url, waha_api_key_encrypted")
    .eq("organization_id", entrada.organizationId)
    .eq("provider", "waha")
    .is("archived_at", null);
  if (error) throw new Error("consulta_falhou");

  const decifrar = (cifra: string) => decryptWebhookSecret(admin, cifra);
  const resultados: ResultadoPorCanal[] = [];

  for (const c of (data ?? []) as Array<Record<string, string | null>>) {
    const canalId = String(c.id);
    if (!c.waha_base_url) {
      resultados.push({ canalId, resultado: "pulado", motivo: "waha_global" });
      continue;
    }
    try {
      const endereco = await enderecoDaLinha(
        { waha_base_url: c.waha_base_url, waha_api_key_encrypted: c.waha_api_key_encrypted ?? null },
        decifrar,
        {},
      );
      if (!endereco || !c.waha_session_name || !c.webhook_path_token) throw new Error("canal_incompleto");

      let segredo = c.webhook_secret_encrypted ? await decryptWebhookSecret(admin, c.webhook_secret_encrypted) : null;
      if (!segredo || segredo.length < TAMANHO_MINIMO_DO_SEGREDO_DO_WEBHOOK) {
        const novo = novoSegredoDoWebhook();
        const cifrado = await encryptWebhookSecret(admin, novo);
        if (!cifrado) throw new Error("cifra_indisponivel");
        const { error: erroDoSegredo } = await admin
          .from("channel_sessions")
          .update({ webhook_secret_encrypted: cifrado })
          .eq("organization_id", entrada.organizationId)
          .eq("id", canalId);
        if (erroDoSegredo) throw new Error("segredo_nao_gravado");
        segredo = novo;
      }
      const webhook = webhookDaSessao(entrada.urlBaseDoWebhook, c.webhook_path_token, segredo);
      const r = await clienteDoWaha(endereco).aplicarWebhookNaSessao(c.waha_session_name, webhook);
      resultados.push({ canalId, resultado: r });
    } catch (err) {
      const motivo = err instanceof WahaDoCanalError ? err.code : err instanceof Error ? err.message.replace(/[^a-z0-9_]/gi, "_").slice(0, 60) : "erro";
      resultados.push({ canalId, resultado: "falhou", motivo });
    }
  }
  return resultados;
}

// ─── Chave nova e kit do contêiner ──────────────────────────────────────────

/** A chave (para colar no Celuzap) e o hash SHA-512 dela (para o contêiner, com o prefixo `sha512:`). */
export function gerarChaveDeApi(): { chave: string; hashSha512: string } {
  const chave = randomBytes(24).toString("hex");
  return { chave, hashSha512: createHash("sha512").update(chave, "utf8").digest("hex") };
}

export const IMAGEM_DO_SERVICO_PARA_EMPRESAS = "devlikeapro/waha:noweb-2026.10.1";
export const MEMORIA_DO_SERVICO_PARA_EMPRESAS = "768 MB";

/** O passo a passo para criar o contêiner da empresa. Só valores públicos e marcadores: nenhum segredo. */
export function kitDoContainer(entrada: { nomeDoServico: string }): string {
  const nome = entrada.nomeDoServico.trim().replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "whatsapp-empresa";
  return [
    `Serviço: ${nome}`,
    `Tipo: App (um serviço por empresa, no mesmo projeto do Celuzap)`,
    `Imagem: ${IMAGEM_DO_SERVICO_PARA_EMPRESAS}`,
    `Memória: limite de ${MEMORIA_DO_SERVICO_PARA_EMPRESAS}`,
    `Volumes (gerenciados, para o QR não ser pedido a cada atualização): /app/.sessions e /app/.media`,
    `Domínio e portas públicas: NENHUM (só o app e o worker alcançam este serviço, pela rede interna)`,
    ``,
    `Variáveis:`,
    `  WAHA_API_KEY=sha512:<cole aqui o hash da chave gerada>`,
    `  WHATSAPP_DEFAULT_ENGINE=NOWEB`,
    `  WAHA_DASHBOARD_ENABLED=false`,
    `  WHATSAPP_RESTART_ALL_SESSIONS=True`,
    ``,
    `NÃO coloque WHATSAPP_HOOK_URL nem variável de assinatura neste contêiner: o Celuzap registra o webhook`,
    `(URL com o token do canal e o segredo de assinatura) na própria sessão ao conectar o número.`,
    ``,
    `Depois de criar: use "Testar conexão" nesta tela com o endereço interno do serviço e a chave gerada.`,
  ].join("\n");
}
