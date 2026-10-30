import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/v1/health com um WAHA POR EMPRESA.
 *
 * A rota é pública e roda a cada poucos segundos. Com WAHAs por empresa ela NÃO sonda cada um (seriam N idas
 * à rede, e o endereço de cada empresa é segredo): lê do banco a CONTAGEM de canais de pé e caídos. O que se
 * prova aqui: o WhatsApp de uma empresa que cai deixa o check `degraded` — nunca `down`, que o resto da rota
 * transformaria em 503 — e a resposta pública só carrega contagens.
 */

const banco = vi.hoisted(() => ({
  canais: [] as Array<{ status: string | null }>,
  quebrado: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (banco.quebrado) throw new Error("sem banco neste teste");
    const q = {
      select: () => q,
      not: () => q,
      is: () => Promise.resolve({ data: banco.canais, error: null }),
    };
    return { from: () => q };
  },
}));

function comEnv(waha: { url?: string; key?: string }) {
  vi.doMock("@/lib/env", () => ({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://projeto-do-cliente.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "chave-de-teste",
      UPSTASH_REDIS_REST_URL: "https://redis.exemplo.com",
      UPSTASH_REDIS_REST_TOKEN: "token-de-teste",
      INTERNAL_CRON_SECRET: "segredo-interno-de-teste-com-tamanho-suficiente",
      INTERNAL_SECRET: "",
      WAHA_API_BASE_URL: waha.url,
      WAHA_API_KEY: waha.key,
    },
  }));
}

function respondeSoOWahaGlobal(statusDoWaha: number | "cai") {
  vi.spyOn(globalThis, "fetch").mockImplementation((async (url: unknown) => {
    const u = String(url);
    if (u.startsWith("http://waha-global:3000")) {
      if (statusDoWaha === "cai") throw new Error("fetch failed");
      return new Response("[]", { status: statusDoWaha });
    }
    throw new Error("sem rede para o resto neste teste");
  }) as typeof fetch);
}

async function checkWaha(): Promise<{ status: number; waha: Record<string, unknown>; corpo: string }> {
  const { GET } = await import("@/app/api/v1/health/route");
  const res = await GET(new NextRequest("https://crm.exemplo.com.br/api/v1/health"));
  const texto = await res.text();
  return { status: res.status, waha: JSON.parse(texto).data.checks.waha, corpo: texto };
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  banco.canais = [];
  banco.quebrado = false;
});

describe("health — canais com WAHA próprio", () => {
  it("sem WAHA global: canais todos de pé = ok, com as contagens", async () => {
    comEnv({});
    banco.canais = [{ status: "WORKING" }, { status: "WORKING" }];
    respondeSoOWahaGlobal(200);
    const { waha } = await checkWaha();
    expect(waha).toMatchObject({ status: "ok", canais: { total: 2, ok: 2, com_falha: 0 } });
  });

  it("⭐ sem WAHA global: o WAHA de UMA empresa caído deixa `degraded`, nunca `down` — não vira 503 por isso", async () => {
    comEnv({});
    banco.canais = [{ status: "WORKING" }, { status: "WORKING" }, { status: "STOPPED" }];
    respondeSoOWahaGlobal(200);
    const { waha } = await checkWaha();
    expect(waha).toMatchObject({ status: "degraded", error: "erro_ao_consultar", canais: { total: 3, ok: 2, com_falha: 1 } });
    expect(waha.status).not.toBe("down");
  });

  it("canal esperando o QR ou subindo não conta como falha", async () => {
    comEnv({});
    banco.canais = [{ status: "WORKING" }, { status: "SCAN_QR_CODE" }, { status: "STARTING" }];
    respondeSoOWahaGlobal(200);
    const { waha } = await checkWaha();
    expect(waha).toMatchObject({ status: "ok", canais: { total: 3, ok: 1, com_falha: 0 } });
  });

  it("com WAHA global de pé e um canal caído: degraded, com as contagens", async () => {
    comEnv({ url: "http://waha-global:3000", key: "chave-global" });
    banco.canais = [{ status: "FAILED" }];
    respondeSoOWahaGlobal(200);
    const { waha } = await checkWaha();
    expect(waha).toMatchObject({ status: "degraded", error: "erro_ao_consultar", canais: { total: 1, ok: 0, com_falha: 1 } });
  });

  it("o WAHA global caído continua `down` (o modo compartilhado não mudou)", async () => {
    comEnv({ url: "http://waha-global:3000", key: "chave-global" });
    banco.canais = [{ status: "WORKING" }];
    respondeSoOWahaGlobal("cai");
    const { waha } = await checkWaha();
    expect(waha.status).toBe("down");
  });

  it("sem WAHA global e sem nenhum canal próprio: `degraded` / não configurado, como sempre", async () => {
    comEnv({});
    respondeSoOWahaGlobal(200);
    const { waha } = await checkWaha();
    expect(waha).toMatchObject({ status: "degraded", reason: "nao_configurado" });
    expect(waha.canais).toBeUndefined();
  });

  it("banco fora do ar: a rota não falha por causa do resumo (sem o campo `canais`)", async () => {
    comEnv({});
    banco.quebrado = true;
    respondeSoOWahaGlobal(200);
    const { waha, status } = await checkWaha();
    expect(waha).toMatchObject({ status: "degraded", reason: "nao_configurado" });
    expect(waha.canais).toBeUndefined();
    expect([200, 503]).toContain(status);
  });

  it("a resposta pública só tem contagens: nenhum endereço nem nome de empresa", async () => {
    comEnv({});
    banco.canais = [{ status: "STOPPED" }];
    respondeSoOWahaGlobal(200);
    const { corpo } = await checkWaha();
    expect(corpo).not.toMatch(/waha-|http:\/\/|org_/);
  });
});
