/**
 * O CACHE DO ARQUIVO DE APARELHOS — 5 minutos, em memória, e nunca preço vencido.
 *
 * Spec 23 §3.
 *
 *  - **Chave** `organization_id|url`: duas organizações que apontem para a mesma URL NÃO
 *    compartilham entrada.
 *  - **TTL positivo 300 s.** Passou disso, a próxima consulta lê de novo.
 *  - **Leitura que falha com cache vencido ⇒ a FALHA, nunca o valor vencido** (decisão do dono do
 *    produto, 2026-11-07). A entrada vencida é descartada antes de ler; se a leitura falhar, ela
 *    não existe mais para ser servida. O preço é uma promessa; "vencido há 6 minutos" é o tipo de
 *    exceção que cresce.
 *  - **Falha lembrada por 30 s.** Sem isso, com o site fora do ar, cada mensagem de cliente
 *    esperaria o timeout inteiro.
 *  - **Uma leitura por vez** (single-flight): 20 clientes escrevendo juntos fazem 1 `fetch`.
 *  - **Teto de 50 entradas**; a mais antiga sai.
 *
 * Em memória do processo, de propósito: o Redis (Upstash) é opcional neste produto, e 512 KB lidos
 * a cada 5 min por processo é desprezível. `app` e `worker` têm caches separados.
 */
import type { ResultadoDaLeitura } from "./tipos";

export type { ResultadoDaLeitura } from "./tipos";

export const TTL_DO_CACHE_MS = 5 * 60_000;
export const TTL_DA_FALHA_MS = 30_000;
export const MAX_ENTRADAS_DO_CACHE = 50;

interface Entrada {
  resultado: ResultadoDaLeitura;
  expiraEm: number;
}

export interface OpcoesDoCache {
  agora?: () => number;
  ttlMs?: number;
  ttlDaFalhaMs?: number;
  maxEntradas?: number;
}

export interface CacheDeAparelhos {
  obter(chave: string, carregar: () => Promise<ResultadoDaLeitura>): Promise<ResultadoDaLeitura>;
  tamanho(): number;
  limpar(): void;
}

export function criarCacheDeAparelhos(opcoes: OpcoesDoCache = {}): CacheDeAparelhos {
  const agora = opcoes.agora ?? Date.now;
  const ttl = opcoes.ttlMs ?? TTL_DO_CACHE_MS;
  const ttlFalha = opcoes.ttlDaFalhaMs ?? TTL_DA_FALHA_MS;
  const maximo = opcoes.maxEntradas ?? MAX_ENTRADAS_DO_CACHE;
  const entradas = new Map<string, Entrada>();
  const emVoo = new Map<string, Promise<ResultadoDaLeitura>>();

  function guardar(chave: string, resultado: ResultadoDaLeitura): void {
    entradas.delete(chave); // reinsere no fim: a ordem do Map é a idade
    entradas.set(chave, { resultado, expiraEm: agora() + (resultado.ok ? ttl : ttlFalha) });
    while (entradas.size > maximo) {
      const maisAntiga = entradas.keys().next().value;
      if (maisAntiga === undefined) break;
      entradas.delete(maisAntiga);
    }
  }

  return {
    async obter(chave, carregar) {
      const atual = entradas.get(chave);
      if (atual) {
        if (atual.expiraEm > agora()) return atual.resultado;
        // Vencida: sai AGORA. Se a releitura falhar, não há valor vencido para ser servido.
        entradas.delete(chave);
      }

      const pendente = emVoo.get(chave);
      if (pendente) return pendente;

      const leitura = (async (): Promise<ResultadoDaLeitura> => {
        let resultado: ResultadoDaLeitura;
        try {
          resultado = await carregar();
        } catch {
          resultado = { ok: false, erro: "falha_na_leitura", detalhe: "rede" };
        }
        guardar(chave, resultado);
        return resultado;
      })().finally(() => {
        emVoo.delete(chave);
      });
      emVoo.set(chave, leitura);
      return leitura;
    },
    tamanho: () => entradas.size,
    limpar: () => {
      entradas.clear();
      emVoo.clear();
    },
  };
}

/** O cache do processo. Os testes de ferramenta usam `limpar()`. */
export const cacheDeAparelhos: CacheDeAparelhos = criarCacheDeAparelhos();
