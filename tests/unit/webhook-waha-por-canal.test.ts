import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AS DUAS ROTAS DO WEBHOOK COM UM WAHA POR EMPRESA.
 *
 *  - a rota POR TOKEN passa a dizer à autenticação quando o canal tem WAHA próprio (aí a assinatura com o
 *    segredo do canal é sempre exigida);
 *  - a rota GLOBAL pode ser desligada (`WAHA_WEBHOOK_GLOBAL_ENABLED=false` → 404) e nunca atende canal com
 *    WAHA próprio: o contêiner dele chama a rota com o token.
 */

const SESSAO = vi.hoisted(() => ({
  id: "sess-1",
  organization_id: "org-1",
  waha_session_name: "org_aaaaaaaa_bbbb",
  webhook_secret_encrypted: "\\xabcd",
  waha_base_url: null as string | null,
  status: "WORKING",
  is_warmup_complete: true,
  warmup_started_at: null,
}));
const estado = vi.hoisted(() => ({
  arquivados: [] as Record<string, unknown>[],
  autenticacoes: [] as Array<Record<string, unknown>>,
  despachados: [] as unknown[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (linha: Record<string, unknown>) => {
        estado.arquivados.push(linha);
        return { select: () => ({ maybeSingle: async () => ({ data: { id: "log-1" }, error: null }) }) };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
    rpc: async () => ({ data: "segredo-decifrado-bem-longo-0123", error: null }),
  }),
}));
vi.mock("@/lib/channels/archived", () => ({
  ARCHIVED_AT: "archived_at",
  queryTolerantToMissingArchived: async () => ({ data: SESSAO, error: null }),
}));
vi.mock("@/lib/audit", () => ({ audit: async () => undefined }));
vi.mock("@/lib/waha/webhook-auth", () => ({
  authenticateWahaWebhook: (entrada: Record<string, unknown>) => {
    estado.autenticacoes.push(entrada);
    return { ok: true, signatureVerified: true };
  },
}));
vi.mock("@/lib/waha/ingest", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  dispatchWahaEvent: async (_a: unknown, _s: unknown, envelope: unknown) => {
    estado.despachados.push(envelope);
  },
}));

const TOKEN = "token-da-rota-de-producao-0001";
const EVENTO = {
  event: "message.any",
  session: "org_aaaaaaaa_bbbb",
  payload: { id: "wamid.OK", from: "5531988887777@c.us", body: "oi" },
};
const pedido = () =>
  ({
    text: async () => JSON.stringify(EVENTO),
    headers: new Headers({ "x-webhook-hmac": "abc" }),
  }) as never;

async function rotas(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const global = await import("@/app/api/v1/webhooks/waha/route");
  const porToken = await import("@/app/api/v1/webhooks/waha/[token]/route");
  return {
    postGlobal: () => global.POST(pedido()),
    postPorToken: () => porToken.POST(pedido(), { params: Promise.resolve({ token: TOKEN }) }),
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  estado.arquivados.length = 0;
  estado.autenticacoes.length = 0;
  estado.despachados.length = 0;
  SESSAO.waha_base_url = null;
});

describe("rota por token — canal com WAHA próprio", () => {
  it("⭐ canal com WAHA próprio: a autenticação é avisada (assinatura do canal obrigatória)", async () => {
    SESSAO.waha_base_url = "http://waha-acme:3000";
    const { postPorToken } = await rotas();
    await postPorToken();
    expect(estado.autenticacoes).toHaveLength(1);
    expect(estado.autenticacoes[0]).toMatchObject({ canalComWahaProprio: true, sessionSecret: "segredo-decifrado-bem-longo-0123" });
  });

  it("canal do modo compartilhado: a autenticação segue como sempre foi (canalComWahaProprio = false)", async () => {
    SESSAO.waha_base_url = null;
    const { postPorToken } = await rotas();
    await postPorToken();
    expect(estado.autenticacoes[0]).toMatchObject({ canalComWahaProprio: false });
  });
});

describe("rota global", () => {
  it("por padrão está ligada (atende o contêiner compartilhado)", async () => {
    const { postGlobal } = await rotas();
    const res = await postGlobal();
    expect(res.status).not.toBe(404);
    expect(estado.autenticacoes).toHaveLength(1);
  });

  it("⭐ WAHA_WEBHOOK_GLOBAL_ENABLED=false: responde 404 e não toca em banco, autenticação nem arquivo", async () => {
    const { postGlobal } = await rotas({ WAHA_WEBHOOK_GLOBAL_ENABLED: "false" });
    const res = await postGlobal();
    expect(res.status).toBe(404);
    expect(estado.autenticacoes).toEqual([]);
    expect(estado.arquivados).toEqual([]);
  });

  it("a chave desligada não afeta a rota POR TOKEN", async () => {
    const { postPorToken } = await rotas({ WAHA_WEBHOOK_GLOBAL_ENABLED: "false" });
    const res = await postPorToken();
    expect(res.status).not.toBe(404);
    expect(estado.autenticacoes).toHaveLength(1);
  });

  it("valor torto na variável não derruba nada: só 'false' desliga", async () => {
    const { postGlobal } = await rotas({ WAHA_WEBHOOK_GLOBAL_ENABLED: "talvez" });
    const res = await postGlobal();
    expect(res.status).not.toBe(404);
  });

  it("⭐ canal com WAHA próprio NÃO entra pela rota global: 200 ignorado, nada é autenticado nem arquivado", async () => {
    SESSAO.waha_base_url = "http://waha-acme:3000";
    const { postGlobal } = await rotas();
    const res = await postGlobal();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { accepted: false, reason: "canal_com_webhook_proprio" } });
    expect(estado.autenticacoes).toEqual([]);
    expect(estado.arquivados).toEqual([]);
    expect(estado.despachados).toEqual([]);
  });
});
