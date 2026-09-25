/**
 * Jev (TypeSafe) como TRIAGEM RÁPIDA de mensagem recebida — módulo puro.
 *
 * O Jev NÃO escreve texto. Ele só responde duas perguntas de formato fixo sobre a
 * mensagem (qual a categoria? tem urgência?) e este módulo transforma a resposta
 * numa decisão. Nada aqui fala com o cliente, com o banco ou com o canal.
 *
 * ─── Regras que não se negociam (docs/03-engenharia.md, docs/06-juridico...) ───
 *
 * 1. LGPD — TODA chamada leva `zeroDataRetention: true`. Existe UM ÚNICO ponto que
 *    chama o modelo (`chamarJev`) e ele monta as opções a partir da constante
 *    `OPCOES_DO_PROVEDOR_JEV`. `lib/ai/triagem/jev.test.ts` reprova se qualquer
 *    outro arquivo de código chamar `experimental_evaluate`, e se a chamada sair
 *    sem a opção.
 * 2. Minimização — o `state` é SÓ o texto da mensagem. Nem telefone, nem nome, nem
 *    organização, nem id.
 * 3. Limiar — probabilidade da opção escolhida >= 0.7 E confiança >= 0.6. Abaixo
 *    disso o Jev nunca decide sozinho.
 * 4. Falha ABERTA — qualquer erro vira `llm_principal_decide` com um CÓDIGO de
 *    motivo e o atendimento segue. Esta função nunca lança e nunca registra o texto
 *    da mensagem (nem a mensagem de erro do provedor, que pode ecoá-lo).
 * 5. Timeout curto — para não atrasar o atendimento.
 *
 * ⛔ TRAVA (Berg, 24/09/2026): a conta Vercel é Hobby e ZDR por chamada só vale no
 * Pro. Enquanto for Hobby, o Jev só pode ver dado de TESTE. Quem liga isto em
 * produção é a chave `JEV_TRIAGEM_ENABLED` (desligada por padrão) — ver `aplicar.ts`.
 */
import { experimental_evaluate as evaluate, type Experimental_EvaluationModel } from 'ai';

export type CategoriaAtendimento = 'conserto' | 'financeiro' | 'venda' | 'outro';

export const CATEGORIAS_DE_ATENDIMENTO: readonly CategoriaAtendimento[] = [
  'conserto',
  'financeiro',
  'venda',
  'outro',
];

export type DecisaoDaTriagem =
  | { acao: 'rotear'; categoria: CategoriaAtendimento; urgente: boolean }
  | { acao: 'revisao_humana' | 'llm_principal_decide'; motivo: MotivoDaTriagem };

/** Códigos fixos — NUNCA texto livre, para nada da mensagem do cliente vazar para log. */
export type MotivoDaTriagem =
  | 'sem_texto'
  | 'baixa_confianca'
  | 'baixa_probabilidade'
  | 'formato_inesperado'
  | 'sem_confianca'
  | 'sem_provedor_zdr'
  | 'timeout'
  | 'erro_de_rede'
  | 'erro_http_4xx'
  | 'erro_http_5xx'
  | 'erro_do_modelo';

export const JEV_MODEL_ID = 'typesafe-ai/jev';
export const LIMIAR_PROBABILIDADE = 0.7;
export const LIMIAR_CONFIANCA = 0.6;
export const LIMIAR_URGENCIA = 0.7;
export const JEV_TIMEOUT_MS = 3000;
/** Teto de caracteres enviados: menos dado para fora, menos custo. */
export const JEV_MAX_CHARS_DO_TEXTO = 2000;

/**
 * LGPD (docs/06): a ÚNICA fonte das opções do provedor. Congelada para ninguém
 * "consertar" um caso sem perceber que está tirando a garantia.
 */
export const OPCOES_DO_PROVEDOR_JEV = Object.freeze({
  gateway: Object.freeze({ zeroDataRetention: true }),
});

const PERGUNTAS = {
  categoria: {
    type: 'choice',
    instructions: 'Qual a intenção principal dessa mensagem do cliente?',
    criteria: {
      conserto: 'Orçamento, status de reparo, agendar entrega de aparelho',
      financeiro: '2ª via de boleto, dúvida de pagamento, parcelamento',
      venda: 'Quer comprar aparelho/acessório, pergunta sobre produto/preço/estoque',
      outro: 'Não se encaixa nas anteriores',
    },
  },
  urgente: {
    type: 'boolean',
    instructions: 'Essa mensagem expressa urgência ou insatisfação forte?',
    criteria: {
      true: 'Cliente demonstra pressa, frustração ou reclamação forte',
      false: 'Tom normal, sem sinal de urgência',
    },
  },
} as const;

export interface OpcoesDaTriagem {
  /** Só para teste (mock). Produção usa o default. */
  model?: Experimental_EvaluationModel;
  /** Só para teste. */
  timeoutMs?: number;
}

interface ErroComoLido {
  name?: unknown;
  statusCode?: unknown;
  status?: unknown;
  message?: unknown;
  responseBody?: unknown;
  lastError?: unknown;
  cause?: unknown;
}

/** Percorre o erro e suas causas (com teto) — só para CLASSIFICAR, nunca para registrar. */
function cadeiaDoErro(err: unknown): ErroComoLido[] {
  const cadeia: ErroComoLido[] = [];
  let atual: unknown = err;
  for (let i = 0; i < 4 && atual !== null && typeof atual === 'object'; i++) {
    const e = atual as ErroComoLido;
    cadeia.push(e);
    // RetryError embrulha o erro real em `lastError`.
    atual = e.lastError !== undefined ? e.lastError : e.cause;
  }
  return cadeia;
}

/**
 * Erro -> CÓDIGO seguro. Nunca devolve (nem deixa vazar) `error.message`: a mensagem
 * de um provedor pode ecoar o conteúdo enviado.
 */
export function motivoDoErro(err: unknown): MotivoDaTriagem {
  const cadeia = cadeiaDoErro(err);
  if (cadeia.length === 0) return 'erro_do_modelo';

  if (cadeia.some((e) => e.name === 'TimeoutError' || e.name === 'AbortError' || e.name === 'JevTimeout')) {
    return 'timeout';
  }
  // O Gateway responde 400 `no_providers_available` quando nenhum provedor atende
  // a exigência de ZDR — o caso da conta Hobby. Não pode virar erro genérico.
  const textos = cadeia.flatMap((e) => [e.message, e.responseBody]).filter((t) => typeof t === 'string');
  if (textos.some((t) => (t as string).includes('no_providers_available'))) return 'sem_provedor_zdr';
  // A SDK valida a resposta do modelo e lança este erro quando o formato não fecha.
  if (cadeia.some((e) => typeof e.name === 'string' && e.name.includes('InvalidResponseData'))) {
    return 'formato_inesperado';
  }
  for (const e of cadeia) {
    const status =
      typeof e.statusCode === 'number' ? e.statusCode : typeof e.status === 'number' ? e.status : null;
    if (status !== null && status >= 500) return 'erro_http_5xx';
    if (status !== null && status >= 400) return 'erro_http_4xx';
  }
  if (textos.some((t) => /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|network/i.test(t as string))) {
    return 'erro_de_rede';
  }
  return 'erro_do_modelo';
}

/**
 * O ÚNICO lugar do código que chama o Jev. Sempre com ZDR, sem retentativa
 * (o timeout é curto e o atendimento não espera), e com um teto de tempo que vale
 * mesmo se o modelo ignorar o sinal de cancelamento.
 */
async function chamarJev(texto: string, opcoes: OpcoesDaTriagem) {
  const timeoutMs = opcoes.timeoutMs ?? JEV_TIMEOUT_MS;
  const controle = new AbortController();
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<never>((_, rejeita) => {
    relogio = setTimeout(() => {
      controle.abort();
      const erro = new Error('jev_timeout');
      erro.name = 'JevTimeout';
      rejeita(erro);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      evaluate({
        model: opcoes.model ?? JEV_MODEL_ID,
        state: texto, // SÓ o texto — minimização de dado
        questions: PERGUNTAS,
        providerOptions: OPCOES_DO_PROVEDOR_JEV,
        maxRetries: 0,
        abortSignal: controle.signal,
      }),
      estouro,
    ]);
  } finally {
    if (relogio !== undefined) clearTimeout(relogio);
  }
}

function numeroEntre0e1(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

/**
 * Classifica a mensagem. NUNCA lança.
 *
 * `rotear` só sai quando as DUAS condições do limiar passam; o resto nunca decide.
 */
export async function triarMensagem(
  textoDaMensagem: string,
  opcoes: OpcoesDaTriagem = {},
): Promise<DecisaoDaTriagem> {
  try {
    const texto = (textoDaMensagem ?? '').trim().slice(0, JEV_MAX_CHARS_DO_TEXTO);
    if (texto === '') return { acao: 'llm_principal_decide', motivo: 'sem_texto' };

    const resultado = await chamarJev(texto, opcoes);

    const categoria = resultado.answers?.categoria;
    const urgente = resultado.answers?.urgente;
    if (
      categoria?.type !== 'choice' ||
      urgente?.type !== 'boolean' ||
      !(CATEGORIAS_DE_ATENDIMENTO as readonly string[]).includes(categoria.choice)
    ) {
      return { acao: 'llm_principal_decide', motivo: 'formato_inesperado' };
    }

    // `confidence` vem em providerMetadata.typesafe.confidence, por pergunta.
    const meta = resultado.providerMetadata?.typesafe as { confidence?: unknown } | undefined;
    const confiancas =
      meta?.confidence !== null && typeof meta?.confidence === 'object'
        ? (meta.confidence as Record<string, unknown>)
        : undefined;
    const confianca = numeroEntre0e1(confiancas?.categoria);
    const probabilidade = numeroEntre0e1(categoria.probabilities?.[categoria.choice]);

    // Sem número não há como conferir o limiar — o Jev não decide, e NÃO se
    // finge que veio baixo: é um formato que não conhecemos.
    if (confianca === null) return { acao: 'llm_principal_decide', motivo: 'sem_confianca' };
    if (probabilidade === null) return { acao: 'llm_principal_decide', motivo: 'formato_inesperado' };

    if (confianca < LIMIAR_CONFIANCA) return { acao: 'revisao_humana', motivo: 'baixa_confianca' };
    if (probabilidade < LIMIAR_PROBABILIDADE) {
      return { acao: 'revisao_humana', motivo: 'baixa_probabilidade' };
    }

    return {
      acao: 'rotear',
      categoria: categoria.choice as CategoriaAtendimento,
      urgente: numeroEntre0e1(urgente.probability) !== null && urgente.probability >= LIMIAR_URGENCIA,
    };
  } catch (err) {
    return { acao: 'llm_principal_decide', motivo: motivoDoErro(err) };
  }
}
