/**
 * O portão "o transporte deste canal está de pé?" do aviso à equipe (e do aviso de teste).
 *
 * O canal por QR passou a ter WAHA POR EMPRESA: `isConfigured()` do adaptador é sempre verdadeiro (não dá para
 * saber, de forma síncrona, qual WAHA é o do canal), e a resposta que vale vem de `isConfiguredForSession`. Se o
 * portão perguntasse só ao primeiro, uma empresa com o cadastro quebrado passaria por ele e o envio falharia lá
 * na frente, com texto técnico em vez de "transporte_ausente".
 */
import { describe, expect, it, vi } from "vitest";

const adapter = vi.hoisted(() => ({
  isConfigured: vi.fn(() => true),
  isConfiguredForSession: undefined as undefined | ((ref: string) => Promise<boolean>),
}));

vi.mock("@/lib/channels", () => ({
  CHANNEL_SESSION_REF_COLUMNS: "id",
  getAdapter: () => adapter,
  resolveSessionRef: (linha: { sessionRef?: string | null }) => linha.sessionRef ?? null,
}));

import { criarTransporteDoAviso } from "@/lib/escalacao/aviso-ao-suporte.handler";

const ORG = "11111111-1111-4111-8111-111111111111";
const CANAL = { id: "22222222-2222-4222-8222-222222222222" } as never;

function adminComCanal(linha: Record<string, unknown> | null) {
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: linha, error: null }),
  };
  return { from: () => q } as never;
}

describe("criarTransporteDoAviso.configurado", () => {
  it("⭐ adaptador com resposta por SESSÃO: vale a dela, mesmo com isConfigured() verdadeiro", async () => {
    adapter.isConfiguredForSession = vi.fn(async () => false);
    const transporte = await criarTransporteDoAviso(adminComCanal({ provider: "waha", sessionRef: "org_acme" }));

    expect(await transporte.configurado(ORG, CANAL)).toBe(false);
    expect(adapter.isConfiguredForSession).toHaveBeenCalledWith("org_acme");
  });

  it("sessão configurada: passa o portão", async () => {
    adapter.isConfiguredForSession = vi.fn(async () => true);
    const transporte = await criarTransporteDoAviso(adminComCanal({ provider: "waha", sessionRef: "org_acme" }));
    expect(await transporte.configurado(ORG, CANAL)).toBe(true);
  });

  it("canal sem referência de sessão: não configurado (e a pergunta nem é feita)", async () => {
    adapter.isConfiguredForSession = vi.fn(async () => true);
    const transporte = await criarTransporteDoAviso(adminComCanal({ provider: "waha", sessionRef: null }));
    expect(await transporte.configurado(ORG, CANAL)).toBe(false);
    expect(adapter.isConfiguredForSession).not.toHaveBeenCalled();
  });

  it("adaptador sem resposta por sessão (outros canais): continua valendo `isConfigured()`", async () => {
    adapter.isConfiguredForSession = undefined;
    adapter.isConfigured.mockReturnValueOnce(false);
    const transporte = await criarTransporteDoAviso(adminComCanal({ provider: "meta_cloud", sessionRef: "x" }));
    expect(await transporte.configurado(ORG, CANAL)).toBe(false);
  });

  it("canal que não existe nesta empresa: não configurado", async () => {
    const transporte = await criarTransporteDoAviso(adminComCanal(null));
    expect(await transporte.configurado(ORG, CANAL)).toBe(false);
  });
});
