import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/instalacao/config", () => ({ valorDaInstalacao: vi.fn() }));

import { valorDaInstalacao } from "@/lib/instalacao/config";

import { centavosEmDolares, centavosEmReais, cotacaoDoDolar, formatarCustoEmReais, lerCotacao } from "./cotacao";

const ler = vi.mocked(valorDaInstalacao);

describe("lerCotacao", () => {
  it.each([
    ["5.4212", 5.4212],
    ["5,42", 5.42],
    [" 6 ", 6],
  ])("aceita %s", (bruto, esperado) => expect(lerCotacao(bruto)).toBe(esperado));

  it.each([[""], ["abc"], ["-5"], ["0"], ["0.1"], ["500"], ["5.4.2"], ["5 reais"], [null], [undefined]])(
    "recusa %s",
    (bruto) => expect(lerCotacao(bruto as string | null | undefined)).toBeNull(),
  );
});

describe("cotacaoDoDolar", () => {
  it("lê pela configuração da instalação", async () => {
    ler.mockResolvedValueOnce({ valor: "5,4212", fonte: "banco" } as never);
    expect(await cotacaoDoDolar()).toBe(5.4212);
    expect(ler).toHaveBeenLastCalledWith("COTACAO_USD_BRL");
  });
  it("sem valor, valor ruim ou erro: null (as telas ficam em dólar)", async () => {
    ler.mockResolvedValueOnce({ valor: null, fonte: "nenhuma" } as never);
    expect(await cotacaoDoDolar()).toBeNull();
    ler.mockResolvedValueOnce({ valor: "lixo", fonte: "banco" } as never);
    expect(await cotacaoDoDolar()).toBeNull();
    ler.mockRejectedValueOnce(new Error("banco"));
    expect(await cotacaoDoDolar()).toBeNull();
  });
});

describe("conversão e formato", () => {
  it("converte nos dois sentidos", () => {
    expect(centavosEmReais(500, 5.4212)).toBe(2711);
    expect(centavosEmDolares(2711, 5.4212)).toBe(500);
  });
  it("mostra R$ com a cotação, ou só o dólar sem ela", () => {
    const com = formatarCustoEmReais(500, 5.4212).replace(/\s/g, " ");
    expect(com).toBe("R$ 27,11 (cotação R$ 5,42)");
    expect(formatarCustoEmReais(500, null).replace(/\s/g, " ")).toBe("US$ 5,00");
  });
});
