/**
 * A RESPOSTA SEGURADA — a regra das duas tentativas da conferência do "depois"
 * (`docs/14-spec-jev.md`, seções 3.3 e 3.4).
 *
 * Quando a conferência (regras da casa + Jev) reprova a resposta da IA, em
 * `decidindo`:
 *
 *  - **1ª reprovação no turno** — o motivo volta ao MODELO como erro de ensino, para
 *    ele reescrever SÓ com o que está nas fontes consultadas. O cliente não recebe
 *    nada dessa tentativa.
 *  - **2ª reprovação** — a resposta fica segurada de vez. Nada mais sai neste turno
 *    (o modelo é mandado parar); a T14 abre o caso para a equipe e a T15 manda ao
 *    cliente o aviso fixo.
 *
 * É o mesmo degrau dos fail-safes irmãos (promessa de humano, vocabulário interno),
 * com uma diferença que importa: aqueles LIBERAM o envio na segunda vez, porque o
 * pior desfecho deles é o cliente sem resposta. Este SEGURA — o pior desfecho dele
 * é uma resposta errada que sai, e é por isso que a segunda reprovação não solta
 * o texto, e sim chama uma pessoa.
 *
 * A decisão é uma função pura sobre o contador do turno (por turno, no closure do
 * `send_message`; nunca entre turnos), para ser testada sem o turno inteiro.
 */

export const CODIGO_DA_CONFERENCIA = "jev_conferencia";
export const CODIGO_DA_RESPOSTA_SEGURADA = "resposta_segurada";

/** Quantas reprovações o turno tolera: a 1ª ensina, a 2ª segura de vez. */
export const MAX_VETOS_DA_CONFERENCIA = 2;

export type DecisaoDoVeto =
  /** Devolve o motivo ao modelo; o cliente não recebe nada. */
  | { acao: "reescrever" }
  /** Segura de vez: nada mais sai neste turno. */
  | { acao: "segurar_de_vez" };

/** `vetosNoTurno` já conta o veto de agora (o primeiro é 1). */
export function decidirOVetoDaConferencia(vetosNoTurno: number): DecisaoDoVeto {
  return vetosNoTurno < MAX_VETOS_DA_CONFERENCIA ? { acao: "reescrever" } : { acao: "segurar_de_vez" };
}

/** O que volta ao modelo quando a resposta é segurada de vez (e em toda tentativa seguinte do turno). */
export const MENSAGEM_DA_RESPOSTA_SEGURADA =
  "Esta resposta foi SEGURADA: a conferência a reprovou duas vezes e a equipe vai assumir a conversa. " +
  "NÃO chame send_message de novo neste turno e NÃO tente enviar outra versão — encerre agora.";

/** O erro de ensino do turno quando a resposta já foi segurada de vez. */
export function erroDaRespostaSegurada(): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code: CODIGO_DA_RESPOSTA_SEGURADA, message: MENSAGEM_DA_RESPOSTA_SEGURADA } };
}
