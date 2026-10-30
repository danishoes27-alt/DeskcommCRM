/**
 * ONDE FICA O WAHA DESTE CANAL? — o resolvedor "canal → WAHA".
 *
 * ─── O que isto troca ───────────────────────────────────────────────────────
 * Até aqui o app falava com UM WAHA por instalação: `getWahaClient()` lia
 * `WAHA_API_BASE_URL` e `WAHA_API_KEY` do ambiente a cada chamada. Para cada empresa
 * ter o seu contêiner, o canal carrega o próprio endereço e a própria chave
 * (`channel_sessions.waha_base_url` e `waha_api_key_encrypted`, migration 9001), e todo
 * ponto que fala com o WAHA pergunta aqui, pelo nome da sessão, com quem deve falar.
 *
 * ─── A regra, em três linhas ────────────────────────────────────────────────
 *  1. O canal tem endereço próprio  -> fala com o WAHA DELE (`origem: "canal"`).
 *  2. O canal não tem (coluna NULL) -> fala com o WAHA global do ambiente
 *     (`origem: "ambiente"`): é o modo compartilhado, igual ao de antes.
 *  3. O canal tem endereço e a chave falta ou não decifra -> ERRO. Nunca cai no WAHA
 *     global: uma empresa cujo cadastro está quebrado não pode passar a falar pelo
 *     WhatsApp de outra. Mesma lição de `lib/channels/meta/credentials.ts` (issue
 *     #236): falha de resolução fecha a ação e abre a informação, não vira o caminho
 *     feliz de outra conta.
 *
 * O nome da sessão é único na instalação (`channel_sessions_waha_session_name_unique`),
 * então ele basta como chave da busca.
 *
 * ─── O que NÃO fica aqui ────────────────────────────────────────────────────
 * Cadastrar o endereço (rota do operador), testar a conexão e decidir o webhook são
 * de quem chama. Este arquivo só responde "com quem falo?". O nome do provedor mora
 * em `lib/channels/` por causa da cerca `pnpm lint:channels`.
 */
import { WahaClient } from "@/lib/waha/client";

export type OrigemDoWaha = "canal" | "ambiente";

export interface EnderecoDoWaha {
  /** Sem barra no fim, http ou https. */
  baseUrl: string;
  apiKey: string;
  /** De onde veio — aparece em log de diagnóstico, nunca com a chave. */
  origem: OrigemDoWaha;
}

export type CodigoDeFalhaDoWaha =
  | "endereco_invalido"
  | "canal_sem_chave"
  | "chave_ilegivel"
  | "consulta_falhou";

/**
 * Falha ao descobrir o WAHA de um canal que TEM cadastro próprio. O texto nunca leva o
 * endereço nem a chave: vai para log e para resposta de API.
 */
export class WahaDoCanalError extends Error {
  constructor(
    readonly code: CodigoDeFalhaDoWaha,
    mensagem: string,
  ) {
    super(`waha_do_canal_${code}: ${mensagem}`);
    this.name = "WahaDoCanalError";
  }
}

/** O valor que o `.env.example` traz e que NÃO conta como chave configurada. */
export const CHAVE_DE_ENFEITE_DO_WAHA = "dev_plaintext_change_me";

/** Nomes de metadado de nuvem: nunca um destino legítimo de WAHA. */
const NOMES_PROIBIDOS = new Set(["metadata.google.internal", "metadata.goog", "instance-data", "instance-data.ec2.internal"]);
/** Endereços de metadado de nuvem fora da faixa 169.254/16 (Alibaba, Azure, ECS). */
const IPV4_PROIBIDOS = new Set(["100.100.100.200", "168.63.129.16", "0.0.0.0"]);

/** `[::ffff:a9fe:a9fe]` ou `::ffff:169.254.169.254` -> `169.254.169.254`; `null` se não for IPv4 mapeado. */
function ipv4DoMapeado(host: string): string | null {
  const m = /^::ffff:(?:(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(host);
  if (!m) return null;
  if (m[1]) return m[1];
  const alto = parseInt(m[2] ?? "0", 16);
  const baixo = parseInt(m[3] ?? "0", 16);
  return [alto >> 8, alto & 255, baixo >> 8, baixo & 255].join(".");
}

/**
 * O host é destino de metadado de nuvem? Normaliza antes de comparar: caixa, colchetes do IPv6, ponto final
 * (`metadata.google.internal.`) e IPv4 embutido em IPv6 (`::ffff:a9fe:a9fe`). Rede interna comum (nome de
 * contêiner, 10.x, 172.16/12, localhost) continua permitida: é o destino normal de um WAHA por empresa.
 */
export function hostEhDeMetadadoDeNuvem(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (NOMES_PROIBIDOS.has(host)) return true;
  const v4 = ipv4DoMapeado(host) ?? (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ? host : null);
  if (v4) return v4.startsWith("169.254.") || IPV4_PROIBIDOS.has(v4);
  // IPv6: link-local (fe80::/10) e o metadado da AWS em IPv6 (fd00:ec2::254).
  return /^fe[89ab][0-9a-f]:/.test(host) || host === "fd00:ec2::254";
}

/**
 * Valida e normaliza o endereço de um WAHA: só `http`/`https`, sem usuário nem senha na
 * URL, sem destino de metadado de nuvem. Devolve a URL sem barra no fim.
 *
 * O endereço é escolhido SÓ pelo operador da plataforma e costuma ser interno (a rede do
 * contêiner, `http://waha-acme:3000`); por isso rede interna é permitida aqui, ao contrário
 * do que uma empresa poderia apontar sozinha.
 */
export function normalizarEnderecoDoWaha(bruto: string): string {
  let url: URL;
  try {
    url = new URL(bruto.trim());
  } catch {
    throw new WahaDoCanalError("endereco_invalido", "o endereço não é uma URL válida.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WahaDoCanalError("endereco_invalido", "o endereço precisa começar com http:// ou https://.");
  }
  if (url.username || url.password) {
    throw new WahaDoCanalError("endereco_invalido", "o endereço não pode levar usuário nem senha.");
  }
  if (hostEhDeMetadadoDeNuvem(url.hostname)) {
    throw new WahaDoCanalError("endereco_invalido", "este endereço não pode ser usado.");
  }
  if (url.search || url.hash) {
    throw new WahaDoCanalError("endereco_invalido", "o endereço não pode ter parâmetros nem âncora.");
  }
  return url.toString().replace(/\/+$/, "");
}

/** Versão sem lançar, para validação de formulário/rota. */
export function validarEnderecoDoWaha(bruto: unknown): { ok: true; url: string } | { ok: false; motivo: string } {
  if (typeof bruto !== "string" || bruto.trim() === "") return { ok: false, motivo: "informe o endereço." };
  try {
    return { ok: true, url: normalizarEnderecoDoWaha(bruto) };
  } catch (e) {
    return { ok: false, motivo: e instanceof WahaDoCanalError ? e.message.replace(/^waha_do_canal_[a-z_]+: /, "") : "endereço inválido." };
  }
}

/**
 * O erro do banco é "as colunas da migration 9001 ainda não existem"? Acontece quando a imagem nova sobe antes de a
 * migration ser aplicada (o `archived.ts` documenta que a ordem errada já aconteceu neste projeto). Nesse banco nenhum
 * canal pode ter WAHA próprio, então quem pergunta trata como "sem cadastro próprio" e segue no global — o que a imagem
 * anterior faria — em vez de derrubar o WhatsApp inteiro, inclusive o modo compartilhado.
 */
export function colunaDoWahaAusente(erro: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!erro) return false;
  const mensagem = erro.message ?? "";
  const colunaInexistente = erro.code === "42703" || erro.code === "PGRST204" || /does not exist|schema cache/i.test(mensagem);
  return colunaInexistente && /waha_base_url|waha_api_key_encrypted/.test(mensagem);
}

/** O WAHA global do ambiente (modo compartilhado). `null` quando não está configurado. */
export function enderecoDoAmbiente(fonte: Record<string, string | undefined> = process.env): EnderecoDoWaha | null {
  const url = fonte.WAHA_API_BASE_URL?.trim();
  const chave = fonte.WAHA_API_KEY?.trim();
  if (!url || !chave || chave === CHAVE_DE_ENFEITE_DO_WAHA) return null;
  return { baseUrl: url.replace(/\/+$/, ""), apiKey: chave, origem: "ambiente" };
}

/** As duas colunas da migration 9001, como o banco as devolve. */
export interface LinhaDoWahaDoCanal {
  waha_base_url: string | null;
  /** bytea em hex (`\x…` do PostgREST, ou hex puro). */
  waha_api_key_encrypted: string | null;
}

/** De onde vêm as colunas e como se decifra a chave. Duas implementações: Supabase (app) e pg (worker). */
export interface FonteDoWahaDoCanal {
  /** Linha do canal pelo nome da sessão no WAHA (único na instalação). `null` = não existe. */
  porSessionRef(sessionRef: string): Promise<LinhaDoWahaDoCanal | null>;
  /** Chave em claro, ou `null` se não decifra. */
  decifrar(cifra: string): Promise<string | null>;
}

// ─── Cache em memória ───────────────────────────────────────────────────────
// Os envios e os indicadores de "digitando" passam por aqui a cada mensagem: sem cache,
// cada um custaria uma ida ao banco e uma decifragem. O cache é por processo e curto; quem
// muda o cadastro chama `limparCacheDoWaha` (no mesmo processo vale na hora; nos outros,
// em até `TTL_PADRAO_MS`). Só guarda resolução BEM-SUCEDIDA — erro nunca é lembrado.
const TTL_PADRAO_MS = 30_000;
interface Lembrado {
  valor: EnderecoDoWaha | null;
  ate: number;
}
const cache = new Map<string, Lembrado>();

export function limparCacheDoWaha(sessionRef?: string): void {
  if (sessionRef === undefined) cache.clear();
  else cache.delete(sessionRef);
}

export interface OpcoesDaResolucao {
  /** Ambiente injetável (testes). */
  ambiente?: Record<string, string | undefined>;
  /** Relógio injetável (testes). */
  agora?: () => number;
  /** 0 desliga o cache. */
  ttlMs?: number;
}

/**
 * Com quem falar para esta sessão. `null` = não há WAHA nenhum configurado para ela (nem do
 * canal, nem do ambiente): o chamador trata como "transporte não configurado", como sempre
 * tratou. LANÇA `WahaDoCanalError` quando o canal TEM cadastro próprio e ele está quebrado.
 */
export async function resolverEnderecoDoWaha(
  fonte: FonteDoWahaDoCanal,
  sessionRef: string,
  opcoes: OpcoesDaResolucao = {},
): Promise<EnderecoDoWaha | null> {
  const agora = opcoes.agora ?? Date.now;
  const ttl = opcoes.ttlMs ?? TTL_PADRAO_MS;
  const ambiente = opcoes.ambiente ?? process.env;

  // O cache só é consultado com o ambiente real: um teste que injeta `ambiente` quer ver a
  // resolução de verdade, e um valor lembrado de outro ambiente mentiria.
  const usaCache = ttl > 0 && opcoes.ambiente === undefined;
  if (usaCache) {
    const lembrado = cache.get(sessionRef);
    if (lembrado && lembrado.ate > agora()) return lembrado.valor;
  }

  let linha: LinhaDoWahaDoCanal | null;
  try {
    linha = await fonte.porSessionRef(sessionRef);
  } catch {
    // Não sabemos se o canal tem cadastro próprio. Cair no global agora seria adivinhar.
    throw new WahaDoCanalError("consulta_falhou", "não consegui ler o cadastro do WhatsApp deste canal.");
  }

  const resolvido = await enderecoDaLinha(linha, fonte.decifrar, ambiente);
  if (usaCache) cache.set(sessionRef, { valor: resolvido, ate: agora() + ttl });
  return resolvido;
}

/**
 * A decisão em si, sem banco: dadas as duas colunas, com quem falar. Linha ausente ou com as duas
 * colunas vazias = WAHA global; cadastro pela metade, endereço inválido ou chave ilegível = erro.
 */
export async function enderecoDaLinha(
  linha: LinhaDoWahaDoCanal | null,
  decifrar: FonteDoWahaDoCanal["decifrar"],
  ambiente: Record<string, string | undefined> = process.env,
): Promise<EnderecoDoWaha | null> {
  const temEndereco = Boolean(linha?.waha_base_url?.trim());
  const temChave = Boolean(linha?.waha_api_key_encrypted);

  if (!linha || (!temEndereco && !temChave)) return enderecoDoAmbiente(ambiente);
  if (!temEndereco) {
    throw new WahaDoCanalError("endereco_invalido", "este canal tem chave cadastrada, mas não tem endereço.");
  }
  const baseUrl = normalizarEnderecoDoWaha(linha.waha_base_url as string);
  if (!temChave) throw new WahaDoCanalError("canal_sem_chave", "este canal tem endereço, mas não tem chave cadastrada.");
  let chave: string | null;
  try {
    chave = await decifrar(linha.waha_api_key_encrypted as string);
  } catch {
    chave = null;
  }
  if (!chave) throw new WahaDoCanalError("chave_ilegivel", "a chave deste canal não pôde ser lida.");
  return { baseUrl, apiKey: chave, origem: "canal" };
}

// ─── O WAHA da EMPRESA (para o canal novo herdar) ───────────────────────────
/**
 * O CADASTRO DA EMPRESA: o operador registra o WAHA dela uma vez (`organizations.settings.waha`, sem
 * canal nenhum ainda), e cada número que o lojista conecta depois nasce no MESMO WAHA — o canal novo copia
 * esse cadastro para as próprias colunas (migration 9001). O formato guardado é o mesmo das colunas do
 * canal: `{ base_url, api_key_encrypted }`, com a chave cifrada (nunca em claro).
 *
 * Esta função é pura: lê o `settings` já carregado e devolve o par, ou `null` se não há cadastro.
 */
export function registroDoWahaNasConfiguracoes(settings: unknown): LinhaDoWahaDoCanal | null {
  if (!settings || typeof settings !== "object") return null;
  const bruto = (settings as { waha?: unknown }).waha;
  if (!bruto || typeof bruto !== "object") return null;
  const { base_url: url, api_key_encrypted: chave } = bruto as Record<string, unknown>;
  const waha_base_url = typeof url === "string" && url.trim() !== "" ? url : null;
  const waha_api_key_encrypted = typeof chave === "string" && chave !== "" ? chave : null;
  if (!waha_base_url && !waha_api_key_encrypted) return null;
  return { waha_base_url, waha_api_key_encrypted };
}

/**
 * Onde achar o WAHA da EMPRESA para um canal novo herdar, em ordem: (1) o cadastro da empresa; (2) o canal
 * mais recente dela que já tem endereço próprio (arquivado conta: o WAHA é da empresa) — é o caso de quem
 * conectou antes de existir o cadastro da empresa.
 */
export interface FonteDoWahaDaOrganizacao {
  registroDaEmpresa(organizationId: string): Promise<LinhaDoWahaDoCanal | null>;
  canalMaisRecenteComEndereco(organizationId: string): Promise<LinhaDoWahaDoCanal | null>;
  decifrar: FonteDoWahaDoCanal["decifrar"];
}

export interface WahaDaOrganizacao {
  endereco: EnderecoDoWaha;
  /** As colunas a copiar para o canal novo; `null` quando o WAHA é o global (nada a gravar no canal). */
  colunas: LinhaDoWahaDoCanal | null;
}

/** `null` = a empresa não tem WAHA próprio e o ambiente também não tem: ainda não dá para conectar. */
export async function resolverWahaDaOrganizacao(
  fonte: FonteDoWahaDaOrganizacao,
  organizationId: string,
  ambiente: Record<string, string | undefined> = process.env,
): Promise<WahaDaOrganizacao | null> {
  let linha: LinhaDoWahaDoCanal | null;
  try {
    linha = (await fonte.registroDaEmpresa(organizationId)) ?? (await fonte.canalMaisRecenteComEndereco(organizationId));
  } catch {
    throw new WahaDoCanalError("consulta_falhou", "não consegui ler o cadastro do WhatsApp desta empresa.");
  }
  const endereco = await enderecoDaLinha(linha, fonte.decifrar, ambiente);
  if (!endereco) return null;
  return { endereco, colunas: endereco.origem === "canal" ? linha : null };
}

/** O cliente HTTP do WAHA para um endereço já resolvido. */
export function clienteDoWaha(endereco: EnderecoDoWaha): WahaClient {
  return new WahaClient(endereco.baseUrl, endereco.apiKey);
}

// ─── Fontes ─────────────────────────────────────────────────────────────────
// A fonte do APP (Supabase) mora em `lib/waha/fonte-do-endereco.ts`: ali a consulta por
// `waha_session_name` (UNIQUE na instalação) é resolução exata, e a varredura
// `canal-consulta-por-organizacao` — que protege consulta por identificador NÃO único de outros
// provedores dentro de `lib/channels/` — não se aplica. A do worker (pg) fica aqui.

/** Quem consulta com SQL cru (o worker usa `pg.Pool`). */
export interface ConsultaSql {
  query<T = unknown>(texto: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Worker: `pg` lê a linha e decifra por `fn_decrypt_oauth` (a conexão do worker é service-role). */
export function fonteViaPg(db: ConsultaSql): FonteDoWahaDoCanal {
  return {
    async porSessionRef(sessionRef) {
      const { rows } = await db.query<LinhaDoWahaDoCanal>(
        `select waha_base_url, encode(waha_api_key_encrypted, 'hex') as waha_api_key_encrypted
           from public.channel_sessions where waha_session_name = $1 limit 1`,
        [sessionRef],
      );
      return rows[0] ?? null;
    },
    async decifrar(cifra) {
      const hex = cifra.startsWith("\\x") ? cifra.slice(2) : cifra;
      const { rows } = await db.query<{ chave: string | null }>(
        `select public.fn_decrypt_oauth(decode($1, 'hex')) as chave`,
        [hex],
      );
      return rows[0]?.chave ?? null;
    },
  };
}
