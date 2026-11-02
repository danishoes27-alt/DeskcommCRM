/**
 * O TETO DIGITADO EM REAIS (T24, spec do Jev 7.4): o servidor converte pela cotação em vigor,
 * grava em DÓLAR (a fonte de verdade) e audita o que foi digitado e a cotação usada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { getBudgetStatus } from "@/lib/ai/budget/check";
import { cotacaoDoDolar } from "@/lib/ai/cotacao";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/budget/check", () => ({ getBudgetStatus: vi.fn() }));
vi.mock("@/lib/ai/cotacao", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/cotacao")>()),
  cotacaoDoDolar: vi.fn(),
}));
vi.mock("@/lib/impersonate/support", async (orig) => ({
  ...(await orig<typeof import("@/lib/impersonate/support")>()),
  requireSupportWrite: vi.fn(async () => null),
}));

import { PATCH } from "@/app/api/v1/ai/budget/route";

const ORG = "22222222-2222-4222-8222-222222222222";
let escritas: Record<string, unknown>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  escritas = [];
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "u", idioma: "pt-BR" },
    org: { orgId: ORG, name: "Org", role: "admin" },
  } as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    maybeSingle: async () => ({
      data: { monthly_limit_cents: 0, alarm_threshold_pct: 80, enforcement_mode: "off", enforcement_effective_at: null },
      error: null,
    }),
    update: (p: Record<string, unknown>) => (escritas.push(p), chain),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  };
  vi.mocked(createAdminClient).mockReturnValue({ from: () => chain } as never);
  vi.mocked(getBudgetStatus).mockResolvedValue({
    monthly_limit_cents: 500,
    alarm_threshold_pct: 80,
    current_month_consumed_cents: 0,
  } as never);
});

const patch = (corpo: unknown) =>
  PATCH(new NextRequest("http://x/api/v1/ai/budget", { method: "PATCH", body: JSON.stringify(corpo) }));

describe("teto em reais", () => {
  it("converte pela cotação, grava em dólar e audita o digitado e a cotação usada", async () => {
    vi.mocked(cotacaoDoDolar).mockResolvedValue(5);
    const res = await patch({ monthly_limit_brl_cents: 2500, enforcement_mode: "off" });
    expect(res.status).toBe(200);
    expect(escritas[0]).toMatchObject({ monthly_limit_cents: 500 });
    const meta = vi.mocked(audit).mock.calls[0]![0].metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      monthly_limit_cents: { depois: 500 },
      monthly_limit_brl_cents: 2500,
      cotacao_usd_brl_usada: 5,
    });
  });

  it("sem cotação configurada: 422, nada gravado", async () => {
    vi.mocked(cotacaoDoDolar).mockResolvedValue(null);
    const res = await patch({ monthly_limit_brl_cents: 2500 });
    expect(res.status).toBe(422);
    expect(escritas).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("o piso vale sobre o dólar convertido", async () => {
    vi.mocked(cotacaoDoDolar).mockResolvedValue(5);
    const res = await patch({ monthly_limit_brl_cents: 300, enforcement_mode: "avisar" });
    expect(res.status).toBe(422);
    expect(escritas).toEqual([]);
  });

  it("dólar e reais no mesmo corpo: 422", async () => {
    const res = await patch({ monthly_limit_brl_cents: 2500, monthly_limit_cents: 500 });
    expect(res.status).toBe(422);
  });

  it("o caminho em dólar não consulta a cotação nem a audita", async () => {
    const res = await patch({ monthly_limit_cents: 800, enforcement_mode: "off" });
    expect(res.status).toBe(200);
    expect(cotacaoDoDolar).not.toHaveBeenCalled();
    const meta = vi.mocked(audit).mock.calls[0]![0].metadata as Record<string, unknown>;
    expect(meta.cotacao_usd_brl_usada).toBeUndefined();
  });
});
