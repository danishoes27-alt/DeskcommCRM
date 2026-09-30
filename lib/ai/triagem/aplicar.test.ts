/**
 * Ligação da triagem do Jev ao fluxo real: chave desligada, confirmação do plano,
 * SÓ o texto digitado vai para fora, isolamento por organização, o que é gravado
 * (sem texto) e falha aberta. Nenhuma chamada real.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  empresaDeuAceiteDoJev,
  montarTriagemGravada,
  planoConfirmadoDoJev,
  textoDigitadoDaMensagem,
  triarEGravarMensagemRecebida,
  type DepsDaTriagem,
} from './aplicar';
import type { DecisaoDaTriagem } from './jev';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONVERSA = '22222222-2222-4222-8222-222222222222';
const MENSAGEM = '33333333-3333-4333-8333-333333333333';
const ENTRADA = { tenantId: ORG, conversationId: CONVERSA, inboundMessageId: MENSAGEM };
const AGORA = new Date('2026-09-24T12:00:00.000Z');

/**
 * REDE DE SEGURANÇA — nenhum teste daqui chega no Jev de verdade. O setup de testes
 * carrega o `.env.local` (com a chave real do Gateway): um teste que esquecesse de
 * injetar `triar` usaria o Gateway PADRÃO da SDK. Aqui o provedor padrão vira uma
 * armadilha que explode, e a chave é zerada.
 */
type ProvedorPadrao = { evaluationModel: (id: string) => never };
const globalDaSdk = globalThis as unknown as { AI_SDK_DEFAULT_PROVIDER?: ProvedorPadrao };
const provedorPadraoAntes = globalDaSdk.AI_SDK_DEFAULT_PROVIDER;
beforeAll(() => {
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
  globalDaSdk.AI_SDK_DEFAULT_PROVIDER = {
    evaluationModel: () => {
      throw new Error('TESTE TENTOU CHAMAR O JEV DE VERDADE — injete sempre `triar`');
    },
  };
});
afterAll(() => {
  vi.unstubAllEnvs();
  globalDaSdk.AI_SDK_DEFAULT_PROVIDER = provedorPadraoAntes;
});

interface Consulta {
  sql: string;
  values: unknown[];
}

/** Banco de mentira: devolve `linha` para o SELECT e registra toda consulta. */
function bancoQue(linha: Record<string, unknown> | null) {
  const consultas: Consulta[] = [];
  const db = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      consultas.push({ sql, values });
      const ehSelect = /^\s*select/i.test(sql);
      return { rows: ehSelect && linha !== null ? [linha] : [] };
    }),
  };
  return {
    db: db as unknown as Parameters<typeof triarEGravarMensagemRecebida>[0],
    consultas,
    query: db.query,
  };
}

const LINHA_TEXTO = {
  type: 'text',
  body: 'meu celular caiu e a tela quebrou',
  ja_triada: false,
  contato_bloqueado: false,
};

function deps(sobrescreve: Partial<DepsDaTriagem> = {}) {
  const log = { info: vi.fn(), warn: vi.fn() };
  const triar = vi.fn(
    async (_texto: string): Promise<DecisaoDaTriagem> => ({
      acao: 'rotear',
      categoria: 'conserto',
      urgente: true,
    }),
  );
  const d: DepsDaTriagem = {
    log,
    habilitado: () => true,
    planoConfirmado: () => 'so_dado_de_teste',
    temChave: () => true,
    aceiteDoJev: async () => true,
    triar,
    agora: () => AGORA,
    ...sobrescreve,
  };
  return { d, log, triar };
}

describe('triarEGravarMensagemRecebida — chave desligada', () => {
  it('desligada: nem consulta o banco nem chama o Jev nem avisa nada', async () => {
    const { db, query } = bancoQue(LINHA_TEXTO);
    // sem plano confirmado E desligada: continua saindo antes de tudo, sem nem avisar
    const { d, triar, log } = deps({ habilitado: () => false, planoConfirmado: () => undefined });
    await expect(triarEGravarMensagemRecebida(db, ENTRADA, d)).resolves.toBeNull();
    expect(triar).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });

  it('o padrão é DESLIGADO: sem JEV_TRIAGEM_ENABLED no ambiente, env vale false', async () => {
    const antes = process.env.JEV_TRIAGEM_ENABLED;
    delete process.env.JEV_TRIAGEM_ENABLED;
    vi.resetModules();
    try {
      const { env } = await import('@/lib/env');
      expect(env.JEV_TRIAGEM_ENABLED).toBe(false);
    } finally {
      if (antes !== undefined) process.env.JEV_TRIAGEM_ENABLED = antes;
      vi.resetModules();
    }
  });

  it('ligada sem chave do gateway: pula, avisa por código e não chama o Jev', async () => {
    const { db, query } = bancoQue(LINHA_TEXTO);
    const { d, triar, log } = deps({ temChave: () => false });
    await expect(triarEGravarMensagemRecebida(db, ENTRADA, d)).resolves.toBeNull();
    expect(triar).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('triagem do Jev pulada', { motivo: 'sem_chave_do_gateway' });
  });
});

describe('triarEGravarMensagemRecebida — segunda confirmação do plano (trava Hobby)', () => {
  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['só espaço', '   '],
    ['valor inválido', 'talvez'],
    ['quase certo', 'pro_sim'],
    ['grafia antiga', 'true'],
  ])('ligada com confirmação %s: NÃO consulta o banco, NÃO chama o Jev, avisa uma vez com o código', async (_nome, valor) => {
    const { db, query } = bancoQue(LINHA_TEXTO);
    const { d, triar, log } = deps({ planoConfirmado: () => valor });

    await expect(triarEGravarMensagemRecebida(db, ENTRADA, d)).resolves.toBeNull();

    expect(query).not.toHaveBeenCalled();
    expect(triar).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('triagem do Jev pulada', {
      motivo: 'plano_do_gateway_nao_confirmado',
    });
    expect(log.info).not.toHaveBeenCalled();
  });

  it.each([
    ['so_dado_de_teste', 'so_dado_de_teste'],
    ['pro', 'pro'],
    ['com espaço e caixa', '  PRO '],
  ])('confirmação "%s" deixa passar', async (_nome, valor) => {
    const { db } = bancoQue(LINHA_TEXTO);
    const { d, triar, log } = deps({ planoConfirmado: () => valor });
    const gravada = await triarEGravarMensagemRecebida(db, ENTRADA, d);
    expect(gravada).not.toBeNull();
    expect(triar).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('o motivo do aviso é um CÓDIGO: nunca leva o texto da mensagem nem o valor digitado', async () => {
    const { db } = bancoQue({ ...LINHA_TEXTO, body: 'TEXTO-SECRETO-DO-CLIENTE' });
    const { d, log } = deps({ planoConfirmado: () => 'VALOR-ESTRANHO-DO-OPERADOR' });
    await triarEGravarMensagemRecebida(db, ENTRADA, d);
    const tudo = JSON.stringify([log.warn.mock.calls, log.info.mock.calls]);
    expect(tudo).toContain('plano_do_gateway_nao_confirmado');
    expect(tudo).not.toContain('SECRETO');
    expect(tudo).not.toContain('ESTRANHO');
  });

  it('planoConfirmadoDoJev só aceita os dois valores; o resto é "não confirmado"', () => {
    expect(planoConfirmadoDoJev('pro')).toBe('pro');
    expect(planoConfirmadoDoJev('so_dado_de_teste')).toBe('so_dado_de_teste');
    expect(planoConfirmadoDoJev(' Pro ')).toBe('pro');
    for (const ruim of [undefined, null, '', ' ', 'hobby', 'enterprise', 'sim', 'true', '1']) {
      expect(planoConfirmadoDoJev(ruim as string | undefined)).toBeNull();
    }
  });

  it('a chave nasce vazia no .env.example e vazia NÃO derruba o app (por isso é string, não enum)', async () => {
    const exemplo = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
    expect(exemplo).toMatch(/^JEV_PLANO_CONFIRMADO=$/m);

    const antes = process.env.JEV_PLANO_CONFIRMADO;
    process.env.JEV_PLANO_CONFIRMADO = '';
    vi.resetModules();
    try {
      const { env } = await import('@/lib/env');
      expect(planoConfirmadoDoJev(env.JEV_PLANO_CONFIRMADO)).toBeNull();
    } finally {
      if (antes === undefined) delete process.env.JEV_PLANO_CONFIRMADO;
      else process.env.JEV_PLANO_CONFIRMADO = antes;
      vi.resetModules();
    }
  });

  it('sem JEV_PLANO_CONFIRMADO no ambiente, o padrão é "não confirmado"', async () => {
    const antes = process.env.JEV_PLANO_CONFIRMADO;
    delete process.env.JEV_PLANO_CONFIRMADO;
    vi.resetModules();
    try {
      const { env } = await import('@/lib/env');
      expect(planoConfirmadoDoJev(env.JEV_PLANO_CONFIRMADO)).toBeNull();
    } finally {
      if (antes !== undefined) process.env.JEV_PLANO_CONFIRMADO = antes;
      vi.resetModules();
    }
  });
});

describe('triarEGravarMensagemRecebida — ligada', () => {
  it('lê a mensagem filtrando por organização, triagem só do texto, e grava o resultado', async () => {
    const { db, consultas } = bancoQue(LINHA_TEXTO);
    const { d, triar } = deps();

    const gravada = await triarEGravarMensagemRecebida(db, ENTRADA, d);

    expect(triar).toHaveBeenCalledTimes(1);
    expect(triar).toHaveBeenCalledWith('meu celular caiu e a tela quebrou');
    expect(gravada).toEqual({
      v: 1,
      acao: 'rotear',
      categoria: 'conserto',
      urgente: true,
      em: AGORA.toISOString(),
    });

    expect(consultas).toHaveLength(2);
    const [leitura, escrita] = consultas as [Consulta, Consulta];
    // multi-tenant: organization_id é o 1º parâmetro das duas consultas, vindo do job
    for (const c of [leitura, escrita]) {
      expect(c.sql).toMatch(/organization_id\s*=\s*\$1/);
      expect(c.sql).toMatch(/direction\s*=\s*'inbound'/);
      expect(c.values.slice(0, 3)).toEqual([ORG, CONVERSA, MENSAGEM]);
    }
    // a consulta do contato (bloqueado) também é filtrada por organização
    expect(leitura.sql).toMatch(/c\.organization_id\s*=\s*m\.organization_id/);
    expect(escrita.sql).toMatch(/update messages/);
    // não cria coluna nem tabela: usa o jsonb `metadata` que já existe, na chave `triagem`
    expect(escrita.sql).toMatch(/jsonb_build_object\('triagem'/);
  });

  it('o que vai para o banco NÃO tem o texto da mensagem nem nenhum id/telefone', async () => {
    const { db, consultas } = bancoQue({
      ...LINHA_TEXTO,
      body: 'TEXTO-SECRETO-DO-CLIENTE +5511999998888',
    });
    const { d } = deps();
    await triarEGravarMensagemRecebida(db, ENTRADA, d);
    const escrita = consultas[1]!;
    const json = String(escrita.values[3]);
    expect(json).not.toContain('SECRETO');
    expect(json).not.toContain('5511');
    expect(json).not.toContain(ORG);
    expect(json).not.toContain(MENSAGEM);
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(['acao', 'categoria', 'em', 'urgente', 'v']);
  });

  it('o log leva só código/categoria — nunca o texto', async () => {
    const { db } = bancoQue({ ...LINHA_TEXTO, body: 'TEXTO-SECRETO-DO-CLIENTE' });
    const { d, log } = deps();
    await triarEGravarMensagemRecebida(db, ENTRADA, d);
    const tudo = JSON.stringify([log.info.mock.calls, log.warn.mock.calls]);
    expect(tudo).not.toContain('SECRETO');
  });

  it('decisão que não roteia grava só o motivo (código)', async () => {
    const { db, consultas } = bancoQue(LINHA_TEXTO);
    const { d } = deps({
      triar: async () => ({ acao: 'llm_principal_decide', motivo: 'baixa_confianca' }),
    });
    const gravada = await triarEGravarMensagemRecebida(db, ENTRADA, d);
    expect(gravada).toEqual({
      v: 1,
      acao: 'llm_principal_decide',
      motivo: 'baixa_confianca',
      em: AGORA.toISOString(),
    });
    expect(JSON.parse(String(consultas[1]!.values[3]))).not.toHaveProperty('categoria');
  });

  it('job re-tentado: mensagem já triada não gasta o Jev de novo', async () => {
    const { db, consultas } = bancoQue({ ...LINHA_TEXTO, ja_triada: true });
    const { d, triar } = deps();
    await expect(triarEGravarMensagemRecebida(db, ENTRADA, d)).resolves.toBeNull();
    expect(triar).not.toHaveBeenCalled();
    expect(consultas).toHaveLength(1); // só a leitura
  });

  it('mensagem que não é desta organização/conversa (sem linha): não chama o Jev nem escreve', async () => {
    const { db, consultas } = bancoQue(null);
    const { d, triar } = deps();
    await expect(triarEGravarMensagemRecebida(db, ENTRADA, d)).resolves.toBeNull();
    expect(triar).not.toHaveBeenCalled();
    expect(consultas).toHaveLength(1);
  });

  it('contato bloqueado (pediu para parar): não vai ao Jev e nada é gravado', async () => {
    const { db, consultas } = bancoQue({ ...LINHA_TEXTO, contato_bloqueado: true });
    const { d, triar, log } = deps();
    await expect(triarEGravarMensagemRecebida(db, ENTRADA, d)).resolves.toBeNull();
    expect(triar).not.toHaveBeenCalled();
    expect(consultas).toHaveLength(1);
    expect(log.info).toHaveBeenCalledWith('triagem do Jev pulada', { motivo: 'contato_bloqueado' });
  });
});

describe('triarEGravarMensagemRecebida — SÓ o texto digitado vai para fora', () => {
  // Uma linha "hostil": o banco devolve, além do corpo, tudo o que o sistema derivou da
  // mídia. Nada disso pode chegar ao Jev — mesmo que a consulta o devolvesse.
  const DERIVADO =
    'TRANSCRICAO-DO-AUDIO CPF 123.456.789-09 Rua das Flores 10 [Mídia do cliente: ele enviou um áudio ...]';

  it('a consulta nem busca o texto derivado nem os caminhos da mídia', async () => {
    const { db, consultas } = bancoQue(LINHA_TEXTO);
    await triarEGravarMensagemRecebida(db, ENTRADA, deps().d);
    const leitura = consultas[0]!.sql;
    expect(leitura).not.toMatch(/media_derived_text|media_url|media_storage_path/);
  });

  it('áudio com transcrição preenchida: a transcrição NÃO vai ao Jev e a chamada nem acontece', async () => {
    const { db, consultas } = bancoQue({
      type: 'audio',
      body: null,
      media_derived_text: DERIVADO,
      media_storage_path: 'org/x/audio.ogg',
      ja_triada: false,
      contato_bloqueado: false,
    });
    const { d, triar } = deps();

    const gravada = await triarEGravarMensagemRecebida(db, ENTRADA, d);

    expect(triar).not.toHaveBeenCalled();
    expect(gravada).toEqual({
      v: 1,
      acao: 'llm_principal_decide',
      motivo: 'sem_texto',
      em: AGORA.toISOString(),
    });
    // registrou (a IA principal segue normal) e o que foi gravado não tem o derivado
    expect(consultas).toHaveLength(2);
    expect(String(consultas[1]!.values[3])).not.toContain('CPF');
  });

  it('foto com legenda digitada e descrição da imagem: só a LEGENDA vai ao Jev', async () => {
    const { db } = bancoQue({
      type: 'image',
      body: '  quanto custa trocar essa tela?  ',
      media_derived_text: 'DESCRICAO-DA-IMAGEM: celular com a tela trincada, CPF 123.456.789-09',
      media_storage_path: 'org/x/foto.jpg',
      ja_triada: false,
      contato_bloqueado: false,
    });
    const { d, triar } = deps();
    await triarEGravarMensagemRecebida(db, ENTRADA, d);
    expect(triar).toHaveBeenCalledTimes(1);
    expect(triar).toHaveBeenCalledWith('quanto custa trocar essa tela?');
    const enviado = String(triar.mock.calls[0]![0]);
    expect(enviado).not.toContain('DESCRICAO');
    expect(enviado).not.toContain('CPF');
    expect(enviado).not.toContain('Mídia do cliente');
  });

  it('documento com legenda: só a legenda; texto extraído do PDF fica de fora', async () => {
    const { db } = bancoQue({
      type: 'document',
      body: 'segue o comprovante',
      media_derived_text: 'PDF-EXTRAIDO CPF 123.456.789-09 endereço Rua X',
      ja_triada: false,
      contato_bloqueado: false,
    });
    const { d, triar } = deps();
    await triarEGravarMensagemRecebida(db, ENTRADA, d);
    expect(triar).toHaveBeenCalledWith('segue o comprovante');
  });

  it.each([
    ['foto sem legenda', { type: 'image', body: null }],
    ['legenda em branco', { type: 'image', body: '   ' }],
    ['placeholder [audio] no corpo', { type: 'text', body: '[audio]' }],
    ['placeholder [image] com espaço', { type: 'image', body: ' [image] ' }],
    ['figurinha', { type: 'sticker', body: null }],
    ['localização (o corpo pode ser endereço)', { type: 'location', body: 'Rua das Flores 10, Centro' }],
    ['cartão de contato (o corpo pode ter telefone)', { type: 'contact', body: 'BEGIN:VCARD TEL:+5511999998888' }],
    ['reação', { type: 'reaction', body: '👍' }],
    ['mensagem de sistema', { type: 'system', body: 'grupo criado' }],
  ])('%s: NÃO chama o Jev, grava sem_texto e a IA principal segue', async (_nome, parte) => {
    const { db, consultas } = bancoQue({
      ...parte,
      media_derived_text: DERIVADO,
      ja_triada: false,
      contato_bloqueado: false,
    });
    const { d, triar } = deps();
    const gravada = await triarEGravarMensagemRecebida(db, ENTRADA, d);
    expect(triar).not.toHaveBeenCalled();
    expect(gravada).toMatchObject({ acao: 'llm_principal_decide', motivo: 'sem_texto' });
    expect(consultas).toHaveLength(2); // leu e gravou; nenhuma chamada externa
  });

  it('textoDigitadoDaMensagem: só body de tipo digitável, sem marcador, sem espaço nas pontas', () => {
    expect(textoDigitadoDaMensagem({ type: 'text', body: '  oi, tudo bem?  ' })).toBe('oi, tudo bem?');
    expect(textoDigitadoDaMensagem({ type: 'image', body: 'olha isso' })).toBe('olha isso');
    expect(textoDigitadoDaMensagem({ type: 'video', body: 'olha' })).toBe('olha');
    expect(textoDigitadoDaMensagem({ type: 'audio', body: 'algo' })).toBe('');
    expect(textoDigitadoDaMensagem({ type: 'text', body: null })).toBe('');
    expect(textoDigitadoDaMensagem({ type: 'text', body: '[audio]' })).toBe('');
    // colchete no meio de uma frase de verdade não é marcador
    expect(textoDigitadoDaMensagem({ type: 'text', body: 'pedido [12345] ainda não chegou' })).toBe(
      'pedido [12345] ainda não chegou',
    );
  });
});

describe('triarEGravarMensagemRecebida — falha aberta', () => {
  it('se o Jev (ou o que o chama) lançar, nada sobe e nenhuma escrita acontece', async () => {
    const { db, consultas } = bancoQue(LINHA_TEXTO);
    const { d, log } = deps({
      triar: async () => {
        throw new Error('TEXTO-SECRETO-NO-ERRO');
      },
    });
    await expect(triarEGravarMensagemRecebida(db, ENTRADA, d)).resolves.toBeNull();
    expect(consultas).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith('triagem do Jev falhou — o atendimento segue normal', {
      erro: 'Error',
    });
    // nem a mensagem do erro vai para o log
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('SECRETO');
  });

  it('se o banco falhar, também não sobe', async () => {
    const db = {
      query: vi.fn(async () => {
        throw new Error('banco fora do ar');
      }),
    } as unknown as Parameters<typeof triarEGravarMensagemRecebida>[0];
    const { d } = deps();
    await expect(triarEGravarMensagemRecebida(db, ENTRADA, d)).resolves.toBeNull();
  });

  it('se gravar falhar, o atendimento segue (sem exceção)', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (/^\s*update/i.test(sql)) throw new Error('sem permissão');
        return { rows: [LINHA_TEXTO] };
      }),
    } as unknown as Parameters<typeof triarEGravarMensagemRecebida>[0];
    const { d } = deps();
    await expect(triarEGravarMensagemRecebida(db, ENTRADA, d)).resolves.toBeNull();
  });
});

describe('montarTriagemGravada', () => {
  it('rotear guarda categoria e urgência; o resto guarda o motivo', () => {
    expect(
      montarTriagemGravada({ acao: 'rotear', categoria: 'venda', urgente: false }, AGORA),
    ).toEqual({
      v: 1,
      acao: 'rotear',
      categoria: 'venda',
      urgente: false,
      em: AGORA.toISOString(),
    });
    expect(montarTriagemGravada({ acao: 'llm_principal_decide', motivo: 'timeout' }, AGORA)).toEqual({
      v: 1,
      acao: 'llm_principal_decide',
      motivo: 'timeout',
      em: AGORA.toISOString(),
    });
  });
});

describe('ligação no fluxo real — ponto de chamada', () => {
  // Sem Postgres não dá para rodar o turno inteiro; o que se prova aqui é a POSIÇÃO da
  // chamada no código do turno: depois de TODA saída antecipada, e fora do começo do
  // handler (que roda antes das guardas). O que garante que nenhum nome de provedor de
  // canal entrou é `pnpm lint:channels` (este arquivo também é varrido por ele).
  const fonte = readFileSync(join(process.cwd(), 'lib/agent-engine/agent/inbound-turn.ts'), 'utf8');
  const iniTurno = fonte.indexOf('export async function runAgentTurn(');
  const iniHandler = fonte.indexOf('export function createInboundTurnHandler(');
  const corpoDoTurno = fonte.slice(iniTurno, iniHandler);
  const corpoDoHandler = fonte.slice(iniHandler);
  const CHAMADA = 'await triarEGravarMensagemRecebida(';

  it('a chamada existe uma só vez, dentro de runAgentTurn, e não no handler', () => {
    expect(iniTurno).toBeGreaterThan(-1);
    expect(iniHandler).toBeGreaterThan(iniTurno);
    expect(fonte.split(CHAMADA)).toHaveLength(2); // exatamente uma
    expect(corpoDoTurno).toContain(CHAMADA);
    expect(corpoDoHandler).not.toContain('triarEGravarMensagemRecebida');
  });

  it('vem DEPOIS de cada saída antecipada em que a IA não vai atuar', () => {
    const iChamada = corpoDoTurno.indexOf(CHAMADA);
    const saidas: Array<[string, string]> = [
      ['lead em handoff / robô silenciado', 'await isLeadInHandoff(pool, tenantId, leadId)'],
      ['conversa não elegível para IA', 'await decidirElegibilidadeDaConversa(pool, {'],
      ['janela anti-ban de envio', '!janelaDeEnvioAberta(agora, knobs'],
      ['agente pausado ou assistido', "agentConfig.pausedAt || agentConfig.operationMode === 'assisted'"],
      ['horário de funcionamento do agente', 'agentConfig?.janelaDeAtendimento != null'],
    ];
    for (const [nome, trecho] of saidas) {
      const i = corpoDoTurno.indexOf(trecho);
      expect(i, `saída não achada no turno: ${nome}`).toBeGreaterThan(-1);
      expect(iChamada, `a triagem tem de vir depois de: ${nome}`).toBeGreaterThan(i);
    }
  });

  it('só no turno de mensagem recebida ao vivo: não roda em prévia nem em follow-up', () => {
    const i = corpoDoTurno.indexOf(CHAMADA);
    const guarda = corpoDoTurno.slice(Math.max(0, i - 200), i);
    expect(guarda).toContain('!preview');
    expect(guarda).toContain("liveJob().kind === 'inbound_turn'");
    expect(guarda).toContain('input.inboundMessageId !== undefined');
  });

  it('o tenant vem do turno (linha do job), nunca do corpo de uma requisição', () => {
    const i = corpoDoTurno.indexOf(CHAMADA);
    const chamada = corpoDoTurno.slice(i, i + 260);
    expect(chamada).toMatch(/tenantId,/);
    expect(chamada).toContain('conversationId: input.conversationId');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ACEITE DA EMPRESA — o mesmo do Jev do sistema (`organizations.settings.jev`).
// ───────────────────────────────────────────────────────────────────────────

const ACEITE = { em: '2026-09-01T12:00:00.000Z', por: '44444444-4444-4444-8444-444444444444' };

/** Banco de mentira que separa a leitura do aceite (organizations) da leitura da mensagem. */
function bancoComEmpresa(settings: unknown, linha: Record<string, unknown> | null = LINHA_TEXTO) {
  const consultas: Consulta[] = [];
  const db = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      consultas.push({ sql, values });
      if (/from\s+public\.organizations/i.test(sql)) return { rows: [{ settings }] };
      const ehSelect = /^\s*select/i.test(sql);
      return { rows: ehSelect && linha !== null ? [linha] : [] };
    }),
  };
  return { db: db as unknown as Parameters<typeof triarEGravarMensagemRecebida>[0], consultas };
}

describe('triarEGravarMensagemRecebida — aceite da empresa', () => {
  it('SEM aceite: não lê a mensagem, não chama o Gateway e registra só o código', async () => {
    const { db, query } = bancoQue(LINHA_TEXTO);
    const aceiteDoJev = vi.fn(async () => false);
    const { d, triar, log } = deps({ aceiteDoJev });

    await expect(triarEGravarMensagemRecebida(db, ENTRADA, d)).resolves.toBeNull();

    expect(aceiteDoJev).toHaveBeenCalledWith(ORG);
    expect(triar).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('triagem do Jev pulada', { motivo: 'sem_aceite_do_jev' });
  });

  it('COM aceite e a chave ligada: chama o Jev com o texto digitado e grava', async () => {
    const { db, query } = bancoQue(LINHA_TEXTO);
    const { d, triar } = deps({ aceiteDoJev: async () => true });

    const gravada = await triarEGravarMensagemRecebida(db, ENTRADA, d);

    expect(gravada).not.toBeNull();
    expect(triar).toHaveBeenCalledTimes(1);
    expect(triar).toHaveBeenCalledWith('meu celular caiu e a tela quebrou');
    expect(query).toHaveBeenCalled();
  });

  it('COM aceite e a chave DESLIGADA: nem pergunta pelo aceite nem chama o Jev', async () => {
    const { db, query } = bancoQue(LINHA_TEXTO);
    const aceiteDoJev = vi.fn(async () => true);
    const { d, triar } = deps({ habilitado: () => false, aceiteDoJev });

    await expect(triarEGravarMensagemRecebida(db, ENTRADA, d)).resolves.toBeNull();

    expect(aceiteDoJev).not.toHaveBeenCalled();
    expect(triar).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('o aceite é checado DEPOIS das travas de ambiente e ANTES de ler a mensagem', async () => {
    const { db, query } = bancoQue(LINHA_TEXTO);
    const aceiteDoJev = vi.fn(async () => true);
    const semPlano = deps({ planoConfirmado: () => undefined, aceiteDoJev });
    await triarEGravarMensagemRecebida(db, ENTRADA, semPlano.d);
    const semChave = deps({ temChave: () => false, aceiteDoJev });
    await triarEGravarMensagemRecebida(db, ENTRADA, semChave.d);
    expect(aceiteDoJev).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('sem injeção, lê o aceite do banco: com o Jev ligado e aceito, chama o Jev', async () => {
    const { db, consultas } = bancoComEmpresa({ jev: { ligado: true, aceite: ACEITE } });
    const { d, triar } = deps();
    delete d.aceiteDoJev;

    const gravada = await triarEGravarMensagemRecebida(db, ENTRADA, d);

    expect(gravada).not.toBeNull();
    expect(triar).toHaveBeenCalledTimes(1);
    const leitura = consultas.find((c) => /public\.organizations/i.test(c.sql));
    expect(leitura?.values).toEqual([ORG]);
  });

  it.each([
    ['empresa sem nenhuma configuração do Jev', {}],
    ['settings nulo', null],
    ['Jev ligado SEM aceite (configuração inválida)', { jev: { ligado: true } }],
    ['aceite dado, mas interruptor mestre desligado', { jev: { ligado: false, aceite: ACEITE } }],
    ['aceite ilegível', { jev: { ligado: true, aceite: { em: 'ontem', por: 'ninguem' } } }],
    ['jev que nem é objeto', { jev: 'sim' }],
  ])('sem injeção: %s => sem aceite, não chama o Jev e não lê a mensagem', async (_nome, settings) => {
    const { db, consultas } = bancoComEmpresa(settings);
    const { d, triar } = deps();
    delete d.aceiteDoJev;

    await expect(triarEGravarMensagemRecebida(db, ENTRADA, d)).resolves.toBeNull();

    expect(triar).not.toHaveBeenCalled();
    expect(consultas.every((c) => /public\.organizations/i.test(c.sql))).toBe(true);
  });
});

describe('empresaDeuAceiteDoJev', () => {
  it('é a regra do Jev do sistema: ligado + aceite, em qualquer alcance aceito, vale; o resto não', async () => {
    const ok = bancoComEmpresa({ jev: { ligado: true, aceite: ACEITE } }).db;
    const okConversa = bancoComEmpresa({ jev: { ligado: true, aceite: { ...ACEITE, alcance: 'conversa' } } }).db;
    const desligado = bancoComEmpresa({ jev: { ligado: false, aceite: ACEITE } }).db;
    const semAceite = bancoComEmpresa({ jev: { ligado: false } }).db;
    await expect(empresaDeuAceiteDoJev(ok, ORG)).resolves.toBe(true);
    await expect(empresaDeuAceiteDoJev(okConversa, ORG)).resolves.toBe(true);
    await expect(empresaDeuAceiteDoJev(desligado, ORG)).resolves.toBe(false);
    await expect(empresaDeuAceiteDoJev(semAceite, ORG)).resolves.toBe(false);
  });

  it('organização que não existe: sem aceite', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) } as unknown as Parameters<typeof empresaDeuAceiteDoJev>[0];
    await expect(empresaDeuAceiteDoJev(db, ORG)).resolves.toBe(false);
  });

  it('falha ao ler o banco: sem aceite (falha FECHADA) e nunca lança', async () => {
    const db = {
      query: vi.fn(async () => {
        throw new Error('conexão caiu');
      }),
    } as unknown as Parameters<typeof empresaDeuAceiteDoJev>[0];
    await expect(empresaDeuAceiteDoJev(db, ORG)).resolves.toBe(false);
  });
});
