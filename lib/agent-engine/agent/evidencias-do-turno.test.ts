import { describe, expect, it } from "vitest";

import { criarEvidenciasDoTurno, EVIDENCIAS_NO_MAXIMO } from "./evidencias-do-turno";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("evidências do turno", () => {
  it("nasce vazia, sem consulta nenhuma", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    expect(e.vazia()).toBe(true);
    expect(e.todas()).toEqual([]);
    expect(e.consultou("base_de_conhecimento")).toBe(false);
  });

  it("guarda os trechos da base com a origem e a fonte", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    const n = e.registrar(
      "base_de_conhecimento",
      [
        { fonte: "Tabela de preços", texto: "Troca de tela: R$ 250" },
        { fonte: null, texto: "Garantia de 90 dias" },
      ],
      ORG_A,
    );
    expect(n).toBe(2);
    expect(e.todas()).toEqual([
      { origem: "base_de_conhecimento", fonte: "Tabela de preços", texto: "Troca de tela: R$ 250" },
      { origem: "base_de_conhecimento", fonte: null, texto: "Garantia de 90 dias" },
    ]);
    expect(e.consultou("base_de_conhecimento")).toBe(true);
    expect(e.consultou("catalogo")).toBe(false);
  });

  it("consulta sem resultado conta como feita, mas não vira evidência (nem procurou ≠ não achou)", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    expect(e.registrar("bling", [], ORG_A)).toBe(0);
    expect(e.consultou("bling")).toBe(true);
    expect(e.vazia()).toBe(true);
    expect(e.marcarConsulta("catalogo", ORG_A)).toBe(true);
    expect(e.consultou("catalogo")).toBe(true);
  });

  it("a mesma consulta repetida no turno não infla a lista", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    const item = { fonte: "FAQ", texto: "Aceitamos Pix" };
    expect(e.registrar("base_de_conhecimento", [item], ORG_A)).toBe(1);
    expect(e.registrar("base_de_conhecimento", [item], ORG_A)).toBe(0);
    expect(e.todas()).toHaveLength(1);
    // Outra origem com o mesmo texto é outra evidência.
    expect(e.registrar("catalogo", [item], ORG_A)).toBe(1);
  });

  it("ignora trecho em branco e apara os espaços", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    e.registrar("base_de_conhecimento", [{ texto: "   " }, { texto: "  R$ 10  ", fonte: "  x  " }], ORG_A);
    expect(e.todas()).toEqual([{ origem: "base_de_conhecimento", fonte: "x", texto: "R$ 10" }]);
  });

  it("ISOLAMENTO: registro em nome de OUTRA empresa é descartado e a consulta não conta", () => {
    const turnoDaA = criarEvidenciasDoTurno(ORG_A);
    expect(turnoDaA.registrar("base_de_conhecimento", [{ texto: "Segredo da B: R$ 1" }], ORG_B)).toBe(0);
    expect(turnoDaA.marcarConsulta("bling", ORG_B)).toBe(false);
    expect(turnoDaA.vazia()).toBe(true);
    expect(turnoDaA.consultou("base_de_conhecimento")).toBe(false);
    expect(turnoDaA.consultou("bling")).toBe(false);
  });

  it("ISOLAMENTO: dois turnos no mesmo processo (empresas A e B) não misturam evidências", () => {
    const turnoDaA = criarEvidenciasDoTurno(ORG_A);
    const turnoDaB = criarEvidenciasDoTurno(ORG_B);
    turnoDaA.registrar("base_de_conhecimento", [{ texto: "A: troca de tela R$ 250" }], ORG_A);
    turnoDaB.registrar("base_de_conhecimento", [{ texto: "B: troca de tela R$ 999" }], ORG_B);
    expect(turnoDaA.todas().map((x) => x.texto)).toEqual(["A: troca de tela R$ 250"]);
    expect(turnoDaB.todas().map((x) => x.texto)).toEqual(["B: troca de tela R$ 999"]);
    expect(turnoDaA.organizationId).toBe(ORG_A);
    expect(turnoDaB.organizationId).toBe(ORG_B);
  });

  it("cada leitura devolve uma cópia: quem lê não mexe na lista do turno", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    e.registrar("catalogo", [{ texto: "Capinha R$ 30" }], ORG_A);
    (e.todas() as unknown[]).length = 0;
    expect(e.todas()).toHaveLength(1);
  });

  it("tem teto de memória", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    const muitas = Array.from({ length: EVIDENCIAS_NO_MAXIMO + 50 }, (_, i) => ({ texto: `item ${i}` }));
    expect(e.registrar("base_de_conhecimento", muitas, ORG_A)).toBe(EVIDENCIAS_NO_MAXIMO);
    expect(e.todas()).toHaveLength(EVIDENCIAS_NO_MAXIMO);
  });

  it("daOrigem separa por ferramenta", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    e.registrar("base_de_conhecimento", [{ texto: "a" }], ORG_A);
    e.registrar("bling", [{ texto: "b" }], ORG_A);
    expect(e.daOrigem("bling").map((x) => x.texto)).toEqual(["b"]);
    expect(e.daOrigem("catalogo")).toEqual([]);
  });
});
