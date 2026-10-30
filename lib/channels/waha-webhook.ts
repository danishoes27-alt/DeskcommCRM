/**
 * O WEBHOOK DE CADA CANAL: endereço com token, eventos e segredo de assinatura PRÓPRIOS.
 *
 * ─── O desenho (provado no Bloco A, contra o WAHA real, 3 versões) ─────────────────────────────────
 * O WAHA Core aceita `config.webhooks[]` POR SESSÃO, com `hmac.key` próprio, e assina cada evento com
 * HMAC-SHA512 no cabeçalho `X-Webhook-Hmac`. Então o contêiner de uma empresa fica GENÉRICO — só chave de
 * API e volume, sem `WHATSAPP_HOOK_URL` — e o app diz à sessão, ao criá-la, para onde mandar os eventos
 * e com qual segredo assinar:
 *
 *   url   = <base pública do app>/api/v1/webhooks/waha/<token do canal>      (o token já existe, é único)
 *   hmac  = segredo ALEATÓRIO do canal (48 hex), cifrado em `webhook_secret_encrypted`
 *
 * Cada evento só confere com o segredo da sessão que o emitiu: o evento do canal A nunca passa na
 * rota/segredo do canal B (provado: 84 eventos, 0 na URL errada).
 *
 * A variável de ambiente GLOBAL de assinatura do contêiner compartilhado é `WHATSAPP_HOOK_HMAC_KEY`
 * (o nome SEM `_KEY` é ignorado pelo WAHA e fazia o contêiner mandar eventos sem assinatura).
 */
import { randomBytes } from "node:crypto";

/**
 * Os eventos que o app consome. É a MESMA lista do `WHATSAPP_HOOK_EVENTS` dos arquivos compose do
 * contêiner compartilhado (cerca: `lib/channels/waha-webhook.test.ts`). `message` NÃO
 * entra: `message.any` é superconjunto estrito (medido em 22.815 mensagens reais).
 */
export const EVENTOS_DO_WEBHOOK_DO_WAHA = [
  "message.any",
  "message.ack",
  "message.edited",
  "message.revoked",
  "session.status",
  "state.change",
] as const;

/** Mesmo mínimo de `lib/waha/webhook-auth.ts`: abaixo disso é enfeite ou lixo de decifragem, não segredo. */
export const TAMANHO_MINIMO_DO_SEGREDO_DO_WEBHOOK = 16;

/** O que o WAHA recebe em `config.webhooks[]` ao criar (ou reaplicar) a sessão. */
export interface WebhookDaSessao {
  url: string;
  events: readonly string[];
  hmacKey: string;
}

/** Segredo novo e imprevisível para o canal: 24 bytes aleatórios = 48 hexadecimais. */
export function novoSegredoDoWebhook(): string {
  return randomBytes(24).toString("hex");
}

/** O token do canal vai na URL: só caracteres seguros, e comprido o bastante para não ser adivinhável. */
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{8,}$/;

/**
 * A URL que o WAHA vai chamar. `baseUrl` é a URL pública do app (ou a interna da rede do contêiner);
 * LANÇA se não for http(s) ou se o token não servir, em vez de mandar o WAHA para um destino torto.
 */
export function urlDoWebhookDoCanal(baseUrl: string, token: string): string {
  let base: URL;
  try {
    base = new URL(baseUrl.trim());
  } catch {
    throw new Error("webhook_base_url_invalida");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("webhook_base_url_invalida");
  if (base.username || base.password || base.search || base.hash) throw new Error("webhook_base_url_invalida");
  if (!TOKEN_VALIDO.test(token)) throw new Error("webhook_token_invalido");
  return `${base.toString().replace(/\/+$/, "")}/api/v1/webhooks/waha/${token}`;
}

export function webhookDaSessao(baseUrl: string, token: string, hmacKey: string): WebhookDaSessao {
  if (hmacKey.length < TAMANHO_MINIMO_DO_SEGREDO_DO_WEBHOOK) throw new Error("webhook_segredo_curto");
  return { url: urlDoWebhookDoCanal(baseUrl, token), events: EVENTOS_DO_WEBHOOK_DO_WAHA, hmacKey };
}

/** O formato de `config.webhooks[]` do WAHA. */
export function webhookParaOWaha(w: WebhookDaSessao) {
  return { url: w.url, events: [...w.events], hmac: { key: w.hmacKey } };
}
