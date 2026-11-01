/**
 * O TETO MENSAL E O ANTES (`docs/14-spec-jev.md`, seção 7.3 e D12; T22).
 *
 * O Jev CONTA no teto mensal de IA (cada chamada grava `llm_calls`, que a soma do mês inclui),
 * mas só a triagem é PULADA quando o teto estoura em modo "bloquear": é a pergunta que só
 * ajuda, e pular economiza e deixa a IA atender como hoje. A conferência do DEPOIS nunca é
 * barrada por teto (`jev_depois` está em `PURPOSES_ISENTOS`; ver
 * `lib/agent-engine/edge/llm/orcamento.ts`).
 *
 * Usa a MESMA regra pura de todo o produto (`decidirOrcamento`): modo `bloquear`, carência
 * vencida, aviso já dado no mês, chave de emergência da instalação. Diferente do gate das
 * chamadas de modelo (`aplicarOrcamento`), esta leitura NÃO tem efeito colateral — não abre
 * aviso na Central nem registra bloqueio: o aviso e o bloqueio são da IA principal, que é quem
 * para de verdade. Falha ABERTA: erro ao ler o orçamento = não bloqueia (a triagem só ajuda).
 */
import type pg from "pg";

import {
  decidirOrcamento,
  LIMIAR_PADRAO_PCT,
  normalizarModoDeOrcamento,
} from "@/lib/agent-engine/edge/llm/orcamento";
import { chaveDeOrcamentoDaInstalacao } from "@/lib/instalacao/comportamento";
import { logger } from "@/lib/logger";

import { TRIAGEM_DA_MENSAGEM } from "./tarefas";

interface LinhaDoTeto {
  teto: string | number | null;
  modo: string | null;
  efetivo_em: Date | null;
  limiar_pct: string | number | null;
  gasto: string | number | null;
  avisado_antes: boolean | null;
}

export async function tetoEstouradoParaOAntes(
  pool: pg.Pool,
  organizationId: string,
  agora: Date = new Date(),
): Promise<boolean> {
  try {
    const { rows } = await pool.query<LinhaDoTeto>(
      `select b.monthly_limit_cents as teto,
              b.enforcement_mode as modo,
              b.enforcement_effective_at as efetivo_em,
              b.alarm_threshold_pct as limiar_pct,
              public.fn_gasto_de_ia_do_mes(b.organization_id) as gasto,
              exists (
                select 1 from public.agent_inbox_items i
                 where i.organization_id = b.organization_id and i.kind = 'budget_warning'
                   and i.created_at >= date_trunc('month', now())
              ) as avisado_antes
         from public.ai_budgets b
        where b.organization_id = $1`,
      [organizationId],
    );
    const linha = rows[0];
    // Sem linha em `ai_budgets`: a organização nunca ligou a proteção.
    if (linha === undefined) return false;
    const veredito = decidirOrcamento({
      modo: normalizarModoDeOrcamento(linha.modo),
      tetoCents: Number(linha.teto ?? 0),
      gastoCents: Number(linha.gasto ?? 0),
      efetivoEm: linha.efetivo_em ?? null,
      agora,
      purpose: TRIAGEM_DA_MENSAGEM.purpose,
      chave: chaveDeOrcamentoDaInstalacao("on"),
      limiarPct: Number(linha.limiar_pct ?? LIMIAR_PADRAO_PCT),
      avisadoNesteMes: linha.avisado_antes === true,
    });
    return veredito.acao === "bloquear";
  } catch (erro) {
    logger.warn("teto de IA não pôde ser lido para a triagem; ela segue", {
      organization_id: organizationId,
      erro: erro instanceof Error ? erro.name : typeof erro,
    });
    return false;
  }
}
