import { describe, expect, it } from "vitest";

import { canaisComModeloDaEmpresa } from "./canais-com-modelo-da-empresa";

/** O cliente de mentira devolve as linhas de `channel_sessions` da empresa, na ordem da consulta. */
function bancoCom(linhas: Array<{ provider: string }>, erro: { message: string; code?: string } | null = null) {
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    in: () => consulta,
    is: () => consulta,
    then: (ok: (v: unknown) => unknown) => ok({ data: erro ? null : linhas, error: erro }),
  };
  return { from: () => consulta } as never;
}

describe("canaisComModeloDaEmpresa", () => {
  it("empresa só com números por QR: nada de oficial, nada de parceiro, nenhum canal exige modelo", async () => {
    expect(await canaisComModeloDaEmpresa(bancoCom([{ provider: "waha" }, { provider: "waha" }]), "org-1")).toEqual({
      oficial: false,
      parceiro: false,
      exigeModelo: false,
    });
  });

  it("empresa sem nenhum canal ainda: o mesmo — não há o que mostrar", async () => {
    expect(await canaisComModeloDaEmpresa(bancoCom([]), "org-1")).toEqual({ oficial: false, parceiro: false, exigeModelo: false });
  });

  it("com canal oficial: a aba oficial aparece e o canal exige modelo", async () => {
    expect(await canaisComModeloDaEmpresa(bancoCom([{ provider: "waha" }, { provider: "meta_cloud" }]), "org-1")).toEqual({
      oficial: true,
      parceiro: false,
      exigeModelo: true,
    });
  });

  it("com provedor parceiro: a aba do parceiro aparece e o canal exige modelo", async () => {
    expect(await canaisComModeloDaEmpresa(bancoCom([{ provider: "zernio" }]), "org-1")).toEqual({
      oficial: false,
      parceiro: true,
      exigeModelo: true,
    });
  });

  it("a linha de chamada de voz mora na mesma tabela e não conta como canal de mensagem", async () => {
    expect(await canaisComModeloDaEmpresa(bancoCom([{ provider: "wacalls" }]), "org-1")).toEqual({
      oficial: false,
      parceiro: false,
      exigeModelo: false,
    });
  });

  it("⭐ não conseguir ler NÃO esconde nada: quem já usa o canal não perde a aba por um erro de leitura", async () => {
    expect(await canaisComModeloDaEmpresa(bancoCom([], { message: "boom" }), "org-1")).toEqual({
      oficial: true,
      parceiro: true,
      exigeModelo: true,
    });
  });
});
