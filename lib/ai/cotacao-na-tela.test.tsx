import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/client", () => ({ apiClient: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

import { BudgetCard } from "@/components/ai/BudgetCard";
import type { BudgetStatus } from "@/lib/ai/budget/check";

const estado: BudgetStatus = {
  organization_id: "22222222-2222-4222-8222-222222222222",
  monthly_limit_cents: 5000,
  current_month_consumed_cents: 1000,
  pct: 20,
  alarm_threshold_pct: 80,
  enforcement_mode: "off",
  enforcement_effective_at: null,
  enforcement_env: "on",
  blocked_now: false,
  gasto_incompleto: false,
  current_period_start: "2026-03-01",
  last_alarm_sent_at: null,
  updated_at: "2026-11-01T00:00:00.000Z",
};

function desenhar(cotacao?: number | null) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BudgetCard initialData={estado} isAdmin={false} cotacao={cotacao} />
    </QueryClientProvider>,
  );
}
const texto = () => (document.body.textContent ?? "").replace(/\s/g, " ");

describe("o card de orçamento em reais (T24)", () => {
  it("com cotação: R$ com a cotação visível, e a fonte dita em dólar", () => {
    desenhar(5.4212);
    expect(texto()).toContain("R$ 54,21 (cotação R$ 5,42)");
    expect(texto()).toContain("R$ 271,06 (cotação R$ 5,42)");
    expect(texto()).toContain("provedor de IA cobra em dólar");
    expect(texto()).not.toContain("US$");
  });
  it("sem cotação: como sempre, em dólar", () => {
    desenhar(null);
    expect(texto()).toContain("US$ 10,00");
    expect(texto()).toContain("US$ 50,00");
    expect(texto()).not.toContain("cotação");
  });
  it("sem a propriedade: também em dólar", () => {
    desenhar();
    expect(texto()).toContain("US$ 10,00");
  });
});
