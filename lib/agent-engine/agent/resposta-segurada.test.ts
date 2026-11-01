/**
 * A regra das duas tentativas (T13): a decisão pura, e a fiação no `send_message`
 * (o turno de verdade, contra Postgres, é o invariante da T25).
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BEFORE_SEND_GATES } from "../guardrails/before-send";
import {
  CODIGO_DA_CONFERENCIA,
  CODIGO_DA_RESPOSTA_SEGURADA,
  decidirOVetoDaConferencia,
  erroDaRespostaSegurada,
  MAX_VETOS_DA_CONFERENCIA,
  MENSAGEM_DA_RESPOSTA_SEGURADA,
} from "./resposta-segurada";

describe("decidirOVetoDaConferencia: a 1ª ensina, a 2ª segura de vez", () => {
  it("1ª reprovação: reescrever", () => {
    expect(decidirOVetoDaConferencia(1)).toEqual({ acao: "reescrever" });
  });

  it("2ª reprovação (e qualquer depois): segurar de vez", () => {
    expect(decidirOVetoDaConferencia(2)).toEqual({ acao: "segurar_de_vez" });
    expect(decidirOVetoDaConferencia(3)).toEqual({ acao: "segurar_de_vez" });
  });

  it("o degrau é 2: deixa UMA chance de reescrita (como os fail-safes irmãos)", () => {
    expect(MAX_VETOS_DA_CONFERENCIA).toBe(2);
  });
});

describe("a resposta segurada de vez", () => {
  it("o erro ao modelo manda encerrar: não chamar send_message de novo", () => {
    const e = erroDaRespostaSegurada();
    expect(e.ok).toBe(false);
    expect(e.error.code).toBe(CODIGO_DA_RESPOSTA_SEGURADA);
    expect(e.error.message).toBe(MENSAGEM_DA_RESPOSTA_SEGURADA);
    expect(e.error.message).toMatch(/NÃO chame send_message de novo/);
    expect(e.error.message).toMatch(/equipe vai assumir/);
  });

  it("o código do veto é o do gate da cadeia (se um mudar, o outro quebra o teste)", () => {
    expect(BEFORE_SEND_GATES.map((g) => g.name)).toContain(CODIGO_DA_CONFERENCIA);
  });
});

describe("a fiação no send_message (guarda de ligação — a execução ponta a ponta é o invariante de turno)", () => {
  const fonte = fs.readFileSync(path.resolve(__dirname, "inbound-turn.ts"), "utf8");

  it("o turno trata o veto da conferência: conta, decide e segura — sem LIBERAR o envio", () => {
    const bloco = fonte.slice(
      fonte.indexOf("chain.code === CODIGO_DA_CONFERENCIA"),
      fonte.indexOf("if (chain.status === 'vetoed') {\n            // Cap de warm-up"),
    );
    expect(bloco).toContain("jevConferenciaVetoCount += 1");
    expect(bloco).toContain("decidirOVetoDaConferencia(jevConferenciaVetoCount)");
    expect(bloco).toContain("respostaSegurada = true");
    expect(bloco).toContain("return erroDaRespostaSegurada()");
    // Diferente dos fail-safes irmãos: nenhuma chamada a runBeforeSend para soltar o texto.
    expect(bloco).not.toContain("runBeforeSend");
    expect(bloco).not.toContain("enforceInternalVocabulary: false");
  });

  it("depois de segurada, o turno não envia mais nada: a checagem vem ANTES de qualquer outra", () => {
    const aposSegurada = fonte.indexOf("if (respostaSegurada) return erroDaRespostaSegurada();");
    expect(aposSegurada).toBeGreaterThan(0);
    // Antes da conferência (que custa Jev) e da cadeia.
    expect(aposSegurada).toBeLessThan(fonte.indexOf("await conferirOTurno("));
    expect(aposSegurada).toBeLessThan(fonte.indexOf("let chain = await runBeforeSend(beforeSendArgs)"));
  });

  it("o contador e o flag são do TURNO (closure), nunca de módulo", () => {
    // Declarados DENTRO da função do turno (recuados), nunca na coluna 0 do módulo.
    expect(fonte).not.toMatch(/^(let|var|const) (jevConferenciaVetoCount|respostaSegurada)/m);
    expect(fonte).toMatch(/^ {2}let jevConferenciaVetoCount = 0;/m);
    expect(fonte).toMatch(/^ {2}let respostaSegurada = false;/m);
  });

  it("o veto da conferência é tratado ANTES do caminho genérico de veto (o que só devolve o erro ao modelo)", () => {
    expect(fonte.indexOf("chain.code === CODIGO_DA_CONFERENCIA")).toBeLessThan(
      fonte.indexOf("if (chain.status === 'vetoed') {\n            // Cap de warm-up"),
    );
  });
});
