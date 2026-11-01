import { describe, expect, it } from "vitest";

import { foraDoAr, JANELA_DA_QUEDA_MS } from "./fora-do-ar";

const AGORA = Date.parse("2026-11-01T15:00:00.000Z");
const haMinutos = (n: number) => new Date(AGORA - n * 60_000).toISOString();

describe("foraDoAr", () => {
  it.each([
    "jev_credencial_invalida",
    "jev_sem_credito",
    "jev_limite_de_taxa",
    "jev_provedor_sobrecarregado",
    "jev_provedor_indisponivel",
  ])("falha recente de conta ou de fornecedor (%s) = fora do ar", (motivo) => {
    expect(foraDoAr({ motivo, em: haMinutos(5) }, AGORA)).toEqual({ desde: haMinutos(5), motivo });
  });

  it.each(["jev_contrato_invalido", "jev_resposta_ilegivel", "jev_sem_credencial", "qualquer_outro", null])(
    "%s é defeito nosso, ou não é queda: segue como 'Última falha'",
    (motivo) => {
      expect(foraDoAr({ motivo, em: haMinutos(1) }, AGORA)).toBeNull();
    },
  );

  it("falha antiga (passou da janela) já não é queda", () => {
    expect(foraDoAr({ motivo: "jev_provedor_indisponivel", em: haMinutos(31) }, AGORA)).toBeNull();
    expect(foraDoAr({ motivo: "jev_provedor_indisponivel", em: haMinutos(30) }, AGORA)).not.toBeNull();
    expect(JANELA_DA_QUEDA_MS).toBe(30 * 60_000);
  });

  it("sem falha, não há queda", () => {
    expect(foraDoAr(null, AGORA)).toBeNull();
  });
});
