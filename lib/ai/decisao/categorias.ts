/**
 * AS CATEGORIAS DA TRIAGEM — uma lista só, por empresa (`docs/14-spec-jev.md`, seção 3.2, D3).
 *
 * Mora em `organizations.settings.jev.categorias` (sem migração; o schema central é
 * `./config.ts`). Empresa sem lista usa o PADRÃO: Conserto, Venda, Impressão, Outro. Boleto e
 * parcelamento ficam descritos dentro de Venda — `financeiro` deixou de ser categoria. A
 * triagem antiga (`lib/ai/triagem/`) segue como estava: legado, desligada.
 *
 * Duas regras que o código garante, qualquer que seja a lista gravada:
 *  - `outro` existe e é a ÚLTIMA opção. O Jev tende à primeira opção quando está em dúvida
 *    (limitação documentada), então a dúvida cai no "outro", que não faz nada;
 *  - a ordem é a gravada, sem reordenar por rótulo — a ordem é informação.
 */
import type { ConfigDoJev } from "./config";

export interface CategoriaDaTriagem {
  id: string;
  rotulo: string;
  descricao: string;
}

export const ID_DO_OUTRO = "outro";

export const CATEGORIAS_PADRAO: readonly CategoriaDaTriagem[] = [
  {
    id: "conserto",
    rotulo: "Conserto",
    descricao: "Orçamento, andamento de um reparo, entrega ou retirada de um aparelho na assistência.",
  },
  {
    id: "venda",
    rotulo: "Venda",
    descricao:
      "Quer comprar um aparelho ou acessório, pergunta de produto, preço ou estoque; também boleto, parcelamento e forma de pagamento da compra.",
  },
  {
    id: "impressao",
    rotulo: "Impressão",
    descricao: "Impressão de documentos, fotos ou arte, cópias, encadernação e orçamento de serviço gráfico.",
  },
  { id: ID_DO_OUTRO, rotulo: "Outro", descricao: "Não se encaixa em nenhuma das anteriores." },
];

/** O fornecedor aceita até 255 opções numa escolha; as nossas são poucas, e o teto da lista é 20. */
export function categoriasDaEmpresa(config: Pick<ConfigDoJev, "categorias">): readonly CategoriaDaTriagem[] {
  const gravadas = config.categorias;
  if (gravadas === undefined || gravadas.length < 2) return CATEGORIAS_PADRAO;
  const unicas: CategoriaDaTriagem[] = [];
  const vistos = new Set<string>();
  for (const c of gravadas) {
    if (c.id === ID_DO_OUTRO || vistos.has(c.id)) continue;
    vistos.add(c.id);
    unicas.push(c);
  }
  if (unicas.length === 0) return CATEGORIAS_PADRAO;
  const outro = gravadas.find((c) => c.id === ID_DO_OUTRO) ?? CATEGORIAS_PADRAO[CATEGORIAS_PADRAO.length - 1]!;
  return [...unicas, outro];
}

/** As opções da pergunta `categoria`: id → descrição, na ordem da lista (`outro` por último). */
export function criteriosDaCategoria(categorias: readonly CategoriaDaTriagem[]): Record<string, string> {
  return Object.fromEntries(categorias.map((c) => [c.id, c.descricao]));
}
