/**
 * A MARCA "URGENTE" DO JEV NO CARTÃO DA CONVERSA (r3, T21; spec 14, seção 3.2 e ambiguidade 5).
 *
 * A triagem do "antes" pergunta se a mensagem mostra pressa ou insatisfação forte. Com
 * probabilidade a partir de 0,80 — e a tarefa em `decidindo` — o cartão da conversa na lista
 * ganha a marca "Urgente". **Só marca**: não muda o destino da mensagem, não abre caso, não
 * passa a conversa e não muda a ordem da fila. O corte pode ser ajustado durante a observação.
 *
 * Mora em `conversations.metadata.jev_urgente` (jsonb que a lista já carrega, sem migração):
 * `{ em, message_id }` — rótulos, nunca texto. A marca acompanha a mensagem MAIS RECENTE: se a
 * triagem seguinte diz que não é urgente, a marca sai (`desmarcado`). Escrita pelo turno com
 * a organização do turno; lida pela lista da inbox.
 */

export const CHAVE_DA_MARCA_URGENTE = "jev_urgente";

/** A conversa tem a marca de urgente? Tolera `metadata` nulo, não-objeto ou sem a chave. */
export function conversaMarcadaComoUrgente(metadata: unknown): boolean {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const marca = (metadata as Record<string, unknown>)[CHAVE_DA_MARCA_URGENTE];
  return marca !== null && typeof marca === "object" && !Array.isArray(marca);
}
