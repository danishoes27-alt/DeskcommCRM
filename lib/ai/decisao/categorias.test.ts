import { describe, expect, it } from "vitest";

import { CATEGORIAS_PADRAO, categoriasDaEmpresa, criteriosDaCategoria } from "./categorias";
import { lerConfigDoJev } from "./config";

const ler = (categorias: unknown) => lerConfigDoJev({ jev: { ligado: false, categorias } });

describe("categorias da triagem", () => {
  it("o padrão: Conserto, Venda, Impressão, Outro — outro por último", () => {
    expect(CATEGORIAS_PADRAO.map((c) => c.rotulo)).toEqual(["Conserto", "Venda", "Impressão", "Outro"]);
    expect(CATEGORIAS_PADRAO.at(-1)!.id).toBe("outro");
  });

  it("boleto e parcelamento estão dentro de Venda; financeiro deixou de ser categoria", () => {
    expect(CATEGORIAS_PADRAO.find((c) => c.id === "venda")!.descricao).toMatch(/boleto/i);
    expect(CATEGORIAS_PADRAO.find((c) => c.id === "venda")!.descricao).toMatch(/parcelamento/i);
    expect(CATEGORIAS_PADRAO.map((c) => c.id)).not.toContain("financeiro");
  });

  it("empresa sem configuração usa o padrão", () => {
    expect(categoriasDaEmpresa(lerConfigDoJev({}))).toEqual(CATEGORIAS_PADRAO);
    expect(categoriasDaEmpresa(lerConfigDoJev(null))).toEqual(CATEGORIAS_PADRAO);
  });

  it("lista ilegível ou curta demais vale o padrão — sem derrubar o resto da configuração", () => {
    for (const ruim of ["x", [{ id: "A B" }], [{ id: "a", rotulo: "A", descricao: "d" }]]) {
      const c = ler(ruim);
      expect(categoriasDaEmpresa(c)).toEqual(CATEGORIAS_PADRAO);
      expect(c.ligado).toBe(false);
    }
  });

  it("lista própria: a ordem gravada vale e `outro` é SEMPRE o último", () => {
    const c = ler([
      { id: "outro", rotulo: "Outro", descricao: "nada acima" },
      { id: "troca", rotulo: "Troca de tela", descricao: "trocar tela" },
      { id: "bateria", rotulo: "Bateria", descricao: "trocar bateria" },
    ]);
    expect(categoriasDaEmpresa(c).map((x) => x.id)).toEqual(["troca", "bateria", "outro"]);
  });

  it("sem `outro` na lista, ele é acrescentado no fim; id repetido é descartado", () => {
    const c = ler([
      { id: "troca", rotulo: "Troca", descricao: "a" },
      { id: "troca", rotulo: "Outra troca", descricao: "b" },
      { id: "bateria", rotulo: "Bateria", descricao: "c" },
    ]);
    expect(categoriasDaEmpresa(c).map((x) => x.id)).toEqual(["troca", "bateria", "outro"]);
  });

  it("os critérios saem na ordem da lista, id → descrição", () => {
    const criterios = criteriosDaCategoria(CATEGORIAS_PADRAO);
    expect(Object.keys(criterios)).toEqual(["conserto", "venda", "impressao", "outro"]);
  });

  it("a lista de uma empresa não aparece na leitura de outra", () => {
    const a = ler([
      { id: "troca", rotulo: "Troca", descricao: "a" },
      { id: "bateria", rotulo: "Bateria", descricao: "c" },
    ]);
    const b = lerConfigDoJev({ jev: { ligado: false } });
    expect(categoriasDaEmpresa(a).map((x) => x.id)).toContain("troca");
    expect(categoriasDaEmpresa(b).map((x) => x.id)).not.toContain("troca");
  });
});
