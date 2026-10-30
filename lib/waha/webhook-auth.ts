/**
 * Autenticação dos webhooks do WAHA — fail-closed.
 *
 * O que existia antes era fail-OPEN: se o segredo não pudesse ser obtido
 * (`fn_decrypt_oauth` falhando, ou o campo trazendo um placeholder), a rota
 * marcava `hmacSkipped = true` e **processava o evento assim mesmo**. Como as
 * duas rotas que criam sessão gravam `webhook_secret_encrypted: Buffer.from([0])`
 * — um byte de enfeite —, esse "caso de exceção" era o estado PERMANENTE de toda
 * instalação: qualquer pessoa que soubesse a URL injetava mensagem falsa no CRM
 * alheio, escolhia o remetente e fazia o WhatsApp da vítima responder para um
 * número arbitrário (provado nesta VPS, com `curl` sem header nenhum).
 *
 * Quatro regras, nesta ordem:
 *
 *  0. Canal com WAHA PRÓPRIO (`canalComWahaProprio`, migration 9001) ⇒ a assinatura é SEMPRE exigida e
 *     só vale o segredo do CANAL. O app registrou esse segredo na própria sessão ao criá-la, então o
 *     WAHA da empresa assina todo evento; evento sem assinatura, ou assinado com outro segredo (inclusive
 *     o global `WAHA_HMAC_SECRET`), é recusado. A exigência global e o segredo global não afrouxam isto.
 *  1. Assinatura presente que NÃO confere ⇒ rejeita. Sempre. Não existe motivo
 *     legítimo para alguém assinar errado, e era o buraco mais óbvio.
 *  2. `WAHA_WEBHOOK_REQUIRE_SIGNATURE=true` ⇒ exige assinatura válida em tudo.
 *     O WAHA Core ASSINA — provado contra o WAHA real em 3 versões —, desde que a variável do contêiner
 *     seja `WHATSAPP_HOOK_HMAC_KEY` (com `_KEY`) ou que o segredo vá por sessão (`hmac.key`). O nome SEM
 *     `_KEY` (`WHATSAPP_HOOK_HMAC`) é ignorado pelo WAHA e fazia o contêiner mandar eventos sem
 *     assinatura: foi a medição feita com o nome errado que deu o "o Core não assina" que este arquivo
 *     repetia. A exigência continua desligada por padrão porque um contêiner COMPARTILHADO já instalado
 *     pode ainda estar com o nome antigo, e ligá-la derrubaria a ingestão de todo mundo até ele ser
 *     corrigido; com o nome certo, ligue.
 *  3. Sem assinatura e sem exigência ⇒ aceita, mas devolve `signatureVerified:
 *     false` — e quem chama grava ESSA verdade no log. Antes o log registrava
 *     `valid_signature = true` para evento não verificado.
 *
 * A defesa de rede continua valendo e é independente: a rota global (sem token) pode ser DESLIGADA
 * (`WAHA_WEBHOOK_GLOBAL_ENABLED=false`), e canal com WAHA próprio nunca entra por ela.
 */
import { env } from "@/lib/env";
import { exigirAssinaturaNoWebhookDaInstalacao } from "@/lib/instalacao/comportamento";

import { verifyHmacSha512 } from "./ingest";

/** Curto demais para ser segredo de verdade — é placeholder ou lixo de decrypt. */
const MIN_SECRET_LEN = 16;

export type WahaWebhookAuth =
  | { ok: true; signatureVerified: boolean }
  | { ok: false; reason: "bad_signature" | "signature_required" };

export interface WahaWebhookAuthInput {
  rawBody: string;
  signatureHeader: string | null;
  /** Segredo por sessão já decifrado (null quando não há/não decifrou). */
  sessionSecret: string | null;
  /**
   * O canal usa WAHA próprio: assina com o segredo do canal, sempre. Ver a regra 0 acima. Ausente = canal
   * do modo compartilhado (comportamento de antes).
   */
  canalComWahaProprio?: boolean;
}

export function authenticateWahaWebhook(input: WahaWebhookAuthInput): WahaWebhookAuth {
  const { rawBody, signatureHeader, sessionSecret } = input;

  if (input.canalComWahaProprio) {
    if (!signatureHeader) return { ok: false, reason: "signature_required" };
    if (!sessionSecret || sessionSecret.length < MIN_SECRET_LEN) return { ok: false, reason: "bad_signature" };
    return verifyHmacSha512(rawBody, signatureHeader, sessionSecret)
      ? { ok: true, signatureVerified: true }
      : { ok: false, reason: "bad_signature" };
  }

  const envSecret = (env.WAHA_HMAC_SECRET ?? "").trim();
  const secret =
    sessionSecret && sessionSecret.length >= MIN_SECRET_LEN
      ? sessionSecret
      : envSecret.length >= MIN_SECRET_LEN
        ? envSecret
        : null;

  // A exigência tem DUAS camadas, com a mesma divisão de papéis da política de
  // cadastro: a linha da INSTALAÇÃO (escrita pela tela de admin) está acima, e
  // o `.env` é o PISO — ele responde quando o processo ainda não leu o banco
  // (issue #1034). Sem banco nesta vida do processo, isto é o de hoje.
  const required = exigirAssinaturaNoWebhookDaInstalacao(
    env.WAHA_WEBHOOK_REQUIRE_SIGNATURE === "true",
  );

  if (signatureHeader) {
    // Assinou: tem que conferir. Sem segredo para conferir, não há como
    // confiar — e confiar no que não dá para verificar é o defeito original.
    if (!secret) return { ok: false, reason: "bad_signature" };
    return verifyHmacSha512(rawBody, signatureHeader, secret)
      ? { ok: true, signatureVerified: true }
      : { ok: false, reason: "bad_signature" };
  }

  if (required) return { ok: false, reason: "signature_required" };
  return { ok: true, signatureVerified: false };
}
