/**
 * A CONFERÊNCIA DO "DEPOIS" NO TURNO — o que o `send_message` faz ANTES de chamar a
 * cadeia `before_send` (`docs/14-spec-jev.md`, seções 2, 3.3 e 8.4 risco 4).
 *
 * A cadeia toma um lock por número (`pg_advisory_xact_lock`) e o segura enquanto
 * julga e envia. O Jev é rede (até 1,5 s): chamá-lo com o lock na mão seria fazer
 * todo o número esperar o fornecedor. Por isso o veredito é calculado AQUI, antes, e
 * a cadeia só o lê (`jevConferenciaGate`, `ctx.conferenciaJev`).
 *
 * ═══ QUANDO NÃO FAZ NADA (e devolve `undefined`) ═══
 *
 *  - prévia de teste (sem chamada externa e sem custo real: simulação não vira
 *    concordância, R5);
 *  - um turno que não é o da mensagem nova (`inbound_turn`): o `case_reply_turn`
 *    responde a uma ação humana, e o follow-up é texto de código;
 *  - o interruptor da INSTALAÇÃO desligado (`JEV_CONFERENCIA_ENABLED`) — vale também
 *    para as regras locais: "a tarefa só roda com todas as condições juntas";
 *  - a tarefa `conferencia` desligada na empresa (interruptor mestre, aceite de
 *    `resposta` ou estado).
 *
 * ═══ O QUE FAZ ═══
 *
 * Regras locais L1 a L6 e, se elas não bastaram e há rascunho sem segredo, o Jev; a
 * junção em que o Jev só aperta (`conferirOMeuRascunho`); grava o custo e a observação
 * (`registrarConferenciaDoJev`); e devolve o que a cadeia precisa, com um motivo em
 * português para o modelo e um `detail` de rótulos e números para o trace — nunca o
 * rascunho, a senha nem texto de documento.
 *
 * Nunca lança: o turno é o atendimento do cliente. Qualquer falha aqui vira
 * "sem conferência", e a cadeia segue como seguia.
 */
import type pg from "pg";

import { conferirOMeuRascunho, type VeredictoDoDepois } from "@/lib/ai/decisao/conferencia";
import type { DependenciasDoPonto } from "@/lib/ai/decisao/ponto";
import { interruptorDaInstalacaoLigado } from "@/lib/ai/decisao/interruptores";
import { registrarConferenciaDoJev } from "@/lib/ai/decisao/observacao-da-conferencia";
import { estadoDaTarefaNoPool } from "@/lib/ai/decisao/pool";
import { TAREFA_DA_CONFERENCIA } from "@/lib/ai/decisao/tarefas";
import { logger } from "@/lib/logger";

import type { ConferenciaJevNoGate } from "../guardrails/before-send";
import type { EvidenciasDoTurno } from "./evidencias-do-turno";

export interface EntradaDaConferenciaNoTurno {
  pool: pg.Pool;
  organizationId: string;
  /** `inbound_turn` é o único que confere. */
  tipoDoJob: string;
  preview: boolean;
  rascunho: string;
  evidencias: Pick<EvidenciasDoTurno, "todas" | "consultou" | "senhasDoCliente" | "documentosDoCliente">;
  /** Só para MASCARAR o nome no que vai ao Jev; nunca é enviado. */
  nomeDoContato?: string | null;
  conversationId: string | null;
  /** A mensagem de ENTRADA do cliente: a chave da observação. */
  messageId: string | null;
  jobId: string | null;
  contactId: string | null;
  agentId: string | null;
}

const PERGUNTA_EM_PALAVRAS: Readonly<Record<string, string>> = {
  sem_fonte: "um preço, prazo ou garantia que não aparece nas fontes que você consultou",
  promete_aprovacao: "a aprovação de crédito, financiamento ou boleto como certa",
  inventa_dado: "um fato sobre produto, serviço, estoque, loja ou regra que não aparece nas fontes que você consultou",
};

/** O erro de ensino que volta ao MODELO: o que foi segurado e o que fazer. */
export function motivoParaOModelo(v: VeredictoDoDepois): string {
  const doLocal = [...new Set(v.local.achados.map((a) => a.motivo))].slice(0, 3);
  const partes: string[] = [];
  if (doLocal.length > 0) partes.push(...doLocal.map((m) => `- ${m}`));
  if (v.jev !== null && v.jev.faixa === "alta") {
    partes.push(`- o verificador acha muito provável que a resposta afirma ${PERGUNTA_EM_PALAVRAS[v.jev.pergunta]}.`);
  }
  return (
    "A sua resposta NÃO foi enviada, porque a conferência antes do envio encontrou:\n" +
    `${partes.join("\n")}\n` +
    "Reescreva usando SOMENTE o que está nas fontes que você consultou neste turno (catálogo, banco de dados e " +
    "base de conhecimento). O que você não leu, não afirme: diga que a equipe confirma."
  );
}

/** Rótulos e números curtos para o trace — a prova do que a conferência viu, sem o conteúdo. */
export function detalheDoTrace(v: VeredictoDoDepois): Record<string, string | number> {
  const detalhe: Record<string, string | number> = {
    faixa: v.faixa,
    origem: v.origem,
    conferida_pelo_jev: v.conferidaPeloJev ? 1 : 0,
  };
  if (v.local.achados.length > 0) detalhe.regras = [...new Set(v.local.achados.map((a) => a.regra))].join(",");
  if (v.jev !== null) {
    detalhe.pergunta = v.jev.pergunta;
    detalhe.jev_maior = Math.round(v.jev.maior * 100) / 100;
  }
  if (v.duvida) detalhe.duvida = 1;
  return detalhe;
}

export async function conferirOTurno(
  e: EntradaDaConferenciaNoTurno,
  deps: DependenciasDoPonto & { tetoMs?: number } = {},
): Promise<ConferenciaJevNoGate | undefined> {
  try {
    if (e.preview || e.tipoDoJob !== "inbound_turn") return undefined;
    if (e.rascunho.trim() === "") return undefined;
    if (!interruptorDaInstalacaoLigado(TAREFA_DA_CONFERENCIA.id)) return undefined;

    const estado = await estadoDaTarefaNoPool(e.pool, e.organizationId, TAREFA_DA_CONFERENCIA);
    if (estado === "desligada") return undefined;

    const { veredito, pergunta } = await conferirOMeuRascunho(
      e.organizationId,
      { rascunho: e.rascunho, evidencias: e.evidencias, nomeDoContato: e.nomeDoContato ?? null },
      deps,
    );

    if (pergunta.ok) {
      await registrarConferenciaDoJev(e.pool, {
        organizationId: e.organizationId,
        estado,
        conversationId: e.conversationId,
        messageId: e.messageId,
        jobId: e.jobId,
        contactId: e.contactId,
        agentId: e.agentId,
        veredito,
        uso: pergunta.uso,
        modelo: pergunta.modelo,
        latenciaMs: pergunta.latenciaMs,
      });
    }

    return {
      estado,
      segurar: veredito.segurar,
      motivo: veredito.segurar ? motivoParaOModelo(veredito) : "",
      detail: detalheDoTrace(veredito),
    };
  } catch (erro) {
    logger.warn("conferência da resposta falhou; a cadeia segue sem ela", {
      organization_id: e.organizationId,
      erro: erro instanceof Error ? erro.name : typeof erro,
    });
    return undefined;
  }
}
