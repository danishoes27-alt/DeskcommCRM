import { describe, expect, it } from "vitest";

import {
  configuracaoDeAparelhosSchema,
  hostsDeAparelhosSchema,
  lerConfiguracaoDeAparelhos,
  validarUrlDeAparelhos,
} from "./configuracao";

const HOSTS = ["catalogo.example.com"];
const URL_LOJA = "https://catalogo.example.com/aparelhos.json";

describe("validarUrlDeAparelhos (host dentro da lista da organização)", () => {
  it("T-CFG-01 aceita a URL cujo host está na lista", () => {
    expect(validarUrlDeAparelhos(URL_LOJA, HOSTS)).toEqual({ ok: true, url: URL_LOJA });
  });

  it("normaliza caixa do esquema e do host", () => {
    expect(validarUrlDeAparelhos("HTTPS://Catalogo.Example.COM/aparelhos.json", HOSTS)).toEqual({
      ok: true,
      url: URL_LOJA,
    });
  });

  it("T-SEG-03 recusa http (mesmo fora de produção)", () => {
    expect(validarUrlDeAparelhos("http://catalogo.example.com/aparelhos.json", HOSTS)).toEqual({
      ok: false,
      motivo: "esquema",
    });
  });

  it("T-SEG-01 recusa host fora da lista, e lista vazia não libera nada", () => {
    expect(validarUrlDeAparelhos("https://evil.example/aparelhos.json", HOSTS)).toEqual({ ok: false, motivo: "host" });
    expect(validarUrlDeAparelhos(URL_LOJA, [])).toEqual({ ok: false, motivo: "host" });
  });

  it("T-SEG-02 recusa host parecido (sufixo, prefixo, ponto final, subdomínio, pai)", () => {
    for (const h of [
      "catalogo.example.com.evil.io",
      "evil-catalogo.example.com",
      "catalogo.example.com.",
      "x.catalogo.example.com",
      "example.com",
      "localhost",
      "127.0.0.1",
      "169.254.169.254",
    ]) {
      expect(validarUrlDeAparelhos(`https://${h}/aparelhos.json`, HOSTS), h).toEqual({ ok: false, motivo: "host" });
    }
  });

  it("T-SEG-04 recusa credencial embutida", () => {
    expect(validarUrlDeAparelhos("https://u:s@catalogo.example.com/aparelhos.json", HOSTS)).toEqual({
      ok: false,
      motivo: "credencial",
    });
    expect(validarUrlDeAparelhos("https://u@catalogo.example.com/aparelhos.json", HOSTS).ok).toBe(false);
  });

  it("T-SEG-05 recusa porta diferente da padrão (443 explícita é a padrão e passa)", () => {
    expect(validarUrlDeAparelhos("https://catalogo.example.com:8443/aparelhos.json", HOSTS)).toEqual({
      ok: false,
      motivo: "porta",
    });
    expect(validarUrlDeAparelhos("https://catalogo.example.com:443/aparelhos.json", HOSTS).ok).toBe(true);
  });

  it("recusa fragmento, lixo, esquema estranho e texto vazio", () => {
    expect(validarUrlDeAparelhos("https://catalogo.example.com/aparelhos.json#x", HOSTS)).toEqual({
      ok: false,
      motivo: "fragmento",
    });
    for (const lixo of ["", "   ", "nao e url", "javascript:alert(1)", "file:///etc/passwd", "//catalogo.example.com/x"]) {
      expect(validarUrlDeAparelhos(lixo, HOSTS).ok, lixo).toBe(false);
    }
  });
});

describe("hostsDeAparelhosSchema", () => {
  it("aceita hostnames em minúsculas, sem esquema, porta nem caminho", () => {
    expect(hostsDeAparelhosSchema.safeParse(["catalogo.example.com"]).success).toBe(true);
    expect(hostsDeAparelhosSchema.safeParse(["a.example.com", "b-2.example.org"]).success).toBe(true);
  });

  it("recusa lista vazia, repetida, grande demais e elementos fora do formato", () => {
    for (const ruim of [
      [],
      ["catalogo.example.com", "catalogo.example.com"],
      Array.from({ length: 11 }, (_, i) => `h${i}.example.com`),
      ["https://catalogo.example.com"],
      ["catalogo.example.com:443"],
      ["catalogo.example.com/aparelhos.json"],
      ["Catalogo.Example.com"],
      ["catalogo.example.com."],
      ["localhost"],
      ["127.0.0.1"],
      ["*.example.com"],
      ["user@catalogo.example.com"],
      [""],
      [42],
    ]) {
      expect(hostsDeAparelhosSchema.safeParse(ruim).success, JSON.stringify(ruim)).toBe(false);
    }
  });
});

describe("configuracaoDeAparelhosSchema", () => {
  it("exige url E hosts, é estrito, e a url precisa estar na lista", () => {
    expect(configuracaoDeAparelhosSchema.safeParse({ url: URL_LOJA, hosts: HOSTS }).success).toBe(true);
    expect(configuracaoDeAparelhosSchema.safeParse({ url: URL_LOJA }).success).toBe(false);
    expect(configuracaoDeAparelhosSchema.safeParse({ hosts: HOSTS }).success).toBe(false);
    expect(configuracaoDeAparelhosSchema.safeParse({ url: URL_LOJA, hosts: HOSTS, extra: 1 }).success).toBe(false);
    expect(configuracaoDeAparelhosSchema.safeParse({ url: URL_LOJA, hosts: ["outro.example.com"] }).success).toBe(false);
    expect(
      configuracaoDeAparelhosSchema.safeParse({ url: "http://catalogo.example.com/a.json", hosts: HOSTS }).success,
    ).toBe(false);
  });
});

describe("lerConfiguracaoDeAparelhos (nunca lança)", () => {
  it("T-CFG-03 settings nulo, texto, lista ou lixo: sem_url", () => {
    for (const lixo of [null, undefined, "x", 42, [], {}, { aparelhos: null }, { aparelhos: "x" }, { aparelhos: {} }, { aparelhos: { url: 123, hosts: HOSTS } }, { aparelhos: { url: "", hosts: HOSTS } }]) {
      expect(lerConfiguracaoDeAparelhos(lixo), JSON.stringify(lixo)).toEqual({ ok: false, motivo: "sem_url" });
    }
  });

  it("url sem hosts, ou com hosts vazio ou que não é lista: sem_hosts", () => {
    for (const hosts of [undefined, [], "catalogo.example.com", null, {}]) {
      expect(lerConfiguracaoDeAparelhos({ aparelhos: { url: URL_LOJA, hosts } }), JSON.stringify(hosts)).toEqual({
        ok: false,
        motivo: "sem_hosts",
      });
    }
  });

  it("hosts mal formados: hosts_invalidos", () => {
    for (const hosts of [["https://catalogo.example.com"], ["Catalogo.Example.com"], [42], ["localhost"]]) {
      expect(lerConfiguracaoDeAparelhos({ aparelhos: { url: URL_LOJA, hosts } })).toEqual({
        ok: false,
        motivo: "hosts_invalidos",
      });
    }
  });

  it("host da URL fora da lista, ou url fora da regra: url_fora_da_regra", () => {
    expect(
      lerConfiguracaoDeAparelhos({ aparelhos: { url: "https://evil.example/x.json", hosts: HOSTS } }),
    ).toEqual({ ok: false, motivo: "url_fora_da_regra" });
    expect(
      lerConfiguracaoDeAparelhos({ aparelhos: { url: "http://catalogo.example.com/a.json", hosts: HOSTS } }),
    ).toEqual({ ok: false, motivo: "url_fora_da_regra" });
  });

  it("configuração válida: devolve a URL normalizada e os hosts, ignorando as outras chaves de settings", () => {
    expect(
      lerConfiguracaoDeAparelhos({ routing: { x: 1 }, branding: {}, aparelhos: { url: URL_LOJA, hosts: HOSTS } }),
    ).toEqual({ ok: true, url: URL_LOJA, hosts: HOSTS });
  });
});
