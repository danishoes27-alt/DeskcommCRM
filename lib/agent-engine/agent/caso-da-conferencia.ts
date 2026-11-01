/**
 * O CASO DA RESPOSTA SEGURADA — a equipe assume quando a conferência reprova a
 * resposta duas vezes (`docs/14-spec-jev.md`, seção 3.4 e ambiguidade 4).
 *
 * A 2ª reprovação (`resposta-segurada.ts`) segura a resposta de vez. Aqui:
 *
 *  - **abre um caso** pelo sistema que já existe (`openCase`), NA EMPRESA DO TURNO
 *    (o `tenantId` vem do turno, nunca do corpo nem do modelo), com o rascunho
 *    segurado e as razões para quem vai atender ver o que a IA queria dizer;
 *  - **se a conversa já tem caso aberto, NÃO abre outro** (só pode haver um por
 *    conversa): anota o fato na linha do tempo do caso existente
 *    (`registrarNotaDoAgente`), para a equipe ver que há uma resposta segurada
 *    esperando;
 *  - **registra o desfecho no rastro** (`before_send_traces`) numa linha própria,
 *    `vetoed_code = 'resposta_segurada'`, só em rótulos — nunca o rascunho.
 *
 * A origem do caso é `guardrail_autofallback`: a regra do banco restringe
 * `agent_cases.source` a `agent` e `guardrail_autofallback`, e uma origem própria do
 * Jev é a migração OPCIONAL do plano (seção 5), que não vale uma migração só pelo
 * rótulo. O `context_snapshot` leva `origem: 'jev_conferencia'` para quem precisar
 * distinguir.
 *
 * Nunca lança: o turno é o atendimento do cliente. Falhou, o desfecho é `caso_falhou`
 * — a resposta continua segurada e o aviso ao cliente (T15) ainda sai.
 */
import type pg from "pg";

import { mascararSegredos } from "../guardrails/mascarar-segredos";
import { openCase, registrarNotaDoAgente, type CaseIds } from "./human-cases";

/**
 * A nota que marca, na linha do tempo do caso, que o cliente JÁ recebeu o aviso fixo ("vou
 * confirmar com a equipe…"). É o que faz o aviso sair UMA ÚNICA VEZ por conversa quando já havia
 * caso aberto (spec 14, ambiguidade 4): sem uma marca durável, cada nova resposta segurada na
 * mesma conversa mandaria o mesmo aviso de novo.
 */
export const NOTA_DO_AVISO_AO_CLIENTE =
  "O cliente recebeu o aviso de que a equipe vai confirmar a informação. Respostas seguintes que ficarem seguradas nesta conversa não repetem o aviso.";

export type DesfechoDoCaso =
  | { desfecho: "caso_aberto"; caseId: string }
  /** A conversa JÁ tinha caso aberto: nenhum novo, e a nota entrou no existente (`caseId` nulo se não foi achado). */
  | { desfecho: "caso_ja_aberto"; caseId: string | null; avisoJaDado: boolean }
  | { desfecho: "caso_falhou" };

export interface EntradaDoCasoDaConferencia {
  ids: CaseIds;
  /** A resposta que a IA queria enviar — segurada. */
  rascunho: string;
  /** A mensagem de ensino da última reprovação (`chain.message`): dela saem as razões. */
  motivoDoVeto: string;
  /** A senha que o cliente informou (cofre do turno): sai do rascunho antes de ir ao caso. */
  senhasDoCliente?: readonly string[];
  /** O mesmo recorte de contexto que o `open_human_case` do modelo grava. */
  contextSnapshot: Record<string, unknown>;
  /** Para a linha de rastro. */
  rastro: { jobId: string; contactId: string | null; channelSessionId: string };
  /** Rótulos da conferência (faixa, origem, regras): vão ao rastro, nunca texto. */
  detalhe?: Record<string, string | number>;
}

/** As razões da reprovação, tiradas do texto de ensino: as linhas "- …" (sem a instrução final ao modelo). */
export function razoesDoMotivo(motivo: string): string[] {
  return motivo
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter((l) => l !== "");
}

const TITULO = "Resposta da IA segurada pela conferência";

function montarOCaso(e: EntradaDoCasoDaConferencia) {
  const razoes = razoesDoMotivo(e.motivoDoVeto);
  // O rascunho é interno (a equipe vê o que a IA queria dizer), mas a senha do cliente
  // não mora num caso: sai antes, junto do que a máscara tira.
  const rascunho = mascararSegredos(e.rascunho, { valoresSecretos: e.senhasDoCliente ?? [] });
  return {
    title: TITULO,
    summary: `A IA preparou esta resposta, mas ela NÃO foi enviada ao cliente:\n\n${rascunho}`.slice(0, 3_900),
    blocker: (
      "A conferência antes do envio reprovou a resposta duas vezes" +
      (razoes.length > 0 ? `: ${razoes.join(" ")}` : ".") +
      " Confirme a informação e responda ao cliente."
    ).slice(0, 950),
  };
}

async function registrarORastro(pool: pg.Pool, e: EntradaDoCasoDaConferencia, desfecho: DesfechoDoCaso["desfecho"]): Promise<void> {
  try {
    await pool.query(
      `insert into before_send_traces
         (organization_id, job_id, contact_id, channel_session_id, trace, vetoed_gate, vetoed_code)
       values ($1, $2, $3, $4, $5, 'jev_conferencia', 'resposta_segurada')`,
      [
        e.ids.tenantId,
        e.rastro.jobId,
        e.rastro.contactId,
        e.rastro.channelSessionId,
        JSON.stringify([
          {
            gate: "jev_conferencia",
            verdict: "veto",
            code: "resposta_segurada",
            detail: { ...(e.detalhe ?? {}), caso: desfecho },
          },
        ]),
      ],
    );
  } catch {
    // O rastro é auditoria: perdê-lo não pode derrubar o turno. O log do turno é o backup.
  }
}

/** Abre o caso (ou anota no existente) e registra o desfecho no rastro. Nunca lança. */
export async function abrirOCasoDaRespostaSegurada(
  pool: pg.Pool,
  e: EntradaDoCasoDaConferencia,
): Promise<DesfechoDoCaso> {
  let resultado: DesfechoDoCaso;
  try {
    const aberto = await openCase(pool, e.ids, {
      ...montarOCaso(e),
      contextSnapshot: { ...e.contextSnapshot, origem: "jev_conferencia" },
      source: "guardrail_autofallback",
      kind: "duvida",
    });
    if (aberto.ok) {
      resultado = { desfecho: "caso_aberto", caseId: aberto.caseId };
    } else if (aberto.error.code === "case_already_open") {
      const existente = await anotarNoCasoExistente(pool, e);
      resultado = { desfecho: "caso_ja_aberto", caseId: existente.caseId, avisoJaDado: existente.avisoJaDado };
    } else {
      resultado = { desfecho: "caso_falhou" };
    }
  } catch {
    resultado = { desfecho: "caso_falhou" };
  }
  await registrarORastro(pool, e, resultado.desfecho);
  return resultado;
}

/**
 * A conversa já tem caso: a equipe vê, na linha do tempo dele, que outra resposta ficou segurada.
 * Devolve também se o cliente JÁ tinha sido avisado neste caso (a marca de `NOTA_DO_AVISO_AO_CLIENTE`),
 * lida ANTES de a nota nova entrar. Falha ao ler = "já avisado": na dúvida, o cliente não recebe o
 * mesmo aviso duas vezes.
 */
async function anotarNoCasoExistente(
  pool: pg.Pool,
  e: EntradaDoCasoDaConferencia,
): Promise<{ caseId: string | null; avisoJaDado: boolean }> {
  try {
    const { rows } = await pool.query<{ id: string; avisado: boolean }>(
      `select c.id,
              exists (
                select 1 from agent_case_events ev
                 where ev.organization_id = c.organization_id and ev.case_id = c.id
                   and ev.kind = 'agent_noted' and ev.body = $4
              ) as avisado
         from agent_cases c
        where c.organization_id = $1 and c.conversation_id = $2 and c.status = any($3::text[])
        order by c.created_at desc
        limit 1`,
      [e.ids.tenantId, e.ids.conversationId, ["awaiting_human", "awaiting_lead"], NOTA_DO_AVISO_AO_CLIENTE],
    );
    const caso = rows[0];
    if (caso === undefined) return { caseId: null, avisoJaDado: false };
    await registrarNotaDoAgente(
      pool,
      e.ids.tenantId,
      caso.id,
      "Outra resposta da IA foi segurada pela conferência antes do envio e não foi mandada ao cliente. " +
        "Confirme a informação e responda a ele.",
    );
    return { caseId: caso.id, avisoJaDado: caso.avisado === true };
  } catch {
    return { caseId: null, avisoJaDado: true };
  }
}

/** Marca no caso que o cliente recebeu o aviso fixo. Nunca lança. */
export async function marcarOAvisoNoCaso(pool: pg.Pool, tenantId: string, caseId: string): Promise<void> {
  try {
    await registrarNotaDoAgente(pool, tenantId, caseId, NOTA_DO_AVISO_AO_CLIENTE);
  } catch {
    // A marca é conveniência de deduplicação: sem ela, no pior caso o aviso sai uma vez a mais.
  }
}

/**
 * O cliente deve receber o aviso fixo agora? Sempre que o caso foi aberto AGORA (uma vez por
 * resposta segurada) ou nem abriu; quando já havia caso, só se ele ainda não tinha sido avisado.
 */
export function devoAvisarOCliente(caso: DesfechoDoCaso): boolean {
  return caso.desfecho !== "caso_ja_aberto" || !caso.avisoJaDado;
}
