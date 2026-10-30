/**
 * O passo do telefone para quem conecta o número no celular: vai direto ao QR.
 *
 * "Conta oficial" e "provedor parceiro" só são oferecidos a quem já tem um canal desse tipo (`outrasFormas`).
 * Para a empresa que usa o WhatsApp do celular elas são escolhas que não existem — e a pergunta de abertura,
 * o botão "Conectei em outro lugar" (que marca o passo como cumprido SEM checar nada) e o texto de servidor
 * ficam de fora. A versão com a pergunta continua em `onboarding-escolhe-como-conecta.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/app/actions/onboarding/skipWhatsapp", () => ({ skipWhatsapp: vi.fn(), markWhatsappConfigured: vi.fn() }));
vi.mock("@/components/connections/CanalOficialClient", () => ({ CanalOficialClient: () => <div data-testid="dublê-oficial" /> }));
vi.mock("@/components/connections/CanalParceiroClient", () => ({ CanalParceiroClient: () => <div data-testid="dublê-parceiro" /> }));

import { ConnectWhatsappClient } from "@/app/onboarding/connect-whatsapp/_client";

let chamadas: string[] = [];
let resposta: { ok: boolean; status: number; corpo: unknown } = {
  ok: true,
  status: 200,
  corpo: { data: { status: "SCAN_QR_CODE", session: "org_teste", channel_session_id: "ch-1" } },
};

beforeEach(() => {
  chamadas = [];
  resposta = { ok: true, status: 200, corpo: { data: { status: "SCAN_QR_CODE", session: "org_teste", channel_session_id: "ch-1" } } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      chamadas.push(`${init?.method ?? "GET"} ${String(url)}`);
      return { ok: resposta.ok, status: resposta.status, json: async () => resposta.corpo } as unknown as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const montar = (over: { wahaConfigured?: boolean } = {}) =>
  render(
    <ConnectWhatsappClient
      wahaConfigured={over.wahaConfigured ?? true}
      sessionName="org_teste"
      oficialPodeReceber
      outrasFormas={false}
    />,
  );

describe("passo do telefone, empresa que conecta pelo celular", () => {
  it("não pergunta 'como você já usa esse número' e não oferece conta oficial nem parceiro", async () => {
    montar();

    expect(screen.queryByText(/como você já usa esse número/i)).toBeNull();
    expect(screen.queryByTestId("forma-oficial")).toBeNull();
    expect(screen.queryByTestId("forma-parceiro")).toBeNull();
    expect(screen.queryByText(/conta oficial/i)).toBeNull();
    expect(screen.queryByText(/provedor parceiro/i)).toBeNull();
    expect(screen.queryByTestId("voltar-para-escolha")).toBeNull();
    // e vai direto sobre o QR: a sessão sobe sem ninguém clicar em forma nenhuma
    await waitFor(() => expect(chamadas.some((c) => c.startsWith("POST") && c.includes("/onboarding/whatsapp/session"))).toBe(true));
  });

  it("não tem 'Conectei em outro lugar' (marcava o passo como cumprido sem checar nada); o 'Pular' continua", () => {
    montar();

    expect(screen.queryByRole("button", { name: /conectei em outro lugar/i })).toBeNull();
    expect(screen.getByRole("button", { name: /pular por enquanto/i })).toBeTruthy();
  });

  it("WhatsApp da empresa ainda não cadastrado: 'Estamos preparando o seu WhatsApp', com saída e sem texto de servidor", () => {
    const { container } = montar({ wahaConfigured: false });

    expect(screen.getByText("Estamos preparando o seu WhatsApp")).toBeTruthy();
    expect(screen.getByRole("button", { name: /verificar de novo/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /pular por enquanto/i })).toBeTruthy();
    for (const tecnico of [/WAHA/, /docker/i, /seu próprio servidor/i, /roda no seu servidor/i]) {
      expect(container.textContent ?? "", String(tecnico)).not.toMatch(tecnico);
    }
    // nada foi criado: sem WhatsApp pronto a sessão nem é pedida
    expect(chamadas).toEqual([]);
  });

  it("serviço fora do ar: texto de quem vende, e o detalhe técnico fica recolhido para o suporte", async () => {
    resposta = { ok: false, status: 502, corpo: { error: { message: "falha ao falar com o servidor" } } };

    const { container } = montar();

    await waitFor(() => expect(screen.getByText(/o whatsapp não respondeu agora\. tente de novo; se continuar/i)).toBeTruthy());
    expect(container.textContent ?? "").not.toMatch(/roda no seu servidor|quem instalou/i);
    const detalhe = container.querySelector("details");
    expect(detalhe).not.toBeNull();
    expect(detalhe?.textContent).toMatch(/suporte/i);
  });
});
