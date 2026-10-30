/**
 * O retrato da instalação continua enxergando o servidor de WhatsApp GLOBAL (modo compartilhado) como "de pé" —
 * a regra nova (o WhatsApp da empresa também conta) não pode tirar o que já valia.
 */
import { describe, expect, it } from "vitest";

import { lerRetratoDaInstalacao } from "@/lib/instalacao/retrato";

const ORG = "11111111-1111-4111-8111-111111111111";

/** Um cliente de mentira que responde "nada" a qualquer leitura. */
function clienteVazio() {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "not", "order", "limit", "neq"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: null, error: null });
  q.then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
  return { from: () => q } as never;
}

describe("retrato — servidor de WhatsApp global", () => {
  it("endereço e chave reais no ambiente: o WhatsApp conta como de pé, mesmo sem WhatsApp da empresa", async () => {
    const r = await lerRetratoDaInstalacao({
      supabase: clienteVazio(),
      orgId: ORG,
      ambiente: { WAHA_API_BASE_URL: "http://waha:3000", WAHA_API_KEY: "chave-real", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" },
      wahaDaEmpresaPronto: async () => false,
    });
    expect(r.whatsapp.transporteApontado).toBe(true);
  });

  it("a chave de enfeite do exemplo NÃO conta", async () => {
    const r = await lerRetratoDaInstalacao({
      supabase: clienteVazio(),
      orgId: ORG,
      ambiente: { WAHA_API_BASE_URL: "http://waha:3000", WAHA_API_KEY: "dev_plaintext_change_me", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" },
    });
    expect(r.whatsapp.transporteApontado).toBe(false);
  });
});
