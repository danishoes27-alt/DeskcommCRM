/**
 * O CUSTO E A OBSERVAÇÃO DO ANTES — o que se grava de cada chamada à triagem
 * (`docs/14-spec-jev.md`, seções 7.3 e 8.1, D13; [DESENHO] da T18 fechado aqui).
 *
 *  - **UMA linha em `llm_calls` por chamada** (finalidade `jev_antes`), mesmo com as três
 *    perguntas. Custo fracionário pelo id EXATO do modelo; sem preço, `null`.
 *  - **UMA observação em `jev_observacoes`** por (empresa, `triagem`, mensagem de entrada):
 *    `rotulo_jev` = o `destino` (a pergunta que age), `probabilidade_jev`/`confianca_jev` as
 *    dele, `rotulo_atual` VAZIO — não há "mecanismo de hoje" para comparar, e a concordância
 *    aparece como "sem par". Um rótulo por linha bastou: nenhuma migração.
 *  - **`messages.metadata.triagem_jev`** guarda o resto (categoria, urgente, faixas), só em
 *    rótulos e números, na mensagem de ENTRADA da empresa certa. Chave própria: a triagem
 *    antiga (legado) usa `triagem`, e quem a lê não deve achar a nova.
 *
 * Sem texto de cliente em nenhuma das três. Pelo `pg.Pool` do turno; nunca lança.
 */
import type pg from "pg";

import { logger } from "@/lib/logger";

import type { UsoDeTokens } from "./cliente";
import type { EstadoQuePergunta } from "./config";
import { custoDaChamada } from "./observacao-da-conferencia";
import { TAREFA_DA_TRIAGEM, TRIAGEM_DA_MENSAGEM } from "./tarefas";
import type { VeredictoDaTriagem } from "./triagem";

export interface RegistroDaTriagem {
  organizationId: string;
  estado: EstadoQuePergunta;
  conversationId: string | null;
  /** A mensagem de ENTRADA do cliente. */
  messageId: string | null;
  jobId: string | null;
  contactId: string | null;
  agentId?: string | null;
  veredito: VeredictoDaTriagem;
  uso: UsoDeTokens;
  modelo: string;
  latenciaMs: number;
  agora?: Date;
}

/** O que fica em `messages.metadata.triagem_jev`: rótulos e números, nunca texto. */
export function metadadoDaTriagem(r: Pick<RegistroDaTriagem, "estado" | "veredito" | "agora">) {
  const v = r.veredito;
  return {
    v: 1,
    estado: r.estado,
    categoria: { id: v.categoria.id, p: v.categoria.probabilidade, faixa: v.categoria.faixa },
    destino: { id: v.destino.id, p: v.destino.probabilidade, faixa: v.destino.faixa, efetivo: v.destinoEfetivo },
    urgente: { p: v.urgente.probabilidade, marcar: v.urgente.marcar },
    em: (r.agora ?? new Date()).toISOString(),
  };
}

export async function registrarTriagemDoJev(pool: pg.Pool, r: RegistroDaTriagem): Promise<void> {
  const v = r.veredito;
  try {
    await pool.query(
      `with observacao as (
         insert into public.jev_observacoes
           (organization_id, tarefa, estado, conversation_id, message_id, job_id,
            rotulo_jev, probabilidade_jev, confianca_jev, rotulo_atual, modelo, latencia_ms)
         select $1::uuid, $2::text, $3::text, $4::uuid, $5::uuid, $6::uuid,
                $7::text, $8::numeric, $9::numeric, null, $10::text, $11::integer
          where $5::uuid is not null
         on conflict (organization_id, tarefa, message_id) where message_id is not null do nothing
       ), meta as (
         update public.messages
            set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('triagem_jev', $20::jsonb)
          where organization_id = $1::uuid and id = $5::uuid and direction = 'inbound'
       )
       insert into public.llm_calls
         (organization_id, contact_id, agent_id, job_id, purpose, provider, model,
          input_tokens, output_tokens, cost_cents, latency_ms, status, origem_da_escolha)
       values ($1, $12, $13, $6, $14, 'typesafe', $15, $16, $17, $18, $11, 'ok', $19)`,
      [
        r.organizationId,
        TAREFA_DA_TRIAGEM.id,
        r.estado,
        r.conversationId,
        r.messageId,
        r.jobId,
        v.destino.id,
        v.destino.probabilidade,
        v.destino.confianca,
        r.modelo,
        r.latenciaMs,
        r.contactId,
        r.agentId ?? null,
        TRIAGEM_DA_MENSAGEM.purpose,
        `typesafe/${r.modelo}`,
        r.uso.tokensDeEntrada,
        r.uso.tokensDeSaida,
        custoDaChamada(r.modelo, r.uso),
        r.estado === "decidindo" ? "jev" : "jev_observacao",
        JSON.stringify(metadadoDaTriagem(r)),
      ],
    );
  } catch (erro) {
    logger.warn("observação do Jev sobre a triagem não foi gravada", {
      organization_id: r.organizationId,
      erro: erro instanceof Error ? erro.message.slice(0, 200) : typeof erro,
    });
  }
}
