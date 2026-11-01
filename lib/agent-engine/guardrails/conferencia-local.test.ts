import { describe, expect, it } from "vitest";

import { criarEvidenciasDoTurno, type OrigemDaEvidencia } from "../agent/evidencias-do-turno";
import {
  conferirAprovacao,
  conferirDisponibilidade,
  conferirLocalmente,
  conferirPrazoEGarantia,
  conferirValores,
  valoresConsultados,
} from "./conferencia-local";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Um turno com o que a IA consultou: `[origem, texto]`; origem sem texto = consultou e não achou. */
function turno(...consultas: Array<[OrigemDaEvidencia, string?]>) {
  const e = criarEvidenciasDoTurno(ORG);
  for (const [origem, texto] of consultas) e.registrar(origem, texto === undefined ? [] : [{ texto }], ORG);
  return e;
}
const sem = () => turno();
const codigos = (r: { codigo: string }[]) => r.map((a) => a.codigo);

describe("L1 — valores em R$", () => {
  it("valor igual ao consultado passa", () => {
    const e = turno(["catalogo", "Capinha iPhone 13 — preço R$ 39,90 — disponível"]);
    expect(conferirValores({ rascunho: "A capinha sai por R$ 39,90.", evidencias: e })).toEqual([]);
  });

  it("múltiplo inteiro de um preço unitário consultado passa: 5 folhas × R$ 2 = R$ 10", () => {
    const e = turno(["base_de_conhecimento", "Impressão colorida: R$ 2,00 por folha"]);
    expect(conferirValores({ rascunho: "5 folhas ficam R$ 10,00.", evidencias: e })).toEqual([]);
  });

  it("soma de itens é segurada: 2 itens somados = R$ 80 sem fonte", () => {
    const e = turno(["catalogo", "Capinha — preço R$ 30,00"], ["catalogo", "Película — preço R$ 50,00"]);
    // 30 + 50 = 80: não é igual a nenhum, nem múltiplo inteiro de nenhum
    const achados = conferirValores({ rascunho: "Os dois juntos ficam R$ 80,00.", evidencias: e });
    expect(codigos(achados)).toEqual(["valor_sem_fonte"]);
    expect(achados[0]).toMatchObject({ regra: "L1" });
    expect(achados[0]!.motivo).toContain("R$ 80,00");
  });

  it("valor que vem de fonte passa mesmo sendo uma soma (a fonte já traz o total)", () => {
    const e = turno(["base_de_conhecimento", "Combo capinha + película: R$ 80,00"]);
    expect(conferirValores({ rascunho: "O combo sai R$ 80,00.", evidencias: e })).toEqual([]);
  });

  it("preço sem nenhuma consulta é segurado", () => {
    expect(codigos(conferirValores({ rascunho: "A troca de tela custa R$ 250,00.", evidencias: sem() }))).toEqual([
      "valor_sem_fonte",
    ]);
  });

  it("preço da coluna do banco externo (sem R$) conta como consultado", () => {
    const e = turno(["bling", "nome: Fonte 20W; preco: 89.9; estoque: 4"]);
    expect(conferirValores({ rascunho: "A fonte 20W sai R$ 89,90.", evidencias: e })).toEqual([]);
  });

  it("'reais' por extenso também é valor", () => {
    expect(codigos(conferirValores({ rascunho: "Fica 120 reais.", evidencias: sem() }))).toEqual(["valor_sem_fonte"]);
  });

  it("valor diferente do consultado é segurado (R$ 39,90 consultado, R$ 35,00 dito)", () => {
    const e = turno(["catalogo", "Capinha — preço R$ 39,90"]);
    expect(codigos(conferirValores({ rascunho: "Faço por R$ 35,00.", evidencias: e }))).toEqual(["valor_sem_fonte"]);
  });

  it("sem valor no rascunho, não há o que segurar — nem com a evidência vazia", () => {
    expect(conferirValores({ rascunho: "Oi! Como posso ajudar?", evidencias: sem() })).toEqual([]);
  });

  it("desconto e parcela não são 'valor em R$' (são da trava de promessa)", () => {
    expect(conferirValores({ rascunho: "Dou 10% de desconto em até 12x sem juros.", evidencias: sem() })).toEqual([]);
  });

  it("valoresConsultados lê R$, reais e a coluna de preço", () => {
    const e = turno(["catalogo", "preço R$ 39,90"], ["bling", "valor: 12,5; nome: x"], ["base_de_conhecimento", "serviço por 100 reais"]);
    expect(valoresConsultados(e.todas()).sort((a, b) => a - b)).toEqual([1250, 3990, 10000]);
  });
});

describe("L2 — prazo e garantia", () => {
  it("prazo sem fonte é segurado", () => {
    expect(codigos(conferirPrazoEGarantia({ rascunho: "O conserto fica pronto em 2 dias.", evidencias: sem() }))).toEqual([
      "prazo_sem_fonte",
    ]);
  });

  it("prazo com a mesma quantidade e unidade na evidência passa", () => {
    const e = turno(["base_de_conhecimento", "Troca de tela: prazo de 2 dias úteis."]);
    expect(conferirPrazoEGarantia({ rascunho: "O conserto fica pronto em 2 dias.", evidencias: e })).toEqual([]);
  });

  it("número por extenso e faixa: 'de dois a três dias' contra '2 a 3 dias'", () => {
    const e = turno(["base_de_conhecimento", "Prazo: 2 a 3 dias."]);
    expect(conferirPrazoEGarantia({ rascunho: "Leva de dois a três dias.", evidencias: e })).toEqual([]);
    expect(codigos(conferirPrazoEGarantia({ rascunho: "Fica pronto em 7 dias.", evidencias: e }))).toEqual([
      "prazo_sem_fonte",
    ]);
  });

  it("unidade diferente não vale: a fonte diz 2 dias, o rascunho diz 2 horas", () => {
    const e = turno(["base_de_conhecimento", "Prazo de 2 dias."]);
    expect(codigos(conferirPrazoEGarantia({ rascunho: "Fica pronto em 2 horas.", evidencias: e }))).toEqual([
      "prazo_sem_fonte",
    ]);
  });

  it.each([
    "Seu celular fica pronto hoje.",
    "Entregamos amanhã sem falta.",
    "O aparelho chega depois de amanhã.",
    "Consertamos no mesmo dia.",
  ])("'hoje'/'amanhã' ao lado de verbo de compromisso, sem fonte: %s", (rascunho) => {
    expect(codigos(conferirPrazoEGarantia({ rascunho, evidencias: sem() }))).toEqual(["prazo_sem_fonte"]);
  });

  it("'hoje' com fonte que o sustenta passa", () => {
    const e = turno(["base_de_conhecimento", "Troca de tela fica pronta no mesmo dia."]);
    expect(conferirPrazoEGarantia({ rascunho: "Fica pronto hoje.", evidencias: e })).toEqual([]);
  });

  it.each([
    "Bom dia! Em que posso ajudar hoje?",
    "Hoje estamos abertos até as 18h.",
    "Amanhã é feriado, não abrimos.",
    "Aguarde um minutinho, por favor.",
  ])("conversa normal não é prazo: %s", (rascunho) => {
    expect(conferirPrazoEGarantia({ rascunho, evidencias: sem() })).toEqual([]);
  });

  it.each([
    ["garantia de 3 meses", "Todos os serviços têm garantia de 3 meses."],
    ["N meses de garantia", "Dou 6 meses de garantia na tela."],
    ["por extenso", "Tem garantia de um ano."],
  ])("garantia numérica sem fonte é segurada (%s)", (_n, rascunho) => {
    expect(codigos(conferirPrazoEGarantia({ rascunho, evidencias: sem() }))).toEqual(["garantia_sem_fonte"]);
  });

  it("garantia numérica com a mesma quantidade na evidência passa", () => {
    const e = turno(["base_de_conhecimento", "Política: garantia de 90 dias em todos os serviços."]);
    expect(conferirPrazoEGarantia({ rascunho: "O serviço tem garantia de 90 dias.", evidencias: e })).toEqual([]);
    expect(codigos(conferirPrazoEGarantia({ rascunho: "O serviço tem garantia de 120 dias.", evidencias: e }))).toEqual([
      "garantia_sem_fonte",
    ]);
  });

  it("garantia vitalícia / de fábrica sem fonte é segurada", () => {
    expect(codigos(conferirPrazoEGarantia({ rascunho: "A peça tem garantia de fábrica.", evidencias: sem() }))).toEqual([
      "garantia_sem_fonte",
    ]);
    const e = turno(["base_de_conhecimento", "Peças originais têm garantia de fábrica."]);
    expect(conferirPrazoEGarantia({ rascunho: "A peça tem garantia de fábrica.", evidencias: e })).toEqual([]);
  });

  it("'com garantia' sem número nem tipo não é afirmação checável aqui (fica para o Jev)", () => {
    expect(conferirPrazoEGarantia({ rascunho: "O serviço vai com garantia.", evidencias: sem() })).toEqual([]);
  });
});

describe("L3 — aprovação de crédito prometida", () => {
  it.each([
    "Seu crédito está aprovado!",
    "O financiamento é aprovado sem consulta ao SPC.",
    "Boleto liberado, é só vir buscar.",
    "Financiamento sem análise, 100% garantido.",
    "Parcelamento garantido, pode vir.",
    "Aprovamos o seu crediário.",
  ])("promessa de aprovação é segurada: %s", (rascunho) => {
    const achados = conferirAprovacao({ rascunho, evidencias: sem() });
    expect(codigos(achados)).toEqual(["aprovacao_prometida"]);
    expect(achados[0]).toMatchObject({ regra: "L3" });
  });

  it("segura mesmo havendo evidência (nenhuma fonte salva uma promessa de aprovação)", () => {
    const e = turno(["base_de_conhecimento", "Parcelamos em até 12x no cartão."]);
    expect(codigos(conferirAprovacao({ rascunho: "O parcelamento está aprovado.", evidencias: e }))).toEqual([
      "aprovacao_prometida",
    ]);
  });

  it.each([
    "O crédito depende da análise da financeira.",
    "Só depois de aprovado pela financeira eu confirmo o boleto.",
    "Se o financiamento for aprovado, a gente separa o aparelho.",
    "Não posso garantir a aprovação do crédito.",
    "O crédito ainda não foi aprovado.",
    "Precisa ser aprovado pela financeira.",
    "O boleto pode ser aprovado em poucos minutos, mas depende da análise.",
  ])("condicional ou negação não é promessa: %s", (rascunho) => {
    expect(conferirAprovacao({ rascunho, evidencias: sem() })).toEqual([]);
  });

  it("'100%' e 'garantido' fora de conversa de crédito não disparam", () => {
    for (const rascunho of ["A peça é 100% original.", "Pedido garantido para amanhã? Vou confirmar.", "O reparo é garantido pela loja."]) {
      expect(conferirAprovacao({ rascunho, evidencias: sem() }), rascunho).toEqual([]);
    }
  });
});

describe("L6 — disponibilidade sem fonte", () => {
  it.each([
    "Temos a película 3D em estoque.",
    "Sim, tem em estoque!",
    "O iPhone 13 já chegou.",
    "Temos sim, pode vir buscar.",
  ])("afirmar que TEM, sem nenhuma consulta: %s", (rascunho) => {
    const achados = conferirDisponibilidade({ rascunho, evidencias: sem() });
    expect(codigos(achados)).toEqual(["disponibilidade_sem_fonte"]);
    expect(achados[0]).toMatchObject({ regra: "L6" });
  });

  it("com o trecho consultado do MESMO produto, passa", () => {
    const e = turno(["catalogo", "Película 3D — código PEL-02 — preço R$ 19,90 — disponível"]);
    expect(conferirDisponibilidade({ rascunho: "Temos a película 3D em estoque.", evidencias: e })).toEqual([]);
  });

  it("consultou outro produto: a afirmação sobre este continua sem fonte", () => {
    const e = turno(["catalogo", "Capinha iPhone 13 — preço R$ 39,90 — disponível"]);
    expect(codigos(conferirDisponibilidade({ rascunho: "Temos a película 3D em estoque.", evidencias: e }))).toEqual([
      "disponibilidade_sem_fonte",
    ]);
  });

  it("a base de conhecimento também sustenta", () => {
    const e = turno(["base_de_conhecimento", "Trabalhamos com carregador turbo de 20W, sempre em estoque."]);
    expect(conferirDisponibilidade({ rascunho: "Temos o carregador turbo.", evidencias: e })).toEqual([]);
  });

  it.each([
    "Não temos esse modelo.",
    "Esse produto acabou.",
    "Está sem estoque no momento.",
    "A película esgotou.",
  ])("afirmar que NÃO tem, sem consultar nada: %s", (rascunho) => {
    expect(codigos(conferirDisponibilidade({ rascunho, evidencias: sem() }))).toEqual(["disponibilidade_sem_fonte"]);
  });

  it("'não temos' depois de uma busca que não achou nada: a consulta aconteceu, a afirmação passa", () => {
    const e = turno(["catalogo"]);
    expect(conferirDisponibilidade({ rascunho: "Não temos o modelo XZ900.", evidencias: e })).toEqual([]);
  });

  it("'não temos' contra uma fonte que diz que TEM é segurado (contradição)", () => {
    const e = turno(["catalogo", "Película 3D — preço R$ 19,90 — disponível"]);
    expect(codigos(conferirDisponibilidade({ rascunho: "Não temos a película 3D.", evidencias: e }))).toEqual([
      "disponibilidade_sem_fonte",
    ]);
  });

  it("'sem estoque' com a fonte dizendo sem estoque passa", () => {
    const e = turno(["catalogo", "Película 3D — preço R$ 19,90 — sem estoque"]);
    expect(conferirDisponibilidade({ rascunho: "A película 3D está sem estoque.", evidencias: e })).toEqual([]);
  });

  it("pergunta não afirma nada", () => {
    expect(conferirDisponibilidade({ rascunho: "Você quer o modelo que tem 128GB?", evidencias: sem() })).toEqual([]);
  });

  it("conversa sem afirmação de estoque não dispara", () => {
    for (const rascunho of ["Oi! Como posso ajudar?", "Pode trazer o aparelho para avaliarmos.", "O conserto leva uns minutos."]) {
      expect(conferirDisponibilidade({ rascunho, evidencias: sem() }), rascunho).toEqual([]);
    }
  });
});

describe("a conferência local junta tudo, e o achado é sempre faixa alta", () => {
  it("sem achado: faixa nula", () => {
    expect(conferirLocalmente({ rascunho: "Oi! Como posso ajudar?", evidencias: sem() })).toEqual({ achados: [], faixa: null });
  });

  it("qualquer achado: faixa alta, e cada regra aparece com o seu código", () => {
    const r = conferirLocalmente({
      rascunho: "Temos em estoque, custa R$ 250,00, fica pronto em 2 dias e o crédito está aprovado.",
      evidencias: sem(),
    });
    expect(r.faixa).toBe("alta");
    expect(new Set(r.achados.map((a) => a.regra))).toEqual(new Set(["L1", "L2", "L3", "L6"]));
  });

  it("o resultado é só o piso: nem uma evidência nem o Jev o rebaixam — o achado depende SÓ do texto e das fontes", () => {
    const e = turno(["base_de_conhecimento", "Frase qualquer que não sustenta nada."]);
    const a = conferirLocalmente({ rascunho: "O crédito está aprovado.", evidencias: e });
    const b = conferirLocalmente({ rascunho: "O crédito está aprovado.", evidencias: e });
    expect(a).toEqual(b);
    expect(a.faixa).toBe("alta");
  });

  it("achado carrega um motivo em português, para o modelo, sem expor dado pessoal além do trecho", () => {
    const r = conferirLocalmente({ rascunho: "Custa R$ 99,00.", evidencias: sem() });
    expect(r.achados[0]!.motivo).toMatch(/consulte|equipe confirma/);
    expect(r.achados[0]!.trecho).toContain("R$ 99,00");
  });

  it("nunca lança, nem com texto estranho", () => {
    for (const rascunho of ["", "\u0000", "R$ ", "em dias", "a".repeat(50_000)]) {
      expect(() => conferirLocalmente({ rascunho, evidencias: sem() })).not.toThrow();
    }
  });
});
