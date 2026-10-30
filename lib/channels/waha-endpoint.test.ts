/**
 * O resolvedor "canal -> WAHA": cada canal fala com o WAHA dele; sem cadastro próprio, com o
 * global; com cadastro próprio QUEBRADO, com erro — nunca com o WAHA de outra empresa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fonteViaSupabase } from "@/lib/waha/fonte-do-endereco";

import {
  CHAVE_DE_ENFEITE_DO_WAHA,
  WahaDoCanalError,
  clienteDoWaha,
  enderecoDoAmbiente,
  fonteViaPg,
  limparCacheDoWaha,
  normalizarEnderecoDoWaha,
  registroDoWahaNasConfiguracoes,
  resolverEnderecoDoWaha,
  validarEnderecoDoWaha,
  type FonteDoWahaDoCanal,
  type LinhaDoWahaDoCanal,
} from "./waha-endpoint";

const GLOBAL = { WAHA_API_BASE_URL: "http://waha-global:3000/", WAHA_API_KEY: "chave-global" };
const SEM_GLOBAL = {};

/** Fonte de mentira: uma tabela por nome de sessão e uma "cifra" que é o texto invertido. */
function fonteDe(linhas: Record<string, LinhaDoWahaDoCanal | Error>) {
  const consultas: string[] = [];
  const decifradas: string[] = [];
  const fonte: FonteDoWahaDoCanal = {
    async porSessionRef(ref) {
      consultas.push(ref);
      const v = linhas[ref];
      if (v instanceof Error) throw v;
      return v ?? null;
    },
    async decifrar(cifra) {
      decifradas.push(cifra);
      if (cifra === "ilegivel") return null;
      if (cifra === "explode") throw new Error("pg caiu");
      return [...cifra].reverse().join("");
    },
  };
  return { fonte, consultas, decifradas };
}
const cifra = (claro: string) => [...claro].reverse().join("");

beforeEach(() => limparCacheDoWaha());

describe("normalizarEnderecoDoWaha", () => {
  it("aceita http e https e tira a barra do fim", () => {
    expect(normalizarEnderecoDoWaha("http://waha-acme:3000")).toBe("http://waha-acme:3000");
    expect(normalizarEnderecoDoWaha("  https://waha.exemplo.com/  ")).toBe("https://waha.exemplo.com");
    expect(normalizarEnderecoDoWaha("http://10.0.0.5:3000///")).toBe("http://10.0.0.5:3000");
  });

  it.each([
    ["não é URL", "waha-acme:3000"],
    ["outro protocolo", "ftp://waha:21"],
    ["javascript", "javascript:alert(1)"],
    ["com usuário e senha", "http://admin:segredo@waha:3000"],
    ["com parâmetros", "http://waha:3000/?x=1"],
    ["com âncora", "http://waha:3000/#a"],
    ["metadado de nuvem (IP)", "http://169.254.169.254/latest/meta-data"],
    ["metadado de nuvem (nome)", "http://metadata.google.internal/"],
  ])("recusa %s", (_nome, entrada) => {
    expect(() => normalizarEnderecoDoWaha(entrada)).toThrowError(WahaDoCanalError);
  });

  it("a recusa por senha na URL não repete a senha na mensagem", () => {
    try {
      normalizarEnderecoDoWaha("http://admin:segredo-xyz@waha:3000");
      throw new Error("devia ter recusado");
    } catch (e) {
      expect((e as Error).message).not.toContain("segredo-xyz");
    }
  });

  it("validarEnderecoDoWaha não lança e explica", () => {
    expect(validarEnderecoDoWaha("http://waha:3000/")).toEqual({ ok: true, url: "http://waha:3000" });
    expect(validarEnderecoDoWaha("")).toMatchObject({ ok: false });
    expect(validarEnderecoDoWaha(42)).toMatchObject({ ok: false });
    expect(validarEnderecoDoWaha("ftp://x")).toMatchObject({ ok: false, motivo: expect.stringContaining("http") });
  });
});

describe("enderecoDoAmbiente", () => {
  it("lê o WAHA global e marca a origem", () => {
    expect(enderecoDoAmbiente(GLOBAL)).toEqual({ baseUrl: "http://waha-global:3000", apiKey: "chave-global", origem: "ambiente" });
  });

  it("sem uma das duas, ou com a chave de enfeite do .env.example: null", () => {
    expect(enderecoDoAmbiente({})).toBeNull();
    expect(enderecoDoAmbiente({ WAHA_API_BASE_URL: "http://x:3000" })).toBeNull();
    expect(enderecoDoAmbiente({ WAHA_API_KEY: "k" })).toBeNull();
    expect(enderecoDoAmbiente({ ...GLOBAL, WAHA_API_KEY: CHAVE_DE_ENFEITE_DO_WAHA })).toBeNull();
  });
});

describe("resolverEnderecoDoWaha — canal com WAHA próprio", () => {
  it("fala com o WAHA do canal, com a chave decifrada", async () => {
    const { fonte } = fonteDe({
      org_a: { waha_base_url: "http://waha-acme:3000/", waha_api_key_encrypted: cifra("chave-da-acme") },
    });
    await expect(resolverEnderecoDoWaha(fonte, "org_a", { ambiente: GLOBAL })).resolves.toEqual({
      baseUrl: "http://waha-acme:3000",
      apiKey: "chave-da-acme",
      origem: "canal",
    });
  });

  it("dois canais de duas empresas resolvem para dois WAHAs diferentes", async () => {
    const { fonte } = fonteDe({
      org_a: { waha_base_url: "http://waha-a:3000", waha_api_key_encrypted: cifra("chave-a") },
      org_b: { waha_base_url: "http://waha-b:3000", waha_api_key_encrypted: cifra("chave-b") },
    });
    const a = await resolverEnderecoDoWaha(fonte, "org_a", { ambiente: GLOBAL });
    const b = await resolverEnderecoDoWaha(fonte, "org_b", { ambiente: GLOBAL });
    expect(a).toMatchObject({ baseUrl: "http://waha-a:3000", apiKey: "chave-a" });
    expect(b).toMatchObject({ baseUrl: "http://waha-b:3000", apiKey: "chave-b" });
  });

  it("o cliente HTTP nasce apontando para o endereço e a chave do canal", async () => {
    const { fonte } = fonteDe({ org_a: { waha_base_url: "http://waha-a:3000", waha_api_key_encrypted: cifra("chave-a") } });
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify({ version: "2026.7.2" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchFalso);
    try {
      const end = await resolverEnderecoDoWaha(fonte, "org_a", { ambiente: GLOBAL });
      await clienteDoWaha(end!).getServerVersion();
    } finally {
      vi.unstubAllGlobals();
    }
    const chamada = fetchFalso.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(chamada[0]).toBe("http://waha-a:3000/api/server/version");
    expect(chamada[1].headers["X-Api-Key"]).toBe("chave-a");
  });
});

describe("resolverEnderecoDoWaha — sem cadastro próprio: o WAHA global (modo compartilhado)", () => {
  it("colunas NULL -> ambiente", async () => {
    const { fonte } = fonteDe({ org_a: { waha_base_url: null, waha_api_key_encrypted: null } });
    await expect(resolverEnderecoDoWaha(fonte, "org_a", { ambiente: GLOBAL })).resolves.toMatchObject({
      origem: "ambiente",
      baseUrl: "http://waha-global:3000",
    });
  });

  it("endereço em branco conta como sem cadastro", async () => {
    const { fonte } = fonteDe({ org_a: { waha_base_url: "   ", waha_api_key_encrypted: null } });
    await expect(resolverEnderecoDoWaha(fonte, "org_a", { ambiente: GLOBAL })).resolves.toMatchObject({ origem: "ambiente" });
  });

  it("sessão que não está no banco -> ambiente (como sempre foi)", async () => {
    const { fonte } = fonteDe({});
    await expect(resolverEnderecoDoWaha(fonte, "desconhecida", { ambiente: GLOBAL })).resolves.toMatchObject({ origem: "ambiente" });
  });

  it("sem cadastro no canal e sem WAHA global: null (transporte não configurado)", async () => {
    const { fonte } = fonteDe({ org_a: { waha_base_url: null, waha_api_key_encrypted: null } });
    await expect(resolverEnderecoDoWaha(fonte, "org_a", { ambiente: SEM_GLOBAL })).resolves.toBeNull();
  });

  it("o app sobe e funciona SÓ com WAHAs por canal: o global ausente não atrapalha quem tem o seu", async () => {
    const { fonte } = fonteDe({ org_a: { waha_base_url: "http://waha-a:3000", waha_api_key_encrypted: cifra("k") } });
    await expect(resolverEnderecoDoWaha(fonte, "org_a", { ambiente: SEM_GLOBAL })).resolves.toMatchObject({ origem: "canal" });
  });
});

describe("resolverEnderecoDoWaha — cadastro próprio QUEBRADO nunca cai no WAHA global", () => {
  const codigoDoErro = async (linha: LinhaDoWahaDoCanal | Error) => {
    const { fonte } = fonteDe({ org_a: linha });
    try {
      await resolverEnderecoDoWaha(fonte, "org_a", { ambiente: GLOBAL });
    } catch (e) {
      return (e as WahaDoCanalError).code;
    }
    return "NAO_LANCOU";
  };

  it("endereço sem chave", async () => {
    expect(await codigoDoErro({ waha_base_url: "http://waha-a:3000", waha_api_key_encrypted: null })).toBe("canal_sem_chave");
  });

  it("chave sem endereço", async () => {
    expect(await codigoDoErro({ waha_base_url: null, waha_api_key_encrypted: cifra("k") })).toBe("endereco_invalido");
  });

  it("endereço gravado que não passa na validação", async () => {
    expect(await codigoDoErro({ waha_base_url: "ftp://x", waha_api_key_encrypted: cifra("k") })).toBe("endereco_invalido");
  });

  it("chave que não decifra (null) ou cuja decifragem falha", async () => {
    expect(await codigoDoErro({ waha_base_url: "http://waha-a:3000", waha_api_key_encrypted: "ilegivel" })).toBe("chave_ilegivel");
    expect(await codigoDoErro({ waha_base_url: "http://waha-a:3000", waha_api_key_encrypted: "explode" })).toBe("chave_ilegivel");
  });

  it("consulta ao banco que falha: não sabemos se há cadastro, então não adivinhamos o global", async () => {
    expect(await codigoDoErro(new Error("conexão caiu"))).toBe("consulta_falhou");
  });

  it("as mensagens de erro não carregam endereço nem chave", async () => {
    const { fonte } = fonteDe({
      org_a: { waha_base_url: "http://waha-secreto-interno:3000", waha_api_key_encrypted: "explode" },
    });
    try {
      await resolverEnderecoDoWaha(fonte, "org_a", { ambiente: GLOBAL });
      throw new Error("devia ter lançado");
    } catch (e) {
      expect((e as Error).message).not.toContain("waha-secreto-interno");
      expect((e as Error).message).not.toContain("explode");
    }
  });
});

describe("resolverEnderecoDoWaha — cache", () => {
  const linha = { waha_base_url: "http://waha-a:3000", waha_api_key_encrypted: cifra("chave-a") };

  it("a segunda pergunta dentro do prazo não vai ao banco nem decifra de novo", async () => {
    const { fonte, consultas, decifradas } = fonteDe({ org_a: linha });
    const agora = () => 1_000;
    // `ambiente` não pode ser injetado aqui (injetar desliga o cache): o ambiente real basta, a linha tem endereço próprio.
    await resolverEnderecoDoWaha(fonte, "org_a", { agora });
    await resolverEnderecoDoWaha(fonte, "org_a", { agora });
    expect(consultas).toEqual(["org_a"]);
    expect(decifradas).toHaveLength(1);
  });

  it("passado o prazo, pergunta de novo", async () => {
    const { fonte, consultas } = fonteDe({ org_a: linha });
    let t = 0;
    await resolverEnderecoDoWaha(fonte, "org_a", { agora: () => t, ttlMs: 10 });
    t = 11;
    await resolverEnderecoDoWaha(fonte, "org_a", { agora: () => t, ttlMs: 10 });
    expect(consultas).toHaveLength(2);
  });

  it("limparCacheDoWaha(sessão) faz a próxima pergunta ver o cadastro novo", async () => {
    const linhas: Record<string, LinhaDoWahaDoCanal> = { org_a: linha };
    const { fonte } = fonteDe(linhas);
    const antes = await resolverEnderecoDoWaha(fonte, "org_a", { agora: () => 1 });
    expect(antes?.baseUrl).toBe("http://waha-a:3000");
    linhas.org_a = { waha_base_url: "http://waha-novo:3000", waha_api_key_encrypted: cifra("chave-nova") };
    const lembrado = await resolverEnderecoDoWaha(fonte, "org_a", { agora: () => 2 });
    expect(lembrado?.baseUrl).toBe("http://waha-a:3000");
    limparCacheDoWaha("org_a");
    const depois = await resolverEnderecoDoWaha(fonte, "org_a", { agora: () => 3 });
    expect(depois).toMatchObject({ baseUrl: "http://waha-novo:3000", apiKey: "chave-nova" });
  });

  it("erro nunca é lembrado: consertado o cadastro, a próxima pergunta já funciona", async () => {
    const linhas: Record<string, LinhaDoWahaDoCanal> = { org_a: { waha_base_url: "http://waha-a:3000", waha_api_key_encrypted: null } };
    const { fonte } = fonteDe(linhas);
    await expect(resolverEnderecoDoWaha(fonte, "org_a", { agora: () => 1 })).rejects.toBeInstanceOf(WahaDoCanalError);
    linhas.org_a = linha;
    await expect(resolverEnderecoDoWaha(fonte, "org_a", { agora: () => 2 })).resolves.toMatchObject({ origem: "canal" });
  });
});

describe("fontes", () => {
  it("fonteViaSupabase: lê pelo nome da sessão e decifra pela RPC do admin", async () => {
    const maybeSingle = vi.fn(async () => ({ data: { waha_base_url: "http://waha-a:3000", waha_api_key_encrypted: "\\xabcd" }, error: null }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const rpc = vi.fn(async () => ({ data: "chave-em-claro", error: null }));
    const fonte = fonteViaSupabase({ from, rpc } as never);

    await expect(fonte.porSessionRef("org_a")).resolves.toEqual({ waha_base_url: "http://waha-a:3000", waha_api_key_encrypted: "\\xabcd" });
    expect(from).toHaveBeenCalledWith("channel_sessions");
    expect(select).toHaveBeenCalledWith("waha_base_url, waha_api_key_encrypted");
    expect(eq).toHaveBeenCalledWith("waha_session_name", "org_a");

    await expect(fonte.decifrar("\\xabcd")).resolves.toBe("chave-em-claro");
    expect(rpc).toHaveBeenCalledWith("fn_decrypt_oauth", { ciphertext: "\\xabcd" });
  });

  it("fonteViaSupabase: erro da consulta lança (o resolvedor vira consulta_falhou)", async () => {
    const fonte = fonteViaSupabase({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) }),
    } as never);
    await expect(fonte.porSessionRef("org_a")).rejects.toThrow();
  });

  it("fonteViaPg: lê pelo nome da sessão e decifra por fn_decrypt_oauth, aceitando o prefixo \\x", async () => {
    const query = vi.fn(async (texto: string, _params?: unknown[]) => {
      if (texto.includes("fn_decrypt_oauth")) return { rows: [{ chave: "chave-em-claro" }] };
      return { rows: [{ waha_base_url: "http://waha-a:3000", waha_api_key_encrypted: "abcd" }] };
    });
    const fonte = fonteViaPg({ query: query as never });

    await expect(fonte.porSessionRef("org_a")).resolves.toEqual({ waha_base_url: "http://waha-a:3000", waha_api_key_encrypted: "abcd" });
    expect(query.mock.calls[0]![1]).toEqual(["org_a"]);

    await expect(fonte.decifrar("\\xabcd")).resolves.toBe("chave-em-claro");
    expect(query.mock.calls[1]![1]).toEqual(["abcd"]);
    await expect(fonte.decifrar("abcd")).resolves.toBe("chave-em-claro");
    expect(query.mock.calls[2]![1]).toEqual(["abcd"]);
  });

  it("fonteViaPg: sessão inexistente -> null", async () => {
    const fonte = fonteViaPg({ query: (async () => ({ rows: [] })) as never });
    await expect(fonte.porSessionRef("nada")).resolves.toBeNull();
  });
});

describe("registroDoWahaNasConfiguracoes — o cadastro da empresa em organizations.settings.waha", () => {
  it("lê o par endereço + chave cifrada", () => {
    expect(registroDoWahaNasConfiguracoes({ outra: 1, waha: { base_url: "http://waha-a:3000", api_key_encrypted: "\\xaa" } })).toEqual({
      waha_base_url: "http://waha-a:3000",
      waha_api_key_encrypted: "\\xaa",
    });
  });

  it("sem cadastro, com lixo ou vazio: null", () => {
    for (const settings of [null, undefined, "texto", 42, {}, { waha: null }, { waha: "x" }, { waha: {} }, { waha: { base_url: "  ", api_key_encrypted: "" } }]) {
      expect(registroDoWahaNasConfiguracoes(settings)).toBeNull();
    }
  });

  it("cadastro pela metade volta como está (quem decide o que fazer é o resolvedor, que recusa)", () => {
    expect(registroDoWahaNasConfiguracoes({ waha: { base_url: "http://waha-a:3000" } })).toEqual({ waha_base_url: "http://waha-a:3000", waha_api_key_encrypted: null });
    expect(registroDoWahaNasConfiguracoes({ waha: { api_key_encrypted: "\\xaa" } })).toEqual({ waha_base_url: null, waha_api_key_encrypted: "\\xaa" });
  });

  it("ignora campos de outro tipo (número, objeto) em vez de lançar", () => {
    expect(registroDoWahaNasConfiguracoes({ waha: { base_url: 3000, api_key_encrypted: { x: 1 } } })).toBeNull();
  });
});
