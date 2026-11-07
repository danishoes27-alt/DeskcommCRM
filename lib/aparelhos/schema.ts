/**
 * O ARQUIVO DE APARELHOS — o contrato do `aparelhos.json` que a loja publica.
 *
 * Spec 23 §5. O arquivo é ENTRADA NÃO CONFIÁVEL (texto escrito por outro sistema), então tudo
 * passa por aqui antes de chegar ao agente.
 *
 * Duas regras que não se negociam:
 *
 *  1. **Preço é texto e nunca é interpretado.** `preco.avista` ("R$ 1.429") e `preco.parcelas`
 *     ("até 18x no boleto") são string e saem do arquivo como entraram: sem `parseFloat`, sem
 *     regex de formato, sem conta. Interpretar é o primeiro passo para reescrever, e reescrever
 *     preço é promessa que a loja terá de cumprir.
 *  2. **Campo desconhecido é preservado (`passthrough`).** O arquivo pode ganhar campo sem
 *     derrubar a leitura. O que não está aqui também sai ao agente, com o aviso de "é dado".
 *
 * Vocabulário FECHADO de `detalhe` (nunca carrega dado do arquivo): `schema_invalido`,
 * `contagem_nao_confere`, `data_invalida`.
 */
import { z } from "zod";

/** Mais velho que isto, o arquivo é `desatualizado` e nenhum preço sai dele. */
export const LIMITE_DESATUALIZADO_DIAS = 30;

/** `geradoEm` além deste adiantamento é relógio errado ou arquivo errado. */
const TOLERANCIA_FUTURO_MS = 24 * 60 * 60 * 1000;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

const textoOuNulo = (max: number) => z.string().max(max).nullish();

const precoSchema = z
  .object({
    avista: z.string().min(1).max(40),
    parcelas: z.string().min(1).max(80),
  })
  .passthrough();

const varianteSchema = z
  .object({
    nome: z.string().min(1).max(100),
    cor: z.string().max(100),
    preco: precoSchema,
    rede: textoOuNulo(200),
    nfc: textoOuNulo(100),
    processador: textoOuNulo(200),
    ram: textoOuNulo(100),
    armazenamento: z.string().max(100),
    bateria: textoOuNulo(100),
    observacao: textoOuNulo(500),
  })
  .passthrough();

const aparelhoSchema = z
  .object({
    id: z.string().min(1).max(120),
    categoria: z.string().min(1).max(60),
    marca: z.string().min(1).max(100),
    nome: z.string().min(1).max(200),
    condicao: z.string().min(1).max(60),
    oferta: z.boolean(),
    variantes: z.array(varianteSchema).max(50),
  })
  .passthrough();

export const arquivoDeAparelhosSchema = z
  .object({
    geradoEm: z.string().min(1).max(40),
    totalAparelhos: z.number().int().min(0),
    totalVariantes: z.number().int().min(0),
    nota: textoOuNulo(1000),
    aparelhos: z.array(aparelhoSchema).max(500),
  })
  .passthrough();

export type VarianteDeAparelho = z.infer<typeof varianteSchema>;
export type AparelhoDoArquivo = z.infer<typeof aparelhoSchema>;
export type ArquivoDeAparelhos = z.infer<typeof arquivoDeAparelhosSchema>;

export type DetalheDeArquivoInvalido = "schema_invalido" | "contagem_nao_confere" | "data_invalida";

export type ResultadoDaValidacao =
  | { ok: true; arquivo: ArquivoDeAparelhos; geradoEm: Date }
  | { ok: false; detalhe: DetalheDeArquivoInvalido };

/** ISO-8601 COM fuso (`Z` ou `±hh:mm`). Sem fuso a data é ambígua, e ambígua não vale. */
const ISO_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Valida o objeto já lido do JSON. Pura; nunca lança.
 *
 * Confere também que os totais declarados batem com o conteúdo: arquivo cortado ao meio ou
 * publicado pela metade tem `totalAparelhos` maior que a lista, e é esse descompasso que o
 * denuncia.
 */
export function validarArquivo(bruto: unknown, agora: Date = new Date()): ResultadoDaValidacao {
  const lido = arquivoDeAparelhosSchema.safeParse(bruto);
  if (!lido.success) return { ok: false, detalhe: "schema_invalido" };
  const arquivo = lido.data;

  const variantes = arquivo.aparelhos.reduce((soma, a) => soma + a.variantes.length, 0);
  if (arquivo.totalAparelhos !== arquivo.aparelhos.length || arquivo.totalVariantes !== variantes) {
    return { ok: false, detalhe: "contagem_nao_confere" };
  }

  if (!ISO_COM_FUSO.test(arquivo.geradoEm)) return { ok: false, detalhe: "data_invalida" };
  const geradoEm = new Date(arquivo.geradoEm);
  if (Number.isNaN(geradoEm.getTime())) return { ok: false, detalhe: "data_invalida" };
  if (geradoEm.getTime() - agora.getTime() > TOLERANCIA_FUTURO_MS) {
    return { ok: false, detalhe: "data_invalida" };
  }

  return { ok: true, arquivo, geradoEm };
}

/** Idade em dias inteiros (para baixo). Nunca negativa. */
export function idadeEmDias(geradoEm: Date, agora: Date): number {
  return Math.max(0, Math.floor((agora.getTime() - geradoEm.getTime()) / MS_POR_DIA));
}

/** `agora − geradoEm` ESTRITAMENTE maior que 30 dias. Exatamente 30 dias ainda vale. */
export function estaDesatualizado(geradoEm: Date, agora: Date): boolean {
  return agora.getTime() - geradoEm.getTime() > LIMITE_DESATUALIZADO_DIAS * MS_POR_DIA;
}
