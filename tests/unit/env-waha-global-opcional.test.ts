import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O WAHA GLOBAL É OPCIONAL: o app sobe só com os WAHAs dos canais (um por empresa).
 *
 * Antes `WAHA_API_BASE_URL`, `WAHA_API_KEY` e `WAHA_WEBHOOK_BASE_URL` eram `required()` em produção: a
 * instalação não subia sem um WAHA global, mesmo que cada empresa tivesse o seu. Agora são o WAHA dos
 * canais que não têm o próprio. O que continua sendo erro é a configuração PELA METADE (endereço sem chave,
 * ou o contrário), que esconde a causa de um WhatsApp que não responde.
 */

describe("problemasDoWahaGlobal", () => {
  async function problemas(src: { WAHA_API_BASE_URL?: string; WAHA_API_KEY?: string }) {
    const { problemasDoWahaGlobal } = await import("@/lib/env");
    return problemasDoWahaGlobal(src);
  }

  it("nenhuma das duas: tudo bem (cada empresa tem o seu WAHA)", async () => {
    expect(await problemas({})).toEqual([]);
    expect(await problemas({ WAHA_API_BASE_URL: "", WAHA_API_KEY: "" })).toEqual([]);
    expect(await problemas({ WAHA_API_BASE_URL: "  ", WAHA_API_KEY: "  " })).toEqual([]);
  });

  it("as duas: tudo bem (modo compartilhado)", async () => {
    expect(await problemas({ WAHA_API_BASE_URL: "http://waha:3000", WAHA_API_KEY: "chave" })).toEqual([]);
  });

  it("⭐ endereço sem chave é erro, com a mensagem dizendo o que falta", async () => {
    const p = await problemas({ WAHA_API_BASE_URL: "http://waha:3000" });
    expect(p).toHaveLength(1);
    expect(p[0]?.campo).toBe("WAHA_API_KEY");
    expect(p[0]?.mensagem).toContain("WAHA_API_BASE_URL está preenchida, mas WAHA_API_KEY não");
  });

  it("⭐ chave sem endereço é erro", async () => {
    const p = await problemas({ WAHA_API_KEY: "chave" });
    expect(p).toHaveLength(1);
    expect(p[0]?.campo).toBe("WAHA_API_BASE_URL");
  });

  it("a mensagem de erro não repete o valor da chave", async () => {
    const p = await problemas({ WAHA_API_KEY: "chave-super-secreta-123" });
    expect(JSON.stringify(p)).not.toContain("chave-super-secreta-123");
  });
});

describe("lib/env — o boot com e sem WAHA global", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sem nenhuma variável WAHA o módulo carrega, e o WAHA global fica vazio", async () => {
    vi.stubEnv("WAHA_API_BASE_URL", "");
    vi.stubEnv("WAHA_API_KEY", "");
    vi.stubEnv("WAHA_WEBHOOK_BASE_URL", "");
    const { env } = await import("@/lib/env");
    expect(env.WAHA_API_BASE_URL).toBe("");
    expect(env.WAHA_API_KEY).toBe("");
    expect(env.WAHA_WEBHOOK_BASE_URL).toBe("");
  });

  it("com as duas, carrega", async () => {
    vi.stubEnv("WAHA_API_BASE_URL", "http://waha:3000");
    vi.stubEnv("WAHA_API_KEY", "chave-de-teste");
    const { env } = await import("@/lib/env");
    expect(env.WAHA_API_BASE_URL).toBe("http://waha:3000");
  });

  it("fora de produção a configuração pela metade não derruba o boot (o .env de dev é montado aos poucos)", async () => {
    vi.stubEnv("WAHA_API_BASE_URL", "http://localhost:3000");
    vi.stubEnv("WAHA_API_KEY", "");
    await expect(import("@/lib/env")).resolves.toBeTruthy();
  });
});

describe("o schema não volta a exigir o WAHA global em produção", () => {
  const fonte = readFileSync("lib/env.ts", "utf8");

  it.each(["WAHA_API_BASE_URL", "WAHA_API_KEY", "WAHA_WEBHOOK_BASE_URL"])("%s é opcional", (nome) => {
    expect(fonte).not.toMatch(new RegExp(`${nome}:\\s*required\\(`));
    expect(fonte).toMatch(new RegExp(`${nome}:\\s*z\\.string\\(\\)\\.optional\\(\\)\\.default\\(""\\)`));
  });
});

describe("a regra da metade está ligada ao boot de produção", () => {
  const fonte = readFileSync("lib/env.ts", "utf8");

  it("o schema passa por problemasDoWahaGlobal só quando isProd, como o required() que ela substitui", () => {
    const bloco = fonte.slice(fonte.indexOf("const schema = schemaBase.superRefine"), fonte.indexOf("let parsed = schema.safeParse"));
    expect(bloco).toContain("if (!isProd) return;");
    expect(bloco).toContain("problemasDoWahaGlobal(valores)");
    expect(bloco).toContain('code: "custom"');
  });
});

describe("lib/env — o boot em PRODUÇÃO (todas as outras variáveis obrigatórias presentes)", () => {
  /** Os nomes que o schema exige em produção, lidos do próprio arquivo: a lista não envelhece sozinha. */
  const obrigatorias = [...readFileSync("lib/env.ts", "utf8").matchAll(/(?:required|requiredAlways)\("([A-Z0-9_]+)"\)/g)].map((m) => m[1]!);

  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("NODE_ENV", "production");
    for (const nome of obrigatorias) vi.stubEnv(nome, "https://valor-de-teste.exemplo.com/abc");
    for (const nome of ["WAHA_API_BASE_URL", "WAHA_API_KEY", "WAHA_WEBHOOK_BASE_URL"]) vi.stubEnv(nome, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("controle: a lista de obrigatórias foi lida (senão o teste seguinte não prova nada)", () => {
    expect(obrigatorias.length).toBeGreaterThan(5);
    expect(obrigatorias).not.toContain("WAHA_API_BASE_URL");
    expect(obrigatorias).not.toContain("WAHA_API_KEY");
    expect(obrigatorias).not.toContain("WAHA_WEBHOOK_BASE_URL");
  });

  it("⭐ produção SEM nenhuma variável WAHA: o app sobe (só com os WAHAs dos canais)", async () => {
    const { env } = await import("@/lib/env");
    expect(env.WAHA_API_BASE_URL).toBe("");
  });

  it("⭐ produção com o WAHA global completo: sobe", async () => {
    vi.stubEnv("WAHA_API_BASE_URL", "http://waha:3000");
    vi.stubEnv("WAHA_API_KEY", "chave");
    await expect(import("@/lib/env")).resolves.toBeTruthy();
  });

  it("⭐ produção só com a chave: o boot RECUSA", async () => {
    vi.stubEnv("WAHA_API_KEY", "chave");
    await expect(import("@/lib/env")).rejects.toThrow("Variáveis de ambiente inválidas");
  });

  it("⭐ produção só com o endereço: o boot RECUSA", async () => {
    vi.stubEnv("WAHA_API_BASE_URL", "http://waha:3000");
    await expect(import("@/lib/env")).rejects.toThrow("Variáveis de ambiente inválidas");
  });
});
