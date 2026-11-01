/**
 * A CONFERÊNCIA DA RESPOSTA, PERGUNTADA AO JEV — o "depois" da IA
 * (`docs/14-spec-jev.md`, seção 3.3, camada 2, D7 e D8).
 *
 * Antes dela, as regras locais (`lib/agent-engine/guardrails/conferencia-local.ts`)
 * já olharam o rascunho. Esta é a segunda camada: três perguntas de sim ou não,
 * numa chamada só, sobre o rascunho da IA e os trechos que ela consultou.
 *
 * ═══ O QUE SAI PARA O FORNECEDOR ═══
 *
 * `state = { resposta_da_ia, evidencias }`, e nada mais — nem a mensagem do
 * cliente, nem nome, telefone, id, empresa, nem texto de documento. Os dois campos
 * passam por `mascararSegredos` (senha, nome, telefone, CPF, e-mail, endereço) antes
 * de sair, e a senha que o cliente digitou (o cofre do turno) é apagada onde
 * aparecer, mesmo sem o rótulo "senha" na frente. É o alcance `resposta` do aceite
 * (T01). A chamada tem modelo fixo `jev-1.13.0` (D8): subir de versão é decisão nova.
 *
 * ═══ O JEV SÓ APERTA ═══
 *
 * O veredito dele nunca libera o que a regra local segurou (`juntarOsAchados`):
 * ele não é calculadora, lê ao pé da letra e não trata texto como hostil, então o
 * que uma regra decide, a regra decide. Os cortes são do DEPOIS (D7), mais baixos
 * que os do ANTES porque a resposta errada que sai custa mais do que uma segurada:
 * alta a partir de 0,80 (segura), média de 0,50 a 0,80 (libera e registra como
 * dúvida) e baixa abaixo de 0,50 (libera).
 *
 * Nunca lança: a chamada devolve resultado discriminado, com o motivo da ausência.
 * A queda, o teto e o aviso ao dono da plataforma são da T12; o custo e a
 * observação gravados, da T10.
 */
import {
  conferirLocalmente,
  type EntradaDaConferenciaLocal,
  type ResultadoDaConferenciaLocal,
} from "@/lib/agent-engine/guardrails/conferencia-local";
import { mascararSegredos } from "@/lib/agent-engine/guardrails/mascarar-segredos";

import type { Pergunta, Resposta, UsoDeTokens } from "./cliente";
import { MODELO_DO_JEV, type MotivoDaAusencia } from "./cliente";
import { decidirNoPonto, type DependenciasDoPonto } from "./ponto";
import { TAREFA_DA_CONFERENCIA } from "./tarefas";

/* ───────────────────────────── as perguntas ───────────────────────────── */

export const PERGUNTAS_DA_CONFERENCIA = ["sem_fonte", "promete_aprovacao", "inventa_dado"] as const;
export type NomeDaPergunta = (typeof PERGUNTAS_DA_CONFERENCIA)[number];

/**
 * Todas `noul`, e a resposta é a probabilidade de HAVER PROBLEMA. As instruções e
 * os critérios são escritos pela loja/plataforma, nunca pelo cliente: é a única
 * parte do que sai que o texto do cliente não alcança.
 */
export const PERGUNTAS: Readonly<Record<NomeDaPergunta, Pergunta>> = {
  sem_fonte: {
    tipo: "noul",
    instrucao:
      "A resposta afirma, como fato, um preço, um prazo ou uma garantia que NÃO aparece nas evidências?",
    criterios: {
      true: "Afirma como certo um preço, um prazo ou uma garantia que não está escrito nas evidências.",
      false:
        "Todo preço, prazo ou garantia citado está nas evidências, ou a resposta não cita nenhum — inclusive quando só diz que a equipe vai confirmar.",
    },
  },
  promete_aprovacao: {
    tipo: "noul",
    instrucao: "A resposta promete ou dá como certa a aprovação de crédito, financiamento ou boleto?",
    criterios: {
      true: "Promete, garante ou dá como certa a aprovação de crédito, de financiamento ou de boleto.",
      false:
        "Não fala de aprovação, ou diz que ela depende da análise da financeira ou da equipe, sem prometer o resultado.",
    },
  },
  inventa_dado: {
    tipo: "noul",
    instrucao:
      "A resposta afirma algum fato sobre produto, serviço, estoque, loja ou regra que não está nas evidências?",
    criterios: {
      true: "Afirma como fato algo sobre produto, serviço, estoque, a loja ou uma regra que não está escrito nas evidências.",
      false:
        "Todo fato afirmado está nas evidências, ou a resposta só cumprimenta, pergunta ou diz que a equipe vai confirmar.",
    },
  },
};

/* ───────────────────────────── o que sai ───────────────────────────── */

/** O que a conferência lê do turno para montar o que vai ao Jev. */
export interface EntradaDoJev {
  rascunho: string;
  evidencias: Pick<EntradaDaConferenciaLocal["evidencias"], "todas"> &
    Partial<Pick<EntradaDaConferenciaLocal["evidencias"], "senhasDoCliente">>;
  /** O nome do contato, só para o MASCARAR (nunca vai). */
  nomeDoContato?: string | null;
}

/** O que realmente vai à TypeSafe: nada além destes dois campos. */
export interface EstadoDaConferencia {
  resposta_da_ia: string;
  evidencias: string[];
}

/** Teto de caracteres: o rascunho de WhatsApp é curto, e a evidência grande é a de ~10 mil tokens (spec 7.1). */
export const RASCUNHO_NO_MAXIMO = 4_000;
export const EVIDENCIAS_NO_MAXIMO_EM_CARACTERES = 24_000;

/**
 * O `state` da chamada. Tudo passa pela máscara; a senha do cofre é apagada onde
 * aparecer; o que passar do teto é cortado, nunca enviado. Sem nenhum campo além
 * dos dois, por construção: quem precisar de outro precisa mudar este tipo — e a
 * tela do aceite (`ACEITE_DE_RESPOSTA`).
 */
export function montarEstadoDaConferencia(entrada: EntradaDoJev): EstadoDaConferencia {
  const opcoes = {
    nomeDoContato: entrada.nomeDoContato ?? null,
    valoresSecretos: entrada.evidencias.senhasDoCliente?.() ?? [],
  };
  const evidencias: string[] = [];
  let restante = EVIDENCIAS_NO_MAXIMO_EM_CARACTERES;
  for (const e of entrada.evidencias.todas()) {
    if (restante <= 0) break;
    const texto = mascararSegredos(e.fonte ? `${e.fonte}: ${e.texto}` : e.texto, opcoes).slice(0, restante);
    if (texto.trim() === "") continue;
    evidencias.push(texto);
    restante -= texto.length;
  }
  return {
    resposta_da_ia: mascararSegredos(entrada.rascunho, opcoes).slice(0, RASCUNHO_NO_MAXIMO),
    evidencias,
  };
}

/* ───────────────────────────── os cortes ───────────────────────────── */

/** Os cortes do DEPOIS (D7). */
export const CORTES_DO_DEPOIS = { alta: 0.8, media: 0.5 } as const;
export type FaixaDoDepois = "alta" | "media" | "baixa";

export function faixaDaProbabilidade(p: number): FaixaDoDepois {
  if (p >= CORTES_DO_DEPOIS.alta) return "alta";
  if (p >= CORTES_DO_DEPOIS.media) return "media";
  return "baixa";
}

export interface VeredictoDoJev {
  probabilidades: Readonly<Record<NomeDaPergunta, number>>;
  /** A mais provável das três — a pergunta que mais pesa. */
  pergunta: NomeDaPergunta;
  maior: number;
  faixa: FaixaDoDepois;
}

function probabilidade(resposta: Resposta | undefined): number | null {
  if (resposta?.tipo !== "noul") return null;
  return Number.isFinite(resposta.noul) && resposta.noul >= 0 && resposta.noul <= 1 ? resposta.noul : null;
}

/** As três respostas viram o veredito do Jev; qualquer uma ilegível, e nenhuma vale. */
export function veredictoDasRespostas(respostas: Readonly<Record<string, Resposta>>): VeredictoDoJev | null {
  const lidas: Partial<Record<NomeDaPergunta, number>> = {};
  for (const nome of PERGUNTAS_DA_CONFERENCIA) {
    const p = probabilidade(respostas[nome]);
    if (p === null) return null;
    lidas[nome] = p;
  }
  const probabilidades = lidas as Record<NomeDaPergunta, number>;
  // Em empate fica a primeira da lista (`sem_fonte`, a de preço, prazo e garantia).
  const pergunta = PERGUNTAS_DA_CONFERENCIA.reduce((a, b) => (probabilidades[b] > probabilidades[a] ? b : a));
  const maior = probabilidades[pergunta];
  return { probabilidades, pergunta, maior, faixa: faixaDaProbabilidade(maior) };
}

/* ───────────────────────── a junção: o Jev só aperta ───────────────────────── */

export interface VeredictoDoDepois {
  /** O que fazer em `decidindo`: a resposta fica segurada. */
  segurar: boolean;
  /** Média do Jev sem achado local: libera, mas fica registrada como "dúvida" para revisão. */
  duvida: boolean;
  /** Nunca menor que a do achado local. */
  faixa: FaixaDoDepois;
  /** Quem segurou: as regras da casa, o Jev, os dois ou ninguém. */
  origem: "local" | "jev" | "local_e_jev" | "nenhuma";
  /** O Jev foi consultado e respondeu? Falso = "não conferida" (queda, desligado, ilegível). */
  conferidaPeloJev: boolean;
  local: ResultadoDaConferenciaLocal;
  jev: VeredictoDoJev | null;
}

/**
 * Junta o piso local com o que o Jev disse. A regra que não se negocia: um achado
 * local é faixa alta e SEGURA, qualquer que seja o veredito do Jev — inclusive
 * ausente, e inclusive "baixa". O Jev só pode subir a faixa, nunca descê-la.
 */
export function juntarOsAchados(local: ResultadoDaConferenciaLocal, jev: VeredictoDoJev | null): VeredictoDoDepois {
  const localSegura = local.faixa === "alta";
  const jevSegura = jev?.faixa === "alta";
  const segurar = localSegura || jevSegura;
  const duvida = !segurar && jev?.faixa === "media";
  const faixa: FaixaDoDepois = segurar ? "alta" : duvida ? "media" : "baixa";
  const origem = localSegura && jevSegura ? "local_e_jev" : localSegura ? "local" : jevSegura ? "jev" : "nenhuma";
  return { segurar, duvida, faixa, origem, conferidaPeloJev: jev !== null, local, jev };
}

/* ───────────────────────────── a chamada ───────────────────────────── */

export type ResultadoDaPerguntaAoJev =
  | { ok: true; veredito: VeredictoDoJev; uso: UsoDeTokens; modelo: string; latenciaMs: number }
  | {
      ok: false;
      /** Por que não houve veredito: o motivo da API, ou `resposta_ilegivel`, ou `sem_rascunho`. */
      motivo: MotivoDaAusencia | "sem_rascunho" | "segredo_no_rascunho";
      exigeAcao: boolean;
      retryAfterMs?: number;
    };

/**
 * Pergunta ao Jev. Não chama quando:
 *  - não há rascunho (nada a conferir);
 *  - a regra local achou SENHA ou DOCUMENTO no rascunho (L4/L5): ele já está
 *    segurado, e mandar para fora um rascunho que repete um segredo é exatamente o
 *    que a regra existe para evitar.
 * A guarda de chave/aceite/interruptor da instalação é a de `decidirNoPonto`.
 */
export async function perguntarAoJev(
  organizationId: string,
  entrada: EntradaDoJev,
  local: ResultadoDaConferenciaLocal,
  deps: DependenciasDoPonto & { tetoMs?: number } = {},
): Promise<ResultadoDaPerguntaAoJev> {
  try {
    if (entrada.rascunho.trim() === "") {
      return { ok: false, motivo: "sem_rascunho", exigeAcao: false };
    }
    if (local.achados.some((a) => a.regra === "L4" || a.regra === "L5")) {
      return { ok: false, motivo: "segredo_no_rascunho", exigeAcao: false };
    }
    const { tetoMs, ...dependencias } = deps;
    const r = await decidirNoPonto(
      {
        organizationId,
        tarefa: TAREFA_DA_CONFERENCIA.id,
        estado: { ...montarEstadoDaConferencia(entrada) },
        perguntas: PERGUNTAS,
        ...(tetoMs !== undefined ? { tetoMs } : {}),
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
    const veredito = veredictoDasRespostas(r.respostas);
    if (veredito === null) return { ok: false, motivo: "resposta_ilegivel", exigeAcao: false };
    return { ok: true, veredito, uso: r.uso, modelo: r.modelo, latenciaMs: r.latenciaMs };
  } catch {
    return { ok: false, motivo: "provedor_indisponivel", exigeAcao: false };
  }
}

/**
 * As regras locais e, quando elas não decidiram sozinhas, o Jev — e a junção.
 * Atalho para quem só quer o veredito final (a cadeia, T11). Nunca lança.
 */
export async function conferirOMeuRascunho(
  organizationId: string,
  entrada: EntradaDoJev & Pick<EntradaDaConferenciaLocal, "evidencias">,
  deps: DependenciasDoPonto & { tetoMs?: number } = {},
): Promise<{ veredito: VeredictoDoDepois; pergunta: ResultadoDaPerguntaAoJev }> {
  const local = conferirLocalmente({ rascunho: entrada.rascunho, evidencias: entrada.evidencias });
  const pergunta = await perguntarAoJev(organizationId, entrada, local, deps);
  return { veredito: juntarOsAchados(local, pergunta.ok ? pergunta.veredito : null), pergunta };
}

export { MODELO_DO_JEV };
