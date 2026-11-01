import { describe, expect, it, vi } from "vitest";

import { criarEvidenciasDoTurno } from "./evidencias-do-turno";
import { guardarSegredosDoCliente, type MensagemDoContexto } from "./segredos-do-cliente-no-turno";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DOC = "Laudo técnico do aparelho: placa principal com oxidação severa, bateria estufada e display com mancha escura";

const entrada = (body: string): MensagemDoContexto => ({ direction: "inbound", body });

describe("o cofre do turno", () => {
  it("guarda a senha que o cliente digitou, e só ela", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    const r = guardarSegredosDoCliente(
      e,
      [entrada("oi, quero trocar a tela"), entrada("a senha é 4321"), { direction: "outbound", body: "senha 9999" }],
      ORG_A,
    );
    expect(r).toEqual({ senhas: 1, documentos: 0 });
    expect(e.senhasDoCliente()).toEqual(["4321"]);
  });

  it("áudio transcrito também pode ter a senha; foto não tem texto", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    guardarSegredosDoCliente(
      e,
      [
        { direction: "inbound", type: "audio", body: "a senha do celular é 5555" },
        { direction: "inbound", type: "image", body: "senha 1111" },
      ],
      ORG_A,
    );
    expect(e.senhasDoCliente()).toEqual(["5555"]);
  });

  it("o texto do documento vai para o cofre; marcador vazio e texto curto não", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    const r = guardarSegredosDoCliente(
      e,
      [
        { direction: "inbound", type: "document", body: DOC },
        { direction: "inbound", type: "document", body: "[document]" },
        { direction: "inbound", type: "document", body: "curto" },
      ],
      ORG_A,
    );
    expect(r).toEqual({ senhas: 0, documentos: 1 });
    expect(e.documentosDoCliente()).toEqual([DOC]);
  });

  it("a moldura de mídia do turno não vira senha nem documento", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    guardarSegredosDoCliente(e, [entrada("[Mídia do cliente: ele enviou um PDF… senha 7777")], ORG_A);
    expect(e.senhasDoCliente()).toEqual([]);
  });

  it("ISOLAMENTO: o cofre do turno da empresa A recusa o que vem em nome da B", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    expect(guardarSegredosDoCliente(e, [entrada("senha 4321")], ORG_B)).toEqual({ senhas: 0, documentos: 0 });
    expect(e.senhasDoCliente()).toEqual([]);
    expect(e.guardarDocumentoDoCliente(DOC, ORG_B)).toBe(false);
  });

  it("O COFRE NÃO É EVIDÊNCIA: a senha e o documento nunca aparecem em `todas()` (nem no que vai ao Jev)", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    guardarSegredosDoCliente(e, [entrada("senha 4321"), { direction: "inbound", type: "document", body: DOC }], ORG_A);
    expect(e.todas()).toEqual([]);
    expect(e.vazia()).toBe(true);
    expect(JSON.stringify(e.todas())).not.toContain("4321");
  });

  it("a senha não vai a log nem a console (nenhuma saída durante o guardar)", () => {
    const espioes = (["log", "info", "warn", "error", "debug"] as const).map((n) =>
      vi.spyOn(console, n).mockImplementation(() => {}),
    );
    const e = criarEvidenciasDoTurno(ORG_A);
    guardarSegredosDoCliente(e, [entrada("senha 4321")], ORG_A);
    for (const s of espioes) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });

  it("o cofre tem teto, e as leituras devolvem cópias", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    for (let i = 0; i < 30; i++) e.guardarSenhaDoCliente(`senha${i}`, ORG_A);
    expect(e.senhasDoCliente()).toHaveLength(10);
    (e.senhasDoCliente() as string[]).length = 0;
    expect(e.senhasDoCliente()).toHaveLength(10);
  });

  it("nunca lança, nem com mensagens estranhas", () => {
    const e = criarEvidenciasDoTurno(ORG_A);
    expect(() => guardarSegredosDoCliente(e, [entrada(""), entrada("senha:"), entrada("\0\0")], ORG_A)).not.toThrow();
  });
});
