import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  EVENTOS_DO_WEBHOOK_DO_WAHA,
  TAMANHO_MINIMO_DO_SEGREDO_DO_WEBHOOK,
  novoSegredoDoWebhook,
  urlDoWebhookDoCanal,
  webhookDaSessao,
  webhookParaOWaha,
} from "./waha-webhook";

describe("novoSegredoDoWebhook", () => {
  it("48 hexadecimais, acima do mínimo que a autenticação aceita como segredo de verdade", () => {
    const s = novoSegredoDoWebhook();
    expect(s).toMatch(/^[0-9a-f]{48}$/);
    expect(s.length).toBeGreaterThanOrEqual(TAMANHO_MINIMO_DO_SEGREDO_DO_WEBHOOK);
  });

  it("cada chamada devolve um segredo diferente", () => {
    const todos = new Set(Array.from({ length: 50 }, () => novoSegredoDoWebhook()));
    expect(todos.size).toBe(50);
  });
});

describe("urlDoWebhookDoCanal", () => {
  const TOKEN = "d9001000222240008000000000000a01";

  it("monta <base>/api/v1/webhooks/waha/<token>, sem barra dupla", () => {
    expect(urlDoWebhookDoCanal("https://crm.exemplo.com.br", TOKEN)).toBe(`https://crm.exemplo.com.br/api/v1/webhooks/waha/${TOKEN}`);
    expect(urlDoWebhookDoCanal("https://crm.exemplo.com.br/", TOKEN)).toBe(`https://crm.exemplo.com.br/api/v1/webhooks/waha/${TOKEN}`);
    expect(urlDoWebhookDoCanal("http://app:3000", TOKEN)).toBe(`http://app:3000/api/v1/webhooks/waha/${TOKEN}`);
  });

  it.each([
    ["sem esquema", "crm.exemplo.com.br"],
    ["outro protocolo", "ftp://crm.exemplo.com.br"],
    ["com usuário e senha", "https://u:s@crm.exemplo.com.br"],
    ["com parâmetros", "https://crm.exemplo.com.br?x=1"],
    ["vazia", ""],
  ])("recusa base %s", (_nome, base) => {
    expect(() => urlDoWebhookDoCanal(base, TOKEN)).toThrow("webhook_base_url_invalida");
  });

  it.each(["curto", "com espaço no token ok", "tok/en-com-barra-0001", "../etc/passwd-aaaa"])("recusa token torto %s", (token) => {
    expect(() => urlDoWebhookDoCanal("https://crm.exemplo.com.br", token)).toThrow("webhook_token_invalido");
  });
});

describe("webhookDaSessao / webhookParaOWaha", () => {
  it("leva os eventos do app, e o formato do WAHA tem hmac.key", () => {
    const w = webhookDaSessao("https://crm.exemplo.com.br", "d9001000222240008000000000000a01", "a".repeat(48));
    expect(w.events).toEqual(EVENTOS_DO_WEBHOOK_DO_WAHA);
    expect(webhookParaOWaha(w)).toEqual({
      url: "https://crm.exemplo.com.br/api/v1/webhooks/waha/d9001000222240008000000000000a01",
      events: [...EVENTOS_DO_WEBHOOK_DO_WAHA],
      hmac: { key: "a".repeat(48) },
    });
  });

  it("recusa segredo curto (placeholder não assina nada)", () => {
    expect(() => webhookDaSessao("https://crm.exemplo.com.br", "d9001000222240008000000000000a01", "curto")).toThrow("webhook_segredo_curto");
  });

  it("não pede o evento `message` (message.any é superconjunto estrito)", () => {
    expect(EVENTOS_DO_WEBHOOK_DO_WAHA).not.toContain("message");
    expect(EVENTOS_DO_WEBHOOK_DO_WAHA).toContain("message.any");
  });
});

describe("a lista de eventos e o nome da variável de assinatura nos arquivos compose", () => {
  const COMPOSES = ["docker-compose.prod.yml", "docker-compose.local.yml", "docker-compose.yml"];

  it.each(COMPOSES)("%s pede exatamente os mesmos eventos que o webhook por sessão", (arquivo) => {
    const linha = readFileSync(arquivo, "utf8")
      .split("\n")
      .find((l) => l.includes("WHATSAPP_HOOK_EVENTS:"));
    expect(linha, `${arquivo} não tem WHATSAPP_HOOK_EVENTS`).toBeTruthy();
    const eventos = /"([^"]+)"/.exec(linha ?? "")?.[1]?.split(",") ?? [];
    expect(eventos).toEqual([...EVENTOS_DO_WEBHOOK_DO_WAHA]);
  });

  it.each(COMPOSES)("%s usa WHATSAPP_HOOK_HMAC_KEY (com _KEY): sem ele o WAHA ignora a variável e não assina", (arquivo) => {
    const fonte = readFileSync(arquivo, "utf8");
    expect(fonte).toMatch(/^\s*WHATSAPP_HOOK_HMAC_KEY:\s*\$\{WAHA_HMAC_SECRET\}/m);
    expect(fonte).not.toMatch(/^\s*WHATSAPP_HOOK_HMAC:/m);
  });

  it("o runbook do kit também usa o nome certo", () => {
    const fonte = readFileSync("docs/runbooks/waha-hostgator.md", "utf8");
    expect(fonte).not.toMatch(/^\s*WHATSAPP_HOOK_HMAC:/m);
  });
});
