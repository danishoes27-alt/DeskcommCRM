import { describe, expect, it } from "vitest";

import { arquivoExemplo } from "./arquivo-exemplo";
import {
  LIMITE_DE_APARELHOS,
  buscarAparelhos,
  normalizar,
  tokensDaBusca,
  tokensDoTexto,
} from "./busca";
import type { AparelhoDoArquivo } from "./schema";
import { validarArquivo } from "./schema";

/** Aparelho sintético mínimo (a forma é a do arquivo real). */
function ap(
  id: string,
  nome: string,
  opcoes: { marca?: string; categoria?: string; condicao?: string; cor?: string; armazenamento?: string; ram?: string | null; rede?: string | null } = {},
): AparelhoDoArquivo {
  return {
    id,
    categoria: opcoes.categoria ?? "android",
    marca: opcoes.marca ?? "Marca",
    nome,
    condicao: opcoes.condicao ?? "novo",
    oferta: false,
    variantes: [
      {
        nome: opcoes.armazenamento ?? "128 GB",
        cor: opcoes.cor ?? "Preto",
        preco: { avista: "R$ 1.000", parcelas: "até 18x no boleto" },
        rede: opcoes.rede ?? null,
        nfc: null,
        processador: null,
        ram: opcoes.ram ?? null,
        armazenamento: opcoes.armazenamento ?? "128 GB",
        bateria: null,
        observacao: null,
      },
    ],
  };
}

function exemplo(): AparelhoDoArquivo[] {
  const r = validarArquivo(arquivoExemplo(), new Date("2026-11-08T12:00:00-03:00"));
  if (!r.ok) throw new Error("fixture inválida");
  return r.arquivo.aparelhos;
}

const CATALOGO: AparelhoDoArquivo[] = [
  ap("i16", "iPhone 16", { marca: "Apple", categoria: "iphone", cor: "Azul" }),
  ap("i16p", "iPhone 16 Pro", { marca: "Apple", categoria: "iphone" }),
  ap("i16pm", "iPhone 16 Pro Max", { marca: "Apple", categoria: "iphone" }),
  ap("i16pl", "iPhone 16 Plus", { marca: "Apple", categoria: "iphone" }),
  ap("i17", "iPhone 17", { marca: "Apple", categoria: "iphone" }),
  ap("i17e", "iPhone 17e", { marca: "Apple", categoria: "iphone" }),
  ap("i1", "iPhone 15", { marca: "Apple", categoria: "iphone" }),
  ap("rn15", "Redmi Note 15", { marca: "Xiaomi", ram: "8 GB", armazenamento: "256 GB", rede: "5G" }),
  ap("rn15p", "Redmi Note 15 Pro", { marca: "Xiaomi" }),
  ap("rn14", "Redmi Note 14", { marca: "Xiaomi" }),
  ap("s24u", "Galaxy S24 Ultra", { marca: "Samsung" }),
  ap("a56", "Galaxy A56", { marca: "Samsung" }),
  ap("g06", "Moto G06", { marca: "Motorola" }),
  ap("duo", "iPhone Duo", { marca: "Apple", categoria: "iphone" }),
];

const ids = (r: { itens: AparelhoDoArquivo[] }) => r.itens.map((a) => a.id);

describe("normalização (função pura)", () => {
  it("T-NOR-01 caixa e acento não importam", () => {
    expect(normalizar("iPhone")).toBe("iphone");
    expect(normalizar("IPHONE")).toBe("iphone");
    expect(normalizar("Galáxy Ãé")).toBe("galaxy ae");
    expect(normalizar("  Moto--G06!! ")).toBe("moto g06");
  });

  it("T-NOR-02 letra e dígito colados viram tokens separados", () => {
    expect(tokensDoTexto("a56")).toEqual(["a", "56"]);
    expect(tokensDoTexto("A 56")).toEqual(["a", "56"]);
    expect(tokensDoTexto("a-56")).toEqual(["a", "56"]);
    expect(tokensDoTexto("iPhone 17e")).toEqual(["iphone", "17", "e"]);
    expect(tokensDoTexto("s24ultra")).toEqual(["s", "24", "ultra"]);
    expect(tokensDoTexto("Iphone16ProMax")).toEqual(["iphone", "16", "promax"]);
  });

  it("T-NOR-10 palavras vazias só saem da busca, e antes de separar letra de dígito", () => {
    expect(tokensDaBusca("quero um celular iphone 16")).toEqual(["iphone", "16"]);
    expect(tokensDaBusca("tem a iphone 16?")).toEqual(["iphone", "16"]);
    // "a7" e "g06" NÃO são palavras vazias
    expect(tokensDaBusca("redmi a7")).toEqual(["redmi", "a", "7"]);
    expect(tokensDaBusca("quanto custa o celular")).toEqual([]);
  });
});

describe("casamento", () => {
  it("T-NOR-03 '16 promax' casa o Pro Max e NÃO casa 16, 16 Pro nem 16 Plus", () => {
    const r = buscarAparelhos(CATALOGO, { busca: "16 promax" });
    expect(ids(r)).toEqual(["i16pm"]);
    expect(r.aproximado).toBe(false);
  });

  it("'iphone 16 pro max' (como digitado) e 'Iphone16ProMax' (colado) dão o mesmo resultado", () => {
    expect(ids(buscarAparelhos(CATALOGO, { busca: "iphone 16 pro max" }))).toEqual(["i16pm"]);
    expect(ids(buscarAparelhos(CATALOGO, { busca: "Iphone16ProMax" }))).toEqual(["i16pm"]);
    expect(ids(buscarAparelhos(CATALOGO, { busca: "pro max 16" }))).toEqual(["i16pm"]);
  });

  it("T-NOR-04 número é sempre exato: 'iphone 1' e 'iphone 6' não casam o iPhone 16", () => {
    expect(buscarAparelhos(CATALOGO, { busca: "iphone 1" }).motivoVazio).toBe("sem_correspondencia");
    expect(buscarAparelhos(CATALOGO, { busca: "iphone 6" }).motivoVazio).toBe("sem_correspondencia");
    expect(buscarAparelhos(CATALOGO, { busca: "iphone 160" }).itens).toEqual([]);
  });

  it("D9: 'Redmi Note 15' jamais casa 'Redmi Note 14' (e o contrário), aproximado ou não", () => {
    expect(ids(buscarAparelhos(CATALOGO, { busca: "redmi note 15" }))).not.toContain("rn14");
    expect(ids(buscarAparelhos(CATALOGO, { busca: "redmi note 14" }))).toEqual(["rn14"]);
    expect(buscarAparelhos(CATALOGO, { busca: "redmi note 13" }).itens).toEqual([]);
    expect(buscarAparelhos(CATALOGO, { busca: "redmi note 16" }).itens).toEqual([]);
    // número do aparelho que existe só como atributo (8 GB de RAM) também não vale como modelo
    expect(buscarAparelhos(CATALOGO, { busca: "redmi note 8" }).itens).toEqual([]);
  });

  it("T-NOR-05 'redmi note 15': o exato vem sozinho, e o Pro fica em outros_modelos", () => {
    const r = buscarAparelhos(CATALOGO, { busca: "redmi note 15" });
    expect(ids(r)).toEqual(["rn15"]);
    expect(r.outrosModelos).toEqual(["Redmi Note 15 Pro (novo)"]);
  });

  it("T-NOR-06 exato exclusivo: 'iphone 16' devolve só o iPhone 16, os outros vão para outros_modelos", () => {
    const r = buscarAparelhos(CATALOGO, { busca: "iphone 16" });
    expect(ids(r)).toEqual(["i16"]);
    expect(r.totalEncontrado).toBe(1);
    expect(r.outrosModelos).toEqual(
      expect.arrayContaining(["iPhone 16 Pro (novo)", "iPhone 16 Pro Max (novo)", "iPhone 16 Plus (novo)"]),
    );
  });

  it("sem exato, devolve todos os que contêm os tokens ('iphone 16 pro' é exato do Pro; 'pro 16' idem)", () => {
    expect(ids(buscarAparelhos(CATALOGO, { busca: "iphone 16 pro" }))).toEqual(["i16p"]);
    const r = buscarAparelhos(CATALOGO, { busca: "16" });
    expect(ids(r).sort()).toEqual(["i16", "i16p", "i16pl", "i16pm"]);
  });

  it("T-NOR-07 erro de digitação (1 letra, palavra com 5+ letras) casa e volta aproximado", () => {
    const r = buscarAparelhos(CATALOGO, { busca: "ipone 16" });
    expect(ids(r)).toEqual(["i16"]);
    expect(r.aproximado).toBe(true);
    expect(ids(buscarAparelhos(CATALOGO, { busca: "iphnoe 16" }))).toEqual(["i16"]); // letras trocadas
    expect(buscarAparelhos(CATALOGO, { busca: "iphone 16" }).aproximado).toBe(false);
  });

  it("palavra curta (menos de 5 letras) não tem tolerância: 'moti g06' não casa 'moto', 'ifon' não casa 'iphone'", () => {
    // 'moti' tem 4 letras
    expect(buscarAparelhos(CATALOGO, { busca: "moti g06" }).itens).toEqual([]);
    expect(buscarAparelhos(CATALOGO, { busca: "ifon 16" }).itens).toEqual([]);
  });

  it("duas letras erradas não casam", () => {
    expect(buscarAparelhos(CATALOGO, { busca: "ifoni 16" }).itens).toEqual([]);
  });

  it("número nunca é aproximado, mesmo junto de palavra com erro de digitação", () => {
    expect(buscarAparelhos(CATALOGO, { busca: "ipone 17" }).itens.map((a) => a.id)).toEqual(["i17"]);
    expect(buscarAparelhos(CATALOGO, { busca: "ipone 18" }).itens).toEqual([]);
  });

  it("iPhone 17e (letra colada ao número): '17e' casa só o 17e; 'iphone 17' casa só o 17", () => {
    expect(ids(buscarAparelhos(CATALOGO, { busca: "17e" }))).toEqual(["i17e"]);
    expect(ids(buscarAparelhos(CATALOGO, { busca: "iphone 17e" }))).toEqual(["i17e"]);
    expect(ids(buscarAparelhos(CATALOGO, { busca: "iphone 17" }))).toEqual(["i17"]);
  });

  it("modelos com letra e número ('a56', 's24 ultra', 'moto g06', 'duo')", () => {
    expect(ids(buscarAparelhos(CATALOGO, { busca: "a56" }))).toEqual(["a56"]);
    expect(ids(buscarAparelhos(CATALOGO, { busca: "galaxy a 56" }))).toEqual(["a56"]);
    expect(ids(buscarAparelhos(CATALOGO, { busca: "s24 ultra" }))).toEqual(["s24u"]);
    expect(ids(buscarAparelhos(CATALOGO, { busca: "moto g06" }))).toEqual(["g06"]);
    expect(ids(buscarAparelhos(CATALOGO, { busca: "iphone duo" }))).toEqual(["duo"]);
  });

  it("T-NOR-09 sem sinônimo: só vale o texto do arquivo (marca é a do arquivo)", () => {
    expect(ids(buscarAparelhos(CATALOGO, { busca: "apple 16 pro" }))).toEqual(["i16p", "i16pm"]);
    expect(buscarAparelhos(CATALOGO, { busca: "maçã 16" }).itens).toEqual([]);
    expect(buscarAparelhos(CATALOGO, { busca: "mi note 15" }).itens).toEqual([]);
  });

  it("T-NOR-08 atributo de variante: cor e armazenamento ajudam, mas sozinhos não bastam", () => {
    expect(ids(buscarAparelhos(CATALOGO, { busca: "iphone 16 azul" }))).toEqual(["i16"]);
    expect(buscarAparelhos(CATALOGO, { busca: "azul" }).motivoVazio).toBe("sem_correspondencia");
    expect(ids(buscarAparelhos(CATALOGO, { busca: "redmi note 15 256gb" }))).toEqual(["rn15"]);
    expect(ids(buscarAparelhos(CATALOGO, { busca: "redmi note 15 256 gb" }))).toEqual(["rn15"]);
    expect(buscarAparelhos(CATALOGO, { busca: "redmi note 15 512gb" }).itens).toEqual([]);
    expect(ids(buscarAparelhos(CATALOGO, { busca: "redmi note 15 5g" }))).toEqual(["rn15"]);
  });

  it("busca vazia ou só palavras vazias: busca_vazia, sem varrer", () => {
    expect(buscarAparelhos(CATALOGO, { busca: "" }).motivoVazio).toBe("busca_vazia");
    expect(buscarAparelhos(CATALOGO, { busca: "quero um celular" }).motivoVazio).toBe("busca_vazia");
    expect(buscarAparelhos(CATALOGO, { busca: "!!!" }).motivoVazio).toBe("busca_vazia");
  });
});

describe("filtros categoria e condicao", () => {
  const mistos = [
    ap("a-novo", "iPhone 16", { marca: "Apple", categoria: "iphone", condicao: "novo" }),
    ap("a-semi", "iPhone 16", { marca: "Apple", categoria: "iphone", condicao: "seminovo" }),
    ap("a-cpo", "iPhone 16", { marca: "Apple", categoria: "iphone", condicao: "cpo" }),
    ap("r15", "Redmi Note 15", { marca: "Xiaomi", categoria: "android", condicao: "novo" }),
  ];

  it("mesmo modelo em mais de uma condição: todas voltam (exato), distintas pelo id", () => {
    const r = buscarAparelhos(mistos, { busca: "iphone 16" });
    expect(ids(r)).toEqual(["a-novo", "a-semi", "a-cpo"]);
    expect(r.empate).toBe(false); // é um modelo só, em condições diferentes
  });

  it("T-LIM-04 'condicao' reduz antes do casamento", () => {
    expect(ids(buscarAparelhos(mistos, { busca: "iphone 16", condicao: "seminovo" }))).toEqual(["a-semi"]);
    expect(ids(buscarAparelhos(mistos, { busca: "iphone 16", condicao: "SEMINOVO" }))).toEqual(["a-semi"]);
    expect(ids(buscarAparelhos(mistos, { busca: "iphone 16 seminovo" }))).toEqual(["a-semi"]);
  });

  it("T-LIM-04 'categoria' reduz antes do casamento", () => {
    expect(buscarAparelhos(mistos, { busca: "iphone 16", categoria: "android" }).itens).toEqual([]);
    expect(ids(buscarAparelhos(mistos, { busca: "note 15", categoria: "android" }))).toEqual(["r15"]);
  });

  it("T-LIM-04 valor que não existe no arquivo: vazio com os valores disponíveis", () => {
    const c = buscarAparelhos(mistos, { busca: "iphone 16", condicao: "lacrado" });
    expect(c.itens).toEqual([]);
    expect(c.motivoVazio).toBe("condicao_inexistente");
    expect(c.condicoesDisponiveis).toEqual(["cpo", "novo", "seminovo"]);

    const k = buscarAparelhos(mistos, { busca: "iphone 16", categoria: "tablet" });
    expect(k.motivoVazio).toBe("categoria_inexistente");
    expect(k.categoriasDisponiveis).toEqual(["android", "iphone"]);
  });
});

describe("limite e ordem", () => {
  const muitos = Array.from({ length: 8 }, (_, i) => ap(`g${i}`, `Galaxy A${50 + i}`, { marca: "Samsung" }));

  it("T-LIM-01 mais de 5 casam: devolve 5, truncado, total e os nomes dos demais", () => {
    const r = buscarAparelhos(muitos, { busca: "galaxy" });
    expect(LIMITE_DE_APARELHOS).toBe(5);
    expect(r.itens).toHaveLength(5);
    expect(r.truncado).toBe(true);
    expect(r.totalEncontrado).toBe(8);
    expect(r.outrosModelos).toHaveLength(3);
    expect(ids(r)).toEqual(["g0", "g1", "g2", "g3", "g4"]); // ordem do arquivo no empate
  });

  it("outros_modelos tem no máximo 20 nomes", () => {
    const enorme = Array.from({ length: 60 }, (_, i) => ap(`h${i}`, `Galaxy M${100 + i}`));
    const r = buscarAparelhos(enorme, { busca: "galaxy" });
    expect(r.totalEncontrado).toBe(60);
    expect(r.outrosModelos).toHaveLength(20);
  });

  it("T-LIM-03 empate: nomes diferentes com a mesma pontuação voltam juntos, marcados", () => {
    const r = buscarAparelhos(muitos.slice(0, 3), { busca: "galaxy" });
    expect(r.itens).toHaveLength(3);
    expect(r.empate).toBe(true);
    expect(r.truncado).toBe(false);
  });

  it("um só resultado não é empate", () => {
    expect(buscarAparelhos(CATALOGO, { busca: "iphone 16 pro max" }).empate).toBe(false);
  });

  it("sem exato: menos palavras sobrando no nome vem antes, e o aproximado vem depois", () => {
    const lista = [ap("longo", "Galaxy S24 Ultra Plus Edition"), ap("curto", "Galaxy S24")];
    expect(ids(buscarAparelhos(lista, { busca: "s24" }))).toEqual(["curto", "longo"]);

    const mista = [ap("aprox", "Galaxy S24 Ultra"), ap("certo", "Samsung Galaxy S24 Ultra")];
    // 'galaxi' (6 letras, 1 erro) casa aproximado nos dois; 'galaxy' exato em ambos → ordem do arquivo
    const r = buscarAparelhos(mista, { busca: "galaxi s24" });
    expect(r.aproximado).toBe(true);
  });

  it("os itens são os objetos do arquivo, intactos (mesma referência)", () => {
    const r = buscarAparelhos(CATALOGO, { busca: "iphone 16 pro max" });
    expect(r.itens[0]).toBe(CATALOGO.find((a) => a.id === "i16pm"));
  });
});

describe("com 4 aparelhos reais do arquivo publicado", () => {
  it("iPhone 16 existe em duas condições (novo e seminovo) e as duas voltam", () => {
    const r = buscarAparelhos(exemplo(), { busca: "iphone 16" });
    expect(ids(r)).toEqual(["iphone-16-lacrado", "iphone-16-seminovo"]);
  });

  it("'redmi note 15' acha o Android real, 'iphone 17e' o 17e, e 'redmi note 14' não existe", () => {
    expect(ids(buscarAparelhos(exemplo(), { busca: "redmi note 15" }))).toEqual(["redmi-note-15"]);
    expect(ids(buscarAparelhos(exemplo(), { busca: "iphone 17e" }))).toEqual(["iphone-17e-lacrado"]);
    expect(buscarAparelhos(exemplo(), { busca: "redmi note 14" }).motivoVazio).toBe("sem_correspondencia");
  });
});
