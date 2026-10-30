/**
 * O cron de saúde com MUITOS canais (um WAHA por empresa): o teto de 50 por rodada vira rodízio.
 *
 * Antes a consulta tinha `limit(50)` sem ordem — as mesmas 50 linhas na frente, sempre, e as outras sem
 * vigia. Agora a verificação mais antiga vem primeiro (nunca verificada antes de todas) e cada TENTATIVA é
 * carimbada em `last_health_check_at`, alcançasse o WAHA ou não: sem isso, um canal que não responde ficaria
 * para sempre na frente e empurraria os outros para fora.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  linhas: [] as Array<Record<string, unknown>>,
  ordenou: [] as Array<{ coluna: string; opcoes: unknown }>,
  limite: null as number | null,
  gravacoes: [] as Array<{ id: unknown; patch: Record<string, unknown> }>,
  saude: {} as Record<string, { reachable: boolean; status: string | null; detail: string | null }>,
}));

vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: () => true }));
vi.mock("@/lib/channels/health", () => ({ sincronizarSaudeDaConexao: vi.fn(async () => "sem_mudanca") }));
vi.mock("@/lib/channels", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAdapter: () => ({
    checkHealth: async ({ sessionRef }: { sessionRef: string }) => mundo.saude[sessionRef] ?? { reachable: false, status: null, detail: "x" },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let patch: Record<string, unknown> | null = null;
      const filtros: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        select: () => q,
        is: () => q,
        order: (coluna: string, opcoes: unknown) => {
          mundo.ordenou.push({ coluna, opcoes });
          return q;
        },
        limit: async (n: number) => {
          mundo.limite = n;
          return { data: mundo.linhas, error: null };
        },
        update: (p: Record<string, unknown>) => {
          patch = p;
          return q;
        },
        eq: (coluna: string, valor: unknown) => {
          filtros[coluna] = valor;
          return q;
        },
        then: (resolve: (v: { error: null }) => void) => {
          if (patch) mundo.gravacoes.push({ id: filtros.id, patch });
          resolve({ error: null });
        },
      };
      return q;
    },
  }),
}));

import { GET } from "@/app/api/v1/cron/channel-health/route";

const pedido = () => new NextRequest("https://crm.exemplo.com.br/api/v1/cron/channel-health");
const linha = (id: string, status: string) => ({
  id,
  organization_id: `org-${id}`,
  status,
  display_name: id,
  phone_number: null,
  archived_at: null,
  provider: "waha",
  waha_session_name: `sessao_${id}`,
  meta_phone_number_id: null,
  zernio_account_id: null,
  datafy_phone_number_id: null,
});

beforeEach(() => {
  mundo.linhas = [];
  mundo.ordenou = [];
  mundo.limite = null;
  mundo.gravacoes = [];
  mundo.saude = {};
});

describe("cron channel-health — rodízio", () => {
  it("pede a verificação mais antiga primeiro (nunca verificada na frente), com o teto de 50", async () => {
    await GET(pedido());
    expect(mundo.ordenou).toEqual([{ coluna: "last_health_check_at", opcoes: { ascending: true, nullsFirst: true } }]);
    expect(mundo.limite).toBe(50);
  });

  it("carimba a tentativa de CADA canal, alcançando o WAHA ou não — é o que faz o rodízio andar", async () => {
    mundo.linhas = [linha("a", "WORKING"), linha("b", "WORKING")];
    mundo.saude = {
      sessao_a: { reachable: true, status: "WORKING", detail: null },
      sessao_b: { reachable: false, status: null, detail: "waha_do_canal_chave_ilegivel" },
    };
    await GET(pedido());

    const porId = Object.fromEntries(mundo.gravacoes.map((g) => [String(g.id), g.patch]));
    expect(Object.keys(porId).sort()).toEqual(["a", "b"]);
    expect(porId.a).toHaveProperty("last_health_check_at");
    expect(porId.b).toHaveProperty("last_health_check_at");
    // quem não respondeu NÃO tem o status trocado por ruído
    expect(porId.b).not.toHaveProperty("status");
  });

  it("status que mudou é gravado junto do carimbo, na mesma escrita", async () => {
    mundo.linhas = [linha("a", "WORKING")];
    mundo.saude = { sessao_a: { reachable: true, status: "STOPPED", detail: null } };
    await GET(pedido());

    expect(mundo.gravacoes).toHaveLength(1);
    expect(mundo.gravacoes[0]!.patch).toMatchObject({ status: "STOPPED" });
    expect(mundo.gravacoes[0]!.patch).toHaveProperty("last_health_check_at");
    expect(mundo.gravacoes[0]!.patch).toHaveProperty("last_status_change_at");
  });
});
