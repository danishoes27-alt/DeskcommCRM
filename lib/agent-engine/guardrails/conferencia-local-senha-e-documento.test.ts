import { describe, expect, it } from "vitest";

import { criarEvidenciasDoTurno } from "../agent/evidencias-do-turno";
import { conferirLocalmente } from "./conferencia-local";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const codigos = (r: { codigo: string }[]) => r.map((a) => a.codigo);
const sem = () => criarEvidenciasDoTurno(ORG);

describe("L4 — senha de aparelho repetida", () => {
  const comSenha = (...valores: string[]) => {
    const e = criarEvidenciasDoTurno(ORG);
    for (const v of valores) e.guardarSenhaDoCliente(v, ORG);
    return e;
  };

  it("o rascunho que repete a senha é segurado, em qualquer caixa e com pontuação em volta", () => {
    for (const rascunho of ["Anotei: a senha é 4321.", "ok, usei o código 4321 pra abrir", "SENHA 4321!", "(4321)"]) {
      expect(codigos(conferirLocalmente({ rascunho, evidencias: comSenha("4321") }).achados), rascunho).toEqual([
        "senha_repetida",
      ]);
    }
  });

  it("padrão com separadores: 1-2-3-4 repetido como 1 2 3 4", () => {
    expect(
      codigos(conferirLocalmente({ rascunho: "Usei 1 2 3 4 para abrir.", evidencias: comSenha("1-2-3-4") }).achados),
    ).toEqual(["senha_repetida"]);
  });

  it("senha com acento: Açaí2024 repetida sem acento", () => {
    expect(
      codigos(conferirLocalmente({ rascunho: "Entrei com acai2024.", evidencias: comSenha("Açaí2024") }).achados),
    ).toEqual(["senha_repetida"]);
  });

  it("palavra inteira: a senha 1234 NÃO está em R$ 12.345,00 nem em 51234", () => {
    const e = comSenha("1234");
    const e2 = criarEvidenciasDoTurno(ORG);
    e2.registrar("catalogo", [{ texto: "preço R$ 12.345,00" }], ORG);
    e2.guardarSenhaDoCliente("1234", ORG);
    const l4 = (r: ReturnType<typeof conferirLocalmente>) => r.achados.filter((a) => a.regra === "L4");
    expect(l4(conferirLocalmente({ rascunho: "Peça 51234 chegou.", evidencias: e }))).toEqual([]);
    expect(l4(conferirLocalmente({ rascunho: "Custa R$ 12.345,00.", evidencias: e2 }))).toEqual([]);
  });

  it("sem senha no cofre, nada a conferir; senha curta demais é ignorada", () => {
    const l4 = (r: ReturnType<typeof conferirLocalmente>) => r.achados.filter((a) => a.regra === "L4");
    expect(l4(conferirLocalmente({ rascunho: "A senha é 4321", evidencias: sem() }))).toEqual([]);
    expect(l4(conferirLocalmente({ rascunho: "ab", evidencias: comSenha("ab") }))).toEqual([]);
  });

  it("O ACHADO NÃO LEVA A SENHA: nem no trecho, nem no motivo", () => {
    const r = conferirLocalmente({ rascunho: "A senha 98765 foi anotada.", evidencias: comSenha("98765") });
    const l4 = r.achados.find((a) => a.regra === "L4")!;
    expect(JSON.stringify(l4)).not.toContain("98765");
    expect(r.faixa).toBe("alta");
  });
});

describe("L5 — trecho de documento copiado", () => {
  const DOC =
    "Contrato de prestação de serviços entre as partes abaixo qualificadas, firmado em caráter irrevogável e irretratável pelo prazo de doze meses";
  const comDocumento = (texto: string) => {
    const e = criarEvidenciasDoTurno(ORG);
    e.guardarDocumentoDoCliente(texto, ORG);
    return e;
  };

  it("8 palavras seguidas iguais são cópia — mesmo com outra caixa, acento e pontuação", () => {
    const r = conferirLocalmente({
      rascunho: "Olha o que diz aí: firmado em CARÁTER irrevogável e irretratável, pelo prazo de doze meses — certo?",
      evidencias: comDocumento(DOC),
    });
    expect(codigos(r.achados)).toEqual(["documento_copiado"]);
    expect(r.faixa).toBe("alta");
  });

  it("7 palavras seguidas NÃO é cópia (o limite é 8)", () => {
    const rascunho = "firmado em caráter irrevogável e irretratável pelo"; // 7 palavras
    expect(conferirLocalmente({ rascunho, evidencias: comDocumento(DOC) }).achados).toEqual([]);
  });

  it("palavras do documento espalhadas, fora de ordem, não são cópia", () => {
    expect(
      conferirLocalmente({
        rascunho: "O prazo de doze meses vale; as partes qualificadas assinam em caráter irrevogável.",
        evidencias: comDocumento(DOC),
      }).achados,
    ).toEqual([]);
  });

  it("sem documento no cofre, nada a conferir", () => {
    expect(conferirLocalmente({ rascunho: DOC, evidencias: sem() }).achados).toEqual([]);
  });

  it("O ACHADO NÃO LEVA O TEXTO DO DOCUMENTO", () => {
    const r = conferirLocalmente({ rascunho: `Copiei: ${DOC}`, evidencias: comDocumento(DOC) });
    expect(r.achados).toHaveLength(1);
    expect(JSON.stringify(r.achados[0])).not.toMatch(/irrevog|firmado|Contrato/);
  });

  it("vários documentos: copiar de qualquer um é cópia", () => {
    const e = criarEvidenciasDoTurno(ORG);
    e.guardarDocumentoDoCliente("um texto qualquer sem relação nenhuma com a conversa do dia a dia aqui", ORG);
    e.guardarDocumentoDoCliente(DOC, ORG);
    expect(codigos(conferirLocalmente({ rascunho: DOC, evidencias: e }).achados)).toEqual(["documento_copiado"]);
  });
});
