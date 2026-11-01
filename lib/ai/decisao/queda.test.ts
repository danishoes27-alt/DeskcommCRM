/**
 * O aviso ao dono da plataforma (T12): quando e como o incidente da instalação é
 * aberto, atualizado e deduplicado — e que só a chave recusada e o crédito esgotado
 * pedem ação dele.
 */
import { describe, expect, it, vi } from "vitest";
import type pg from "pg";

import type { MotivoDaAusencia } from "./cliente";
import { avisarODonoDaPlataforma, INCIDENTES_DO_JEV, incidenteDoMotivo, MENSAGEM_DO_INCIDENTE } from "./queda";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGORA = new Date("2026-11-01T15:00:00.000Z");

const pool = () => {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  return { pool: { query } as unknown as pg.Pool, query };
};

describe("incidenteDoMotivo: só o que o DONO resolve", () => {
  it.each([
    ["credencial_invalida", INCIDENTES_DO_JEV.chave_recusada],
    ["sem_credito", INCIDENTES_DO_JEV.sem_credito],
  ] as const)("%s → %s", (motivo, tipo) => {
    expect(incidenteDoMotivo(motivo)).toBe(tipo);
  });

  it.each([
    "limite_de_taxa",
    "provedor_sobrecarregado",
    "provedor_indisponivel",
    "contrato_invalido",
    "resposta_ilegivel",
    "sem_credencial",
    "disjuntor_aberto",
  ] as const)("%s não abre incidente", (motivo: MotivoDaAusencia) => {
    expect(incidenteDoMotivo(motivo)).toBeNull();
  });
});

describe("avisarODonoDaPlataforma", () => {
  it("chave recusada: grava no comando um incidente da INSTALAÇÃO (organization_id nulo), crítico, deduplicado", async () => {
    const { pool: p, query } = pool();
    expect(await avisarODonoDaPlataforma(p, { organizationId: ORG_A, tarefa: "conferencia", motivo: "credencial_invalida", agora: AGORA })).toBe(true);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("insert into public.incidents");
    expect(sql).toContain("select null, $1, 'critical'");
    // Um aberto (ou já reconhecido) por tipo: o segundo falhar atualiza, não duplica.
    expect(sql).toContain("where type = $1 and status in ('open', 'acknowledged')");
    expect(sql).toContain("where not exists (select 1 from existente)");
    expect(params[0]).toBe("jev_chave_recusada");
    expect(params[1]).toBe(ORG_A);
    expect(params[2]).toBe("conferencia");
    expect(params[3]).toBe("2026-11-01T15:00:00.000Z");
    const payload = JSON.parse(params[4] as string) as Record<string, unknown>;
    expect(payload).toMatchObject({
      motivo: "credencial_invalida",
      primeira_organizacao: ORG_A,
      tarefas: { conferencia: "2026-11-01T15:00:00.000Z" },
      ocorrencias: 1,
    });
    expect(payload.mensagem).toBe(MENSAGEM_DO_INCIDENTE.jev_chave_recusada);
  });

  it("sem crédito: outro tipo, com a mensagem de recarregar a conta", async () => {
    const { pool: p, query } = pool();
    await avisarODonoDaPlataforma(p, { organizationId: ORG_A, tarefa: "triagem", motivo: "sem_credito", agora: AGORA });
    const params = (query.mock.calls[0] as [string, unknown[]])[1];
    expect(params[0]).toBe("jev_sem_credito");
    expect(JSON.parse(params[4] as string).mensagem).toMatch(/recarregue/);
  });

  it("ANTES e DEPOIS falhando juntos usam o MESMO tipo (o SQL os une no incidente aberto)", async () => {
    const { pool: p, query } = pool();
    await avisarODonoDaPlataforma(p, { organizationId: ORG_A, tarefa: "triagem", motivo: "credencial_invalida", agora: AGORA });
    await avisarODonoDaPlataforma(p, { organizationId: ORG_A, tarefa: "conferencia", motivo: "credencial_invalida", agora: AGORA });
    const [a, b] = query.mock.calls.map((c) => (c as [string, unknown[]])[1]);
    expect(a![0]).toBe(b![0]);
    // O update junta a tarefa nova às já registradas, em vez de trocá-las.
    expect((query.mock.calls[1] as [string, unknown[]])[0]).toContain("coalesce(i.payload->'tarefas', '{}'::jsonb) || jsonb_build_object($3::text, $4::text)");
  });

  it("lojas diferentes com a mesma chave: UM incidente, com a última loja registrada", async () => {
    const { pool: p, query } = pool();
    await avisarODonoDaPlataforma(p, { organizationId: ORG_A, tarefa: "conferencia", motivo: "sem_credito", agora: AGORA });
    await avisarODonoDaPlataforma(p, { organizationId: ORG_B, tarefa: "conferencia", motivo: "sem_credito", agora: AGORA });
    const [a, b] = query.mock.calls.map((c) => (c as [string, unknown[]])[1]);
    expect(a![0]).toBe(b![0]);
    expect(b![1]).toBe(ORG_B);
    expect((query.mock.calls[1] as [string, unknown[]])[0]).toContain("'ultima_organizacao', $2::text");
  });

  it("motivo que passa sozinho (taxa, sobrecarga, demora): não escreve nada", async () => {
    const { pool: p, query } = pool();
    for (const motivo of ["limite_de_taxa", "provedor_sobrecarregado", "provedor_indisponivel"] as const) {
      expect(await avisarODonoDaPlataforma(p, { organizationId: ORG_A, tarefa: "conferencia", motivo })).toBe(false);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("o payload não leva texto de cliente nem de rascunho: só motivo, tarefas, horas e uuids", async () => {
    const { pool: p, query } = pool();
    await avisarODonoDaPlataforma(p, { organizationId: ORG_A, tarefa: "conferencia", motivo: "credencial_invalida", agora: AGORA });
    const payload = JSON.parse((query.mock.calls[0] as [string, unknown[]])[1][4] as string) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ["mensagem", "motivo", "ocorrencias", "primeira_organizacao", "primeira_vez", "tarefas", "ultima_organizacao", "ultima_vez"].sort(),
    );
  });

  it("falha de banco não lança (o aviso é o alerta, não a chamada)", async () => {
    const p = { query: vi.fn().mockRejectedValue(new Error("banco caiu")) } as unknown as pg.Pool;
    await expect(avisarODonoDaPlataforma(p, { organizationId: ORG_A, tarefa: "conferencia", motivo: "sem_credito" })).resolves.toBe(false);
  });

  it("a mensagem diz o que fazer, em português simples, sem jargão", () => {
    for (const m of Object.values(MENSAGEM_DO_INCIDENTE)) {
      expect(m).toMatch(/TypeSafe/);
      expect(m).not.toMatch(/\b(401|402|403|HTTP|token|JSON|API)\b/);
    }
  });
});
