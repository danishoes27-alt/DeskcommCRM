import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { conferirOTurno } from "@/lib/agent-engine/agent/conferencia-no-turno";
import { createInboundTurnHandler } from "@/lib/agent-engine/agent/inbound-turn";
import { triarOTurno } from "@/lib/agent-engine/agent/triagem-no-turno";
import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import type { Logger } from "@/lib/agent-engine/obs/logger";
import { claimJobs, completeJob, enqueueJob, failJob } from "@/lib/agent-engine/queue/queue";
import { registrarSucesso } from "@/lib/ai/decisao/disjuntor";
import { env } from "@/lib/env";

import { seedGov } from "./gov-helpers";

/**
 * NENHUMA CHAMADA AO JEV SEM TODAS AS GUARDAS (r3, T25; spec 14, seção 8.5).
 *
 * As guardas da chamada, para as DUAS tarefas novas: interruptor mestre da empresa, aceite (com
 * o alcance certo), tarefa ligada, chave, interruptor da INSTALAÇÃO, contato não bloqueado e
 * fora da prévia de teste. Cada caso tira UMA guarda de um turno que, com todas, chama o Jev, e
 * confere que a(s) tarefa(s) que ela protege fica(m) com ZERO pedidos ao fornecedor. O caso de
 * controle mostra que o turno íntegro chama (um "zero" só vale se a sonda enxerga uma chamada)
 * e que o `state` traz só o que a spec permite. A ordem do opt-out e a máscara de dados pessoais
 * ficam em `jev-triagem-no-turno` e `jev-manipulacao-no-turno`.
 */

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`, max: 4 });

const ADMIN = "aaaaaaaa-0427-4000-8000-000000000001";
const INSTANTE = new Date("2026-09-04T17:30:00Z");
const CHECKPOINT = JSON.stringify({ commitments: [], objections: [], next_action: null, rolling_summary: "turno de teste" });
const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

interface Pedido {
  corpo: { state: unknown; questions: Record<string, unknown> };
}
interface Rodada {
  pedidos: Pedido[];
  enviadas: string[];
}

function modelo() {
  let mandou = false;
  return async () => {
    if (!mandou) {
      mandou = true;
      return {
        content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "send_message", input: JSON.stringify({ body: "Posso ajudar com o seu pedido." }) }],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: USO,
        warnings: [],
      };
    }
    return { content: [{ type: "text" as const, text: CHECKPOINT }], finishReason: { unified: "stop" as const, raw: undefined }, usage: USO, warnings: [] };
  };
}

/** O Jev dublê responde às duas tarefas conforme as perguntas do pedido; tudo "ok" (nada veta). */
function jevDuble(r: Rodada, chave: string | null) {
  return {
    buscarChave: async () => chave,
    baseUrl: "https://jev.duble.test",
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      const corpo = JSON.parse(String(init?.body));
      r.pedidos.push({ corpo });
      const ch = (x: string) => ({ type: "choice", choice: x, probabilities: { [x]: 0.95 }, confidence: 0.9 });
      const respostas: Record<string, unknown> = {};
      for (const k of Object.keys(corpo.questions)) {
        respostas[k] = k === "categoria" ? ch("conserto") : k === "destino" ? ch("atender") : { type: "noul", noul: 0.05 };
      }
      return new Response(JSON.stringify({ model: "jev-1.13.0", answers: respostas, usage: { input_tokens: 10, output_tokens: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  };
}

function deps(r: Rodada, jev: ReturnType<typeof jevDuble>) {
  const log: Logger = { info: () => undefined, error: () => undefined, warn: () => undefined };
  return {
    crmCfg: { supabase: {} as never },
    llmCfg: { anthropicApiKey: "fake" } as never,
    knobs: {
      historyLimit: 10,
      maxContextTokens: 1000,
      notesIndexMaxTokens: 500,
      maxSteps: 12,
      queuedRetryDelayMs: 1000,
      breaker: { exactFailureWarn: 2, exactFailureBlock: 5, sameToolFailureWarn: 3, sameToolFailureHalt: 8, noProgressWarn: 3, noProgressBlock: 5 },
    },
    log,
    registry: createFakeRegistry(modelo() as never),
    channel: () =>
      ({
        channel: "captura",
        send: async (i: { body: string }) => {
          r.enviadas.push(i.body);
          return { kind: "sent" as const, idempotencyKey: randomUUID(), messageId: randomUUID() };
        },
        sessionHealth: async () => ({ healthy: true, status: "WORKING" }),
        capabilities: () => ({ freeform: true, media: true, audio: true }),
        costPerMessage: () => ({ currency: "BRL", cents: 0 }),
      }) as never,
    clock: () => INSTANTE,
    sleep: async () => {},
    jev,
  };
}

interface Guardas {
  mestre: boolean;
  aceite: "resposta" | "mensagem" | "nenhum";
  triagem: "observando" | "desligada";
  conferencia: "observando" | "desligada";
  chave: boolean;
  instalacaoTriagem: boolean;
  instalacaoConferencia: boolean;
  bloqueado: boolean;
}
const INTEIRAS: Guardas = {
  mestre: true,
  aceite: "resposta",
  triagem: "observando",
  conferencia: "observando",
  chave: true,
  instalacaoTriagem: true,
  instalacaoConferencia: true,
  bloqueado: false,
};

const escrevivel = env as unknown as Record<string, unknown>;

async function turno(g: Guardas): Promise<Rodada> {
  const [org, contato, sessao, conversa, mensagem] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const jev = {
    ligado: g.mestre,
    ...(g.aceite === "nenhum"
      ? {}
      : { aceite: { em: "2026-11-01T12:00:00.000Z", por: ADMIN, alcance: g.aceite, ...(g.aceite === "resposta" ? { versao: 2 } : {}) } }),
    tarefas: { triagem: { estado: g.triagem }, conferencia: { estado: g.conferencia } },
  };
  await pool.query(`insert into organizations (id, slug, legal_name, display_name, settings) values ($1, $2, 'Jev Guardas', 'Jev Guardas', $3)`, [
    org,
    `jev-0427-${org}`,
    JSON.stringify({ jev }),
  ]);
  await pool.query(`insert into contacts (id, organization_id, name, phone_number, is_blocked) values ($1, $2, 'Maria Souza', '+5511900000427', $3)`, [
    contato,
    org,
    g.bloqueado,
  ]);
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted) values ($1, $2, $3, 'WORKING', '\\x00'::bytea)`,
    [sessao, org, `jev-0427-${sessao}`],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group) values ($1, $2, $3, $4, 'ai_handling', false)`,
    [conversa, org, contato, sessao],
  );
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via, sent_at)
     values ($1, $2, $3, $4, $5, 'text', 'inbound', 'delivered', 'Minha tela quebrou, quanto custa a troca?', 'external_device', now())`,
    [mensagem, org, conversa, sessao, contato],
  );
  escrevivel.JEV_TRIAGEM_DO_SISTEMA_ENABLED = g.instalacaoTriagem;
  escrevivel.JEV_CONFERENCIA_ENABLED = g.instalacaoConferencia;
  const r: Rodada = { pedidos: [], enviadas: [] };
  const d = deps(r, jevDuble(r, g.chave ? "tsk_duble_do_teste" : null));
  await pool.query("update job_queue set status = 'done' where status = 'pending'");
  const { job } = await enqueueJob(pool, org, {
    kind: "inbound_turn",
    leadId: contato,
    payload: { conversation_id: conversa, contact_id: contato, channel_session_id: sessao, inbound_message_id: mensagem, crm_event_id: randomUUID() },
    maxAttempts: 1,
  });
  const [claimed] = await claimJobs(pool, { workerId: "jev-0427", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await createInboundTurnHandler(d)(claimed!, pool, { workerId: "jev-0427" });
    await completeJob(pool, claimed!.id, "jev-0427");
  } catch (err) {
    await failJob(pool, claimed!.id, "jev-0427", err);
    throw err;
  }
  return r;
}

const tarefaDe = (p: Pedido) => (Object.keys(p.corpo.questions).includes("categoria") ? "triagem" : "conferencia");

beforeAll(async () => {
  seedGov();
  await pool.query(
    `with v as (insert into playbook_versions (organization_id, layer, content) select null, 'platform', E'## Identidade\nAssistente de teste.'
       where not exists (select 1 from playbook_pointers where organization_id is null and layer = 'platform') returning id)
     insert into playbook_pointers (organization_id, layer, version_id) select null, 'platform', id from v`,
  );
});
afterAll(() => pool.end());
beforeEach(() => {
  registrarSucesso({ organizationId: "x", tarefa: "triagem" });
});

describe("controle: com todas as guardas o turno chama o Jev nas duas tarefas", () => {
  it("uma chamada do ANTES e uma do DEPOIS, e o state só traz o que a spec permite", async () => {
    const r = await turno(INTEIRAS);
    const por = (t: string) => r.pedidos.filter((p) => tarefaDe(p) === t);
    expect(por("triagem")).toHaveLength(1);
    expect(por("conferencia")).toHaveLength(1);
    // ANTES: o state é o texto digitado, nada de nome, telefone ou ids.
    const antes = JSON.stringify(por("triagem")[0]!.corpo.state);
    expect(antes).toContain("Minha tela quebrou");
    expect(antes).not.toMatch(/Maria|Souza|5511900000427|[0-9a-f]{8}-[0-9a-f]{4}-/);
    // DEPOIS: só a resposta da IA e as evidências.
    const depois = por("conferencia")[0]!.corpo.state as Record<string, unknown>;
    expect(Object.keys(depois).sort()).toEqual(["evidencias", "resposta_da_ia"]);
    expect(JSON.stringify(depois)).not.toMatch(/Maria|Souza|5511900000427/);
  });
});

describe("tirar UMA guarda zera as chamadas da(s) tarefa(s) que ela protege", () => {
  const casos: Array<[string, Partial<Guardas>, { antes: boolean; depois: boolean }]> = [
    ["interruptor mestre da empresa desligado", { mestre: false }, { antes: false, depois: false }],
    ["sem aceite", { aceite: "nenhum" }, { antes: false, depois: false }],
    ["aceite só de mensagem: cobre o ANTES, não o DEPOIS", { aceite: "mensagem" }, { antes: true, depois: false }],
    ["tarefa triagem desligada", { triagem: "desligada" }, { antes: false, depois: true }],
    ["tarefa conferência desligada", { conferencia: "desligada" }, { antes: true, depois: false }],
    ["sem chave do Jev", { chave: false }, { antes: false, depois: false }],
    ["interruptor da instalação da triagem desligado", { instalacaoTriagem: false }, { antes: false, depois: true }],
    ["interruptor da instalação da conferência desligado", { instalacaoConferencia: false }, { antes: true, depois: false }],
    ["contato bloqueado", { bloqueado: true }, { antes: false, depois: false }],
  ];
  it.each(casos)("%s", async (_nome, tirar, esperado) => {
    const r = await turno({ ...INTEIRAS, ...tirar });
    const n = (t: string) => r.pedidos.filter((p) => tarefaDe(p) === t).length;
    expect(n("triagem") > 0, "ANTES").toBe(esperado.antes);
    expect(n("conferencia") > 0, "DEPOIS").toBe(esperado.depois);
  });
});

describe("prévia de teste: nenhuma das duas tarefas chama o Jev nem toca o banco", () => {
  const semBanco = {
    query: () => {
      throw new Error("a prévia não pode consultar o banco");
    },
  } as unknown as pg.Pool;

  it("o ANTES", async () => {
    const out = await triarOTurno({
      pool: semBanco,
      organizationId: randomUUID(),
      tipoDoJob: "inbound_turn",
      preview: true,
      contatoBloqueado: false,
      conversationId: randomUUID(),
      messageId: randomUUID(),
      jobId: null,
      contactId: null,
      agentId: null,
    });
    expect(out).toBeUndefined();
  });

  it("o DEPOIS", async () => {
    const r: Rodada = { pedidos: [], enviadas: [] };
    const out = await conferirOTurno(
      {
        pool: semBanco,
        organizationId: randomUUID(),
        tipoDoJob: "inbound_turn",
        preview: true,
        rascunho: "A troca de tela custa R$ 250,00.",
        evidencias: { todas: [], consultou: false, senhasDoCliente: [], documentosDoCliente: [] },
        conversationId: null,
        messageId: null,
        jobId: null,
        contactId: null,
        agentId: null,
      } as never,
      jevDuble(r, "tsk_duble_do_teste") as never,
    );
    expect(out).toBeUndefined();
    expect(r.pedidos).toHaveLength(0);
  });
});
