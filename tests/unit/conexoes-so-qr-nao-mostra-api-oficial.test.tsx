/**
 * Uma empresa que só conecta número por QR não vê nada da API oficial — e quando o WhatsApp dela ainda não
 * está pronto, a tela diz isso em palavras de quem vende, sem variável de ambiente nem comando de servidor.
 *
 * Duas metades:
 *   1. as abas "API Oficial (Meta)" e "Provedor parceiro" só existem para quem TEM um canal desse tipo, e um link
 *      antigo (`?aba=oficial`) cai na aba de números em vez de abrir um formulário sem sentido;
 *   2. "Estamos preparando o seu WhatsApp" (cadastro ainda não feito) é diferente de "está com um problema"
 *      (cadastro quebrado), e nenhum dos dois cita variável de ambiente ou Docker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type * as CanaisModule from "@/hooks/channels/useChannelSessions";

let urlDaAba = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(urlDaAba),
}));

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/channels/usePacingKnobs", () => ({ usePacingKnobs: () => ({ data: { items: [] } }) }));
vi.mock("@/components/connections/AntiBanSheet", () => ({ AntiBanSheet: () => null }));

vi.mock("@/hooks/channels/useChannelSessions", async (original) => {
  const real = await original<typeof CanaisModule>();
  return { ...real, useChannelSessions: () => ({ data: [], isLoading: false, isError: false, schemaOutdated: false }) };
});

// Os clientes de cada aba viram marcadores: o que está sob teste é QUAIS abas existem, não o formulário delas.
vi.mock("@/components/connections/RedesSociaisClient", () => ({ RedesSociaisClient: () => <div data-testid="aba-RedesSociaisClient" /> }));
vi.mock("@/components/connections/CanalGraphParceiroClient", () => ({ CanalGraphParceiroClient: () => <div data-testid="aba-CanalGraphParceiroClient" /> }));
vi.mock("@/components/connections/CanalOficialClient", () => ({ CanalOficialClient: () => <div data-testid="aba-CanalOficialClient" /> }));
vi.mock("@/components/connections/CanalParceiroClient", () => ({ CanalParceiroClient: () => <div data-testid="aba-CanalParceiroClient" /> }));
vi.mock("@/components/connections/CanalVozClient", () => ({ CanalVozClient: () => <div data-testid="aba-CanalVozClient" /> }));
vi.mock("@/components/connections/TemplatesClient", () => ({ TemplatesClient: () => <div data-testid="aba-TemplatesClient" /> }));
vi.mock("@/components/connections/TemplatesParceiroClient", () => ({ TemplatesParceiroClient: () => <div data-testid="aba-TemplatesParceiroClient" /> }));
vi.mock("@/components/connections/TelefoniaClient", () => ({ TelefoniaClient: () => <div data-testid="aba-TelefoniaClient" /> }));

import { ConnectionsClient } from "@/components/connections/ConnectionsClient";
import { ConexoesShell } from "@/components/connections/ConexoesShell";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  urlDaAba = "";
});
afterEach(() => cleanup());

describe("abas da tela de Conexões", () => {
  it("empresa só por QR: sem 'API Oficial (Meta)' e sem 'Provedor parceiro'", () => {
    render(
      wrap(<ConexoesShell wahaConfigured wacallsConfigured={false} mostrarOficial={false} mostrarParceiro={false} />),
    );

    expect(screen.getByRole("tab", { name: "Números por QR" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "API Oficial (Meta)" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Provedor parceiro" })).toBeNull();
    // o que continua valendo para todo mundo
    expect(screen.getByRole("tab", { name: "Redes sociais" })).toBeInTheDocument();
  });

  it("empresa com canal oficial: a aba aparece (e a do parceiro continua escondida)", () => {
    render(
      wrap(<ConexoesShell wahaConfigured wacallsConfigured={false} mostrarOficial mostrarParceiro={false} />),
    );

    expect(screen.getByRole("tab", { name: "API Oficial (Meta)" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Provedor parceiro" })).toBeNull();
  });

  it("sem informar nada, o padrão é mostrar tudo (quem monta a tela sem saber não perde aba)", () => {
    render(wrap(<ConexoesShell wahaConfigured wacallsConfigured={false} />));

    expect(screen.getByRole("tab", { name: "API Oficial (Meta)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Provedor parceiro" })).toBeInTheDocument();
  });

  it("link antigo para a aba oficial, numa empresa sem canal oficial, cai na aba de números", () => {
    urlDaAba = "aba=oficial";

    render(
      wrap(<ConexoesShell wahaConfigured wacallsConfigured={false} mostrarOficial={false} mostrarParceiro={false} />),
    );

    expect(screen.getByRole("tab", { name: "Números por QR", selected: true })).toBeInTheDocument();
    expect(screen.queryByTestId("aba-CanalOficialClient")).toBeNull();
  });
});

describe("WhatsApp da empresa ainda não pronto", () => {
  it("cadastro por fazer: 'Estamos preparando o seu WhatsApp', sem texto técnico", () => {
    const { container } = render(wrap(<ConnectionsClient wahaConfigured={false} />));

    expect(screen.getByText("Estamos preparando o seu WhatsApp")).toBeInTheDocument();
    for (const tecnico of [/WAHA/, /docker/i, /variáveis de ambiente/i, /\.env/]) {
      expect(container.textContent ?? "", String(tecnico)).not.toMatch(tecnico);
    }
    // sem número novo enquanto não está pronto
    expect(screen.getByRole("button", { name: /conectar novo whatsapp/i })).toBeDisabled();
  });

  it("cadastro quebrado: diz que há um problema (não 'preparando') e manda falar com o suporte", () => {
    render(wrap(<ConnectionsClient wahaConfigured={false} wahaComProblema />));

    expect(screen.getByText("Seu WhatsApp está com um problema.")).toBeInTheDocument();
    expect(screen.queryByText("Estamos preparando o seu WhatsApp")).toBeNull();
    expect(screen.getByText(/fale com o suporte/i)).toBeInTheDocument();
  });

  it("WhatsApp pronto: nenhum dos dois avisos", () => {
    render(wrap(<ConnectionsClient wahaConfigured />));

    expect(screen.queryByText("Estamos preparando o seu WhatsApp")).toBeNull();
    expect(screen.queryByText("Seu WhatsApp está com um problema.")).toBeNull();
  });
});
