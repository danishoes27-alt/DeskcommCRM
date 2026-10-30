/**
 * Triagem do Jev — regras de decisão, LGPD (ZDR em toda chamada), minimização de
 * dado e falha aberta. NENHUM teste chama o Jev de verdade: só o modelo de mentira
 * `Experimental_EvaluationMockModelV4`, da própria SDK.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { Experimental_EvaluationMockModelV4 as MockJev } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  JEV_MAX_CHARS_DO_TEXTO,
  JEV_MODEL_ID,
  OPCOES_DO_PROVEDOR_JEV,
  motivoDoErro,
  triarMensagem,
} from './jev';

type Chamada = Parameters<MockJev['doEvaluate']>[0];

/**
 * REDE DE SEGURANÇA — nenhum teste deste arquivo pode chegar no Jev de verdade.
 *
 * O setup de testes carrega o `.env.local` para o `process.env` (tests/setup/
 * vitest.setup.ts), e o `.env.local` desta máquina tem a chave real do AI Gateway.
 * Um `triarMensagem('x')` sem o modelo de mentira usaria o Gateway PADRÃO da SDK e
 * gastaria uma chamada real. Aqui o provedor padrão da SDK é trocado por um que
 * explode, e a chave é zerada: esquecer o mock passa a falhar o teste em vez de
 * chamar a rede.
 */
type ProvedorPadrao = { evaluationModel: (id: string) => never };
const globalDaSdk = globalThis as unknown as { AI_SDK_DEFAULT_PROVIDER?: ProvedorPadrao };
const provedorPadraoAntes = globalDaSdk.AI_SDK_DEFAULT_PROVIDER;
beforeAll(() => {
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
  globalDaSdk.AI_SDK_DEFAULT_PROVIDER = {
    evaluationModel: () => {
      throw new Error('TESTE TENTOU CHAMAR O JEV DE VERDADE — passe sempre o modelo de mentira');
    },
  };
});
afterAll(() => {
  vi.unstubAllEnvs();
  globalDaSdk.AI_SDK_DEFAULT_PROVIDER = provedorPadraoAntes;
});

interface Cenario {
  probsCategoria?: Record<string, number>;
  escolha?: string;
  confianca?: number | null;
  urgencia?: number;
}

/** Resposta válida do Jev, ajustável por cenário. */
function resposta(c: Cenario = {}) {
  const probs = c.probsCategoria ?? { conserto: 0.91, financeiro: 0.05, venda: 0.03, outro: 0.01 };
  return {
    answers: {
      categoria: { type: 'choice' as const, choice: c.escolha ?? 'conserto', probabilities: probs },
      urgente: { type: 'boolean' as const, probability: c.urgencia ?? 0.2 },
    },
    warnings: [],
    providerMetadata:
      c.confianca === null
        ? undefined
        : { typesafe: { confidence: { categoria: c.confianca ?? 0.85 } } },
  };
}

/** Mock que devolve `c` e guarda todas as chamadas recebidas. */
function jevQue(c: Cenario = {}) {
  const chamadas: Chamada[] = [];
  const model = new MockJev({
    doEvaluate: async (opcoes) => {
      chamadas.push(opcoes);
      return resposta(c);
    },
  });
  return { model, chamadas };
}

describe('triarMensagem — decisão', () => {
  it('categoria clara + confiança alta => rotear', async () => {
    const { model } = jevQue();
    await expect(triarMensagem('meu celular caiu e a tela quebrou', { model })).resolves.toEqual({
      acao: 'rotear',
      categoria: 'conserto',
      urgente: false,
    });
  });

  it('rotear devolve a categoria que o Jev escolheu', async () => {
    const { model } = jevQue({
      escolha: 'financeiro',
      probsCategoria: { conserto: 0.02, financeiro: 0.95, venda: 0.02, outro: 0.01 },
    });
    const d = await triarMensagem('preciso da segunda via do boleto', { model });
    expect(d).toMatchObject({ acao: 'rotear', categoria: 'financeiro' });
  });

  it('confiança baixa => a IA principal decide (não vai direto ao humano), mesmo com probabilidade alta', async () => {
    const { model } = jevQue({ confianca: 0.4 });
    await expect(triarMensagem('oi', { model })).resolves.toEqual({
      acao: 'llm_principal_decide',
      motivo: 'baixa_confianca',
    });
  });

  it('probabilidade da opção escolhida baixa => a IA principal decide, mesmo com confiança alta', async () => {
    const { model } = jevQue({
      probsCategoria: { conserto: 0.5, financeiro: 0.3, venda: 0.15, outro: 0.05 },
      confianca: 0.95,
    });
    await expect(triarMensagem('depende', { model })).resolves.toEqual({
      acao: 'llm_principal_decide',
      motivo: 'baixa_probabilidade',
    });
  });

  it('REGRA DO DONO DO PRODUTO: o Jev nunca manda direto para o humano — só decide ou passa para a IA principal', async () => {
    const cenarios = [
      jevQue({ confianca: 0.1 }),
      jevQue({ confianca: 0.59 }),
      jevQue({ probsCategoria: { conserto: 0.4, financeiro: 0.3, venda: 0.2, outro: 0.1 }, confianca: 0.99 }),
      jevQue({}),
    ];
    for (const { model } of cenarios) {
      const d = await triarMensagem('qualquer mensagem', { model });
      expect(['rotear', 'llm_principal_decide']).toContain(d.acao);
    }
    // Inclui os caminhos de erro e de texto vazio.
    expect((await triarMensagem('   ', { model: jevQue().model })).acao).toBe('llm_principal_decide');
  });

  it('os limiares são "maior OU IGUAL": 0.7 de probabilidade e 0.6 de confiança passam', async () => {
    const { model } = jevQue({
      probsCategoria: { conserto: 0.7, financeiro: 0.1, venda: 0.1, outro: 0.1 },
      confianca: 0.6,
    });
    await expect(triarMensagem('x', { model })).resolves.toMatchObject({ acao: 'rotear' });
  });

  it('logo abaixo dos limiares não passa (0.69 e 0.59)', async () => {
    const abaixoProb = jevQue({
      probsCategoria: { conserto: 0.69, financeiro: 0.11, venda: 0.1, outro: 0.1 },
    });
    await expect(triarMensagem('x', { model: abaixoProb.model })).resolves.toMatchObject({
      acao: 'llm_principal_decide',
    });
    const abaixoConf = jevQue({ confianca: 0.59 });
    await expect(triarMensagem('x', { model: abaixoConf.model })).resolves.toMatchObject({
      acao: 'llm_principal_decide',
    });
  });

  it('urgência alta => urgente: true; baixa => false; no limite 0.7 => true', async () => {
    for (const [p, esperado] of [
      [0.95, true],
      [0.7, true],
      [0.69, false],
      [0.1, false],
    ] as const) {
      const { model } = jevQue({ urgencia: p });
      await expect(triarMensagem('x', { model })).resolves.toMatchObject({
        acao: 'rotear',
        urgente: esperado,
      });
    }
  });

  it('sem `confidence` no metadado => o Jev não decide (LLM principal), sem fingir número', async () => {
    const { model } = jevQue({ confianca: null });
    await expect(triarMensagem('x', { model })).resolves.toEqual({
      acao: 'llm_principal_decide',
      motivo: 'sem_confianca',
    });
  });

  it('texto vazio ou só espaço => nem chama o Jev', async () => {
    const { model, chamadas } = jevQue();
    await expect(triarMensagem('   ', { model })).resolves.toEqual({
      acao: 'llm_principal_decide',
      motivo: 'sem_texto',
    });
    expect(chamadas).toHaveLength(0);
  });
});

describe('triarMensagem — formato inesperado e falha aberta', () => {
  it('resposta com tipo errado => llm_principal_decide (a SDK recusa e nada é lançado)', async () => {
    const model = new MockJev({
      doEvaluate: async () => ({
        answers: {
          categoria: { type: 'boolean', probability: 0.9 },
          urgente: { type: 'boolean', probability: 0.1 },
        },
        warnings: [],
      }),
    });
    await expect(triarMensagem('x', { model })).resolves.toEqual({
      acao: 'llm_principal_decide',
      motivo: 'formato_inesperado',
    });
  });

  it('opção que não existe nas categorias => llm_principal_decide', async () => {
    const model = new MockJev({
      doEvaluate: async () => ({
        answers: {
          categoria: { type: 'choice', choice: 'garantia' },
          urgente: { type: 'boolean', probability: 0.1 },
        },
        warnings: [],
      }),
    });
    await expect(triarMensagem('x', { model })).resolves.toMatchObject({
      acao: 'llm_principal_decide',
    });
  });

  it('choice sem `probabilities` => não decide (não dá para conferir o limiar)', async () => {
    const model = new MockJev({
      doEvaluate: async () => ({
        answers: {
          categoria: { type: 'choice', choice: 'venda' },
          urgente: { type: 'boolean', probability: 0.1 },
        },
        warnings: [],
        providerMetadata: { typesafe: { confidence: { categoria: 0.9 } } },
      }),
    });
    await expect(triarMensagem('x', { model })).resolves.toEqual({
      acao: 'llm_principal_decide',
      motivo: 'formato_inesperado',
    });
  });

  it('erro do modelo => llm_principal_decide, sem exceção e sem repetir a chamada', async () => {
    const chamadas = vi.fn();
    const model = new MockJev({
      doEvaluate: async () => {
        chamadas();
        throw new Error('quebrou com o texto SEGREDO-DO-CLIENTE dentro');
      },
    });
    const d = await triarMensagem('SEGREDO-DO-CLIENTE', { model });
    expect(d).toEqual({ acao: 'llm_principal_decide', motivo: 'erro_do_modelo' });
    // nem o motivo nem nada devolvido carrega o texto do cliente nem a mensagem do erro
    expect(JSON.stringify(d)).not.toContain('SEGREDO');
    // maxRetries: 0 — o atendimento não espera por repetição
    expect(chamadas).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['gateway 400 no_providers_available', { statusCode: 400, message: 'no_providers_available' }, 'sem_provedor_zdr'],
    [
      'no_providers_available só no corpo da resposta',
      { name: 'AI_APICallError', statusCode: 400, message: 'Bad Request', responseBody: '{"error":{"type":"no_providers_available"}}' },
      'sem_provedor_zdr',
    ],
    [
      'no_providers_available dentro da causa',
      { message: 'Gateway request failed', cause: { statusCode: 400, message: 'no_providers_available' } },
      'sem_provedor_zdr',
    ],
    ['http 500', { statusCode: 500, message: 'oops' }, 'erro_http_5xx'],
    ['http 503', { statusCode: 503, message: 'oops' }, 'erro_http_5xx'],
    ['http 401', { statusCode: 401, message: 'oops' }, 'erro_http_4xx'],
    ['http 429', { statusCode: 429, message: 'oops' }, 'erro_http_4xx'],
    ['rede', new TypeError('fetch failed'), 'erro_de_rede'],
    ['abortado', Object.assign(new Error('x'), { name: 'AbortError' }), 'timeout'],
    ['RetryError embrulhando 5xx', { name: 'AI_RetryError', message: 'r', lastError: { statusCode: 502, message: 'bad gw' } }, 'erro_http_5xx'],
  ])('%s => llm_principal_decide (%s)', async (_nome, erro, motivo) => {
    const model = new MockJev({
      doEvaluate: async () => {
        throw erro;
      },
    });
    await expect(triarMensagem('x', { model })).resolves.toEqual({
      acao: 'llm_principal_decide',
      motivo,
    });
  });

  it('nunca lança, seja qual for a coisa lançada pelo modelo', async () => {
    for (const lancado of ['texto solto', null, undefined, 42, { any: 'thing' }]) {
      const model = new MockJev({
        doEvaluate: async () => {
          throw lancado;
        },
      });
      await expect(triarMensagem('x', { model })).resolves.toMatchObject({
        acao: 'llm_principal_decide',
      });
    }
  });

  it('timeout curto: modelo que trava não segura o atendimento', async () => {
    const model = new MockJev({ doEvaluate: () => new Promise(() => {}) }); // nunca responde
    const inicio = Date.now();
    const d = await triarMensagem('x', { model, timeoutMs: 30 });
    expect(d).toEqual({ acao: 'llm_principal_decide', motivo: 'timeout' });
    expect(Date.now() - inicio).toBeLessThan(1000);
  });

  it('o sinal de cancelamento chega ao modelo (a chamada real é cortada, não só ignorada)', async () => {
    let sinal: AbortSignal | undefined;
    const model = new MockJev({
      doEvaluate: (o) => {
        sinal = o.abortSignal;
        return new Promise(() => {});
      },
    });
    await triarMensagem('x', { model, timeoutMs: 20 });
    expect(sinal?.aborted).toBe(true);
  });

  it('motivoDoErro não aceita nada fora do vocabulário de códigos', () => {
    expect(motivoDoErro(undefined)).toBe('erro_do_modelo');
    expect(motivoDoErro('SEGREDO')).toBe('erro_do_modelo');
  });
});

describe('triarMensagem — LGPD: ZDR e minimização de dado', () => {
  it('a constante de opções tem ZDR ligado e está congelada', () => {
    expect(OPCOES_DO_PROVEDOR_JEV).toEqual({ gateway: { zeroDataRetention: true } });
    expect(Object.isFrozen(OPCOES_DO_PROVEDOR_JEV)).toBe(true);
    expect(Object.isFrozen(OPCOES_DO_PROVEDOR_JEV.gateway)).toBe(true);
  });

  it('TODA chamada leva providerOptions.gateway.zeroDataRetention = true (sucesso, baixa confiança e erro)', async () => {
    const vistas: Chamada[] = [];
    const cenarios: Array<() => ReturnType<MockJev['doEvaluate']>> = [
      async () => resposta(), // rotear
      async () => resposta({ confianca: 0.1 }), // baixa confiança: a IA principal decide
      async () => resposta({ confianca: null }), // sem confiança
      async () => {
        throw new Error('rede caiu'); // erro
      },
    ];
    for (const cenario of cenarios) {
      const model = new MockJev({
        doEvaluate: async (o) => {
          vistas.push(o);
          return cenario();
        },
      });
      await triarMensagem('quero um orçamento', { model });
    }
    expect(vistas).toHaveLength(cenarios.length);
    for (const v of vistas) {
      expect(v.providerOptions).toEqual({ gateway: { zeroDataRetention: true } });
    }
  });

  it('SE alguém chamar o Jev sem a opção, este teste falha: nenhuma chamada sai sem ZDR', async () => {
    // Este é o "detector": o mock recusa qualquer chamada sem ZDR. Se uma mudança
    // futura tirar a opção, `triarMensagem` cai na falha aberta e o `expect` abaixo
    // (que exige um rotear) reprova.
    const model = new MockJev({
      doEvaluate: async (o) => {
        const gw = (o.providerOptions as { gateway?: { zeroDataRetention?: unknown } } | undefined)?.gateway;
        if (gw?.zeroDataRetention !== true) throw new Error('CHAMADA SEM ZDR');
        return resposta();
      },
    });
    await expect(triarMensagem('quero comprar um carregador', { model })).resolves.toMatchObject({
      acao: 'rotear',
    });
  });

  it('a rede de segurança funciona: sem o mock a chamada bate na armadilha, não na rede', async () => {
    // Se este teste passar a devolver outra coisa, a armadilha do topo do arquivo
    // foi desmontada e um teste esquecido do mock voltaria a poder gastar chamada real.
    await expect(triarMensagem('quero um orçamento')).resolves.toEqual({
      acao: 'llm_principal_decide',
      motivo: 'erro_do_modelo',
    });
  });

  it('o modelo padrão é o Jev via AI Gateway', () => {
    expect(JEV_MODEL_ID).toBe('typesafe-ai/jev');
  });

  it('o state é SÓ o texto da mensagem — nada de telefone, nome, organização ou id', async () => {
    const { model, chamadas } = jevQue();
    const texto = 'meu celular caiu e a tela quebrou';
    await triarMensagem(texto, { model });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.state).toBe(texto);
    expect(typeof chamadas[0]!.state).toBe('string');
  });

  it('só as duas perguntas conhecidas viajam (categoria e urgente)', async () => {
    const { model, chamadas } = jevQue();
    await triarMensagem('x', { model });
    expect(Object.keys(chamadas[0]!.questions).sort()).toEqual(['categoria', 'urgente']);
  });

  it('texto enorme é cortado antes de sair (menos dado para fora)', async () => {
    const { model, chamadas } = jevQue();
    await triarMensagem('a'.repeat(JEV_MAX_CHARS_DO_TEXTO * 3), { model });
    expect((chamadas[0]!.state as string).length).toBe(JEV_MAX_CHARS_DO_TEXTO);
  });

  it('não escreve nada em console (nunca loga o texto da mensagem)', async () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((n) =>
      vi.spyOn(console, n).mockImplementation(() => {}),
    );
    const falho = new MockJev({
      doEvaluate: async () => {
        throw new Error('boom');
      },
    });
    await triarMensagem('TEXTO-SECRETO', { model: falho });
    await triarMensagem('TEXTO-SECRETO', { model: jevQue().model });
    for (const e of espioes) {
      expect(e).not.toHaveBeenCalled();
      e.mockRestore();
    }
  });
});

describe('ponto único de chamada', () => {
  // Se um segundo arquivo falar com o Jev por conta própria, ele pode esquecer o ZDR.
  // A regra é "um só lugar, uma só constante": só `lib/ai/triagem/jev.ts`.
  //
  // A primeira versão só procurava `experimental_evaluate` — e um arquivo que chamasse
  // `gateway.evaluationModel('typesafe-ai/jev').doEvaluate(...)` passava sem ZDR e sem
  // essa palavra (provado por sabotagem na auditoria). Por isso agora são TODAS as
  // portas: a função da SDK, o modelo de avaliação do Gateway, o método que executa, o
  // id do modelo e o endereço do serviço. E a varredura cobre o repositório inteiro
  // (pastas de código e a raiz), não só quatro pastas.
  const PORTAS_PROIBIDAS = [
    'experimental_evaluate',
    'evaluationModel',
    'doEvaluate',
    'typesafe-ai/jev',
    'evaluation-model',
  ];
  const UNICO_ARQUIVO_PERMITIDO = 'lib/ai/triagem/jev.ts';
  const PASTAS_IGNORADAS = new Set([
    'node_modules',
    '.next',
    '.git',
    'docs',
    '.superpowers',
    'coverage',
    'dist',
    'out',
    '.turbo',
    '.vercel',
    'playwright-report',
    'test-results',
  ]);
  // ⚠️ Os pontos PRECISAM de barra: sem ela `.` casa com qualquer letra e a cerca pulava
  // arquivo de produção com "test"/"spec" no meio do nome (`especialista.ts`, `latest.ts`,
  // `aviso-de-teste.ts`) — achado da segunda auditoria.
  const EXTENSOES_DE_CODIGO = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
  const ARQUIVO_DE_TESTE = /\.(test|spec)\.[^/]+$/;

  /** Arquivos de código do repositório (relativos à raiz, com barra normal). */
  function arquivosDeCodigo(raiz: string): string[] {
    const raizNormal = raiz.split(sep).join('/');
    const varrer = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return PASTAS_IGNORADAS.has(e.name) ? [] : varrer(p);
        if (!EXTENSOES_DE_CODIGO.test(e.name) || ARQUIVO_DE_TESTE.test(e.name)) return [];
        return [p.split(sep).join('/').slice(raizNormal.length + 1)];
      });
    return varrer(raiz);
  }

  function quemFalaComOJev(raiz: string): string[] {
    return arquivosDeCodigo(raiz)
      .filter((f) => {
        const fonte = readFileSync(join(raiz, f), 'utf8');
        return PORTAS_PROIBIDAS.some((porta) => fonte.includes(porta));
      })
      .sort();
  }

  it('só lib/ai/triagem/jev.ts fala com o Jev (função da SDK, modelo do Gateway, id, endereço)', () => {
    expect(quemFalaComOJev(process.cwd())).toEqual([UNICO_ARQUIVO_PERMITIDO]);
  });

  it('a varredura enxerga as pastas de código e a raiz do repositório (não só quatro pastas)', () => {
    const vistos = arquivosDeCodigo(process.cwd());
    for (const parte of ['lib/', 'app/', 'components/', 'hooks/', 'workers/', 'scripts/']) {
      expect(vistos.some((f) => f.startsWith(parte)), parte).toBe(true);
    }
    // arquivos soltos na raiz (next.config.ts, proxy.ts, instrumentation.ts ...)
    expect(vistos.some((f) => !f.includes('/'))).toBe(true);
    // e o próprio ponto único está no conjunto varrido
    expect(vistos).toContain(UNICO_ARQUIVO_PERMITIDO);
  });

  it('a varredura reprova de verdade: numa árvore de mentira, cada porta acusa o arquivo', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'jev-cerca-'));
    try {
      const escreve = (rel: string, conteudo: string) => {
        mkdirSync(join(raiz, rel, '..'), { recursive: true });
        writeFileSync(join(raiz, rel), conteudo);
      };
      escreve('lib/ai/triagem/jev.ts', "export const ok = 'experimental_evaluate';");
      escreve('lib/outro/a.ts', "await gateway.evaluationModel('x').doEvaluate({});");
      escreve('app/b.tsx', "const id = 'typesafe-ai/jev';");
      escreve('scripts/c.mts', "fetch(base + '/evaluation-model');");
      escreve('raiz-solta.mjs', 'evaluate = experimental_evaluate;');
      // nomes de PRODUÇÃO com "test"/"spec"/"latest" no meio NÃO são arquivo de teste:
      // têm de ser acusados (o ponto sem barra da regex antiga os deixava passar)
      escreve('lib/especialista.ts', "const id = 'typesafe-ai/jev';");
      escreve('lib/aviso-de-teste.ts', 'evaluate = experimental_evaluate;');
      escreve('app/latest.tsx', "gateway.evaluationModel('x');");
      escreve('lib/legado.jsx', "const id = 'typesafe-ai/jev';");
      // não devem contar: teste, pasta ignorada e arquivo que não é código
      escreve('lib/x.test.ts', "'typesafe-ai/jev'");
      escreve('lib/y.spec.tsx', "'typesafe-ai/jev'");
      escreve('node_modules/p/i.js', "'typesafe-ai/jev'");
      escreve('docs/e.ts', "'typesafe-ai/jev'");
      escreve('lib/leia.md', 'typesafe-ai/jev');
      expect(quemFalaComOJev(raiz)).toEqual([
        'app/b.tsx',
        'app/latest.tsx',
        'lib/ai/triagem/jev.ts',
        'lib/aviso-de-teste.ts',
        'lib/especialista.ts',
        'lib/legado.jsx',
        'lib/outro/a.ts',
        'raiz-solta.mjs',
        'scripts/c.mts',
      ]);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});
