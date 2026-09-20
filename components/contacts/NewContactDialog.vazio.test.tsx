/**
 * O FORMULÁRIO EM BRANCO NÃO CRIA CONTATO.
 *
 * `contactCreateSchema` não exige campo nenhum — `{ source: "manual" }` passa —
 * e a rota aceita. Enviar o "Novo contato" vazio gravava um contato "Sem nome",
 * sem e-mail nem telefone, que depois aparecia como opção no "Novo Lead" e na
 * Agenda. O diálogo prometia "pelo menos um identificador" e não cobrava.
 *
 * A trava é nome, e-mail ou telefone: o nome sozinho vale (quem marca horário
 * cria o contato só com o termo digitado — ver `VinculoDaMarcacao.test.tsx`);
 * CPF e etiqueta sozinhos não identificam ninguém.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NewContactDialog } from "@/components/contacts/NewContactDialog";

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useActiveOrg: () => ({ currency: "BRL", country: null }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

const AVISO = "Informe o nome, o email ou o telefone para criar o contato.";

function envolver(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { action: "created" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("NewContactDialog · formulário em branco", () => {
  it("não chama a rota e diz o que falta", async () => {
    const user = userEvent.setup();
    envolver(<NewContactDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Criar contato/i }));

    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("CPF e etiqueta sozinhos ainda são um contato vazio", async () => {
    const user = userEvent.setup();
    envolver(<NewContactDialog open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText(/CPF/i), "52998224725");
    await user.type(screen.getByLabelText(/Tags/i), "vip");
    await user.click(screen.getByRole("button", { name: /Criar contato/i }));

    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("o nome sozinho vale: é como a Agenda cria contato", async () => {
    const user = userEvent.setup();
    envolver(<NewContactDialog open onOpenChange={vi.fn()} nomeInicial="Joana Prado" />);

    await user.click(screen.getByRole("button", { name: /Criar contato/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });
});
