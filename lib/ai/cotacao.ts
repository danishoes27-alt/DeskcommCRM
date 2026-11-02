/**
 * A COTAÇÃO DO DÓLAR PARA AS TELAS DE CUSTO (spec do Jev, 7.4 e D11).
 *
 * O custo é guardado e decidido em DÓLAR (`llm_calls.cost_cents`, `ai_budgets`). A cotação serve
 * só para MOSTRAR reais ao lado e para converter o que o administrador digita em reais no teto.
 * Vem da configuração da instalação (`COTACAO_USD_BRL`, banco primeiro e `.env` como piso), a
 * mesma em todas as telas e para todas as empresas. Sem valor (ou valor inválido), devolve `null`
 * e as telas ficam como antes, em dólar. Nunca lança.
 */
import { valorDaInstalacao } from "@/lib/instalacao/config";

export const COTACAO_MINIMA = 0.5;
export const COTACAO_MAXIMA = 50;

/** "5,42" ou "5.4212" → 5.4212. Fora da faixa, vazio ou lixo → `null`. */
export function lerCotacao(bruto: string | null | undefined): number | null {
  if (bruto === null || bruto === undefined) return null;
  const limpo = bruto.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(limpo)) return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n >= COTACAO_MINIMA && n <= COTACAO_MAXIMA ? n : null;
}

export async function cotacaoDoDolar(): Promise<number | null> {
  try {
    const { valor } = await valorDaInstalacao("COTACAO_USD_BRL");
    return lerCotacao(valor);
  } catch {
    return null;
  }
}

/** Centavos de dólar → centavos de real, pela cotação. */
export function centavosEmReais(centavosUsd: number, cotacao: number): number {
  return Math.round(centavosUsd * cotacao);
}

/** Centavos de real → centavos de dólar, pela cotação. */
export function centavosEmDolares(centavosBrl: number, cotacao: number): number {
  return Math.round(centavosBrl / cotacao);
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

/**
 * "R$ 27,11 (cotação R$ 5,42)" quando há cotação; "US$ 5,00" quando não há. A fonte é o dólar;
 * o real é a conta da cotação em vigor, e a cotação aparece para o número não parecer exato.
 */
export function formatarCustoEmReais(centavosUsd: number, cotacao: number | null | undefined): string {
  const dolares = usd.format((centavosUsd ?? 0) / 100);
  if (cotacao === null || cotacao === undefined) return dolares;
  return `${brl.format(centavosEmReais(centavosUsd ?? 0, cotacao) / 100)} (${"cotação"} ${brl.format(cotacao)})`;
}
