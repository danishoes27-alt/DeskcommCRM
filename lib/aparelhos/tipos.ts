/**
 * Tipos compartilhados da leitura do arquivo de aparelhos (spec 23 §5).
 *
 * `detalhe` é um vocabulário FECHADO de códigos curtos: nunca carrega texto do arquivo, nunca
 * carrega a URL. Quem lê (o modelo, o audit, o painel) recebe só o que a ação exige.
 */
import type { ArquivoDeAparelhos } from "./schema";

export type ErroDeLeitura = "falha_na_leitura" | "arquivo_invalido";

/** O que `lerArquivoDeAparelhos` devolve: o arquivo validado, ou a falha com seu código. */
export type ResultadoDaLeitura =
  | { ok: true; arquivo: ArquivoDeAparelhos; geradoEm: Date }
  | { ok: false; erro: ErroDeLeitura; detalhe: string };
