/**
 * Adapter WAHA — o primeiro `ChannelAdapter`, e de propósito o mais burro
 * possível: cada método delega ao `lib/waha/*` que já existe e já é testado.
 * Reimplementar aqui é como se perde paridade de comportamento sem perceber.
 *
 * Nenhuma regra de negócio mora neste arquivo (ver `ChannelAdapter` em ../types).
 */
import { wahaContactPayload } from "@/lib/waha/contact-card";
import { fetchWahaMedia } from "@/lib/messaging/media/waha-source";
import { logger } from "@/lib/logger";
import type { WahaClient } from "@/lib/waha/client";
import { wahaSendPlanFor } from "@/lib/waha/media-send";
import {
  resolveCanonicalCusChatId,
  resolvePhoneJidDigitsForCall,
  resolveWhatsappIdForContactCard,
} from "@/lib/waha/resolve-contact-whatsapp-id";
import {
  bareWaMessageId,
  chatIdFromWaMessageId,
  parseWahaMessageId,
  wahaEchoExternalIds,
} from "@/lib/waha/message-id";
import { resolveWahaChatId } from "@/lib/waha/send";
import type { FetchedMedia } from "@/lib/messaging/media/types";
import { DETALHE_CREDENCIAL_RECUSADA } from "../health";
import { clienteDoWahaDaSessao, enderecoDoWahaDaSessao } from "../waha-endpoint-app";
import { WahaDoCanalError } from "../waha-endpoint";
import type { ChannelAdapter, ChannelHealth, OutboundEnvelope, RecipientInput } from "../types";

/**
 * O HTTP que o WAHA devolveu, lido do PREFIXO da mensagem de erro.
 *
 * `lib/waha/client.ts` lança `waha_<status>` ou `waha_<operação>_<status>`, às
 * vezes seguido do corpo da resposta. Procurar `"404"` com `includes` — como
 * este arquivo fazia — varreria o CORPO junto: um `waha_stop_500: {"detail":
 * "upstream 404"}` viraria "sessão parada", dando um transporte quebrado por
 * explicado.
 *
 * Medido, e sem inflar: pelo caminho do `checkHealth` isso NÃO era alcançável
 * hoje — quem ele chama é `getSessionQr`, e essa lança `waha_<status>` seco,
 * sem corpo. A troca é robustez, não o conserto de um defeito observado; o que
 * conserta o defeito observado é o ramo 401/403 abaixo.
 */
export function statusHttpDoErroWaha(msg: string): number | null {
  const m = /^waha_(?:[a-z]+_)?(\d{3})\b/.exec(msg);
  return m ? Number(m[1]) : null;
}

/**
 * O WAHA DESTE canal, para o que é decorativo ou best-effort ("digitando", foto de perfil, tradução
 * de @lid): sem WAHA configurado ou com o cadastro do canal quebrado, devolve `null` e o chamador
 * segue sem o enfeite. O aviso leva só o CÓDIGO da falha, nunca endereço nem chave.
 */
async function clienteOuNull(sessionRef: string): Promise<WahaClient | null> {
  try {
    return await clienteDoWahaDaSessao(sessionRef);
  } catch (err) {
    if (err instanceof WahaDoCanalError) {
      logger.warn("[waha.adapter] cadastro do WAHA do canal quebrado", { code: err.code });
      return null;
    }
    throw err;
  }
}

/**
 * O WAHA DESTE canal, para o que não pode seguir sem ele. Lança com o prefixo `waha_not_configured`
 * (o mesmo `codes.notConfigured`), que o handler de mensagens já traduz em "fila com motivo" — a
 * mesma saída do adaptador do canal oficial. Falha de cadastro do canal entra pelo mesmo caminho,
 * com o código da falha, e NUNCA cai no WAHA global.
 */
async function clienteOuErro(sessionRef: string): Promise<WahaClient> {
  try {
    const client = await clienteDoWahaDaSessao(sessionRef);
    if (client) return client;
  } catch (err) {
    if (err instanceof WahaDoCanalError) throw new Error(`waha_not_configured: ${err.message}`);
    throw err;
  }
  throw new Error("waha_not_configured");
}

/**
 * O envio NOWEB grava só a cauda do id; o webhook grava o id completo. Quando o
 * completo existe, ele também preserva o @lid original do chat — por isso ele
 * vence o endereço resolvido a partir do contato.
 */
async function enderecoDaMensagem(input: { sessionRef: string; recipient: string | null; externalId: string }) {
  const client = await clienteOuErro(input.sessionRef);
  const chatId = chatIdFromWaMessageId(input.externalId) ?? input.recipient;
  if (!chatId) throw new Error("recipient_unavailable");
  return { client, chatId, messageId: idCompletoDaMensagem(input.externalId, chatId) };
}

/**
 * O id que a API do WAHA pede (editar, apagar, citar) é o COMPLETO. Só o que é
 * nosso fica gravado bare — o envio e, desde o #1855, o eco do que o dono digitou
 * no celular —, e o que é nosso é sempre `fromMe`, daí o `true_`. O inbound
 * chega composto e passa intacto.
 */
function idCompletoDaMensagem(externalId: string, chatId: string): string {
  return externalId.includes("_") ? externalId : `true_${chatId}_${bareWaMessageId(externalId)}`;
}

export const wahaAdapter: ChannelAdapter = {
  provider: "waha",

  resolveRecipient(input: RecipientInput): string | null {
    return resolveWahaChatId(input);
  },

  /**
   * As formas que o eco do nosso envio pode ter gravado. A regra mora em
   * `wahaEchoExternalIds` (`lib/waha/message-id.ts`) porque o reenvio do watchdog
   * precisa da MESMA resposta e não passa por este adaptador — o comentário de lá
   * explica as duas pontas de cada engine.
   */
  echoExternalIds(input: { externalId: string; recipient: string }): string[] {
    return wahaEchoExternalIds(input.externalId, input.recipient);
  },

  // SEMPRE `true`, como o adaptador do canal oficial: a pergunta "há WAHA para este canal?" depende
  // do cadastro do canal no banco (cada empresa tem o seu WAHA) e `isConfigured` é síncrono. Quem
  // desiste é `send()`, que LANÇA `waha_not_configured`; o handler traduz o prefixo em fila com motivo
  // — o que o usuário vê é o mesmo de quando o env estava vazio.
  isConfigured(): boolean {
    return true;
  },

  // A resposta PRECISA: este canal tem WAHA (o do canal ou o global)? Cadastro do canal quebrado = false.
  // É o que o handler de mensagens usa para decidir "fila com motivo" antes de gravar o envio.
  async isConfiguredForSession(sessionRef: string): Promise<boolean> {
    return (await clienteOuNull(sessionRef)) !== null;
  },

  // `unknownError` é gravado em `messages.error_message` quando o throw não é
  // um `Error` — valor observável no banco, por isso ele ATRAVESSA o seam com o
  // literal intacto em vez de virar uma string neutra.
  codes: {
    notConfigured: "waha_not_configured",
    sendFailed: "waha_error",
    unknownError: "waha_unknown",
  },

  // A URL vem assinada pelo CDN do WhatsApp e EXPIRA (~9 dias, medido). Quem
  // chama baixa e persiste; guardar a URL faria a foto sumir sozinha depois.
  async fetchProfilePictureUrl(input: {
    sessionRef: string;
    recipient: string;
  }): Promise<string | null> {
    const client = await clienteOuNull(input.sessionRef);
    if (!client) return null;
    return client.getProfilePictureUrl(input.sessionRef, input.recipient);
  },

  /**
   * `lid:123…` → `+5959…`, quando a tabela de tradução do canal já souber.
   *
   * Só para identidade OPACA: `phone:` já traz o número, e perguntar seria
   * gastar uma chamada para receber de volta o que já se tem.
   */
  async resolvePhoneForIdentity(input: {
    sessionRef: string;
    identity: string;
  }): Promise<string | null> {
    if (!input.identity.startsWith("lid:")) return null;
    const client = await clienteOuNull(input.sessionRef);
    if (!client) return null;
    return client.resolvePhoneForLid(input.sessionRef, input.identity.slice("lid:".length));
  },

  /**
   * `check-exists` nas duas grafias do nono dígito; só JID de telefone serve
   * (ver `phoneJidDigitsFromCheckResult`). Transporte não configurado é `null`.
   */
  async resolveRegisteredPhone(input: { sessionRef: string; phone: string }): Promise<string | null> {
    const client = await clienteOuNull(input.sessionRef);
    if (!client) return null;
    return resolvePhoneJidDigitsForCall(client, input.sessionRef, input.phone);
  },

  /**
   * "digitando…" no aparelho do cliente, antes da 1ª bolha do turno da IA.
   *
   * Transporte não configurado é NOOP, não erro — mesmo critério do `send`
   * logo abaixo: numa instalação sem o container de pé o produto não pode
   * parar por causa de um indicador decorativo.
   */
  async signalTyping(input: { sessionRef: string; recipient: string }): Promise<void> {
    const client = await clienteOuNull(input.sessionRef);
    if (!client) return;
    await client.setPresence(input.sessionRef, input.recipient, "typing");
  },

  async editMessage(input: {
    sessionRef: string;
    recipient: string | null;
    externalId: string;
    text: string;
  }): Promise<void> {
    const { client, chatId, messageId } = await enderecoDaMensagem(input);
    await client.editMessage(input.sessionRef, chatId, messageId, input.text);
  },

  async revokeMessage(input: {
    sessionRef: string;
    recipient: string | null;
    externalId: string;
  }): Promise<void> {
    const { client, chatId, messageId } = await enderecoDaMensagem(input);
    await client.deleteMessage(input.sessionRef, chatId, messageId);
  },

  /**
   * Pergunta ao transporte se a conexão está de pé.
   *
   * Três desfechos, e a diferença entre eles é o que o operador vai FAZER:
   *
   *   - respondeu com estado → é a verdade do momento;
   *   - 404 → a sessão não existe mais lá dentro. Não é erro de rede: é a
   *     resposta, e ela quer dizer parada. Sem este ramo o caso mais comum de
   *     desconexão (o transporte esqueceu a sessão) viraria "não deu para
   *     perguntar" e não alertaria ninguém;
   *   - qualquer outro erro → NÃO sabemos. Devolver um estado aqui seria
   *     inventar: uma oscilação de rede viraria "canal caído" e o operador
   *     aprenderia a ignorar o aviso.
   */
  async checkHealth(input: { sessionRef: string }): Promise<ChannelHealth> {
    let client: WahaClient | null;
    try {
      client = await clienteDoWahaDaSessao(input.sessionRef);
    } catch (err) {
      // Cadastro do WAHA deste canal quebrado: não se sabe o estado da sessão (reachable: false) e o
      // `detail` diz que o problema é o cadastro, não a rede. Nunca pergunta ao WAHA global.
      if (err instanceof WahaDoCanalError) {
        return { reachable: false, status: null, detail: `waha_do_canal_${err.code}` };
      }
      throw err;
    }
    if (!client) return { reachable: false, status: null, detail: "transporte_nao_configurado" };
    try {
      const r = await client.getSessionQr(input.sessionRef);
      return { reachable: true, status: r.status ?? null, detail: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "erro_desconhecido";
      const http = statusHttpDoErroWaha(msg);

      // Sessão não existe no transporte → parada. É o único desfecho em que
      // dá para AFIRMAR o estado da sessão a partir de um erro.
      if (http === 404) return { reachable: true, status: "STOPPED", detail: null };

      // A chave foi recusada. Não é o estado da sessão que está em jogo — é o
      // acesso ao transporte inteiro, e enquanto durar NENHUMA conexão
      // funciona. Continua `reachable: false` porque de fato não se sabe o
      // estado da sessão; o que muda é o `detail`, que a Central lê para dizer
      // ao operador que escanear o QR não vai resolver.
      //
      // Sem isto, um 401 caía no ramo genérico e virava "Não foi possível
      // verificar a conexão" — um aviso `warn` que descreve oscilação de rede.
      // Numa VPS real isso durou TRÊS DIAS: a chave do WAHA tinha sido trocada
      // por uma segunda cópia do repo, nada funcionava, e a única pista visível
      // sugeria um soluço passageiro.
      if (http === 401 || http === 403) {
        return { reachable: false, status: null, detail: DETALHE_CREDENCIAL_RECUSADA };
      }

      return { reachable: false, status: null, detail: msg.slice(0, 200) };
    }
  },

  async listGroups(input: { sessionRef: string }) {
    const client = await clienteOuErro(input.sessionRef);
    return client.listarGrupos(input.sessionRef);
  },

  async setGroupIntake(input: { sessionRef: string; receive: boolean }) {
    const client = await clienteOuNull(input.sessionRef);
    if (!client) return false;
    return client.definirRecebimentoDeGrupos(input.sessionRef, input.receive);
  },

  /**
   * Baixa o anexo que o cliente mandou.
   *
   * Delega em `fetchWahaMedia`, que o worker de persistência chamava FIXO — era
   * essa linha que fazia a mídia de qualquer outro canal virar linha sem bytes.
   * O comportamento aqui é idêntico ao de antes: mesma função, mesmos
   * argumentos. O que mudou é quem a escolhe.
   */
  async fetchInboundMedia(input: {
    sessionRef: string;
    url: string;
    hintMime?: string | null;
  }): Promise<FetchedMedia> {
    // Devolve o objeto INTEIRO, sem remontar campo a campo: `FetchedMedia` é o
    // mesmo tipo dos dois lados, e reconstruí-lo faria a próxima adição de
    // campo sumir em silêncio aqui no meio.
    // A mídia mora no WAHA DESTE canal; a base do download vem do cadastro do canal (ou do global).
    let endereco: Awaited<ReturnType<typeof enderecoDoWahaDaSessao>>;
    try {
      endereco = await enderecoDoWahaDaSessao(input.sessionRef);
    } catch (err) {
      if (err instanceof WahaDoCanalError) throw new Error(`waha_not_configured: ${err.message}`);
      throw err;
    }
    if (!endereco) throw new Error("waha_not_configured");
    return fetchWahaMedia(input.url, input.hintMime ?? null, endereco);
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    // LANÇA `waha_not_configured` (e não devolve `{externalId: null}`) quando não há WAHA para este
    // canal: com `isConfigured` sempre true, quem desiste é este ponto, e `null` faria o handler gravar
    // "enviado" sem id para algo que nunca saiu. O handler traduz o prefixo em fila com o motivo.
    const client = await clienteOuErro(envelope.sessionRef);

    const to = await resolveCanonicalCusChatId(client, envelope.sessionRef, envelope.to);

    // A estrutura de três caminhos é do upstream (o cartão de contato entrou
    // depois da citação). O que se enxerta aqui é o `replyToExternalId` no
    // caminho de TEXTO — os outros dois não citam: o WAHA aceita `reply_to` só
    // no `sendText`, e mandá-lo nos outros seria pedir para a API ignorar em
    // silêncio, que é como se perde uma feature sem ninguém notar.
    let res: unknown;
    if (envelope.kind === "contact" && envelope.contact) {
      const resolvedId = await resolveWhatsappIdForContactCard(
        client,
        envelope.sessionRef,
        envelope.contact.phoneNumber,
      );
      const contact = wahaContactPayload(
        envelope.contact.fullName,
        envelope.contact.phoneNumber,
        resolvedId ?? envelope.contact.whatsappId,
      );
      await envelope.beforeSend?.();
      res = await client.sendContactVcard(envelope.sessionRef, to, [contact]);
    } else if (envelope.media) {
      await envelope.beforeSend?.();
      res = await client.sendMedia(
        envelope.sessionRef,
        to,
        wahaSendPlanFor(envelope.kind, envelope.media),
      );
    } else {
      await envelope.beforeSend?.();
      res = await client.sendMessage(
        envelope.sessionRef,
        to,
        envelope.body ?? "",
        // A citação é enfeite da conversa, nunca condição de envio: quando não
        // há, o envio segue igual. Ver `OutboundEnvelope.replyToExternalId`.
        envelope.replyToExternalId ? idCompletoDaMensagem(envelope.replyToExternalId, to) : null,
      );
    }

    return { externalId: parseWahaMessageId(res) };
  },
};
