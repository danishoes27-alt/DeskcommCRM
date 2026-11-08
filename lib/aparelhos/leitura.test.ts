import { beforeEach, describe, expect, it, vi } from "vitest";

const ordem: string[] = [];

vi.mock("@/lib/automation/outbound-url", () => ({
  assertSafeOutboundUrl: vi.fn(() => {
    ordem.push("textual");
  }),
}));
vi.mock("@/lib/automation/outbound-ip", () => ({
  assertDestinoResolvidoSeguro: vi.fn(async () => {
    ordem.push("dns");
  }),
}));

import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";

import { ARQUIVO_EXEMPLO } from "./arquivo-exemplo";
import { TETO_DO_ARQUIVO_BYTES, TIMEOUT_MS, lerArquivoDeAparelhos } from "./leitura";

const HOSTS = ["catalogo.example.com"];
const URL_OK = "https://catalogo.example.com/aparelhos.json";
const AGORA = new Date("2026-11-08T12:00:00-03:00");
const JSON_OK = JSON.stringify(ARQUIVO_EXEMPLO);

function resposta(corpo: string | null, init: { status?: number; tipo?: string | null; extra?: Record<string, string> } = {}): Response {
  const headers: Record<string, string> = { ...(init.extra ?? {}) };
  if (init.tipo !== null) headers["content-type"] = init.tipo ?? "application/json";
  return new Response(corpo, { status: init.status ?? 200, headers });
}

function fetchQue(...respostas: Array<Response | Error>) {
  const fila = [...respostas];
  return vi.fn(async (_url: unknown, _init?: unknown) => {
    const r = fila.shift();
    if (r === undefined) throw new Error("sem resposta simulada");
    if (r instanceof Error) throw r;
    return r;
  });
}

const deps = (f: ReturnType<typeof fetchQue>, extra: { timeoutMs?: number } = {}) => ({
  fetchImpl: f as unknown as typeof fetch,
  agora: () => AGORA,
  ...extra,
});

beforeEach(() => {
  ordem.length = 0;
  vi.mocked(assertSafeOutboundUrl).mockClear();
  vi.mocked(assertDestinoResolvidoSeguro).mockClear();
  vi.mocked(assertSafeOutboundUrl).mockImplementation(() => {
    ordem.push("textual");
  });
  vi.mocked(assertDestinoResolvidoSeguro).mockImplementation(async () => {
    ordem.push("dns");
  });
});

describe("leitura segura do arquivo", () => {
  it("lê o arquivo, valida e devolve o objeto com o geradoEm", async () => {
    const f = fetchQue(resposta(JSON_OK));
    const r = await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.arquivo.aparelhos).toHaveLength(4);
      expect(r.geradoEm.toISOString()).toBe("2026-11-07T22:25:17.000Z");
    }
  });

  it("só faz GET, com Accept, redirect manual e sinal de tempo; sem cookie nem Authorization", async () => {
    const f = fetchQue(resposta(JSON_OK));
    await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f));
    const [url, init] = f.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(URL_OK);
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const cab = new Headers(init.headers);
    expect(cab.get("accept")).toBe("application/json");
    expect(cab.get("authorization")).toBeNull();
    expect(cab.get("cookie")).toBeNull();
    expect(init.body).toBeUndefined();
  });

  it("T-SEG-01 host fora da allowlist: nenhuma rede, detalhe url_nao_permitida", async () => {
    const f = fetchQue(resposta(JSON_OK));
    const r = await lerArquivoDeAparelhos("https://evil.example/aparelhos.json", HOSTS, deps(f));
    expect(r).toEqual({ ok: false, erro: "falha_na_leitura", detalhe: "url_nao_permitida" });
    expect(f).not.toHaveBeenCalled();
    expect(assertDestinoResolvidoSeguro).not.toHaveBeenCalled();
  });

  it("T-HOST-04 lista de hosts vazia ou sem o host da URL: recusa sem rede", async () => {
    const f = fetchQue(resposta(JSON_OK));
    for (const hosts of [[], ["outro.example.com"], ["example.com"], ["catalogo.example.com.evil.io"]]) {
      const r = await lerArquivoDeAparelhos(URL_OK, hosts, deps(f));
      expect(r, hosts.join(",")).toEqual({ ok: false, erro: "falha_na_leitura", detalhe: "url_nao_permitida" });
    }
    expect(f).not.toHaveBeenCalled();
    expect(assertDestinoResolvidoSeguro).not.toHaveBeenCalled();
  });

  it("T-SEG-03 http recusado antes de qualquer rede", async () => {
    const f = fetchQue(resposta(JSON_OK));
    const r = await lerArquivoDeAparelhos("http://catalogo.example.com/aparelhos.json", HOSTS, deps(f));
    expect(r).toEqual({ ok: false, erro: "falha_na_leitura", detalhe: "url_nao_permitida" });
    expect(f).not.toHaveBeenCalled();
  });

  it("T-SEG-08 as duas guardas rodam, nesta ordem, ANTES do fetch", async () => {
    const f = vi.fn(async () => {
      ordem.push("fetch");
      return resposta(JSON_OK);
    });
    await lerArquivoDeAparelhos(URL_OK, HOSTS, { fetchImpl: f as unknown as typeof fetch, agora: () => AGORA });
    expect(ordem).toEqual(["textual", "dns", "fetch"]);
    expect(assertSafeOutboundUrl).toHaveBeenCalledWith(URL_OK);
    expect(assertDestinoResolvidoSeguro).toHaveBeenCalledWith("catalogo.example.com");
  });

  it("T-SEG-07 DNS que aponta para IP privado: destino_bloqueado e nenhum fetch", async () => {
    vi.mocked(assertDestinoResolvidoSeguro).mockRejectedValue(new Error("unsafe_url:private_ip"));
    const f = fetchQue(resposta(JSON_OK));
    const r = await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f));
    expect(r).toEqual({ ok: false, erro: "falha_na_leitura", detalhe: "destino_bloqueado" });
    expect(f).not.toHaveBeenCalled();
  });

  it("DNS que não resolve: detalhe dns, nenhum fetch", async () => {
    vi.mocked(assertDestinoResolvidoSeguro).mockRejectedValue(new Error("unsafe_url:dns_failed"));
    const f = fetchQue(resposta(JSON_OK));
    const r = await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f));
    expect(r).toEqual({ ok: false, erro: "falha_na_leitura", detalhe: "dns" });
    expect(f).not.toHaveBeenCalled();
  });

  it("guarda textual que recusa: destino_bloqueado", async () => {
    vi.mocked(assertSafeOutboundUrl).mockImplementation(() => {
      throw new Error("unsafe_url:private_host");
    });
    const f = fetchQue(resposta(JSON_OK));
    const r = await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f));
    expect(r).toEqual({ ok: false, erro: "falha_na_leitura", detalhe: "destino_bloqueado" });
  });

  it("T-SEG-06 redirect é erro: 301/302/307/308, um único fetch, o Location não é seguido", async () => {
    for (const status of [301, 302, 307, 308]) {
      const f = fetchQue(resposta(null, { status, tipo: null, extra: { location: "http://169.254.169.254/" } }));
      const r = await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f));
      expect(r, String(status)).toEqual({ ok: false, erro: "falha_na_leitura", detalhe: "redirect" });
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("T-SEG-13 404 não tem nova tentativa; 500 tem uma", async () => {
    const f404 = fetchQue(resposta("x", { status: 404 }));
    expect(await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f404))).toEqual({
      ok: false,
      erro: "falha_na_leitura",
      detalhe: "http_404",
    });
    expect(f404).toHaveBeenCalledTimes(1);

    const f500 = fetchQue(resposta("x", { status: 500 }), resposta("x", { status: 500 }));
    expect(await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f500))).toEqual({
      ok: false,
      erro: "falha_na_leitura",
      detalhe: "http_500",
    });
    expect(f500).toHaveBeenCalledTimes(2);
  });

  it("a segunda tentativa salva um 503 passageiro e uma falha de rede passageira", async () => {
    const f1 = fetchQue(resposta("x", { status: 503 }), resposta(JSON_OK));
    expect((await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f1))).ok).toBe(true);
    expect(f1).toHaveBeenCalledTimes(2);

    const erroDeRede = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    const f2 = fetchQue(erroDeRede, resposta(JSON_OK));
    expect((await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f2))).ok).toBe(true);
  });

  it("falha de rede nas duas tentativas: detalhe classificado (dns / rede)", async () => {
    const semDns = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    const f = fetchQue(semDns, semDns);
    expect(await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f))).toEqual({
      ok: false,
      erro: "falha_na_leitura",
      detalhe: "dns",
    });

    const reset = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const g = fetchQue(reset, reset);
    expect(await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(g))).toEqual({
      ok: false,
      erro: "falha_na_leitura",
      detalhe: "rede",
    });
  });

  it("T-SEG-09 timeout: o limite é 5 s, e fetch que nunca responde vira detalhe timeout (2 tentativas)", async () => {
    expect(TIMEOUT_MS).toBe(5000);
    const f = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
        }),
    );
    const r = await lerArquivoDeAparelhos(URL_OK, HOSTS, { fetchImpl: f as unknown as typeof fetch, agora: () => AGORA, timeoutMs: 20 });
    expect(r).toEqual({ ok: false, erro: "falha_na_leitura", detalhe: "timeout" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("T-SEG-10 Content-Length acima do teto: recusa sem ler o corpo", async () => {
    let lido = false;
    // highWaterMark 0: o stream só puxa dado quando alguém LÊ (o padrão puxaria ao nascer)
    const corpo = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          lido = true;
          c.close();
        },
      },
      { highWaterMark: 0 },
    );
    const f = fetchQue(
      new Response(corpo, {
        status: 200,
        headers: { "content-type": "application/json", "content-length": String(TETO_DO_ARQUIVO_BYTES + 1) },
      }),
    );
    const r = await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f));
    expect(r).toEqual({ ok: false, erro: "arquivo_invalido", detalhe: "arquivo_grande" });
    expect(lido).toBe(false);
  });

  it("T-SEG-11 sem Content-Length, o stream que passa do teto é abortado", async () => {
    let cancelado = false;
    let enviados = 0;
    const pedaco = new Uint8Array(64 * 1024).fill(32);
    const corpo = new ReadableStream<Uint8Array>({
      pull(c) {
        enviados++;
        if (enviados > 100) return c.close();
        c.enqueue(pedaco);
      },
      cancel() {
        cancelado = true;
      },
    });
    const f = fetchQue(new Response(corpo, { status: 200, headers: { "content-type": "application/json" } }));
    const r = await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f));
    expect(r).toEqual({ ok: false, erro: "arquivo_invalido", detalhe: "arquivo_grande" });
    expect(cancelado).toBe(true);
    expect(enviados).toBeLessThan(20); // 512 KB / 64 KB = 8 pedaços; para logo depois
  });

  it("T-SEG-12 tipo de conteúdo: html e ausente são recusados; json com charset passa", async () => {
    expect(await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(fetchQue(resposta(JSON_OK, { tipo: "text/html" }))))).toEqual({
      ok: false,
      erro: "arquivo_invalido",
      detalhe: "tipo_de_conteudo",
    });
    expect(await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(fetchQue(resposta(JSON_OK, { tipo: null }))))).toEqual({
      ok: false,
      erro: "arquivo_invalido",
      detalhe: "tipo_de_conteudo",
    });
    expect((await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(fetchQue(resposta(JSON_OK, { tipo: "application/json; charset=utf-8" }))))).ok).toBe(true);
  });

  it("T-VAL-01 JSON inválido; T-VAL-02 schema inválido; T-VAL-03 contagem; T-VAL-04 data", async () => {
    expect(await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(fetchQue(resposta("{nao e json"))))).toEqual({
      ok: false,
      erro: "arquivo_invalido",
      detalhe: "json_invalido",
    });
    expect(await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(fetchQue(resposta('{"aparelhos": 1}'))))).toEqual({
      ok: false,
      erro: "arquivo_invalido",
      detalhe: "schema_invalido",
    });
    const contagem = JSON.stringify({ ...ARQUIVO_EXEMPLO, totalAparelhos: 9 });
    expect(await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(fetchQue(resposta(contagem))))).toEqual({
      ok: false,
      erro: "arquivo_invalido",
      detalhe: "contagem_nao_confere",
    });
    const data = JSON.stringify({ ...ARQUIVO_EXEMPLO, geradoEm: "ontem" });
    expect(await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(fetchQue(resposta(data))))).toEqual({
      ok: false,
      erro: "arquivo_invalido",
      detalhe: "data_invalida",
    });
  });

  it("T-RET-08 nenhum resultado de erro carrega a URL", async () => {
    const f = fetchQue(resposta("x", { status: 404 }));
    const r = await lerArquivoDeAparelhos(URL_OK, HOSTS, deps(f));
    expect(JSON.stringify(r)).not.toContain("example.com");
    expect(JSON.stringify(r)).not.toContain("https");
  });

  it("o teto é 512 KB", () => {
    expect(TETO_DO_ARQUIVO_BYTES).toBe(512 * 1024);
  });
});
