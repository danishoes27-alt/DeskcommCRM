/**
 * O CUSTO E A OBSERVAÇÃO DO DEPOIS — o que se grava de cada chamada à
 * conferência (`docs/14-spec-jev.md`, seções 7.2, 7.3 e 8.1, D13).
 *
 * ═══ UMA CHAMADA, UMA LINHA DE CUSTO ═══
 *
 * Cada chamada ao Jev grava UMA linha em `llm_calls`, com a finalidade
 * `jev_depois` — a segunda chamada da reescrita (quando o DEPOIS reprova e a IA
 * reescreve) grava a sua. O custo é fracionário e vem da tabela de preços pelo id
 * EXATO do modelo; versão sem preço sai `null`, nunca o preço de outra
 * (`pricing.ts`). O teste desta tarefa reprova o id sem preço: ele gravaria custo
 * vazio, que a soma do mês conta como zero, e o custo sumiria do teto em silêncio.
 *
 * ═══ UMA OBSERVAÇÃO POR MENSAGEM ═══
 *
 * `jev_observacoes` guarda UM rótulo por linha e é única por (empresa, tarefa,
 * mensagem). O desenho que fecha o [DESENHO] da T10 do plano:
 *
 *  - `rotulo_jev`: a pergunta mais provável quando o Jev passa de 0,50 (a faixa
 *    média em diante), senão `ok`;
 *  - `rotulo_atual`: o veredito das regras da casa no MESMO vocabulário — a
 *    pergunta da família do primeiro achado local, ou `ok` quando nada achou.
 *    (Preço, prazo e garantia → `sem_fonte`; aprovação → `promete_aprovacao`;
 *    disponibilidade → `inventa_dado`);
 *  - `probabilidade_jev`: a MAIOR das três probabilidades, o número que o corte
 *    ajusta; as três por pergunta não cabem numa linha (se a medição pedir, vira
 *    migração aditiva, seção 5 do plano);
 *  - só a 1ª chamada da mensagem entra: a da reescrita cai no `on conflict do
 *    nothing`, mas o custo dela entra em `llm_calls`, porque houve.
 *
 * Chamada sem veredito do Jev (queda, ilegível) não grava observação: sem rótulo
 * do Jev não há o que comparar. A linha de custo da falha é da T12.
 *
 * Sem texto de cliente nem de rascunho: só rótulos, números e ponteiros. Pelo
 * `pg.Pool` do turno; nunca lança — telemetria perdida não derruba atendimento.
 */
import type pg from "pg";

import type { CodigoDoAchado } from "@/lib/agent-engine/guardrails/conferencia-local";
import { costCents } from "@/lib/agent-engine/edge/llm/pricing";
import { logger } from "@/lib/logger";

import type { UsoDeTokens } from "./cliente";
import type { EstadoQuePergunta } from "./config";
import {
  CORTES_DO_DEPOIS,
  type NomeDaPergunta,
  type VeredictoDoDepois,
  type VeredictoDoJev,
} from "./conferencia";
import { CONFERENCIA_DA_RESPOSTA, TAREFA_DA_CONFERENCIA } from "./tarefas";

export type RotuloDaConferencia = NomeDaPergunta | "ok";

/** A pergunta do Jev em que cada família de achado local mora — o vocabulário comum do rótulo. */
const PERGUNTA_DO_ACHADO: Readonly<Record<CodigoDoAchado, NomeDaPergunta | null>> = {
  valor_sem_fonte: "sem_fonte",
  prazo_sem_fonte: "sem_fonte",
  garantia_sem_fonte: "sem_fonte",
  aprovacao_prometida: "promete_aprovacao",
  disponibilidade_sem_fonte: "inventa_dado",
  // Segredo no rascunho não tem pergunta do Jev (e o Jev nem é chamado).
  senha_repetida: null,
  documento_copiado: null,
};

/** O que o Jev achou, no vocabulário comum: a pergunta mais provável de 0,50 em diante, senão `ok`. */
export function rotuloDoJev(v: VeredictoDoJev): RotuloDaConferencia {
  return v.maior >= CORTES_DO_DEPOIS.media ? v.pergunta : "ok";
}

/** O que as regras da casa acharam, no mesmo vocabulário. */
export function rotuloDasRegrasLocais(local: VeredictoDoDepois["local"]): RotuloDaConferencia {
  for (const achado of local.achados) {
    const pergunta = PERGUNTA_DO_ACHADO[achado.codigo];
    if (pergunta !== null) return pergunta;
  }
  return "ok";
}

export interface RegistroDaConferencia {
  organizationId: string;
  /** O estado da tarefa na hora da pergunta: desligada não pergunta nada. */
  estado: EstadoQuePergunta;
  conversationId: string | null;
  /** A mensagem de ENTRADA do cliente que abriu o turno — a chave da observação. */
  messageId: string | null;
  jobId: string | null;
  contactId: string | null;
  agentId?: string | null;
  veredito: VeredictoDoDepois;
  uso: UsoDeTokens;
  modelo: string;
  latenciaMs: number;
}

/** O custo da chamada, em centavos de dólar com fração; `null` para modelo sem preço. */
export function custoDaChamada(modelo: string, uso: UsoDeTokens): number | null {
  return costCents(modelo, {
    inputTokens: uso.tokensDeEntrada,
    outputTokens: uso.tokensDeSaida,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

/**
 * Grava a linha de custo e, se há veredito do Jev, a observação. Um comando só
 * (CTE): se a observação já existe para a mensagem (o retry do job, ou a segunda
 * chamada da reescrita), ela fica e só o custo entra.
 */
export async function registrarConferenciaDoJev(pool: pg.Pool, r: RegistroDaConferencia): Promise<void> {
  const jev = r.veredito.jev;
  try {
    await pool.query(
      `with observacao as (
         insert into public.jev_observacoes
           (organization_id, tarefa, estado, conversation_id, message_id, job_id,
            rotulo_jev, probabilidade_jev, rotulo_atual, modelo, latencia_ms)
         select $1::uuid, $2::text, $3::text, $4::uuid, $5::uuid, $6::uuid,
                $7::text, $8::numeric, $9::text, $10::text, $11::integer
         where $7::text is not null and $5::uuid is not null
         on conflict (organization_id, tarefa, message_id) where message_id is not null do nothing
       )
       insert into public.llm_calls
         (organization_id, contact_id, agent_id, job_id, purpose, provider, model,
          input_tokens, output_tokens, cost_cents, latency_ms, status, origem_da_escolha)
       values ($1, $12, $13, $6, $14, 'typesafe', $15, $16, $17, $18, $11, 'ok', $19)`,
      [
        r.organizationId,
        TAREFA_DA_CONFERENCIA.id,
        r.estado,
        r.conversationId,
        r.messageId,
        r.jobId,
        jev === null ? null : rotuloDoJev(jev),
        jev === null ? null : jev.maior,
        rotuloDasRegrasLocais(r.veredito.local),
        r.modelo,
        r.latenciaMs,
        r.contactId,
        r.agentId ?? null,
        CONFERENCIA_DA_RESPOSTA.purpose,
        `typesafe/${r.modelo}`,
        r.uso.tokensDeEntrada,
        r.uso.tokensDeSaida,
        custoDaChamada(r.modelo, r.uso),
        // Observando, a resposta dele só fica registrada; decidindo, é ele quem pode segurar.
        r.estado === "decidindo" ? "jev" : "jev_observacao",
      ],
    );
  } catch (erro) {
    // A observação é telemetria: perdê-la não pode derrubar o atendimento.
    logger.warn("observação do Jev sobre a conferência da resposta não foi gravada", {
      organization_id: r.organizationId,
      erro: erro instanceof Error ? erro.message.slice(0, 200) : typeof erro,
    });
  }
}
