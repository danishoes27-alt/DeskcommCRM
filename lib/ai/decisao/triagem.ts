/**
 * A TRIAGEM DO "ANTES" — o Jev lê a mensagem do cliente ANTES da IA
 * (`docs/14-spec-jev.md`, seção 3.2, D3, D4, D7 e o corte do `urgente`).
 *
 * Uma chamada, três perguntas sobre o texto que o cliente digitou:
 *
 *  - `categoria` (escolha): a lista da empresa (`./categorias.ts`; `outro` por último);
 *  - `destino` (escolha): `atender`, `pedir_dado` ou `equipe`, nesta ordem;
 *  - `urgente` (sim/não): tom de pressa ou insatisfação forte.
 *
 * ═══ O QUE SAI PARA O FORNECEDOR ═══
 *
 * `state` = SÓ o texto que o cliente digitou, passado por `mascararSegredos` e cortado em
 * 2.000 caracteres. Nem nome, nem telefone, nem id, nem empresa, nem transcrição de áudio,
 * nem descrição de foto, nem texto de documento: quem chama passa só o que a pessoa digitou
 * (`textoDigitadoDaMensagem`). Alcance `mensagem` do aceite. Modelo fixo `jev-1.13.0`.
 *
 * ═══ OS CORTES (D7) ═══
 *
 * Usa o piso do código de hoje (probabilidade ≥ 0,70 e confiança ≥ 0,60) e acrescenta a faixa
 * alta (≥ 0,80 e ≥ 0,70). Alta age; média só REGISTRA; baixa é ignorada. `urgente` marca o
 * cartão a partir de 0,80 e NUNCA muda o destino. Dúvida do Jev vai para a IA principal, nunca
 * direto para o humano: a única exceção é a certeza ALTA de `equipe`, e mesmo assim só abre um
 * aviso na Central (T20) — não abre caso e não passa a conversa (D5).
 *
 * O Jev tende à primeira opção quando está em dúvida: por isso `outro` é o último da categoria
 * e `atender` (o que não muda nada) é o primeiro do destino. A ordem entra no teste.
 *
 * `pedir_dado` só vale na PRIMEIRA mensagem da conversa (D4): o Jev vê uma mensagem sozinha e
 * não sabe o que o cliente já contou antes. Fora dela é ignorado.
 *
 * Nunca lança: devolve resultado discriminado com o motivo da ausência.
 */
import { mascararSegredos } from "@/lib/agent-engine/guardrails/mascarar-segredos";

import { criteriosDaCategoria, type CategoriaDaTriagem } from "./categorias";
import type { Pergunta, Resposta, UsoDeTokens } from "./cliente";
import { MODELO_DO_JEV, type MotivoDaAusencia } from "./cliente";
import { decidirNoPonto, type DependenciasDoPonto } from "./ponto";
import { TAREFA_DA_TRIAGEM } from "./tarefas";

export const DESTINOS = ["atender", "pedir_dado", "equipe"] as const;
export type Destino = (typeof DESTINOS)[number];

export const CARACTERES_NO_MAXIMO = 2_000;

/** Os cortes do ANTES (D7) e o do `urgente`. */
export const CORTES_DO_ANTES = {
  piso: { probabilidade: 0.7, confianca: 0.6 },
  alta: { probabilidade: 0.8, confianca: 0.7 },
  urgente: 0.8,
} as const;

export type FaixaDoAntes = "alta" | "media" | "baixa";

export function faixaDoAntes(probabilidade: number, confianca: number): FaixaDoAntes {
  const { alta, piso } = CORTES_DO_ANTES;
  if (probabilidade >= alta.probabilidade && confianca >= alta.confianca) return "alta";
  if (probabilidade >= piso.probabilidade && confianca >= piso.confianca) return "media";
  return "baixa";
}

const CRITERIOS_DO_DESTINO: Readonly<Record<Destino, string>> = {
  atender: "A IA pode responder agora: pergunta, pedido ou conversa comum de atendimento.",
  pedir_dado:
    "Falta um dado básico para atender (qual aparelho, qual serviço, qual produto): a IA deve pedir isso primeiro.",
  equipe: "Precisa de uma pessoa da equipe: reclamação grave, negociação especial ou algo que a IA não deve decidir.",
};

/** As três perguntas. As opções saem em ordem fixa — a ordem é informação (o Jev tende à primeira). */
export function perguntasDaTriagem(categorias: readonly CategoriaDaTriagem[]): Readonly<Record<string, Pergunta>> {
  return {
    categoria: {
      tipo: "choice",
      instrucao: "Qual é o assunto principal desta mensagem do cliente?",
      criterios: criteriosDaCategoria(categorias),
    },
    destino: {
      tipo: "choice",
      instrucao: "O que fazer com esta mensagem do cliente?",
      criterios: { ...CRITERIOS_DO_DESTINO },
    },
    urgente: {
      tipo: "noul",
      instrucao: "A mensagem do cliente mostra pressa ou insatisfação forte?",
      criterios: {
        true: "Demonstra pressa, frustração ou reclamação forte.",
        false: "Tom normal, sem sinal de pressa ou insatisfação.",
      },
    },
  };
}

/**
 * O `state`: só o texto digitado, mascarado e cortado. Mascara PRIMEIRO e corta depois: cortar
 * antes poderia deixar a metade de uma senha ou de um telefone passar pela máscara.
 */
export function montarEstadoDaTriagem(texto: string, nomeDoContato?: string | null): string {
  return mascararSegredos(texto, { nomeDoContato: nomeDoContato ?? null }).slice(0, CARACTERES_NO_MAXIMO);
}

export interface EscolhaDoJev {
  id: string;
  probabilidade: number;
  confianca: number;
  faixa: FaixaDoAntes;
}

export interface VeredictoDaTriagem {
  categoria: EscolhaDoJev;
  destino: EscolhaDoJev & { id: Destino };
  /** O que o destino faz DE FATO: só a faixa alta age, e `pedir_dado` só na 1ª mensagem. */
  destinoEfetivo: Destino | null;
  /** `pedir_dado` com certeza que foi descartado por não ser a 1ª mensagem. */
  pedirDadoIgnorado: boolean;
  urgente: { probabilidade: number; marcar: boolean };
}

const ehDestino = (x: string): x is Destino => (DESTINOS as readonly string[]).includes(x);

function escolha(r: Resposta | undefined): { id: string; probabilidade: number; confianca: number } | null {
  if (r?.tipo !== "choice") return null;
  const confianca = r.confianca;
  const probabilidade = r.probabilidades[r.escolha];
  if (probabilidade === undefined || !Number.isFinite(probabilidade) || !Number.isFinite(confianca)) return null;
  if (probabilidade < 0 || probabilidade > 1 || confianca < 0 || confianca > 1) return null;
  return { id: r.escolha, probabilidade, confianca };
}

/** As três respostas viram o veredito; qualquer uma ilegível (ou fora das opções) derruba o veredito inteiro. */
export function veredictoDasRespostas(
  respostas: Readonly<Record<string, Resposta>>,
  categorias: readonly CategoriaDaTriagem[],
  primeiraMensagem: boolean,
): VeredictoDaTriagem | null {
  const c = escolha(respostas.categoria);
  const d = escolha(respostas.destino);
  const u = respostas.urgente;
  if (c === null || d === null || u?.tipo !== "noul") return null;
  if (!Number.isFinite(u.noul) || u.noul < 0 || u.noul > 1) return null;
  if (!categorias.some((x) => x.id === c.id) || !ehDestino(d.id)) return null;

  const faixaDoDestino = faixaDoAntes(d.probabilidade, d.confianca);
  const pedirDadoIgnorado = d.id === "pedir_dado" && faixaDoDestino === "alta" && !primeiraMensagem;
  return {
    categoria: { ...c, faixa: faixaDoAntes(c.probabilidade, c.confianca) },
    destino: { ...d, id: d.id, faixa: faixaDoDestino },
    destinoEfetivo: faixaDoDestino === "alta" && !pedirDadoIgnorado ? d.id : null,
    pedirDadoIgnorado,
    urgente: { probabilidade: u.noul, marcar: u.noul >= CORTES_DO_ANTES.urgente },
  };
}

export interface EntradaDaTriagem {
  /** SÓ o que o cliente digitou. */
  texto: string;
  nomeDoContato?: string | null;
  /** Não há mensagem anterior do cliente nesta conversa (D4). */
  primeiraMensagem: boolean;
  categorias: readonly CategoriaDaTriagem[];
}

export type ResultadoDaTriagem =
  | { ok: true; veredito: VeredictoDaTriagem; uso: UsoDeTokens; modelo: string; latenciaMs: number }
  | { ok: false; motivo: MotivoDaAusencia | "sem_texto"; exigeAcao: boolean; retryAfterMs?: number };

/**
 * Pergunta ao Jev. Não chama sem texto digitado. A guarda de chave/aceite/interruptor da
 * instalação é a de `decidirNoPonto` (a tarefa é `triagem`; o interruptor é
 * `JEV_TRIAGEM_DO_SISTEMA_ENABLED`).
 */
export async function perguntarATriagem(
  organizationId: string,
  entrada: EntradaDaTriagem,
  deps: DependenciasDoPonto & { tetoMs?: number } = {},
): Promise<ResultadoDaTriagem> {
  try {
    if (entrada.texto.trim() === "") return { ok: false, motivo: "sem_texto", exigeAcao: false };
    const { tetoMs, ...dependencias } = deps;
    const r = await decidirNoPonto(
      {
        organizationId,
        tarefa: TAREFA_DA_TRIAGEM.id,
        estado: montarEstadoDaTriagem(entrada.texto, entrada.nomeDoContato),
        perguntas: perguntasDaTriagem(entrada.categorias),
        tetoMs,
      },
      dependencias,
    );
    if (!r.ok) {
      return {
        ok: false,
        motivo: r.motivo,
        exigeAcao: r.exigeAcao,
        ...(r.retryAfterMs !== undefined ? { retryAfterMs: r.retryAfterMs } : {}),
      };
    }
    const veredito = veredictoDasRespostas(r.respostas, entrada.categorias, entrada.primeiraMensagem);
    if (veredito === null) return { ok: false, motivo: "resposta_ilegivel", exigeAcao: false };
    return { ok: true, veredito, uso: r.uso, modelo: r.modelo, latenciaMs: r.latenciaMs };
  } catch {
    return { ok: false, motivo: "provedor_indisponivel", exigeAcao: false };
  }
}

export { MODELO_DO_JEV };
