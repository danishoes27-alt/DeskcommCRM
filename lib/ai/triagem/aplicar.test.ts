/**
 * Ligação da triagem do Jev ao fluxo real: chave desligada, isolamento por
 * organização, o que é gravado (sem texto) e falha aberta. Nenhuma chamada real.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { montarTriagemGravada, triarEGravarMensagemRecebida, type DepsDaTriagem } from './aplicar';
import type { DecisaoDaTriagem } from './jev';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONVERSA = '22222222-2222-4222-8222-222222222222';
const MENSAGEM = '33333333-3333-4333-8333-333333333333';
const ENTRADA = { tenantId: ORG, conversationId: CONVERSA, inboundMessageId: MENSAGEM };
const AGORA = new Date('2026-09-24T12:00:00.000Z');

interface Consulta {
  sql: string;
  values: unknown[];
}

function bancoQue(linha: Record<string, unknown> | null) {
  const consultas: Consulta[] = [];
  const db = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      consultas.push({ sql, values });
      const ehSelect = /^\s*select/i.test(sql);
      return { rows: ehSelect && linha !== null ? [linha] : [] };
    }),
  };
  return { db: db as unknown as Parameters<typeof triarEGravarMensagemRecebida>[0], consultas, query: db.query };
}

const LINHA_TEXTO = {
  type: 'text',
  body: 'meu celular caiu e a tela quebrou',
  media_url: null,
  media_storage_path: null,
  media_derived_text: null,
  ja_triada: false,
};

function deps(sobrescreve: Partial<DepsDaTriagem> = {}) {
  const log = { info: vi.fn(), warn: vi.fn() };
  const triar = vi.fn(
    async (): Promise<DecisaoDaTriagem> => ({ acao: 'rotear', categoria: 'conserto', urgente: true }),
  );
  const d: DepsDaTriagem = {
    log,
    habilitado: () => true,
    temChave: () => true,
    triar,
    agora: () => AGORA,
    ...sobrescreve,
  };
  return { d, log, triar };
}

describe('triarEGravarMensagemRecebida — chave desligada', () => {
  it('desligada: nem consulta o banco nem chama o Jev', async () => {
    const { db, query } = bancoQue(LINHA_TEXTO);
    const { d, triar } = deps({ habilitado: () => false });
    await expect(triarEGravarMensagemRecebida(db, ENTRADA, d)).resolves.toBeNull();
    expect(triar).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
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

describe('triarEGravarMensagemRecebida — ligada', () => {
  it('lê a mensagem filtrando por organização, triagem só do texto, e grava o resultado', async () => {
    const { db, consultas } = bancoQue(LINHA_TEXTO);
    const { d, triar } = deps();

    const gravada = await triarEGravarMensagemRecebida(db, ENTRADA, d);

    expect(triar).toHaveBeenCalledTimes(1);
    expect(triar).toHaveBeenCalledWith('meu celular caiu e a tela quebrou');
    expect(gravada).toEqual({ v: 1, acao: 'rotear', categoria: 'conserto', urgente: true, em: AGORA.toISOString() });

    expect(consultas).toHaveLength(2);
    const [leitura, escrita] = consultas as [Consulta, Consulta];
    // multi-tenant: organization_id é o 1º parâmetro das duas consultas, vindo do job
    for (const c of [leitura, escrita]) {
      expect(c.sql).toMatch(/organization_id\s*=\s*\$1/);
      expect(c.sql).toMatch(/direction\s*=\s*'inbound'/);
      expect(c.values.slice(0, 3)).toEqual([ORG, CONVERSA, MENSAGEM]);
    }
    expect(escrita.sql).toMatch(/update messages/);
    // não cria coluna nem tabela: usa o jsonb `metadata` que já existe, na chave `triagem`
    expect(escrita.sql).toMatch(/jsonb_build_object\('triagem'/);
  });

  it('o que vai para o banco NÃO tem o texto da mensagem nem nenhum id/telefone', async () => {
    const { db, consultas } = bancoQue({ ...LINHA_TEXTO, body: 'TEXTO-SECRETO-DO-CLIENTE +5511999998888' });
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

  it('mídia sem legenda: usa o mesmo texto que a IA principal enxerga (derivado ou marcador)', async () => {
    const { db } = bancoQue({
      ...LINHA_TEXTO,
      type: 'audio',
      body: null,
      media_storage_path: 'x/y.ogg',
      media_derived_text: null,
    });
    const { d, triar } = deps();
    await triarEGravarMensagemRecebida(db, ENTRADA, d);
    expect(triar).toHaveBeenCalledWith('[audio]');
  });

  it('decisão que não roteia grava só o motivo (código)', async () => {
    const { db, consultas } = bancoQue(LINHA_TEXTO);
    const { d } = deps({ triar: async () => ({ acao: 'revisao_humana', motivo: 'baixa_confianca' }) });
    const gravada = await triarEGravarMensagemRecebida(db, ENTRADA, d);
    expect(gravada).toEqual({ v: 1, acao: 'revisao_humana', motivo: 'baixa_confianca', em: AGORA.toISOString() });
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
    expect(log.warn).toHaveBeenCalledWith('triagem do Jev falhou — o atendimento segue normal', { erro: 'Error' });
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
    expect(montarTriagemGravada({ acao: 'rotear', categoria: 'venda', urgente: false }, AGORA)).toEqual({
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

describe('ligação no fluxo real', () => {
  // O que garante que nenhum nome de provedor de canal entrou é `pnpm lint:channels`
  // (este arquivo, aliás, também é varrido por ele).
  it('o handler do turno chama a triagem ANTES de escolher o agente', () => {
    const fonte = readFileSync(join(process.cwd(), 'lib/agent-engine/agent/inbound-turn.ts'), 'utf8');
    const iChamada = fonte.indexOf('await triarEGravarMensagemRecebida(');
    const iRoteador = fonte.indexOf('const resolvedAgent = await resolveConversationTurn(');
    expect(iChamada).toBeGreaterThan(-1);
    expect(iRoteador).toBeGreaterThan(iChamada);
  });
});
