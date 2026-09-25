/**
 * Liga a triagem do Jev (`jev.ts`) ao fluxo real de mensagem recebida.
 *
 * ─── ONDE ENTRA E POR QUÊ ────────────────────────────────────────────────────
 * No começo do handler do job `inbound_turn` (`createInboundTurnHandler`). Esse é o
 * menor ponto seguro porque:
 *  - a mensagem JÁ foi gravada e o job já foi enfileirado — o webhook (Meta ou
 *    qualquer outro canal) terminou e responde 200 sem esperar o Jev; nada aqui
 *    pode atrasar ou travar o recebimento;
 *  - é o único ponto comum a TODOS os canais, então nenhum nome de provedor de
 *    canal aparece (doutrina `restricao-de-canal`, `pnpm lint:channels`);
 *  - roda ANTES de a IA principal montar a resposta, que é o que o doc 04 pede.
 * Não duplica o Intent Router (`resolve-turn-agent.ts`): aquele escolhe QUAL agente
 * atende, por intenções que a organização configura, com um LLM caro. Este só
 * classifica em quatro categorias fixas + urgência, sem gerar texto.
 *
 * ─── O QUE FAZ HOJE (modo "só registra") ─────────────────────────────────────
 * Grava um objeto pequeno em `messages.metadata.triagem` da mensagem recebida. NÃO
 * muda quem responde, NÃO passa nada ao prompt, NÃO envia nada. Usar o resultado
 * para decidir algo é um passo seguinte, que precisa de decisão do dono do produto.
 *
 * ─── TRAVAS ───────────────────────────────────────────────────────────────────
 * - Chave `JEV_TRIAGEM_ENABLED`, DESLIGADA por padrão. Desligada = zero consulta ao
 *   banco e zero chamada ao Jev.
 * - ⛔ Conta Vercel Hobby: ZDR por chamada só vale no Pro. Proibido ligar com
 *   WhatsApp real de cliente até o upgrade (docs/03-engenharia.md).
 * - FALHA ABERTA: nada aqui lança. Erro vira log com CÓDIGO (nunca o texto).
 * - Multi-tenant: `organization_id` vem do job (fonte confiável) e filtra as duas
 *   consultas; `direction = 'inbound'` impede gravar em mensagem nossa.
 */
import type { Queryable } from '@/lib/agent-engine/queue/queue';
import { corpoDaMensagem } from '@/lib/agent-engine/edge/crm/get-lead-context';
import { env } from '@/lib/env';
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

export interface DepsDaTriagem {
  log: LogDaTriagem;
  /** Testes. Default: env JEV_TRIAGEM_ENABLED. */
  habilitado?: () => boolean;
  /** Testes. Default: há chave do AI Gateway. */
  temChave?: () => boolean;
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

interface LinhaDaMensagem {
  type: string;
  body: string | null;
  media_url: string | null;
  media_storage_path: string | null;
  media_derived_text: string | null;
  ja_triada: boolean;
}

/**
 * Triagem de UMA mensagem recebida. NUNCA lança. Devolve `null` quando não fez nada
 * (desligada, sem chave, já triada, mensagem sumiu) — útil só para teste.
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

    const temChave = deps.temChave ?? (() => Boolean(env.AI_GATEWAY_API_KEY));
    if (!temChave()) {
      deps.log.warn('triagem do Jev pulada', { motivo: 'sem_chave_do_gateway' });
      return null;
    }

    const { rows } = await db.query<LinhaDaMensagem>(
      `select type, body, media_url, media_storage_path, media_derived_text,
              (metadata ? 'triagem') as ja_triada
         from messages
        where organization_id = $1
          and conversation_id = $2
          and id = $3
          and direction = 'inbound'
        limit 1`,
      [entrada.tenantId, entrada.conversationId, entrada.inboundMessageId],
    );
    const linha = rows[0];
    // Job re-tentado: não paga o Jev duas vezes pela mesma mensagem.
    if (linha === undefined || linha.ja_triada) return null;

    const decisao = await (deps.triar ?? ((t: string) => triarMensagem(t)))(corpoDaMensagem(linha));
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
