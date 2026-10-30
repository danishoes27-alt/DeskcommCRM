import { afterEach, describe, expect, it, vi } from "vitest";

import { buscarQrDoWaha, cabecalhosDoQr } from "./waha-qr";

const ENTRADA = { baseUrl: "http://waha-acme:3000", apiKey: "chave-da-acme", sessionName: "org_acme" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);

afterEach(() => vi.restoreAllMocks());

const responde = (corpo: BodyInit | null, init: ResponseInit = { status: 200 }) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(corpo, init));

describe("buscarQrDoWaha", () => {
  it("devolve a imagem PNG e chama o WAHA da empresa com a chave, sem seguir redirecionamento e com prazo", async () => {
    const chamada = responde(PNG, { status: 200, headers: { "content-type": "text/html" } });

    const r = await buscarQrDoWaha(ENTRADA);

    expect(r).toMatchObject({ ok: true, tipo: "image/png" });
    const [url, opcoes] = chamada.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://waha-acme:3000/api/org_acme/auth/qr?format=image");
    expect(opcoes.headers).toEqual({ "X-Api-Key": "chave-da-acme" });
    expect(opcoes.redirect).toBe("error");
    expect(opcoes.signal).toBeInstanceOf(AbortSignal);
  });

  it("reconhece JPEG também", async () => {
    responde(JPEG);
    expect(await buscarQrDoWaha(ENTRADA)).toMatchObject({ ok: true, tipo: "image/jpeg" });
  });

  it("⭐ o tipo vem da IMAGEM reconhecida, nunca do cabeçalho do servidor (corpo HTML não passa)", async () => {
    responde("<html><script>alert(1)</script></html>", { status: 200, headers: { "content-type": "image/png" } });
    expect(await buscarQrDoWaha(ENTRADA)).toEqual({ ok: false, status: 502 });
  });

  it("corpo vazio ou grande demais não é QR", async () => {
    responde(new Uint8Array(0));
    expect(await buscarQrDoWaha(ENTRADA)).toEqual({ ok: false, status: 502 });
    const grande = new Uint8Array(600 * 1024);
    grande.set(PNG);
    vi.restoreAllMocks();
    responde(grande);
    expect(await buscarQrDoWaha(ENTRADA)).toEqual({ ok: false, status: 502 });
  });

  it("o status do WAHA (ex.: 404 quando o QR ainda não ficou pronto) passa adiante", async () => {
    responde(null, { status: 404 });
    expect(await buscarQrDoWaha(ENTRADA)).toEqual({ ok: false, status: 404 });
  });

  it("⭐ redirecionamento, recusa de conexão ou prazo estourado viram 502 — sem lançar", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    expect(await buscarQrDoWaha(ENTRADA)).toEqual({ ok: false, status: 502 });
  });
});

describe("cabecalhosDoQr", () => {
  it("tipo fixo, sem cache e sem interpretação como página", () => {
    expect(cabecalhosDoQr("image/png")).toEqual({
      "content-type": "image/png",
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    });
  });
});
