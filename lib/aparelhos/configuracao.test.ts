import { describe, expect, it } from "vitest";

import {
  HOSTS_PERMITIDOS_APARELHOS,
  configuracaoDeAparelhosSchema,
  lerConfiguracaoDeAparelhos,
  validarUrlDeAparelhos,
} from "./configuracao";

const URL_GRAU_CELL = "https://aparelhos.graucell.com/aparelhos.json";

describe("validarUrlDeAparelhos", () => {
  it("T-CFG-01 aceita a URL da Grau Cell", () => {
    const r = validarUrlDeAparelhos(URL_GRAU_CELL);
    expect(r).toEqual({ ok: true, url: URL_GRAU_CELL });
  });

  it("normaliza caixa do esquema e do host", () => {
    const r = validarUrlDeAparelhos("HTTPS://Aparelhos.GrauCell.com/aparelhos.json");
    expect(r).toEqual({ ok: true, url: URL_GRAU_CELL });
  });

  it("T-SEG-03 recusa http (mesmo fora de produção)", () => {
    expect(validarUrlDeAparelhos("http://aparelhos.graucell.com/aparelhos.json")).toEqual({
      ok: false,
      motivo: "esquema",
    });
  });

  it("T-SEG-01 recusa host fora da allowlist", () => {
    expect(validarUrlDeAparelhos("https://evil.example/aparelhos.json")).toEqual({ ok: false, motivo: "host" });
  });

  it("T-SEG-02 recusa host parecido (sufixo, prefixo, ponto final, subdomínio)", () => {
    for (const h of [
      "aparelhos.graucell.com.evil.io",
      "evil-aparelhos.graucell.com",
      "aparelhos.graucell.com.",
      "x.aparelhos.graucell.com",
      "graucell.com",
      "localhost",
      "127.0.0.1",
      "169.254.169.254",
    ]) {
      expect(validarUrlDeAparelhos(`https://${h}/aparelhos.json`), h).toEqual({ ok: false, motivo: "host" });
    }
  });

  it("T-SEG-04 recusa credencial embutida", () => {
    expect(validarUrlDeAparelhos("https://u:s@aparelhos.graucell.com/aparelhos.json")).toEqual({
      ok: false,
      motivo: "credencial",
    });
    expect(validarUrlDeAparelhos("https://u@aparelhos.graucell.com/aparelhos.json").ok).toBe(false);
  });

  it("T-SEG-05 recusa porta diferente da padrão (443 explícita é a padrão e passa)", () => {
    expect(validarUrlDeAparelhos("https://aparelhos.graucell.com:8443/aparelhos.json")).toEqual({
      ok: false,
      motivo: "porta",
    });
    expect(validarUrlDeAparelhos("https://aparelhos.graucell.com:443/aparelhos.json").ok).toBe(true);
  });

  it("recusa fragmento, lixo, esquema estranho e texto vazio", () => {
    expect(validarUrlDeAparelhos("https://aparelhos.graucell.com/aparelhos.json#x")).toEqual({
      ok: false,
      motivo: "fragmento",
    });
    for (const lixo of ["", "   ", "nao e url", "javascript:alert(1)", "file:///etc/passwd", "//aparelhos.graucell.com/x"]) {
      expect(validarUrlDeAparelhos(lixo).ok, lixo).toBe(false);
    }
  });

  it("a allowlist é só a loja", () => {
    expect([...HOSTS_PERMITIDOS_APARELHOS]).toEqual(["aparelhos.graucell.com"]);
  });
});

describe("configuracaoDeAparelhosSchema", () => {
  it("é estrito: chave desconhecida é recusada", () => {
    expect(configuracaoDeAparelhosSchema.safeParse({ url: URL_GRAU_CELL }).success).toBe(true);
    expect(configuracaoDeAparelhosSchema.safeParse({ url: URL_GRAU_CELL, extra: 1 }).success).toBe(false);
    expect(configuracaoDeAparelhosSchema.safeParse({ url: "http://aparelhos.graucell.com/a.json" }).success).toBe(false);
    expect(configuracaoDeAparelhosSchema.safeParse({}).success).toBe(false);
  });
});

describe("lerConfiguracaoDeAparelhos (nunca lança)", () => {
  it("T-CFG-03 settings nulo, texto, lista ou lixo: sem_url", () => {
    for (const lixo of [null, undefined, "x", 42, [], {}, { aparelhos: null }, { aparelhos: "x" }, { aparelhos: {} }, { aparelhos: { url: 123 } }, { aparelhos: { url: "" } }]) {
      expect(lerConfiguracaoDeAparelhos(lixo), JSON.stringify(lixo)).toEqual({ ok: false, motivo: "sem_url" });
    }
  });

  it("URL presente mas fora da regra: url_nao_permitida (sinal de adulteração)", () => {
    expect(lerConfiguracaoDeAparelhos({ aparelhos: { url: "https://evil.example/x.json" } })).toEqual({
      ok: false,
      motivo: "url_nao_permitida",
    });
    expect(lerConfiguracaoDeAparelhos({ aparelhos: { url: "http://aparelhos.graucell.com/a.json" } })).toEqual({
      ok: false,
      motivo: "url_nao_permitida",
    });
  });

  it("URL válida: devolve a URL normalizada, ignorando as outras chaves de settings", () => {
    expect(
      lerConfiguracaoDeAparelhos({ routing: { x: 1 }, branding: {}, aparelhos: { url: URL_GRAU_CELL } }),
    ).toEqual({ ok: true, url: URL_GRAU_CELL });
  });
});
