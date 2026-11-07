import { describe, expect, it } from "vitest";

import { arquivoExemplo } from "./arquivo-exemplo";
import { estaDesatualizado, idadeEmDias, validarArquivo } from "./schema";

const AGORA = new Date("2026-11-08T12:00:00-03:00");

function aparelhos(arq: Record<string, unknown>): Array<Record<string, unknown>> {
  return arq.aparelhos as Array<Record<string, unknown>>;
}

describe("validarArquivo", () => {
  it("T-VAL-00 aceita o formato real (4 aparelhos copiados do arquivo publicado)", () => {
    const r = validarArquivo(arquivoExemplo(), AGORA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.arquivo.aparelhos).toHaveLength(4);
      expect(r.geradoEm.toISOString()).toBe("2026-11-07T22:25:17.000Z");
    }
  });

  it("T-VAL-01 JSON inválido: texto que não é objeto vira schema_invalido", () => {
    for (const lixo of [null, "texto", 42, [], undefined]) {
      expect(validarArquivo(lixo, AGORA)).toEqual({ ok: false, detalhe: "schema_invalido" });
    }
  });

  it("T-VAL-02 schema inválido: falta preco.avista", () => {
    const arq = arquivoExemplo();
    const v = (aparelhos(arq)[0]!.variantes as Array<Record<string, unknown>>)[0]!;
    delete (v.preco as Record<string, unknown>).avista;
    expect(validarArquivo(arq, AGORA)).toEqual({ ok: false, detalhe: "schema_invalido" });
  });

  it("T-VAL-02b schema inválido: preço que não é texto, oferta que não é booleano", () => {
    const a = arquivoExemplo();
    const v = (aparelhos(a)[0]!.variantes as Array<Record<string, unknown>>)[0]!;
    (v.preco as Record<string, unknown>).avista = 1429;
    expect(validarArquivo(a, AGORA)).toEqual({ ok: false, detalhe: "schema_invalido" });

    const b = arquivoExemplo();
    aparelhos(b)[0]!.oferta = "sim";
    expect(validarArquivo(b, AGORA)).toEqual({ ok: false, detalhe: "schema_invalido" });
  });

  it("T-VAL-03 contagem não confere: totalAparelhos ou totalVariantes diferentes do conteúdo", () => {
    const a = arquivoExemplo();
    a.totalAparelhos = 5;
    expect(validarArquivo(a, AGORA)).toEqual({ ok: false, detalhe: "contagem_nao_confere" });

    const b = arquivoExemplo();
    b.totalVariantes = 99;
    expect(validarArquivo(b, AGORA)).toEqual({ ok: false, detalhe: "contagem_nao_confere" });
  });

  it("T-VAL-04 data inválida e data no futuro (mais de 24 h) viram data_invalida", () => {
    const a = arquivoExemplo();
    a.geradoEm = "ontem";
    expect(validarArquivo(a, AGORA)).toEqual({ ok: false, detalhe: "data_invalida" });

    const semFuso = arquivoExemplo();
    semFuso.geradoEm = "2026-11-07T19:25:17";
    expect(validarArquivo(semFuso, AGORA)).toEqual({ ok: false, detalhe: "data_invalida" });

    const futuro = arquivoExemplo();
    futuro.geradoEm = "2026-11-10T12:00:00-03:00";
    expect(validarArquivo(futuro, AGORA)).toEqual({ ok: false, detalhe: "data_invalida" });

    const quaseAgora = arquivoExemplo();
    quaseAgora.geradoEm = "2026-11-08T20:00:00-03:00"; // 8 h à frente: relógio torto, tolerado
    expect(validarArquivo(quaseAgora, AGORA).ok).toBe(true);
  });

  it("T-VAL-06 campo desconhecido é preservado (o arquivo pode ganhar campo sem derrubar a leitura)", () => {
    const arq = arquivoExemplo();
    aparelhos(arq)[0]!.campoNovo = { x: 1 };
    const r = validarArquivo(arq, AGORA);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.arquivo.aparelhos[0] as Record<string, unknown>).campoNovo).toEqual({ x: 1 });
  });

  it("aceita os nulos reais do arquivo (rede, nfc, processador, ram, bateria, observacao)", () => {
    const arq = arquivoExemplo();
    const iphone = aparelhos(arq).find((a) => a.id === "iphone-16-lacrado")!;
    const v = (iphone.variantes as Array<Record<string, unknown>>)[0]!;
    expect(v.rede).toBeNull();
    expect(v.nfc).toBeNull();
    expect(validarArquivo(arq, AGORA).ok).toBe(true);
  });

  it("preço é texto e nunca é interpretado: formato fora do padrão passa idêntico", () => {
    const arq = arquivoExemplo();
    const v = (aparelhos(arq)[0]!.variantes as Array<Record<string, unknown>>)[0]!;
    (v.preco as Record<string, unknown>).avista = "Sob consulta";
    const r = validarArquivo(arq, AGORA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.arquivo.aparelhos[0]!.variantes[0]!.preco.avista).toBe("Sob consulta");
  });

  it("recusa excesso: 501 aparelhos ou observação gigante", () => {
    const muitos = arquivoExemplo();
    const base = aparelhos(muitos)[0]!;
    muitos.aparelhos = Array.from({ length: 501 }, (_, i) => ({ ...base, id: `x-${i}` }));
    muitos.totalAparelhos = 501;
    muitos.totalVariantes = 501 * (base.variantes as unknown[]).length;
    expect(validarArquivo(muitos, AGORA)).toEqual({ ok: false, detalhe: "schema_invalido" });

    const obs = arquivoExemplo();
    const v = (aparelhos(obs)[0]!.variantes as Array<Record<string, unknown>>)[0]!;
    v.observacao = "x".repeat(501);
    expect(validarArquivo(obs, AGORA)).toEqual({ ok: false, detalhe: "schema_invalido" });
  });
});

describe("desatualizado (30 dias)", () => {
  const gerado = new Date("2026-10-01T00:00:00-03:00");

  it("T-VAL-05 29 dias passa, 31 dias é desatualizado, exatamente 30 dias ainda passa", () => {
    expect(estaDesatualizado(gerado, new Date(gerado.getTime() + 29 * 86_400_000))).toBe(false);
    expect(estaDesatualizado(gerado, new Date(gerado.getTime() + 30 * 86_400_000))).toBe(false);
    expect(estaDesatualizado(gerado, new Date(gerado.getTime() + 30 * 86_400_000 + 1))).toBe(true);
    expect(estaDesatualizado(gerado, new Date(gerado.getTime() + 31 * 86_400_000))).toBe(true);
  });

  it("idadeEmDias arredonda para baixo e nunca é negativa", () => {
    expect(idadeEmDias(gerado, new Date(gerado.getTime() + 31.9 * 86_400_000))).toBe(31);
    expect(idadeEmDias(gerado, new Date(gerado.getTime() - 5 * 86_400_000))).toBe(0);
  });
});
