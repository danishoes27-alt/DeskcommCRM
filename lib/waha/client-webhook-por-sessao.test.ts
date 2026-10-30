import { afterEach, describe, expect, it, vi } from "vitest";

import { WahaClient } from "./client";

/**
 * O WEBHOOK POR SESSÃO no cliente do WAHA: ao criar a sessão (o contêiner da empresa fica genérico) e ao
 * reaplicar (o operador, quando a base pública muda ou o segredo foi trocado).
 */
const WEBHOOK = {
  url: "https://crm.exemplo.com.br/api/v1/webhooks/waha/d9001000222240008000000000000a01",
  events: ["message.any", "session.status"],
  hmacKey: "k".repeat(48),
};
const NO_FORMATO_DO_WAHA = { url: WEBHOOK.url, events: ["message.any", "session.status"], hmac: { key: WEBHOOK.hmacKey } };

interface Chamada {
  url: string;
  metodo: string;
  corpo: unknown;
}

function wahaDeMentira(sessao: Record<string, unknown>) {
  const chamadas: Chamada[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (url: unknown, init?: RequestInit) => {
    const corpo = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    chamadas.push({ url: String(url), metodo: init?.method ?? "GET", corpo });
    return new Response(JSON.stringify(sessao), { status: init?.method === "POST" ? 201 : 200 });
  }) as typeof fetch);
  return chamadas;
}

afterEach(() => vi.restoreAllMocks());

describe("createSession com webhook por sessão", () => {
  const SESSAO = { name: "org_a", status: "STOPPED", engine: { engine: "NOWEB" }, config: { ignore: {} } };

  it("manda config.webhooks[] com url, eventos e hmac.key, junto do filtro de conversas", async () => {
    const chamadas = wahaDeMentira(SESSAO);
    await new WahaClient("http://waha-a:3000", "chave").createSession("org_a", WEBHOOK).catch(() => undefined);

    const post = chamadas.find((c) => c.metodo === "POST" && c.url.endsWith("/api/sessions"));
    expect(post?.corpo).toMatchObject({ name: "org_a", start: false, config: { webhooks: [NO_FORMATO_DO_WAHA] } });
    expect((post?.corpo as { config: { ignore: unknown } }).config.ignore).toBeTruthy();
  });

  it("sem webhook (modo compartilhado): a config NÃO leva `webhooks`, como sempre foi", async () => {
    const chamadas = wahaDeMentira(SESSAO);
    await new WahaClient("http://waha-a:3000", "chave").createSession("org_a").catch(() => undefined);

    const post = chamadas.find((c) => c.metodo === "POST" && c.url.endsWith("/api/sessions"));
    expect((post?.corpo as { config: Record<string, unknown> }).config).not.toHaveProperty("webhooks");
  });
});

describe("aplicarWebhookNaSessao", () => {
  const ATUAL = { name: "org_a", status: "WORKING", config: { ignore: { status: true }, webhooks: [] as unknown[] } };

  it("sessão sem o webhook: PUT com a config preservada e só `webhooks` trocado", async () => {
    const chamadas = wahaDeMentira(ATUAL);
    const r = await new WahaClient("http://waha-a:3000", "chave").aplicarWebhookNaSessao("org_a", WEBHOOK);

    expect(r).toBe("aplicado");
    const put = chamadas.find((c) => c.metodo === "PUT");
    expect(put?.url).toBe("http://waha-a:3000/api/sessions/org_a");
    expect(put?.corpo).toEqual({ name: "org_a", config: { ignore: { status: true }, webhooks: [NO_FORMATO_DO_WAHA] } });
  });

  it("sessão com `config: null` (o WAHA devolve assim uma sessão sem configuração): recebe o webhook do mesmo jeito", async () => {
    const chamadas = wahaDeMentira({ name: "org_a", status: "STOPPED", config: null });
    const r = await new WahaClient("http://waha-a:3000", "chave").aplicarWebhookNaSessao("org_a", WEBHOOK);

    expect(r).toBe("aplicado");
    expect(chamadas.find((c) => c.metodo === "PUT")?.corpo).toEqual({ name: "org_a", config: { webhooks: [NO_FORMATO_DO_WAHA] } });
  });

  it("⭐ sessão que já tem exatamente este webhook: NÃO faz PUT (o PUT reinicia a sessão)", async () => {
    const chamadas = wahaDeMentira({ ...ATUAL, config: { ...ATUAL.config, webhooks: [{ ...NO_FORMATO_DO_WAHA, events: ["session.status", "message.any"] }] } });
    const r = await new WahaClient("http://waha-a:3000", "chave").aplicarWebhookNaSessao("org_a", WEBHOOK);

    expect(r).toBe("ja_estava");
    expect(chamadas.some((c) => c.metodo === "PUT")).toBe(false);
  });

  it("webhook velho (outra URL ou outra chave): troca", async () => {
    for (const velho of [{ ...NO_FORMATO_DO_WAHA, url: "https://outro.exemplo.com/x" }, { ...NO_FORMATO_DO_WAHA, hmac: { key: "outra" } }]) {
      const chamadas = wahaDeMentira({ ...ATUAL, config: { ...ATUAL.config, webhooks: [velho] } });
      expect(await new WahaClient("http://waha-a:3000", "chave").aplicarWebhookNaSessao("org_a", WEBHOOK)).toBe("aplicado");
      expect(chamadas.some((c) => c.metodo === "PUT")).toBe(true);
      vi.restoreAllMocks();
    }
  });

  it("erro do WAHA (sessão inexistente ou recusa): lança, sem gravar nada", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    await expect(new WahaClient("http://waha-a:3000", "chave").aplicarWebhookNaSessao("org_a", WEBHOOK)).rejects.toThrow("waha_webhook_404");
  });

  it("sessão devolvida com outro nome: recusa a reescrever", async () => {
    wahaDeMentira({ ...ATUAL, name: "outra_sessao" });
    await expect(new WahaClient("http://waha-a:3000", "chave").aplicarWebhookNaSessao("org_a", WEBHOOK)).rejects.toThrow("waha_webhook_sessao_invalida");
  });
});
