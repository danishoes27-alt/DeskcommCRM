import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createInboundTurnHandler } from "@/lib/agent-engine/agent/inbound-turn";
import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import type { Logger } from "@/lib/agent-engine/obs/logger";
import { claimJobs, completeJob, enqueueJob, failJob } from "@/lib/agent-engine/queue/queue";
import { registrarSucesso } from "@/lib/ai/decisao/disjuntor";
import { env } from "@/lib/env";

import { seedGov } from "./gov-helpers";

/**
 * A CONFERÊNCIA DO "DEPOIS" PELO TURNO DE VERDADE (r3, T13 e T25): Postgres real, o
 * modelo de linguagem num registry dublê, o Jev num `fetch` dublê injetado por `deps.jev`
 * e o canal num dublê que guarda o que "enviou". Prova o que o unitário não alcança:
 * a regra das 2 tentativas, o caso na empresa certa, o aviso ao cliente, a gravação de
 * custo e observação (o SQL de verdade), o incidente da plataforma e o isolamento entre
 * empresas. Cada caso tem a sua organização: o disjuntor é por organização e vive no processo.
 */

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`, max: 4 });

const ADMIN = "aaaaaaaa-0425-4000-8000-000000000001";
const INSTANTE = new Date("2026-09-04T17:30:00Z");
const PERGUNTA = "Quanto custa a troca de tela?";
const RASCUNHO_RUIM = "A troca de tela custa R$ 250,00.";
const RASCUNHO_BOM = "Vou confirmar o valor com a equipe e já te falo!";

const CHECKPOINT = JSON.stringify({ commitments: [], objections: [], next_action: null, rolling_summary: "turno de teste" });
const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

interface Rodada {
  pedidosAoJev: Array<{ corpo: { model: string; state: Record<string, unknown>; questions: Record<string, unknown> } }>;
  enviadas: string[];
  avisos: Array<{ msg: string; campos: Record<string, unknown> }>;
}
const novaRodada = (): Rodada => ({ pedidosAoJev: [], enviadas: [], avisos: [] });

/** O modelo manda `corpos[n]` no n-ésimo `send_message` e, esgotados, fecha o turno. */
function modelo(corpos: string[]) {
  let n = 0;
  return async () => {
    if (n < corpos.length) {
      const body = corpos[n++]!;
      return {
        content: [{ type: "tool-call" as const, toolCallId: `c${n}`, toolName: "send_message", input: JSON.stringify({ body }) }],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: USO,
        warnings: [],
      };
    }
    return {
      content: [{ type: "text" as const, text: CHECKPOINT }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: USO,
      warnings: [],
    };
  };
}

/** O Jev: `prob` por pergunta (ou um status de erro). */
function jevDuble(r: Rodada, prob: [number, number, number] | number) {
  return {
    buscarChave: async () => "tsk_duble_do_teste",
    baseUrl: "https://jev.duble.test",
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      r.pedidosAoJev.push({ corpo: JSON.parse(String(init?.body)) });
      if (typeof prob === "number") return new Response("{}", { status: prob });
      const noul = (n: number) => ({ type: "noul", noul: n });
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: { sem_fonte: noul(prob[0]), promete_aprovacao: noul(prob[1]), inventa_dado: noul(prob[2]) },
          usage: { input_tokens: 700, output_tokens: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  };
}

function deps(corpos: string[], r: Rodada, jev: ReturnType<typeof jevDuble>) {
  const log: Logger = { info: () => undefined, error: () => undefined, warn: (msg, campos) => r.avisos.push({ msg, campos: campos ?? {} }) };
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
    registry: createFakeRegistry(modelo(corpos) as never),
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

type EstadoDaConferencia = "observando" | "decidindo" | "desligada";
function settingsDoJev(estado: EstadoDaConferencia) {
  return {
    jev: {
      ligado: true,
      aceite: { em: "2026-11-01T12:00:00.000Z", por: ADMIN, alcance: "resposta", versao: 2 },
      tarefas: { conferencia: { estado } },
    },
  };
}

interface Cenario { org: string; sessao: string; contato: string; conversa: string; mensagem: string }

async function cenario(estado: EstadoDaConferencia, opcoes: { casoAberto?: boolean } = {}): Promise<Cenario> {
  const [org, contato, sessao, conversa, mensagem] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name, settings) values ($1, $2, 'Jev Conferencia', 'Jev Conferencia', $3)`,
    [org, `jev-0425-${org}`, JSON.stringify(settingsDoJev(estado))],
  );
  await pool.query(`insert into contacts (id, organization_id, name, phone_number) values ($1, $2, 'Lead', '+5511900000425')`, [contato, org]);
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted) values ($1, $2, $3, 'WORKING', '\\x00'::bytea)`,
    [sessao, org, `jev-0425-${sessao}`],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group) values ($1, $2, $3, $4, 'ai_handling', false)`,
    [conversa, org, contato, sessao],
  );
  await novaMensagem({ org, sessao, contato, conversa, mensagem });
  if (opcoes.casoAberto) {
    await pool.query(
      `insert into agent_cases (organization_id, conversation_id, title, summary, blocker, source, kind)
       values ($1, $2, 'Caso que já existia', 'x', 'y', 'agent', 'outro')`,
      [org, conversa],
    );
  }
  return { org, sessao, contato, conversa, mensagem };
}

async function novaMensagem(c: Pick<Cenario, "org" | "sessao" | "contato" | "conversa" | "mensagem">, texto = PERGUNTA) {
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via, sent_at)
     values ($1, $2, $3, $4, $5, 'text', 'inbound', 'delivered', $6, 'external_device', now())`,
    [c.mensagem, c.org, c.conversa, c.sessao, c.contato, texto],
  );
}

async function rodaTurno(c: Cenario, d: ReturnType<typeof deps>): Promise<string> {
  await pool.query("update job_queue set status = 'done' where status = 'pending'");
  const { job } = await enqueueJob(pool, c.org, {
    kind: "inbound_turn",
    leadId: c.contato,
    payload: { conversation_id: c.conversa, contact_id: c.contato, channel_session_id: c.sessao, inbound_message_id: c.mensagem, crm_event_id: randomUUID() },
    maxAttempts: 1,
  });
  const [claimed] = await claimJobs(pool, { workerId: "jev-0425", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await createInboundTurnHandler(d)(claimed!, pool, { workerId: "jev-0425" });
    await completeJob(pool, claimed!.id, "jev-0425");
  } catch (err) {
    await failJob(pool, claimed!.id, "jev-0425", err);
    throw err;
  }
  return job.id;
}

const q = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows;
const casos = (org: string) => q(`select organization_id, conversation_id, source, kind, status from agent_cases where organization_id = $1`, [org]);
const observacoes = (org: string) =>
  q(`select tarefa, estado, rotulo_jev, rotulo_atual, probabilidade_jev::float8 as p, message_id from jev_observacoes where organization_id = $1`, [org]);
const chamadas = (org: string) =>
  q(`select purpose, status, error_code, origem_da_escolha, cost_cents::float8 as custo, model from llm_calls where organization_id = $1 and provider = 'typesafe' order by created_at`, [org]);
const rastros = (org: string) =>
  q(`select vetoed_gate, vetoed_code from before_send_traces where organization_id = $1 and vetoed_gate is not null order by created_at`, [org]);

beforeAll(async () => {
  seedGov();
  await pool.query(
    `with v as (insert into playbook_versions (organization_id, layer, content) select null, 'platform', E'## Identidade\nAssistente de teste.'
       where not exists (select 1 from playbook_pointers where organization_id is null and layer = 'platform') returning id)
     insert into playbook_pointers (organization_id, layer, version_id) select null, 'platform', id from v`,
  );
});
afterAll(() => pool.end());

const escrevivel = env as unknown as Record<string, unknown>;
beforeEach(() => {
  escrevivel.JEV_CONFERENCIA_ENABLED = true;
});

describe("a conferência do depois, pelo turno real", () => {
  it("DECIDINDO, reprovada duas vezes: o cliente não recebe o rascunho, a equipe recebe o caso e o cliente o aviso", async () => {
    const c = await cenario("decidindo");
    const r = novaRodada();
    const jobId = await rodaTurno(c, deps([RASCUNHO_RUIM, RASCUNHO_RUIM], r, jevDuble(r, [0.9, 0.1, 0.1])));

    // O cliente: nenhum rascunho ruim; só o aviso fixo.
    expect(r.enviadas.some((e) => e.includes("R$ 250"))).toBe(false);
    expect(r.enviadas).toHaveLength(1);
    expect(r.enviadas[0]).toMatch(/confirmar/);
    // A equipe: UM caso, na empresa e na conversa do turno.
    expect(await casos(c.org)).toEqual([
      { organization_id: c.org, conversation_id: c.conversa, source: "guardrail_autofallback", kind: "duvida", status: "awaiting_human" },
    ]);
    // O rastro: os dois vetos e o desfecho.
    expect(await rastros(c.org)).toEqual([
      { vetoed_gate: "jev_conferencia", vetoed_code: "jev_conferencia" },
      { vetoed_gate: "jev_conferencia", vetoed_code: "jev_conferencia" },
      { vetoed_gate: "jev_conferencia", vetoed_code: "resposta_segurada" },
    ]);
    // O custo: UMA linha por chamada (as duas), com preço, finalidade e job; e UMA observação.
    const cs = await chamadas(c.org);
    expect(cs).toHaveLength(2);
    for (const l of cs) expect(l).toMatchObject({ purpose: "jev_depois", status: "ok", origem_da_escolha: "jev", model: "typesafe/jev-1.13.0" });
    expect(cs.every((l) => l.custo !== null && l.custo > 0)).toBe(true);
    const obs = await observacoes(c.org);
    expect(obs).toEqual([{ tarefa: "conferencia", estado: "decidindo", rotulo_jev: "sem_fonte", rotulo_atual: "sem_fonte", p: 0.9, message_id: c.mensagem }]);
    expect(jobId).toBeTruthy();
    // O que foi ao Jev: só { resposta_da_ia, evidencias }, e nunca a pergunta do cliente.
    expect(Object.keys(r.pedidosAoJev[0]!.corpo.state).sort()).toEqual(["evidencias", "resposta_da_ia"]);
    expect(JSON.stringify(r.pedidosAoJev)).not.toContain(PERGUNTA);
    expect(r.pedidosAoJev[0]!.corpo.model).toBe("jev-1.13.0");
  });

  it("DECIDINDO, depois de segurar de vez: um NOVO send_message no mesmo turno não sai e não chama o Jev", async () => {
    const c = await cenario("decidindo");
    const r = novaRodada();
    // Duas reprovações seguram a resposta; o modelo insiste com uma terceira, limpa.
    await rodaTurno(c, deps([RASCUNHO_RUIM, RASCUNHO_RUIM, RASCUNHO_BOM], r, jevDuble(r, [0.9, 0.1, 0.1])));

    expect(r.pedidosAoJev).toHaveLength(2);
    expect(r.enviadas).toHaveLength(1);
    expect(r.enviadas[0]).toMatch(/confirmar/);
    expect(r.enviadas).not.toContain(RASCUNHO_BOM);
    expect(await casos(c.org)).toHaveLength(1);
    expect(await chamadas(c.org)).toHaveLength(2);
  });

  it("DECIDINDO, reprovada na 1ª e aprovada na 2ª: sai a segunda, sem caso e sem aviso", async () => {
    const c = await cenario("decidindo");
    const r = novaRodada();
    await rodaTurno(c, deps([RASCUNHO_RUIM, RASCUNHO_BOM], r, jevDuble(r, [0.05, 0.05, 0.05])));
    // O Jev disse "tudo bem" nas duas, mas a regra local segurou a 1ª (valor sem fonte): o Jev só aperta.
    expect(r.enviadas).toEqual([RASCUNHO_BOM]);
    expect(await casos(c.org)).toEqual([]);
    expect(await rastros(c.org)).toEqual([{ vetoed_gate: "jev_conferencia", vetoed_code: "jev_conferencia" }]);
    expect(await chamadas(c.org)).toHaveLength(2);
  });

  it("OBSERVANDO nunca segura: o rascunho sai, não há caso, e o trace diz o que FARIA", async () => {
    const c = await cenario("observando");
    const r = novaRodada();
    await rodaTurno(c, deps([RASCUNHO_RUIM], r, jevDuble(r, [0.9, 0.1, 0.1])));
    expect(r.enviadas).toEqual([RASCUNHO_RUIM]);
    expect(await casos(c.org)).toEqual([]);
    expect(await rastros(c.org)).toEqual([]);
    const { rows } = await pool.query(`select trace from before_send_traces where organization_id = $1 order by created_at`, [c.org]);
    const gate = (rows[0].trace as Array<{ gate: string; code?: string; detail?: Record<string, unknown> }>).find((g) => g.gate === "jev_conferencia");
    expect(gate).toMatchObject({ code: "observando", detail: { faria: "segurar" } });
    expect(await observacoes(c.org)).toHaveLength(1);
  });

  it("tarefa desligada ou interruptor da instalação desligado: o Jev não é chamado e o rascunho sai", async () => {
    const desligada = await cenario("desligada");
    const r1 = novaRodada();
    await rodaTurno(desligada, deps([RASCUNHO_RUIM], r1, jevDuble(r1, [0.9, 0.9, 0.9])));
    expect(r1.pedidosAoJev).toEqual([]);
    expect(r1.enviadas).toEqual([RASCUNHO_RUIM]);

    escrevivel.JEV_CONFERENCIA_ENABLED = false;
    const semInterruptor = await cenario("decidindo");
    const r2 = novaRodada();
    await rodaTurno(semInterruptor, deps([RASCUNHO_RUIM], r2, jevDuble(r2, [0.9, 0.9, 0.9])));
    expect(r2.pedidosAoJev).toEqual([]);
    expect(r2.enviadas).toEqual([RASCUNHO_RUIM]);
    expect(await chamadas(semInterruptor.org)).toEqual([]);
  });

  it("JÁ HAVIA caso aberto: nenhum caso novo e o cliente é avisado uma única vez", async () => {
    const c = await cenario("decidindo", { casoAberto: true });
    const r = novaRodada();
    await rodaTurno(c, deps([RASCUNHO_RUIM, RASCUNHO_RUIM], r, jevDuble(r, [0.9, 0.1, 0.1])));
    expect((await casos(c.org)).length).toBe(1);
    expect(r.enviadas).toHaveLength(1);
    expect(r.enviadas.some((e) => e.includes("R$ 250"))).toBe(false);
    const { rows } = await pool.query(
      `select e.kind, e.body from agent_case_events e join agent_cases k on k.id = e.case_id where k.organization_id = $1 and e.kind = 'agent_noted'`,
      [c.org],
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((x) => String(x.body).startsWith("O cliente recebeu o aviso"))).toBe(true);

    // Uma nova resposta segurada na MESMA conversa: segue com um caso só e NENHUM aviso a mais.
    const segunda = { ...c, mensagem: randomUUID() };
    await novaMensagem(segunda, "E então, quanto fica?");
    const r2 = novaRodada();
    registrarSucesso({ organizationId: c.org, tarefa: "conferencia" });
    await rodaTurno(segunda, deps([RASCUNHO_RUIM, RASCUNHO_RUIM], r2, jevDuble(r2, [0.9, 0.1, 0.1])));
    expect((await casos(c.org)).length).toBe(1);
    expect(r2.enviadas).toEqual([]);
  });

  it("Jev fora do ar: a resposta sem achado local sai; a queda fica registrada; chave recusada avisa o dono da plataforma", async () => {
    await pool.query(`delete from incidents where type in ('jev_chave_recusada', 'jev_sem_credito')`);
    const c = await cenario("decidindo");
    const r = novaRodada();
    await rodaTurno(c, deps([RASCUNHO_BOM], r, jevDuble(r, 401)));
    expect(r.enviadas).toEqual([RASCUNHO_BOM]);
    const cs = await chamadas(c.org);
    expect(cs).toEqual([expect.objectContaining({ purpose: "jev_depois", status: "erro", error_code: "jev_credencial_invalida" })]);
    expect(await observacoes(c.org)).toEqual([]);
    const inc = await q(`select organization_id, type, severity, status, payload from incidents where type = 'jev_chave_recusada'`, []);
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ organization_id: null, severity: "critical", status: "open" });
    expect(inc[0].payload).toMatchObject({ primeira_organizacao: c.org, tarefas: { conferencia: expect.any(String) } });

    // Outra loja, mesma chave: ATUALIZA o incidente, não abre outro.
    const outra = await cenario("decidindo");
    const r2 = novaRodada();
    await rodaTurno(outra, deps([RASCUNHO_BOM], r2, jevDuble(r2, 401)));
    const depois = await q(`select payload from incidents where type = 'jev_chave_recusada'`, []);
    expect(depois).toHaveLength(1);
    expect(depois[0].payload).toMatchObject({ ultima_organizacao: outra.org, ocorrencias: 2 });
  });
});

describe("isolamento entre empresas", () => {
  it("duas empresas com estados diferentes: cada linha de custo, observação e caso carrega a empresa certa", async () => {
    const a = await cenario("decidindo");
    const b = await cenario("observando");
    const ra = novaRodada();
    const rb = novaRodada();
    await rodaTurno(a, deps([RASCUNHO_RUIM, RASCUNHO_RUIM], ra, jevDuble(ra, [0.9, 0.1, 0.1])));
    await rodaTurno(b, deps([RASCUNHO_RUIM], rb, jevDuble(rb, [0.9, 0.1, 0.1])));

    expect((await casos(a.org)).map((x) => x.organization_id)).toEqual([a.org]);
    expect(await casos(b.org)).toEqual([]);
    expect((await chamadas(a.org)).length).toBe(2);
    expect((await chamadas(b.org)).length).toBe(1);
    expect((await observacoes(a.org)).map((x) => x.estado)).toEqual(["decidindo"]);
    expect((await observacoes(b.org)).map((x) => x.estado)).toEqual(["observando"]);
    // Nenhuma linha nova de uma empresa aponta para a conversa da outra.
    const cruzado = await q(
      `select count(*)::int as n from jev_observacoes o where o.organization_id = $1 and o.conversation_id = $2`,
      [a.org, b.conversa],
    );
    expect(cruzado[0].n).toBe(0);
    // O que A mandou não vazou para B: só 'A' tem aviso ao cliente.
    expect(ra.enviadas).toHaveLength(1);
    expect(rb.enviadas).toEqual([RASCUNHO_RUIM]);
  });
});
