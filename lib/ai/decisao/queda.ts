/**
 * O AVISO AO DONO DA PLATAFORMA — quando a chave do Jev é recusada ou a conta
 * fica sem crédito (`docs/14-spec-jev.md`, seção 7.5, riscos 1 e 2, D2 = B).
 *
 * Com uma conta e uma chave da plataforma coladas na credencial `typesafe` de cada
 * loja, quem compra o crédito e troca a chave é o DONO DA PLATAFORMA — e não o
 * administrador de cada loja, que é quem recebe o aviso de "chave recusada" desde a
 * onda 1 e não consegue resolver. Conta sem crédito derruba o Jev de todas as lojas
 * de uma vez, então o aviso precisa chegar a quem pode agir.
 *
 * ═══ ONDE ELE MORA (e por que não é uma migração) ═══
 *
 * Na tabela `incidents` (`/admin/incidents`, só do administrador da plataforma:
 * RLS `platform_admin_only_incidents`, com abrir, reconhecer e resolver já prontos).
 * O `type` é vocabulário aberto — sem CHECK — e `organization_id` pode ser nulo,
 * que é o caso aqui: o incidente é da INSTALAÇÃO, não de uma loja.
 *
 * ═══ UM INCIDENTE, NÃO UM POR LOJA NEM POR TAREFA ═══
 *
 * A chave é a mesma para todas as lojas e o ANTES e o DEPOIS falham juntos: o
 * segundo aviso ATUALIZA o aberto (a tarefa, a loja, a hora, a contagem) em vez de
 * abrir outro. Reconhecido (`acknowledged`) também conta como "já sabe": não reabre.
 * Só depois de RESOLVIDO uma nova falha abre um novo.
 *
 * ponytail: busca e escrita no mesmo comando, sem trava. Dois processos falhando no
 * mesmo instante podem abrir dois incidentes iguais — a mesma corrida que o aviso
 * da Central declara (`./aviso.ts`). Ruído, e não silêncio; fecha de vez com índice
 * único parcial, que é migração e exige deduplicar antes.
 *
 * Nunca lança: o aviso é o alerta, não a chamada.
 */
import type pg from "pg";

import { logger } from "@/lib/logger";

import type { MotivoDaAusencia } from "./cliente";

export const INCIDENTES_DO_JEV = {
  chave_recusada: "jev_chave_recusada",
  sem_credito: "jev_sem_credito",
} as const;
export type TipoDeIncidenteDoJev = (typeof INCIDENTES_DO_JEV)[keyof typeof INCIDENTES_DO_JEV];

/** Os dois únicos motivos que pedem ação do DONO da plataforma. O resto passa sozinho ou é do suporte. */
export function incidenteDoMotivo(motivo: MotivoDaAusencia): TipoDeIncidenteDoJev | null {
  if (motivo === "credencial_invalida") return INCIDENTES_DO_JEV.chave_recusada;
  if (motivo === "sem_credito") return INCIDENTES_DO_JEV.sem_credito;
  return null;
}

/** O texto que o dono lê no incidente: o que houve, quem é afetado e o que fazer. */
export const MENSAGEM_DO_INCIDENTE: Readonly<Record<TipoDeIncidenteDoJev, string>> = {
  jev_chave_recusada:
    "A TypeSafe recusou a chave do Jev. Com a chave única da plataforma, o Jev parou em todas as lojas que a usam. " +
    "Gere uma chave nova no console da TypeSafe e cole de novo na credencial typesafe de cada loja.",
  jev_sem_credito:
    "A TypeSafe recusou o pedido do Jev, em geral por crédito esgotado. Com a conta única da plataforma, o Jev parou em " +
    "todas as lojas. Confira o saldo na conta da TypeSafe e recarregue.",
};

/**
 * Abre o incidente da instalação, ou atualiza o aberto. `tarefa` é a que falhou
 * (`triagem`, `conferencia`); a segunda tarefa a falhar entra no MESMO incidente.
 * Devolve se algo foi escrito (para o teste e o log), nunca lança.
 */
export async function avisarODonoDaPlataforma(
  pool: pg.Pool,
  a: { organizationId: string; tarefa: string; motivo: MotivoDaAusencia; agora?: Date },
): Promise<boolean> {
  const tipo = incidenteDoMotivo(a.motivo);
  if (tipo === null) return false;
  const quando = (a.agora ?? new Date()).toISOString();
  try {
    await pool.query(
      `with existente as (
         select id from public.incidents
          where type = $1 and status in ('open', 'acknowledged')
          order by created_at desc
          limit 1
       ), atualizado as (
         update public.incidents i
            set payload = i.payload || jsonb_build_object(
                  'ultima_vez', $4::text,
                  'ultima_organizacao', $2::text,
                  'tarefas', coalesce(i.payload->'tarefas', '{}'::jsonb) || jsonb_build_object($3::text, $4::text),
                  'ocorrencias', coalesce((i.payload->>'ocorrencias')::int, 1) + 1
                )
          where i.id in (select id from existente)
        returning i.id
       )
       insert into public.incidents (organization_id, type, severity, payload)
       select null, $1, 'critical', $5::jsonb
        where not exists (select 1 from existente)`,
      [
        tipo,
        a.organizationId,
        a.tarefa,
        quando,
        JSON.stringify({
          mensagem: MENSAGEM_DO_INCIDENTE[tipo],
          motivo: a.motivo,
          primeira_vez: quando,
          ultima_vez: quando,
          primeira_organizacao: a.organizationId,
          ultima_organizacao: a.organizationId,
          tarefas: { [a.tarefa]: quando },
          ocorrencias: 1,
        }),
      ],
    );
    return true;
  } catch (erro) {
    logger.warn("aviso ao dono da plataforma sobre o Jev não foi gravado", {
      organization_id: a.organizationId,
      tipo,
      erro: erro instanceof Error ? erro.message.slice(0, 200) : typeof erro,
    });
    return false;
  }
}
