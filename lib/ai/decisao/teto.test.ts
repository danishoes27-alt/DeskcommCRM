import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import type pg from "pg";

import { tetoEstouradoParaOAntes } from "./teto";

const AGORA = new Date("2026-11-15T12:00:00Z");
const poolCom = (linha: Record<string, unknown> | null) =>
  ({ query: vi.fn().mockResolvedValue({ rows: linha === null ? [] : [linha] }) }) as unknown as pg.Pool;
const base = {
  teto: 1000,
  modo: "bloquear",
  efetivo_em: new Date("2026-11-01T00:00:00Z"),
  limiar_pct: 80,
  gasto: 2000,
  avisado_antes: true,
};

describe("o teto mensal pula SÓ o ANTES (T22, D12)", () => {
  it("estourado, em modo bloquear, com carência vencida e aviso dado: pula", async () => {
    expect(await tetoEstouradoParaOAntes(poolCom(base), "org", AGORA)).toBe(true);
  });

  it.each([
    ["sem linha de orçamento (a empresa nunca ligou a proteção)", null],
    ["modo desligado", { ...base, modo: "off" }],
    ["modo só avisar", { ...base, modo: "avisar" }],
    ["gasto abaixo do teto", { ...base, gasto: 500 }],
    ["carência ainda não venceu", { ...base, efetivo_em: new Date("2026-12-01T00:00:00Z") }],
    ["ainda não avisou neste mês (ninguém é bloqueado sem aviso)", { ...base, avisado_antes: false }],
    ["teto abaixo do piso", { ...base, teto: 50 }],
    ["sem teto", { ...base, teto: 0 }],
  ])("segue: %s", async (_n, linha) => {
    expect(await tetoEstouradoParaOAntes(poolCom(linha), "org", AGORA)).toBe(false);
  });

  it("FALHA ABERTA: erro ao ler o orçamento não pula a triagem", async () => {
    const p = { query: vi.fn().mockRejectedValue(new Error("banco caiu")) } as unknown as pg.Pool;
    expect(await tetoEstouradoParaOAntes(p, "org", AGORA)).toBe(false);
  });

  it("lê SÓ a organização do turno e não escreve nada (sem aviso, sem bloqueio registrado)", async () => {
    const p = poolCom(base);
    await tetoEstouradoParaOAntes(p, "org-a", AGORA);
    const [sql, params] = (p.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(["org-a"]);
    expect(sql).toContain("where b.organization_id = $1");
    expect(sql).not.toMatch(/\b(insert|update|delete)\b/i);
  });

  it("o DEPOIS não consulta este teto: nenhum arquivo da conferência o importa", () => {
    const raiz = path.resolve(__dirname, "../../..");
    for (const rel of ["lib/ai/decisao/conferencia.ts", "lib/agent-engine/agent/conferencia-no-turno.ts"]) {
      expect(fs.readFileSync(path.join(raiz, rel), "utf8"), rel).not.toMatch(/decisao\/teto|\.\/teto|tetoEstourado/);
    }
  });
});
