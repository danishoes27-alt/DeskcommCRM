/**
 * O COFRE DO TURNO — a senha que o cliente digitou e o texto dos documentos que
 * ele enviou, guardados SÓ para a conferência local (L4 e L5) comparar com o
 * rascunho (`docs/14-spec-jev.md`, seções 3.3 e 6.1).
 *
 * Lê as mensagens do contexto que o turno já carregou, e põe no cofre de
 * `EvidenciasDoTurno`. Nada é gravado, logado ou enviado: a senha e o texto do
 * documento não saem da memória deste processo, e morrem com o turno. Esta
 * função também não devolve os valores — só quantos guardou, que é o que se pode
 * dizer em log sem vazar nada.
 */
import type { EvidenciasDoTurno } from "./evidencias-do-turno";
import { encontrarSenhas } from "../guardrails/mascarar-segredos";

/** O que o turno sabe de cada mensagem do contexto (um recorte de `LeadContextMessage`). */
export interface MensagemDoContexto {
  direction: "inbound" | "outbound";
  body: string;
  /** Presente só em mensagem com mídia (`document`, `audio`, `image`…). */
  type?: string;
}

/** O início da moldura que o turno põe em volta de uma mídia (`get-lead-context.ts`). */
const INICIO_DA_MOLDURA_DE_MIDIA = "[Mídia do cliente:";
/** Marcador sem conteúdo ("[document]", "[imagem]") — não é texto de documento. */
const SO_MARCADOR = /^\[[^\]]{1,40}\]$/u;
/** Texto de documento curto demais para ter 8 palavras seguidas não vale o cofre. */
const DOCUMENTO_MINIMO = 40;

export function guardarSegredosDoCliente(
  evidencias: Pick<EvidenciasDoTurno, "guardarSenhaDoCliente" | "guardarDocumentoDoCliente">,
  mensagens: readonly MensagemDoContexto[],
  organizationId: string,
): { senhas: number; documentos: number } {
  let senhas = 0;
  let documentos = 0;
  try {
    for (const m of mensagens) {
      if (m.direction !== "inbound" || m.body === "") continue;
      if (m.type === "document") {
        const t = m.body.trim();
        if (t.length >= DOCUMENTO_MINIMO && !SO_MARCADOR.test(t) && evidencias.guardarDocumentoDoCliente(t, organizationId)) {
          documentos += 1;
        }
        continue;
      }
      // Texto digitado e áudio transcrito: o cliente pode ter dito a senha de
      // qualquer um dos dois jeitos. A foto não tem texto digitado.
      if (m.type === "image" || m.body.startsWith(INICIO_DA_MOLDURA_DE_MIDIA)) continue;
      for (const achada of encontrarSenhas(m.body)) {
        if (evidencias.guardarSenhaDoCliente(achada.valor, organizationId)) senhas += 1;
      }
    }
  } catch {
    // Nunca lança: o cofre vazio só deixa L4/L5 sem o que comparar — o turno do cliente segue.
  }
  return { senhas, documentos };
}
