import { describe, expect, it, vi } from "vitest";

import { criarCacheDeAparelhos, type ResultadoDaLeitura } from "./cache";

const OK = (n: number): ResultadoDaLeitura =>
  ({ ok: true, arquivo: { geradoEm: `v${n}` }, geradoEm: new Date("2026-11-07T22:25:17Z") }) as unknown as ResultadoDaLeitura;
const FALHA: ResultadoDaLeitura = { ok: false, erro: "falha_na_leitura", detalhe: "timeout" };

function relogio(inicio = 1_000_000) {
  let t = inicio;
  return { agora: () => t, avancar: (ms: number) => (t += ms) };
}

const MIN = 60_000;

describe("cache de 5 minutos", () => {
  it("T-CAC-01 miss lê o arquivo; T-CAC-02 hit dentro de 5 min não lê de novo", async () => {
    const r = relogio();
    const cache = criarCacheDeAparelhos({ agora: r.agora });
    const carregar = vi.fn(async () => OK(1));
    expect(await cache.obter("org-a|u", carregar)).toEqual(OK(1));
    r.avancar(4 * MIN + 59_000);
    expect(await cache.obter("org-a|u", carregar)).toEqual(OK(1));
    expect(carregar).toHaveBeenCalledTimes(1);
  });

  it("T-CAC-03 aos 5 min o cache expira e lê de novo", async () => {
    const r = relogio();
    const cache = criarCacheDeAparelhos({ agora: r.agora });
    const carregar = vi.fn().mockResolvedValueOnce(OK(1)).mockResolvedValueOnce(OK(2));
    await cache.obter("k", carregar);
    r.avancar(5 * MIN + 1000);
    expect(await cache.obter("k", carregar)).toEqual(OK(2));
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("T-CAC-04 cache vencido + releitura que falha: devolve a FALHA, nunca o valor vencido", async () => {
    const r = relogio();
    const cache = criarCacheDeAparelhos({ agora: r.agora });
    const carregar = vi.fn().mockResolvedValueOnce(OK(1)).mockResolvedValueOnce(FALHA);
    await cache.obter("k", carregar);
    r.avancar(5 * MIN + 1000);
    const segundo = await cache.obter("k", carregar);
    expect(segundo).toEqual(FALHA);
    expect(JSON.stringify(segundo)).not.toContain("v1");
  });

  it("T-CAC-05 a falha é lembrada por 30 s (sem novo fetch) e depois lê de novo", async () => {
    const r = relogio();
    const cache = criarCacheDeAparelhos({ agora: r.agora });
    const carregar = vi.fn().mockResolvedValueOnce(FALHA).mockResolvedValueOnce(OK(2));
    expect(await cache.obter("k", carregar)).toEqual(FALHA);
    r.avancar(29_000);
    expect(await cache.obter("k", carregar)).toEqual(FALHA);
    expect(carregar).toHaveBeenCalledTimes(1);
    r.avancar(2_000);
    expect(await cache.obter("k", carregar)).toEqual(OK(2));
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("depois de uma falha, o cache anterior vencido NÃO volta (a entrada boa foi descartada)", async () => {
    const r = relogio();
    const cache = criarCacheDeAparelhos({ agora: r.agora });
    const carregar = vi
      .fn()
      .mockResolvedValueOnce(OK(1))
      .mockResolvedValueOnce(FALHA)
      .mockResolvedValueOnce(FALHA);
    await cache.obter("k", carregar);
    r.avancar(6 * MIN);
    await cache.obter("k", carregar); // falha
    r.avancar(40_000);
    expect(await cache.obter("k", carregar)).toEqual(FALHA); // nova leitura, ainda falha: nada de v1
  });

  it("T-CAC-06 single-flight: 20 pedidos simultâneos com cache vazio fazem 1 leitura", async () => {
    const cache = criarCacheDeAparelhos({ agora: relogio().agora });
    let solta: (v: ResultadoDaLeitura) => void = () => {};
    const carregar = vi.fn(() => new Promise<ResultadoDaLeitura>((res) => (solta = res)));
    const todos = Array.from({ length: 20 }, () => cache.obter("k", carregar));
    solta(OK(1));
    const resultados = await Promise.all(todos);
    expect(carregar).toHaveBeenCalledTimes(1);
    expect(resultados.every((x) => JSON.stringify(x) === JSON.stringify(OK(1)))).toBe(true);
  });

  it("T-CAC-07 chaves diferentes (organização) não compartilham entrada", async () => {
    const cache = criarCacheDeAparelhos({ agora: relogio().agora });
    const carregar = vi.fn().mockResolvedValueOnce(OK(1)).mockResolvedValueOnce(OK(2));
    expect(await cache.obter("org-a|https://x/a.json", carregar)).toEqual(OK(1));
    expect(await cache.obter("org-b|https://x/a.json", carregar)).toEqual(OK(2));
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("T-CAC-08 teto de 50 entradas: a mais antiga sai", async () => {
    const cache = criarCacheDeAparelhos({ agora: relogio().agora, maxEntradas: 50 });
    const carregar = vi.fn(async () => OK(1));
    for (let i = 0; i < 51; i++) await cache.obter(`k${i}`, carregar);
    expect(cache.tamanho()).toBe(50);
    carregar.mockClear();
    await cache.obter("k0", carregar); // foi descartada: lê de novo
    expect(carregar).toHaveBeenCalledTimes(1);
  });

  it("um carregador que lança vira falha cacheada, não derruba quem chamou", async () => {
    const cache = criarCacheDeAparelhos({ agora: relogio().agora });
    const r = await cache.obter("k", async () => {
      throw new Error("boom");
    });
    expect(r).toEqual({ ok: false, erro: "falha_na_leitura", detalhe: "rede" });
  });
});
