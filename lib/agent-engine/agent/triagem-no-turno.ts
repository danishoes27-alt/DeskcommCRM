/**
 * A TRIAGEM DO "ANTES" NO TURNO — o ponto de chamada (`docs/14-spec-jev.md`, seções 2, 5.2 e 7.3).
 *
 * Roda DEPOIS de todas as saídas antecipadas do turno (conversa com humano, contato bloqueado,
 * conversa não elegível, janela anti-ban, agente pausado, horário de funcionamento) E depois dos
 * dois avisos fixos de código — pedido de atendente e suspeita de opt-out —, que saem antes e
 * encerram o turno: o opt-out vem sempre antes de tudo. Chegou aqui, a IA vai atuar nesta mensagem.
 *
 * ═══ QUANDO NÃO FAZ NADA (devolve `undefined`) ═══
 *
 *  - prévia de teste — sem chamada externa e sem caso real;
 *  - um turno que não é o da mensagem nova (`inbound_turn`);
 *  - contato bloqueado (`optedOut`);
 *  - o interruptor da INSTALAÇÃO desligado (`JEV_TRIAGEM_DO_SISTEMA_ENABLED`);
 *  - a tarefa `triagem` desligada na empresa (interruptor mestre, aceite, estado);
 *  - sem texto digitado (áudio, figurinha, localização: nada de texto derivado sai);
 *  - sem mensagem de entrada identificada.
 *
 * O texto que sai é SÓ o que o cliente digitou (`textoDigitadoDaMensagem`: corpo ou legenda),
 * lido da própria mensagem — nunca a transcrição, a descrição de foto ou o texto de documento.
 *
 * Grava uma linha de custo (`jev_antes`), uma observação e o metadado da mensagem
 * (`registrarTriagemDoJev`). Nunca lança: o ANTES só ajuda, e quem protege é o DEPOIS.
 */
import type pg from "pg";

import { categoriasDaEmpresa, type CategoriaDaTriagem } from "@/lib/ai/decisao/categorias";
import { lerConfigDoJev } from "@/lib/ai/decisao/config";
import { interruptorDaInstalacaoLigado } from "@/lib/ai/decisao/interruptores";
import { avisarQueEPraEquipe } from "@/lib/ai/decisao/aviso-da-triagem";
import { registrarTriagemDoJev } from "@/lib/ai/decisao/observacao-da-triagem";
import type { DependenciasDoPonto } from "@/lib/ai/decisao/ponto";
import { estadoEfetivoDaTarefa, TAREFA_DA_TRIAGEM } from "@/lib/ai/decisao/tarefas";
import { perguntarATriagem, type VeredictoDaTriagem } from "@/lib/ai/decisao/triagem";
import { CHAVE_DA_MARCA_URGENTE } from "@/lib/inbox/urgente-do-jev";
import { logger } from "@/lib/logger";
import { textoDigitadoDaMensagem } from "@/lib/ai/triagem/aplicar";

export interface TriagemDoTurno {
  estado: "observando" | "decidindo";
  veredito: VeredictoDaTriagem;
  /** A lista de categorias da empresa — para a dica dizer o rótulo dela. */
  categorias: readonly CategoriaDaTriagem[];
}

export interface EntradaDaTriagemNoTurno {
  pool: pg.Pool;
  organizationId: string;
  tipoDoJob: string;
  preview: boolean;
  /** `contacts.is_blocked` do contexto deste turno. */
  contatoBloqueado: boolean;
  conversationId: string;
  /** A mensagem de ENTRADA do cliente. */
  messageId: string | undefined;
  jobId: string | null;
  contactId: string | null;
  agentId: string | null;
  nomeDoContato?: string | null;
}

interface LinhaDaEntrada {
  type: string;
  body: string | null;
  antes: boolean;
  settings: unknown;
}

export async function triarOTurno(
  e: EntradaDaTriagemNoTurno,
  deps: DependenciasDoPonto & { tetoMs?: number } = {},
): Promise<TriagemDoTurno | undefined> {
  try {
    if (e.preview || e.tipoDoJob !== "inbound_turn" || e.contatoBloqueado) return undefined;
    if (e.messageId === undefined) return undefined;
    if (!interruptorDaInstalacaoLigado(TAREFA_DA_TRIAGEM.id)) return undefined;

    // Uma leitura: a configuração da empresa, a mensagem de entrada (só tipo e corpo) e se já
    // houve mensagem anterior do cliente nesta conversa (D4: `pedir_dado` só na primeira).
    const { rows } = await e.pool.query<LinhaDaEntrada>(
      `select m.type, m.body,
              exists (
                select 1 from public.messages p
                 where p.organization_id = m.organization_id and p.conversation_id = m.conversation_id
                   and p.direction = 'inbound' and p.id <> m.id and p.created_at < m.created_at
              ) as antes,
              (select o.settings from public.organizations o where o.id = m.organization_id) as settings
         from public.messages m
        where m.organization_id = $1 and m.conversation_id = $2 and m.id = $3 and m.direction = 'inbound'
        limit 1`,
      [e.organizationId, e.conversationId, e.messageId],
    );
    const linha = rows[0];
    if (linha === undefined) return undefined;

    const config = lerConfigDoJev(linha.settings);
    const estado = estadoEfetivoDaTarefa(config, TAREFA_DA_TRIAGEM);
    if (estado === "desligada") return undefined;

    const texto = textoDigitadoDaMensagem({ type: linha.type, body: linha.body });
    if (texto === "") return undefined;

    const categorias = categoriasDaEmpresa(config);
    const r = await perguntarATriagem(
      e.organizationId,
      { texto, nomeDoContato: e.nomeDoContato ?? null, primeiraMensagem: !linha.antes, categorias },
      deps,
    );
    if (!r.ok) {
      logger.warn("Jev não respondeu à triagem; a IA atende sem a dica dele", {
        organization_id: e.organizationId,
        motivo: r.motivo,
      });
      return undefined;
    }

    await registrarTriagemDoJev(e.pool, {
      organizationId: e.organizationId,
      estado,
      conversationId: e.conversationId,
      messageId: e.messageId,
      jobId: e.jobId,
      contactId: e.contactId,
      agentId: e.agentId,
      veredito: r.veredito,
      uso: r.uso,
      modelo: r.modelo,
      latenciaMs: r.latenciaMs,
    });
    // Certeza ALTA de "equipe", decidindo: abre UM aviso na Central. Não abre caso e não passa
    // a conversa (D5); a IA segue atendendo.
    if (estado === "decidindo" && r.veredito.destinoEfetivo === "equipe") {
      await avisarQueEPraEquipe(e.pool, { organizationId: e.organizationId, conversationId: e.conversationId });
    }
    // A marca "Urgente" do cartão da conversa: só decidindo, e só marca (não muda o destino).
    if (estado === "decidindo") {
      await marcarOuDesmarcarUrgente(e.pool, e.organizationId, e.conversationId, e.messageId, r.veredito.urgente.marcar);
    }
    return { estado, veredito: r.veredito, categorias };
  } catch (erro) {
    logger.warn("triagem do Jev falhou; a IA atende sem a dica dele", {
      organization_id: e.organizationId,
      erro: erro instanceof Error ? erro.name : typeof erro,
    });
    return undefined;
  }
}

/**
 * A marca acompanha a mensagem mais recente: urgente grava `{ em, message_id }`; não urgente tira
 * a marca se ela existia (e não escreve nada se não existia). Sempre na organização do turno.
 */
export async function marcarOuDesmarcarUrgente(
  pool: pg.Pool,
  organizationId: string,
  conversationId: string,
  messageId: string,
  urgente: boolean,
): Promise<void> {
  try {
    if (urgente) {
      await pool.query(
        `update public.conversations
            set metadata = coalesce(metadata, '{}'::jsonb)
                           || jsonb_build_object('${CHAVE_DA_MARCA_URGENTE}', jsonb_build_object('em', now(), 'message_id', $3::text))
          where organization_id = $1 and id = $2`,
        [organizationId, conversationId, messageId],
      );
    } else {
      await pool.query(
        `update public.conversations
            set metadata = metadata - '${CHAVE_DA_MARCA_URGENTE}'
          where organization_id = $1 and id = $2 and metadata ? '${CHAVE_DA_MARCA_URGENTE}'`,
        [organizationId, conversationId],
      );
    }
  } catch (erro) {
    logger.warn("marca de urgente do Jev não foi gravada", {
      organization_id: organizationId,
      erro: erro instanceof Error ? erro.name : typeof erro,
    });
  }
}
