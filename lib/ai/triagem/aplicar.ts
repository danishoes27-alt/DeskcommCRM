/**
 * Liga a triagem do Jev (`jev.ts`) ao fluxo real de mensagem recebida.
 *
 * ─── ONDE ENTRA E POR QUÊ ────────────────────────────────────────────────────
 * Dentro de `runAgentTurn` (`lib/agent-engine/agent/inbound-turn.ts`), no turno do job
 * `inbound_turn`, DEPOIS de todas as saídas antecipadas do turno — conversa em
 * atendimento humano ou com o robô silenciado, conversa não elegível para IA, janela
 * anti-ban fechada, agente pausado ou em modo assistido, e horário de funcionamento do
 * agente. Quando o código chega aqui, já está decidido que a IA vai atuar nesta
 * mensagem (só os dois avisos fixos — cliente pedindo uma pessoa e opt-out detectado no
 * turno — ainda saem depois); conversa que tem dono humano NUNCA manda texto ao Jev (dado
 * a mais para fora à toa). Outros motivos do ponto:
 *  - a mensagem JÁ foi gravada e o job já foi enfileirado — o webhook (Meta ou
 *    qualquer outro canal) terminou e responde 200 sem esperar o Jev; nada aqui
 *    pode atrasar ou travar o recebimento;
 *  - é um ponto comum a TODOS os canais, então nenhum nome de provedor de canal
 *    aparece (doutrina `restricao-de-canal`, `pnpm lint:channels`);
 *  - roda ANTES de a IA principal montar a resposta.
 * Não duplica o Intent Router (`resolve-turn-agent.ts`): aquele escolhe QUAL agente
 * atende, por intenções que a organização configura, com um LLM caro. Este só
 * classifica em quatro categorias fixas + urgência, sem gerar texto.
 *
 * ─── O QUE FAZ HOJE (modo "só registra") ─────────────────────────────────────
 * Grava um objeto pequeno em `messages.metadata.triagem` da mensagem recebida. NÃO
 * muda quem responde, NÃO passa nada ao prompt, NÃO envia nada. Usar o resultado
 * para decidir algo é um passo seguinte, que precisa de decisão do dono do produto.
 *
 * ─── O QUE VAI PARA FORA: SÓ O TEXTO DIGITADO ────────────────────────────────
 * Ao Jev vai SOMENTE o que a pessoa digitou (corpo da mensagem ou legenda de
 * foto/vídeo/documento). Nunca a transcrição de áudio, a descrição de foto, o texto
 * extraído de PDF (pode ter CPF/endereço) nem o enquadramento que o sistema monta
 * para a IA principal (`corpoDaMensagem`). Mensagem sem texto digitado (só áudio,
 * foto sem legenda, figurinha, localização, contato) NÃO chama o Jev: grava
 * `llm_principal_decide` / `sem_texto` e a IA principal segue normal.
 *
 * ─── TRAVAS ───────────────────────────────────────────────────────────────────
 * - Chave `JEV_TRIAGEM_ENABLED`, DESLIGADA por padrão. Desligada = zero consulta ao
 *   banco e zero chamada ao Jev.
 * - TRAVA CENTRAL `AI_GATEWAY_PLANO_CONFIRMADO` (`lib/ai/gateway.ts`,
 *   `planoConfirmadoDoGateway`): vale para o Gateway INTEIRO do sistema, não só o Jev.
 *   Sem ela, avisa `gateway_do_sistema_nao_confirmado` e sai ANTES do banco e do Jev.
 * - SEGUNDA CONFIRMAÇÃO, SÓ do Jev, `JEV_PLANO_CONFIRMADO` (`pro` | `so_dado_de_teste`).
 *   Ligada mas sem ela (ausente ou inválida): não consulta o banco, não chama o Jev,
 *   avisa com o código `plano_do_jev_nao_confirmado` e sai. As DUAS confirmações
 *   (central + esta) são exigidas — falta uma, o Jev não roda.
 * - ⛔ Plano do AI Gateway sem ZDR confirmado: proibido ligar com WhatsApp real de
 *   cliente até o plano garantir o ZDR por chamada.
 * - FALHA ABERTA: nada aqui lança. Erro vira log com CÓDIGO (nunca o texto).
 * - Multi-tenant: `organization_id` vem do job (fonte confiável) e filtra as
 *   consultas; `direction = 'inbound'` impede gravar em mensagem nossa.
 * - Contato bloqueado (pediu para parar) não vai ao Jev.
 * - ACEITE DA EMPRESA, o MESMO do Jev do sistema (`lib/ai/decisao`): a empresa só
 *   entra se o Jev estiver LIGADO e com o aceite do administrador
 *   (`organizations.settings.jev`, lido por `lerConfigDoJev` e decidido por
 *   `estadoEfetivoDaTarefa`). Esta triagem manda o texto de uma mensagem, sozinha,
 *   ao mesmo fornecedor estrangeiro, então vale o alcance "mensagem". Sem aceite,
 *   interruptor mestre desligado ou configuração ilegível: não lê a mensagem e não
 *   chama o Gateway. Falha FECHADA (erro ao ler = sem aceite).
 */
import type { Queryable } from '@/lib/agent-engine/queue/queue';
import { lerConfigDoJev } from '@/lib/ai/decisao/config';
import { estadoEfetivoDaTarefa } from '@/lib/ai/decisao/tarefas';
import { env } from '@/lib/env';
import { planoConfirmadoDoGateway } from '../gateway';
import { triarMensagem, type DecisaoDaTriagem } from './jev';

export interface LogDaTriagem {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
}

export interface EntradaDaTriagem {
  /** Vem da ROW do job, nunca do payload/corpo de requisição. */
  tenantId: string;
  conversationId: string;
  inboundMessageId: string;
}

/** O que o dono da instalação declarou sobre o plano da conta do AI Gateway. */
export type PlanoConfirmadoDoJev = 'pro' | 'so_dado_de_teste';

/**
 * Normaliza `JEV_PLANO_CONFIRMADO`. Aceita só os dois valores (sem se importar com
 * espaço ou caixa); ausente, vazio ou qualquer outra coisa vira `null` = "não
 * confirmado" — o lado seguro. Nunca lança.
 */
export function planoConfirmadoDoJev(valor: string | undefined | null): PlanoConfirmadoDoJev | null {
  const v = typeof valor === 'string' ? valor.trim().toLowerCase() : '';
  return v === 'pro' || v === 'so_dado_de_teste' ? v : null;
}

export interface DepsDaTriagem {
  log: LogDaTriagem;
  /** Testes. Default: env JEV_TRIAGEM_ENABLED. */
  habilitado?: () => boolean;
  /**
   * Testes. Default: `planoConfirmadoDoGateway()` — a TRAVA CENTRAL do Gateway inteiro
   * (lib/ai/gateway.ts), independente da confirmação própria do Jev logo abaixo.
   */
  gatewayCentralConfirmado?: () => boolean;
  /** Testes. Default: env JEV_PLANO_CONFIRMADO (cru — é normalizado aqui). */
  planoConfirmado?: () => string | undefined;
  /** Testes. Default: há chave do AI Gateway. */
  temChave?: () => boolean;
  /** Testes. Default: o aceite do Jev da empresa, lido do banco (`empresaDeuAceiteDoJev`). */
  aceiteDoJev?: (organizationId: string) => Promise<boolean>;
  /** Testes. Default: `triarMensagem` (o Jev de verdade). */
  triar?: (texto: string) => Promise<DecisaoDaTriagem>;
  agora?: () => Date;
}

/** Forma gravada em `messages.metadata.triagem` — sem texto, sem id, sem telefone. */
export interface TriagemGravada {
  v: 1;
  acao: DecisaoDaTriagem['acao'];
  categoria?: string;
  urgente?: boolean;
  motivo?: string;
  em: string;
}

export function montarTriagemGravada(d: DecisaoDaTriagem, em: Date): TriagemGravada {
  return d.acao === 'rotear'
    ? { v: 1, acao: d.acao, categoria: d.categoria, urgente: d.urgente, em: em.toISOString() }
    : { v: 1, acao: d.acao, motivo: d.motivo, em: em.toISOString() };
}

/**
 * Tipos de mensagem cujo `body` é o que a PESSOA digitou: o texto em si e a legenda de
 * foto/vídeo/documento. Nos outros (áudio, figurinha, localização, contato, reação,
 * sistema) o corpo, quando existe, não é texto digitado — pode ser endereço, cartão de
 * contato ou marcador — e por isso não sai.
 */
const TIPOS_COM_TEXTO_DIGITADO: ReadonlySet<string> = new Set(['text', 'image', 'video', 'document']);

/** Corpo que é só um marcador entre colchetes, como `[audio]` — não é texto de gente. */
const SO_MARCADOR = /^\[[^\]\n]{1,30}\]$/;

/**
 * O texto digitado pela pessoa, e SÓ ele: o `body` da própria mensagem, sem nada que o
 * sistema tenha derivado dela (transcrição, descrição de imagem, texto de PDF) e sem o
 * enquadramento feito para a IA principal. `''` quando não há.
 */
export function textoDigitadoDaMensagem(linha: { type: string; body: string | null }): string {
  if (!TIPOS_COM_TEXTO_DIGITADO.has(linha.type)) return '';
  const texto = (linha.body ?? '').trim();
  return SO_MARCADOR.test(texto) ? '' : texto;
}

/**
 * A triagem como a regra do Jev do sistema a enxerga: uma pergunta sobre UMA mensagem,
 * sozinha. Não está gravada em `settings.jev.tarefas` — vale o estado de uma tarefa
 * nova dentro do alcance aceito — e por isso só o interruptor mestre e o aceite decidem.
 */
const TAREFA_DA_TRIAGEM = { id: 'triagem', alcance: 'mensagem' } as const;

/**
 * A empresa deu o aceite de mandar a mensagem ao fornecedor estrangeiro? É a MESMA
 * leitura e a MESMA regra do Jev do sistema (`estadoDaTarefaNoPool`, em
 * `lib/ai/decisao/pool.ts`): `organizations.settings.jev` -> `lerConfigDoJev` ->
 * `estadoEfetivoDaTarefa`. Desligado, sem aceite ou ilegível = `false`. Nunca lança:
 * sem saber se a empresa consentiu, nada sai.
 */
export async function empresaDeuAceiteDoJev(db: Queryable, organizationId: string): Promise<boolean> {
  try {
    const { rows } = await db.query<{ settings: unknown }>(
      'select settings from public.organizations where id = $1',
      [organizationId],
    );
    return estadoEfetivoDaTarefa(lerConfigDoJev(rows[0]?.settings), TAREFA_DA_TRIAGEM) !== 'desligada';
  } catch {
    return false;
  }
}

interface LinhaDaMensagem {
  type: string;
  body: string | null;
  ja_triada: boolean;
  contato_bloqueado: boolean;
}

/**
 * Triagem de UMA mensagem recebida. NUNCA lança. Devolve `null` quando não fez nada
 * (desligada, trava central do Gateway não confirmada, plano do Jev não confirmado, sem
 * chave, já triada, contato bloqueado, mensagem sumiu) — útil só para teste.
 */
export async function triarEGravarMensagemRecebida(
  db: Queryable,
  entrada: EntradaDaTriagem,
  deps: DepsDaTriagem,
): Promise<TriagemGravada | null> {
  try {
    const habilitado = deps.habilitado ?? (() => env.JEV_TRIAGEM_ENABLED === true);
    // Desligada: sai ANTES de qualquer consulta ou chamada.
    if (!habilitado()) return null;

    // ⛔ TRAVA CENTRAL do AI Gateway inteiro (decisão do dono do produto): além da
    // confirmação própria do Jev logo abaixo, existe uma segunda chave que vale para o
    // SISTEMA INTEIRO (`AI_GATEWAY_PLANO_CONFIRMADO`, lib/ai/gateway.ts). Checada aqui —
    // e não só em `gatewayConfig()` — porque o Jev NÃO passa por ele: a chamada que
    // `jev.ts` faz lê `AI_GATEWAY_API_KEY` direto do `process.env` (o ÚNICO ponto
    // autorizado a fazer essa chamada — ver a cerca em `jev.test.ts`).
    // Sai ANTES do banco e do Jev; o aviso leva só um CÓDIGO.
    const gatewayCentralConfirmado =
      deps.gatewayCentralConfirmado ?? (() => planoConfirmadoDoGateway() !== null);
    if (!gatewayCentralConfirmado()) {
      deps.log.warn('triagem do Jev pulada', { motivo: 'gateway_do_sistema_nao_confirmado' });
      return null;
    }

    // Segunda confirmação (SÓ do Jev): ligada mas sem o plano declarado => se recusa.
    // Sai ANTES do banco e do Jev. O aviso leva só um CÓDIGO.
    const plano = planoConfirmadoDoJev((deps.planoConfirmado ?? (() => env.JEV_PLANO_CONFIRMADO))());
    if (plano === null) {
      deps.log.warn('triagem do Jev pulada', { motivo: 'plano_do_jev_nao_confirmado' });
      return null;
    }

    const temChave = deps.temChave ?? (() => Boolean(env.AI_GATEWAY_API_KEY));
    if (!temChave()) {
      deps.log.warn('triagem do Jev pulada', { motivo: 'sem_chave_do_gateway' });
      return null;
    }

    // Aceite da empresa (o mesmo do Jev do sistema): sai ANTES de ler a mensagem e do
    // Gateway. Estado normal da maioria das empresas, então só um registro informativo,
    // com CÓDIGO.
    const deuAceite = await (deps.aceiteDoJev ?? ((org: string) => empresaDeuAceiteDoJev(db, org)))(
      entrada.tenantId,
    );
    if (!deuAceite) {
      deps.log.info('triagem do Jev pulada', { motivo: 'sem_aceite_do_jev' });
      return null;
    }

    // Só o `body` (e o tipo, para saber se ele é texto digitado) — NÃO se lê o texto
    // derivado de mídia nem os caminhos de arquivo: eles nunca podem chegar ao Jev.
    const { rows } = await db.query<LinhaDaMensagem>(
      `select m.type, m.body,
              (m.metadata ? 'triagem') as ja_triada,
              coalesce((select c.is_blocked
                          from contacts c
                         where c.organization_id = m.organization_id
                           and c.id = m.contact_id), false) as contato_bloqueado
         from messages m
        where m.organization_id = $1
          and m.conversation_id = $2
          and m.id = $3
          and m.direction = 'inbound'
        limit 1`,
      [entrada.tenantId, entrada.conversationId, entrada.inboundMessageId],
    );
    const linha = rows[0];
    // Job re-tentado: não paga o Jev duas vezes pela mesma mensagem.
    if (linha === undefined || linha.ja_triada) return null;
    if (linha.contato_bloqueado) {
      deps.log.info('triagem do Jev pulada', { motivo: 'contato_bloqueado' });
      return null;
    }

    const texto = textoDigitadoDaMensagem(linha);
    // Sem texto digitado não há chamada externa: registra e a IA principal segue.
    const decisao: DecisaoDaTriagem =
      texto === ''
        ? { acao: 'llm_principal_decide', motivo: 'sem_texto' }
        : await (deps.triar ?? ((t: string) => triarMensagem(t)))(texto);
    const gravada = montarTriagemGravada(decisao, (deps.agora ?? (() => new Date()))());

    await db.query(
      `update messages
          set metadata = coalesce(metadata, '{}'::jsonb)
                         || jsonb_build_object('triagem', $4::jsonb)
        where organization_id = $1
          and conversation_id = $2
          and id = $3
          and direction = 'inbound'`,
      [entrada.tenantId, entrada.conversationId, entrada.inboundMessageId, JSON.stringify(gravada)],
    );
    // Só códigos e categoria — nunca o texto.
    deps.log.info('triagem do Jev registrada', {
      acao: gravada.acao,
      categoria: gravada.categoria,
      urgente: gravada.urgente,
      motivo: gravada.motivo,
    });
    return gravada;
  } catch (err) {
    deps.log.warn('triagem do Jev falhou — o atendimento segue normal', {
      erro: err instanceof Error ? err.name : 'desconhecido',
    });
    return null;
  }
}
