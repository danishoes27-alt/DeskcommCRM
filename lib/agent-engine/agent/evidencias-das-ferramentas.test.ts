import { describe, expect, it } from "vitest";

import { criarEvidenciasDoTurno } from "./evidencias-do-turno";
import {
  comEvidenciaDoTurno,
  ORIGEM_DA_FERRAMENTA,
  registrarEvidenciaDaFerramenta,
  TEXTO_DA_EVIDENCIA_NO_MAXIMO,
} from "./evidencias-das-ferramentas";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const BUSCA_DE_PRODUTOS = {
  produtos: [
    { codigo: "CAP-01", nome: "Capinha iPhone 13", preco: "R$ 39,90", preco_cents: 3990, marca: "Acme", disponivel: true },
    { codigo: "PEL-02", nome: "Película 3D", preco: "R$ 19,90", preco_cents: 1990, disponivel: false },
  ],
  empate: false,
};

describe("evidências das ferramentas: catálogo", () => {
  it("cada produto vira uma evidência com nome, código, preço exato e disponibilidade", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    expect(registrarEvidenciaDaFerramenta(e, "crm_search_products", BUSCA_DE_PRODUTOS, ORG_A)).toBe(true);
    expect(e.daOrigem("catalogo")).toEqual([
      { origem: "catalogo", fonte: "Capinha iPhone 13", texto: "Capinha iPhone 13 — código CAP-01 — preço R$ 39,90 — marca Acme — disponível" },
      { origem: "catalogo", fonte: "Película 3D", texto: "Película 3D — código PEL-02 — preço R$ 19,90 — sem estoque" },
    ]);
    expect(e.consultou("catalogo")).toBe(true);
    expect(e.consultou("bling")).toBe(false);
  });

  it("busca que não achou nada: a consulta aconteceu, mas não há evidência (a L6 saberá a diferença)", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    expect(
      registrarEvidenciaDaFerramenta(
        e,
        "crm_search_products",
        { produtos: [], motivo: "nao_encontrado", mensagem: "não há nada com esse nome" },
        ORG_A,
      ),
    ).toBe(true);
    expect(e.consultou("catalogo")).toBe(true);
    expect(e.vazia()).toBe(true);
  });

  it("'existe, mas sem estoque' volta como lista vazia com motivo, e vira evidência de quem diz 'sem estoque'", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    registrarEvidenciaDaFerramenta(
      e,
      "crm_search_products",
      { produtos: [], motivo: "sem_estoque", mensagem: "esse produto existe no catálogo, mas está sem estoque." },
      ORG_A,
    );
    expect(e.daOrigem("catalogo")).toEqual([
      { origem: "catalogo", fonte: "catálogo (sem estoque)", texto: "esse produto existe no catálogo, mas está sem estoque." },
    ]);
  });
});

describe("evidências das ferramentas: banco externo (Bling)", () => {
  it("cada linha vira uma evidência 'coluna: valor', com a tabela como fonte", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    const resultado = {
      conexao: { id: "c1", label: "Bling" },
      tabela: "produtos",
      linhas: [
        { nome: "Fonte 20W", preco: 89.9, estoque: 4, obs: null },
        { nome: "Cabo USB-C", preco: 29.9, estoque: 0 },
      ],
      aviso: "…",
    };
    expect(registrarEvidenciaDaFerramenta(e, "crm_query_external_data", resultado, ORG_A)).toBe(true);
    expect(e.daOrigem("bling")).toEqual([
      { origem: "bling", fonte: "produtos", texto: "nome: Fonte 20W; preco: 89.9; estoque: 4" },
      { origem: "bling", fonte: "produtos", texto: "nome: Cabo USB-C; preco: 29.9; estoque: 0" },
    ]);
  });

  it("consulta sem linhas: feita, sem evidência", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    registrarEvidenciaDaFerramenta(e, "crm_query_external_data", { tabela: "produtos", linhas: [], filtro_sem_resultado: "x" }, ORG_A);
    expect(e.consultou("bling")).toBe(true);
    expect(e.vazia()).toBe(true);
  });

  it("uma linha enorme é cortada no teto da evidência", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    registrarEvidenciaDaFerramenta(e, "crm_query_external_data", { tabela: "t", linhas: [{ descricao: "x".repeat(5000) }] }, ORG_A);
    const [ev] = e.daOrigem("bling");
    expect(ev!.texto.length).toBeLessThanOrEqual(TEXTO_DA_EVIDENCIA_NO_MAXIMO + 1);
    expect(ev!.texto.endsWith("…")).toBe(true);
  });
});

describe("evidências das ferramentas: o que NÃO conta como consulta feita", () => {
  it.each([
    ["erro da ferramenta", { erro: "tabela_nao_encontrada", mensagem: "não encontrei essa tabela." }],
    ["erro devolvido pelo wrapper", { error: "unknown_error" }],
    ["recusa de escopo", { permitido: false, motivo: "fora_do_escopo", mensagem: "x" }],
    ["formato desconhecido", { qualquer: "coisa" }],
    ["texto solto", "ok"],
    ["nulo", null],
    ["lista", []],
  ])("%s: nada registrado e a consulta NÃO conta", (_nome, resultado) => {
    for (const ferramenta of Object.keys(ORIGEM_DA_FERRAMENTA)) {
      const e = criarEvidenciasDoTurno(ORG_A);
      expect(registrarEvidenciaDaFerramenta(e, ferramenta, resultado, ORG_A), ferramenta).toBe(false);
      expect(e.vazia()).toBe(true);
      expect(e.consultou("catalogo")).toBe(false);
      expect(e.consultou("bling")).toBe(false);
    }
  });

  it("ferramenta que não é de consulta de preço/estoque é ignorada", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    expect(registrarEvidenciaDaFerramenta(e, "crm_list_contact_orders", BUSCA_DE_PRODUTOS, ORG_A)).toBe(false);
    expect(e.vazia()).toBe(true);
  });

  it("ISOLAMENTO: resultado registrado em nome de outra empresa é descartado", () => {
    const turnoDaA = criarEvidenciasDoTurno(ORG_A);
    expect(registrarEvidenciaDaFerramenta(turnoDaA, "crm_search_products", BUSCA_DE_PRODUTOS, ORG_B)).toBe(false);
    expect(turnoDaA.vazia()).toBe(true);
    expect(turnoDaA.consultou("catalogo")).toBe(false);
  });

  it("nunca lança, nem com resultado hostil (referência circular)", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    const circular: Record<string, unknown> = { tabela: "t" };
    circular.linhas = [circular];
    expect(() => registrarEvidenciaDaFerramenta(e, "crm_query_external_data", circular, ORG_A)).not.toThrow();
  });
});

describe("comEvidenciaDoTurno: o wrapper que o turno usa", () => {
  const ferramenta = (resultado: unknown) => ({
    description: "busca",
    execute: async (_args: { q: string }) => resultado,
  });

  it("registra o que a ferramenta devolveu e entrega o MESMO resultado ao modelo", async () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    const envolvida = comEvidenciaDoTurno(ferramenta(BUSCA_DE_PRODUTOS), "crm_search_products", e, ORG_A);
    expect(await envolvida.execute({ q: "capinha" })).toBe(BUSCA_DE_PRODUTOS);
    expect(e.daOrigem("catalogo")).toHaveLength(2);
    expect(envolvida.description).toBe("busca");
  });

  it("ferramenta fora da lista volta como veio, sem wrapper", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    const original = ferramenta({ ok: true });
    expect(comEvidenciaDoTurno(original, "crm_list_contact_orders", e, ORG_A)).toBe(original);
  });

  it("empresa errada no wrapper: o resultado passa, a evidência não", async () => {
    const turnoDaA = criarEvidenciasDoTurno(ORG_A);
    const envolvida = comEvidenciaDoTurno(ferramenta(BUSCA_DE_PRODUTOS), "crm_search_products", turnoDaA, ORG_B);
    expect(await envolvida.execute({ q: "x" })).toBe(BUSCA_DE_PRODUTOS);
    expect(turnoDaA.vazia()).toBe(true);
  });

  it("se a ferramenta lança, o erro segue e nada é registrado", async () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    const envolvida = comEvidenciaDoTurno(
      { execute: async () => { throw new Error("boom"); } },
      "crm_search_products",
      e,
      ORG_A,
    );
    await expect(envolvida.execute()).rejects.toThrow("boom");
    expect(e.consultou("catalogo")).toBe(false);
  });
});
