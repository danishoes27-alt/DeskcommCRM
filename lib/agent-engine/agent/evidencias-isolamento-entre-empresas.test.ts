import { describe, expect, it } from "vitest";

import { criarEvidenciasDoTurno } from "./evidencias-do-turno";

/**
 * AS EVIDÊNCIAS DE UM TURNO SÃO SÓ DA EMPRESA DELE (r3, T26, item 5 da seção 8.5).
 *
 * Dois turnos de empresas diferentes em voo ao mesmo tempo: uma consulta feita em nome de A
 * não entra no cofre de B nem conta como feita, e nada fica em estado de módulo.
 */
describe("evidências do turno por empresa", () => {
  it("registro em nome de outra empresa é recusado, e a consulta não conta como feita", () => {
    const a = criarEvidenciasDoTurno("org-a");
    const b = criarEvidenciasDoTurno("org-b");

    expect(a.registrar("base_de_conhecimento", [{ fonte: "tabela de A", texto: "Troca de tela: R$ 300" }], "org-a")).toBe(1);
    expect(b.registrar("base_de_conhecimento", [{ fonte: "tabela de A", texto: "Troca de tela: R$ 300" }], "org-a")).toBe(0);
    expect(b.marcarConsulta("catalogo", "org-a")).toBe(false);
    expect(b.guardarSenhaDoCliente("1234", "org-a")).toBe(false);
    expect(b.guardarDocumentoDoCliente("cpf 000", "org-a")).toBe(false);

    expect(b.todas()).toEqual([]);
    expect(b.consultou("base_de_conhecimento")).toBe(false);
    expect(b.consultou("catalogo")).toBe(false);
    expect(b.senhasDoCliente()).toEqual([]);
    expect(b.documentosDoCliente()).toEqual([]);
    expect(a.todas().map((e) => e.texto)).toEqual(["Troca de tela: R$ 300"]);
  });

  it("dois turnos intercalados não se contaminam", () => {
    const a = criarEvidenciasDoTurno("org-a");
    const b = criarEvidenciasDoTurno("org-b");
    a.registrar("catalogo", [{ texto: "Produto de A" }], "org-a");
    b.registrar("catalogo", [{ texto: "Produto de B" }], "org-b");
    a.registrar("bling", [{ texto: "Estoque de A" }], "org-a");
    expect(a.todas().map((e) => e.texto)).toEqual(["Produto de A", "Estoque de A"]);
    expect(b.todas().map((e) => e.texto)).toEqual(["Produto de B"]);
    expect(b.consultou("bling")).toBe(false);
  });
});
