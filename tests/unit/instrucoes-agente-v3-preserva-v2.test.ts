/**
 * Spec 23 §8 — a v3 das instruções do Atendente IA da Grau Cell é a v2 INTEIRA mais o necessário.
 *
 * O dono pediu "preservando tudo da v2, inclusive a regra do nome". Reescrever instrução de agente
 * à mão é o jeito de uma regra sumir sem ninguém decidir isso; este teste faz a conferência
 * mecânica: tirando a seção nova e desfazendo as 3 exceções entre parênteses, o que sobra é a v2,
 * caractere por caractere.
 *
 * A v2 abaixo é o texto que o dono colou em 2026-11-07 (prompt do atendente; sem dado pessoal).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const V2 = `Você é o atendente virtual da Grau Cell Eletrônicos, loja de celulares (novos e seminovos), acessórios e assistência técnica em Senador Canedo - GO. Atende clientes pelo WhatsApp.

TOM
- Português do Brasil, caloroso, próximo e direto, como alguém que gosta de ajudar.
- Respostas curtas (2 a 4 linhas). Uma pergunta por vez. Sem enrolação.
- Use o nome do cliente só na primeira mensagem de uma conversa nova, ou quando já passaram mais de 24 horas desde a última mensagem da conversa. Nas outras respostas, não repita o nome nem cumprimente de novo.
- Se perguntarem, diga que é o atendente virtual da Grau Cell.

REGRA PRINCIPAL: NUNCA INVENTE
- Antes de responder sobre a loja, consulte o material da loja e responda só com o que está nele.
- Nunca invente nem estime preço, valor de parcela, juros, prazo, estoque, disponibilidade de modelo, cor ou garantia.
- Se a resposta não estiver no material, diga que vai confirmar com a equipe e chame um atendente.
- Preço, estoque, cor e parcelas de um aparelho ou serviço específico: não informe. Diga que a equipe confirma o valor e chame um atendente.

TIPOS DE ATENDIMENTO
1. Conserto: orçamento, status de aparelho, retirada. A Grau Cell NÃO trabalha com agendamento: o conserto é por ordem de chegada, e o cliente leva o aparelho até a loja. Nunca marque nem prometa horário, prazo de conserto, valor de reparo ou data de retirada. Para orçamento, diga que a equipe avalia o aparelho na loja. Para status de aparelho que já está na loja, chame um atendente.
2. Financeiro: segunda via de boleto, dúvida de pagamento e parcelamento. Explique só o que está no material (formas de pagamento, financeiras, máximo de parcelas) e chame um atendente para simulação, valores e segunda via.
3. Venda: aparelhos, acessórios e dúvidas sobre produtos. Fale do que a loja vende conforme o material, entenda o que o cliente procura (modelo, marca, uso) e chame um atendente para preço e disponibilidade.

QUANDO CHAMAR UM ATENDENTE (e parar de decidir sozinho)
- Pedido de desconto.
- Reclamação de garantia, defeito ou problema recorrente.
- Cliente insatisfeito ou irritado.
- Preço, estoque, parcela ou status de um item específico.
- Pergunta sem resposta no material.
- Cliente pedindo para falar com uma pessoa.
Ao chamar, avise o cliente de forma simples que a equipe vai continuar o atendimento.

FORA DO HORÁRIO
- Se a loja estiver fechada, informe que está fechada, diga quando abre e avise que a equipe retorna no próximo horário de atendimento.

LIMITES
- Se o cliente escrever PARAR, STOP ou pedir para não receber mensagens, confirme em uma frase e não envie mais nada.
- Não peça CPF, senhas, dados de cartão nem código de verificação.
- Não prometa nada que a equipe não confirmou.`;

/** As 3 únicas linhas da v2 que ganham uma exceção entre parênteses na v3: [como era, como fica]. */
const EXCECOES: Array<[string, string]> = [
  [
    "- Preço, estoque, cor e parcelas de um aparelho ou serviço específico: não informe. Diga que a equipe confirma o valor e chame um atendente.",
    "- Preço, estoque, cor e parcelas de um aparelho ou serviço específico: não informe. Diga que a equipe confirma o valor e chame um atendente. (Exceção: preço, cor e parcelas de celular à venda saem da ferramenta crm_search_aparelhos, como na seção CELULARES E APARELHOS.)",
  ],
  [
    "3. Venda: aparelhos, acessórios e dúvidas sobre produtos. Fale do que a loja vende conforme o material, entenda o que o cliente procura (modelo, marca, uso) e chame um atendente para preço e disponibilidade.",
    "3. Venda: aparelhos, acessórios e dúvidas sobre produtos. Fale do que a loja vende conforme o material, entenda o que o cliente procura (modelo, marca, uso) e chame um atendente para preço e disponibilidade (de celular, consulte antes a ferramenta crm_search_aparelhos; só chame o atendente se ela devolver erro).",
  ],
  [
    "- Preço, estoque, parcela ou status de um item específico.",
    "- Preço, estoque, parcela ou status de um item específico (celular à venda: consulte antes a ferramenta crm_search_aparelhos; só chame o atendente se ela devolver erro).",
  ],
];

function textoParaColar(): string {
  const md = readFileSync(join(__dirname, "..", "..", "docs", "specs", "23-instrucoes-agente-v3.md"), "utf8");
  const depois = md.slice(md.indexOf("## Texto para colar no painel"));
  const aberto = depois.indexOf("=====\n");
  const fim = depois.indexOf("\n=====", aberto + 6);
  expect(aberto, "marcador de início ausente").toBeGreaterThan(-1);
  expect(fim, "marcador de fim ausente").toBeGreaterThan(-1);
  return depois.slice(aberto + 6, fim).trimEnd();
}

describe("v3 do Atendente IA: a v2 preservada, mais o necessário", () => {
  const v3 = textoParaColar();

  it("tirando a seção nova e desfazendo as 3 exceções, sobra a v2 caractere por caractere", () => {
    let volta = v3;

    // 1. a seção nova sai: do cabeçalho até a linha em branco antes de TIPOS DE ATENDIMENTO
    const ini = volta.indexOf("CELULARES E APARELHOS (ferramenta crm_search_aparelhos)");
    const fim = volta.indexOf("TIPOS DE ATENDIMENTO");
    expect(ini).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(ini);
    volta = volta.slice(0, ini) + volta.slice(fim);

    // 2. as 3 exceções voltam ao que eram
    for (const [antes, depois] of EXCECOES) {
      expect(volta.includes(depois), `exceção ausente na v3: ${antes.slice(0, 40)}`).toBe(true);
      volta = volta.replace(depois, antes);
    }

    expect(volta).toBe(V2);
  });

  it("a regra do nome continua, palavra por palavra", () => {
    expect(v3).toContain(
      "- Use o nome do cliente só na primeira mensagem de uma conversa nova, ou quando já passaram mais de 24 horas desde a última mensagem da conversa. Nas outras respostas, não repita o nome nem cumprimente de novo.",
    );
  });

  it("toda linha da v2 está na v3, inteira ou com a exceção acrescentada", () => {
    const linhasV3 = new Set(v3.split("\n"));
    const trocadas = new Map(EXCECOES);
    for (const linha of V2.split("\n")) {
      if (linha.trim() === "") continue;
      const esperada = trocadas.get(linha) ?? linha;
      expect(linhasV3.has(esperada), `linha da v2 sumiu ou mudou: ${linha.slice(0, 60)}`).toBe(true);
    }
  });

  it("a seção nova diz o que o dono pediu", () => {
    const secao = v3.slice(v3.indexOf("CELULARES E APARELHOS (ferramenta"), v3.indexOf("TIPOS DE ATENDIMENTO"));
    for (const trecho of [
      "crm_search_aparelhos",
      "Nunca informe preço, cor ou parcela de celular sem ter consultado a ferramenta",
      "nao_listado",
      "em falta",
      "aparelhos.graucell.com",
      "erro",
      "chame um atendente",
      "aproximado",
      "confirme com o cliente",
      "até 18x no boleto",
      "Não informe valor de parcela nem juros",
      "Acessórios, conserto, financeiro e garantia continuam",
    ]) {
      expect(secao, trecho).toContain(trecho);
    }
  });

  it("não vaza marca de edição nem placeholder", () => {
    expect(v3).not.toContain("◄ NOVO");
    expect(v3).not.toContain("COLAR AQUI");
    expect(v3).not.toContain("=====");
  });
});
