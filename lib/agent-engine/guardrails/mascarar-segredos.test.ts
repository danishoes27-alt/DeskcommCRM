import { describe, expect, it } from "vitest";

import { encontrarSenhas, mascararSegredos, pedacosDoNome } from "./mascarar-segredos";

const MARIA = { nomeDoContato: "Maria da Silva Souza" };

describe("senha de aparelho → [SENHA]", () => {
  it.each([
    ["senha: 1234", "senha: [SENHA]"],
    ["A SENHA É 4321", "A SENHA É [SENHA]"],
    ["minha senha é 12345678", "minha senha é [SENHA]"],
    ["senha 0000 pode testar", "senha [SENHA] pode testar"],
    ["pin 9876", "pin [SENHA]"],
    ["PIN: 1 2 3 4", "PIN: [SENHA]"],
    ["o pin é 12-34-56", "o pin é [SENHA]"],
    ["código de desbloqueio 5555", "código de desbloqueio [SENHA]"],
    ["codigo de desbloqueio: 5555", "codigo de desbloqueio: [SENHA]"],
    ["senha do celular: Mari2024", "senha do celular: [SENHA]"],
    ["padrão em L", "padrão [SENHA]"],
    ["o padrão de desbloqueio é em Z", "o padrão de desbloqueio é [SENHA]"],
    ["padrão: 1478", "padrão: [SENHA]"],
    ['senha "azul 1234"', "senha [SENHA]"],
    ["senha: batata", "senha: [SENHA]"],
    ["senha=abc123!", "senha=[SENHA]"],
    ["minha senha é 1234.", "minha senha é [SENHA]."],
    ["senha: Mari2024! obrigada", "senha: [SENHA] obrigada"],
  ])("%s", (entrada, esperado) => {
    expect(mascararSegredos(entrada)).toBe(esperado);
  });

  it("um PIN de 8 dígitos é senha, e não telefone", () => {
    expect(mascararSegredos("pin 12345678")).toBe("pin [SENHA]");
  });

  it("senha e telefone na mesma frase: cada um com a sua marca", () => {
    expect(mascararSegredos("senha 4321, me liga no (11) 98765-4321")).toBe("senha [SENHA], me liga no [PHONE]");
  });

  it("duas senhas na mesma mensagem: as duas saem", () => {
    expect(mascararSegredos("senha 1111 e o pin 2222")).toBe("senha [SENHA] e o pin [SENHA]");
  });

  describe("o que NÃO pode ser mascarado", () => {
    it.each([
      "a loja não pede senhas de clientes",
      "senhas são pessoais e não pedimos por aqui",
      "o aparelho está fora do padrão da marca",
      "fora do padrão",
      "esqueci a senha",
      "preciso resetar o pin do chip",
      "o padrão da loja é entregar em 3 dias",
      "pinça de precisão",
      "o aparelho não tem senha",
    ])("%s", (frase) => {
      expect(mascararSegredos(frase)).toBe(frase);
    });
  });

  it("encontrarSenhas devolve o valor (a L4 precisa dele) e a posição exata", () => {
    const texto = "oi, a senha é 4321 ok";
    const [achada] = encontrarSenhas(texto);
    expect(achada?.valor).toBe("4321");
    expect(texto.slice(achada!.inicio, achada!.fim)).toBe("4321");
  });

  it("encontrarSenhas não acha nada em frase de política", () => {
    expect(encontrarSenhas("a loja não pede senhas")).toEqual([]);
  });
});

describe("nome → [NOME]", () => {
  it("o primeiro nome E o sobrenome do contato, em qualquer caixa", () => {
    expect(mascararSegredos("Oi Maria, tudo bem? Aqui é o Souza", MARIA)).toBe("Oi [NOME], tudo bem? Aqui é o [NOME]");
    expect(mascararSegredos("MARIA SILVA", MARIA)).toBe("[NOME] [NOME]");
  });

  it("com ou sem acento, dos dois lados", () => {
    expect(mascararSegredos("Olá José", { nomeDoContato: "Jose Antônio" })).toBe("Olá [NOME]");
    expect(mascararSegredos("Olá Jose Antonio", { nomeDoContato: "José Antônio" })).toBe("Olá [NOME] [NOME]");
  });

  it("palavra inteira: 'Mariana' e 'Marialva' não são 'Maria'", () => {
    expect(mascararSegredos("Mariana e Marialva", MARIA)).toBe("Mariana e Marialva");
  });

  it("partículas e letras soltas do nome do cadastro não viram marca (apagariam a frase)", () => {
    expect(pedacosDoNome("Maria da Silva e Souza J.")).toEqual(["Maria", "Silva", "Souza"]);
    expect(mascararSegredos("o filme da Maria e do Souza", MARIA)).toBe("o filme da [NOME] e do [NOME]");
  });

  it("sem nome no cadastro, só o que o cliente diz de si", () => {
    expect(mascararSegredos("meu nome é Joana Pereira e quero trocar a tela")).toBe(
      "meu nome é [NOME] e quero trocar a tela",
    );
    expect(mascararSegredos("Me chamo Carlos.")).toBe("Me chamo [NOME].");
    expect(mascararSegredos("aqui é a Fernanda da Silva, tudo bem?")).toBe("aqui é a [NOME], tudo bem?");
  });

  it("'sou o cliente' / 'sou a dona' não é nome (palavra comum, minúscula)", () => {
    expect(mascararSegredos("sou o cliente do pedido 12")).toBe("sou o cliente do pedido 12");
    expect(mascararSegredos("sou a dona da loja")).toBe("sou a dona da loja");
  });

  it("nome nulo, vazio ou só de partículas: nada a trocar", () => {
    for (const nomeDoContato of [null, undefined, "", "   ", "de da"]) {
      expect(mascararSegredos("Oi Maria", { nomeDoContato })).toBe("Oi Maria");
    }
  });
});

describe("telefone, CPF e e-mail (vêm do scrub do Sentry)", () => {
  it.each([
    ["liga (11) 98765-4321", "liga [PHONE]"],
    ["+55 11 98765-4321", "[PHONE]"],
    ["meu cpf 123.456.789-09", "meu cpf [CPF]"],
    // 11 dígitos colados: o scrub do Sentry lê como telefone. Os dois são mascarados.
    ["cpf 12345678909", "cpf [PHONE]"],
    ["maria.souza@gmail.com", "[EMAIL]"],
    ["escreve pra joao_1@loja.com.br agora", "escreve pra [EMAIL] agora"],
  ])("%s", (entrada, esperado) => {
    expect(mascararSegredos(entrada)).toBe(esperado);
  });
});

describe("endereço e CEP", () => {
  it.each([
    ["moro na Rua das Flores, 123", "moro na [ENDERECO]"],
    ["Rua das Flores 123 apto 45", "[ENDERECO]"],
    ["Avenida Brasil, nº 1500", "[ENDERECO]"],
    ["av. paulista, 1000 - bloco B", "[ENDERECO]"],
    ["Travessa do Comércio, 7, casa 2", "[ENDERECO]"],
    ["Estrada Velha 55", "[ENDERECO]"],
    ["fica no CEP 01310-100", "fica no CEP [CEP]"],
    ["Rua Augusta, 200 - 01305-000", "[ENDERECO] - [CEP]"],
  ])("%s", (entrada, esperado) => {
    expect(mascararSegredos(entrada)).toBe(esperado);
  });

  it("o número da casa não vira telefone, e o telefone ao lado continua sendo telefone", () => {
    expect(mascararSegredos("Rua Sete, 1234 e o tel 11987654321")).toBe("[ENDERECO] e o tel [PHONE]");
  });

  it("frases comuns com 'rua' e 'via' não são endereço", () => {
    for (const frase of ["a rua estava cheia", "vou via correio", "a loja fica na rua de trás", "r$ 50 no pix"]) {
      expect(mascararSegredos(frase)).toBe(frase);
    }
  });
});

describe("propriedades", () => {
  const CASOS = [
    "oi, sou a Maria Souza, senha 4321, cpf 123.456.789-09, rua das Flores, 12, tel (11) 98765-4321 maria@x.com",
    "texto limpo sem nada pessoal",
    "",
  ];

  it("idempotente: mascarar de novo não muda nada", () => {
    for (const t of CASOS) {
      const uma = mascararSegredos(t, MARIA);
      expect(mascararSegredos(uma, MARIA), t).toBe(uma);
    }
  });

  it("nada do que foi mascarado sobra no texto de saída", () => {
    const saida = mascararSegredos(CASOS[0]!, MARIA);
    for (const vazado of ["Maria", "Souza", "4321", "123.456", "Flores", "98765", "maria@x.com"]) {
      expect(saida, vazado).not.toContain(vazado);
    }
  });

  it("texto sem dado pessoal sai igual", () => {
    expect(mascararSegredos("Oi! Temos película 3D por R$ 19,90, quer?")).toBe("Oi! Temos película 3D por R$ 19,90, quer?");
  });

  it("nunca lança, nem com entrada estranha", () => {
    for (const t of ["\u0000", "senha:", "\uD800", "a".repeat(100_000), "senha: " + "9".repeat(5000)]) {
      expect(() => mascararSegredos(t, MARIA)).not.toThrow();
    }
  });
});
