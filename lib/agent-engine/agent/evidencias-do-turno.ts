/**
 * AS EVIDÊNCIAS DO TURNO — o que a IA consultou antes de montar a resposta.
 *
 * É a matéria-prima da conferência do "depois" (`docs/14-spec-jev.md`, seções 3.3
 * e 8.4 risco 2): as regras locais L1 a L6 e o Jev só podem dizer que um preço,
 * prazo, garantia ou disponibilidade "tem fonte" se o trecho que o sustenta está
 * aqui. Sem evidência, uma resposta correta é segurada — por isso o módulo
 * distingue "consultei e não achei nada" (`consultou`) de "nem consultei".
 *
 * ═══ O QUE ELE GARANTE ═══
 *
 *  1. **Só em memória, e só do turno.** Uma instância por turno, descartada com
 *     ele. Nada é gravado em banco, em log ou em `state` de ninguém aqui: o texto
 *     dos trechos pode trazer dado da loja, e a conferência é quem decide o que
 *     sai (mascarado) para o fornecedor.
 *  2. **Só da empresa do turno.** A instância nasce com o `organizationId` do
 *     turno e RECUSA qualquer registro que declare outra empresa. A busca já filtra
 *     por empresa na origem; esta é a segunda cerca — um erro de quem chama vira
 *     evidência descartada, e nunca um trecho de A servindo de fonte para B.
 *  3. **Sem duplicata.** A mesma consulta repetida no turno (a IA pergunta de
 *     novo) não infla a lista.
 *
 * Como o que a IA consulta vem de ferramentas diferentes (base de conhecimento,
 * catálogo, Bling), cada uma registra com a SUA origem, no mesmo formato.
 */

export const ORIGENS_DA_EVIDENCIA = ["base_de_conhecimento", "catalogo", "bling"] as const;
export type OrigemDaEvidencia = (typeof ORIGENS_DA_EVIDENCIA)[number];

export interface Evidencia {
  origem: OrigemDaEvidencia;
  /** De onde veio, para a leitura humana (nome do material, do produto). Pode ser vazio. */
  fonte: string | null;
  /** O trecho consultado, como a IA o leu. */
  texto: string;
}

export interface EvidenciaParaRegistrar {
  fonte?: string | null;
  texto: string;
}

/** Teto de memória por turno: uma busca com trechos enormes não pode crescer sem limite. */
export const EVIDENCIAS_NO_MAXIMO = 200;

export interface EvidenciasDoTurno {
  /** A empresa do turno — a única cuja evidência é aceita. */
  readonly organizationId: string;
  /**
   * Registra o que uma consulta devolveu. `organizationId` é a empresa em nome de
   * quem a consulta foi feita; diferente da do turno, nada é registrado (e a
   * consulta NÃO conta como feita). Devolve quantas evidências novas entraram.
   */
  registrar(origem: OrigemDaEvidencia, itens: readonly EvidenciaParaRegistrar[], organizationId: string): number;
  /**
   * Marca que a consulta ACONTECEU, ainda que sem resultado. Sem isto, "não achei
   * nada" e "nem procurei" seriam iguais, e a L6 (disponibilidade) não saberia
   * qual dos dois está segurando.
   */
  marcarConsulta(origem: OrigemDaEvidencia, organizationId: string): boolean;
  todas(): readonly Evidencia[];
  daOrigem(origem: OrigemDaEvidencia): readonly Evidencia[];
  /** A consulta dessa origem aconteceu neste turno? */
  consultou(origem: OrigemDaEvidencia): boolean;
  vazia(): boolean;
}

export function criarEvidenciasDoTurno(organizationId: string): EvidenciasDoTurno {
  const lista: Evidencia[] = [];
  const vistas = new Set<string>();
  const consultadas = new Set<OrigemDaEvidencia>();

  return {
    organizationId,
    registrar(origem, itens, daOrganizacao) {
      if (daOrganizacao !== organizationId) return 0;
      consultadas.add(origem);
      let novas = 0;
      for (const item of itens) {
        const texto = item.texto.trim();
        if (texto === "" || lista.length >= EVIDENCIAS_NO_MAXIMO) continue;
        const fonte = item.fonte?.trim() || null;
        const chave = JSON.stringify([origem, fonte, texto]);
        if (vistas.has(chave)) continue;
        vistas.add(chave);
        lista.push({ origem, fonte, texto });
        novas += 1;
      }
      return novas;
    },
    marcarConsulta(origem, daOrganizacao) {
      if (daOrganizacao !== organizationId) return false;
      consultadas.add(origem);
      return true;
    },
    todas: () => lista.slice(),
    daOrigem: (origem) => lista.filter((e) => e.origem === origem),
    consultou: (origem) => consultadas.has(origem),
    vazia: () => lista.length === 0,
  };
}
