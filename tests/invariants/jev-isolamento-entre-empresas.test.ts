import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createInboundTurnHandler } from "@/lib/agent-engine/agent/inbound-turn";
import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import type { Logger } from "@/lib/agent-engine/obs/logger";
import { claimJobs, completeJob, enqueueJob, failJob } from "@/lib/agent-engine/queue/queue";
import { env } from "@/lib/env";

import { seedGov } from "./gov-helpers";

/**
 * O JEV NÃO MISTURA EMPRESAS (r3, T26; spec 14, seção 8.5, itens 1 a 6).
 *
 * Duas empresas rodam o turno AO MESMO TEMPO (`Promise.all`), com chave, aceite e estado de
 * tarefa diferentes:
 *
 *  - A: aceite de resposta; triagem OBSERVANDO; conferência DECIDINDO com uma resposta que o
 *    Jev veta duas vezes (então a resposta é segurada e o caso abre);
 *  - B: aceite só de mensagem; triagem DECIDINDO; conferência desligada.
 *
 * E se confere, olhando as LINHAS (a empresa de cada linha e a chave que cada pedido levou, e
 * não o valor da chave sozinho: em D2 = B o valor pode ser o mesmo em todas as empresas):
 *
 *  1. cada pedido ao Jev saiu com a chave da empresa do turno, e `buscarChave` só foi
 *     perguntado pela empresa do turno (a regra da chave em SQL fica em
 *     `lib/ai/decisao/isolamento-da-chave.test.ts`);
 *  2. toda linha de `llm_calls` e de `jev_observacoes` aponta para uma mensagem/conversa da
 *     MESMA empresa;
 *  3. o caso nasce na empresa certa, e o aviso de resposta segurada sai só na conversa dela;
 *  4. o custo soma no gasto da empresa certa (`fn_gasto_de_ia_do_mes`);
 *  5. a empresa B, sem conferência, não tem uma linha de DEPOIS (estados diferentes).
 */

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`, max: 6 });

const ADMIN = "aaaaaaaa-0428-4000-8000-000000000001";
const INSTANTE = new Date("2026-09-04T17:30:00Z");
const CHECKPOINT = JSON.stringify({ commitments: [], objections: [], next_action: null, rolling_summary: "turno de teste" });
const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const RASCUNHO_RUIM = "A troca de tela custa R$ 250,00.";
const RASCUNHO_BOM = "Posso ajudar com o seu pedido.";

interface Pedido {
  chave: string;
  tarefa: "triagem" | "conferencia";
}
interface Lado {
  nome: "A" | "B";
  org: string;
  contato: string;
  sessao: string;
  conversa: string;
  mensagem: string;
  chave: string;
  corpos: string[];
  pedidos: Pedido[];
  chavesPedidasPor: string[];
  enviadas: string[];
}

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
    return { content: [{ type: "text" as const, text: CHECKPOINT }], finishReason: { unified: "stop" as const, raw: undefined }, usage: USO, warnings: [] };
  };
}

/** O Jev dublê: guarda a chave de cada pedido e veta a conferência do rascunho com "R$ 250". */
function jevDoLado(l: Lado) {
  return {
    buscarChave: async (org: string) => {
      l.chavesPedidasPor.push(org);
      return org === l.org ? l.chave : null;
    },
    baseUrl: "https://jev.duble.test",
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      const corpo = JSON.parse(String(init?.body));
      const auth = String((init?.headers as Record<string, string>).Authorization);
      const ehTriagem = Object.keys(corpo.questions).includes("categoria");
      l.pedidos.push({ chave: auth.replace("Bearer ", ""), tarefa: ehTriagem ? "triagem" : "conferencia" });
      const ch = (x: string) => ({ type: "choice", choice: x, probabilities: { [x]: 0.95 }, confidence: 0.9 });
      const veta = JSON.stringify(corpo.state).includes("250,00");
      const respostas: Record<string, unknown> = {};
      for (const k of Object.keys(corpo.questions)) {
        respostas[k] = k === "categoria" ? ch("conserto") : k === "destino" ? ch("atender") : { type: "noul", noul: k === "sem_fonte" && veta ? 0.95 : 0.05 };
      }
      return new Response(JSON.stringify({ model: "jev-1.13.0", answers: respostas, usage: { input_tokens: 300, output_tokens: 3 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  };
}

function depsDoLado(l: Lado) {
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
    registry: createFakeRegistry(modelo(l.corpos) as never),
    channel: () =>
      ({
        channel: "captura",
        send: async (i: { body: string }) => {
          l.enviadas.push(i.body);
          return { kind: "sent" as const, idempotencyKey: randomUUID(), messageId: randomUUID() };
        },
        sessionHealth: async () => ({ healthy: true, status: "WORKING" }),
        capabilities: () => ({ freeform: true, media: true, audio: true }),
        costPerMessage: () => ({ currency: "BRL", cents: 0 }),
      }) as never,
    clock: () => INSTANTE,
    sleep: async () => {},
    jev: jevDoLado(l),
  };
}

async function novoLado(nome: "A" | "B", settingsDoJev: unknown, corpos: string[]): Promise<Lado> {
  const l: Lado = {
    nome,
    org: randomUUID(),
    contato: randomUUID(),
    sessao: randomUUID(),
    conversa: randomUUID(),
    mensagem: randomUUID(),
    chave: `tsk_${nome}_${randomUUID().slice(0, 8)}`,
    corpos,
    pedidos: [],
    chavesPedidasPor: [],
    enviadas: [],
  };
  await pool.query(`insert into organizations (id, slug, legal_name, display_name, settings) values ($1, $2, $3, $3, $4)`, [
    l.org,
    `jev-0428-${l.org}`,
    `Jev Isolamento ${nome}`,
    JSON.stringify({ jev: settingsDoJev }),
  ]);
  await pool.query(`insert into contacts (id, organization_id, name, phone_number) values ($1, $2, $3, $4)`, [l.contato, l.org, `Cliente ${nome}`, nome === "A" ? "+5511900000428" : "+5511900000429"]);
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted) values ($1, $2, $3, 'WORKING', '\\x00'::bytea)`,
    [l.sessao, l.org, `jev-0428-${l.sessao}`],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group) values ($1, $2, $3, $4, 'ai_handling', false)`,
    [l.conversa, l.org, l.contato, l.sessao],
  );
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via, sent_at)
     values ($1, $2, $3, $4, $5, 'text', 'inbound', 'delivered', 'Quanto custa a troca de tela?', 'external_device', now())`,
    [l.mensagem, l.org, l.conversa, l.sessao, l.contato],
  );
  return l;
}

const aceite = (alcance: "mensagem" | "resposta") => ({
  em: "2026-11-01T12:00:00.000Z",
  por: ADMIN,
  alcance,
  ...(alcance === "resposta" ? { versao: 2 } : {}),
});

const q = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows;
const escrevivel = env as unknown as Record<string, unknown>;

let A: Lado;
let B: Lado;

beforeAll(async () => {
  seedGov();
  await pool.query(
    `with v as (insert into playbook_versions (organization_id, layer, content) select null, 'platform', E'## Identidade\nAssistente de teste.'
       where not exists (select 1 from playbook_pointers where organization_id is null and layer = 'platform') returning id)
     insert into playbook_pointers (organization_id, layer, version_id) select null, 'platform', id from v`,
  );
  escrevivel.JEV_TRIAGEM_DO_SISTEMA_ENABLED = true;
  escrevivel.JEV_CONFERENCIA_ENABLED = true;

  A = await novoLado(
    "A",
    { ligado: true, aceite: aceite("resposta"), tarefas: { triagem: { estado: "observando" }, conferencia: { estado: "decidindo" } } },
    [RASCUNHO_RUIM, RASCUNHO_RUIM],
  );
  B = await novoLado(
    "B",
    { ligado: true, aceite: aceite("mensagem"), tarefas: { triagem: { estado: "decidindo" }, conferencia: { estado: "desligada" } } },
    [RASCUNHO_BOM],
  );

  await pool.query("update job_queue set status = 'done' where status = 'pending'");
  const jobs = new Map<string, Lado>();
  for (const l of [A, B]) {
    const { job } = await enqueueJob(pool, l.org, {
      kind: "inbound_turn",
      leadId: l.contato,
      payload: { conversation_id: l.conversa, contact_id: l.contato, channel_session_id: l.sessao, inbound_message_id: l.mensagem, crm_event_id: randomUUID() },
      maxAttempts: 1,
    });
    jobs.set(job.id, l);
  }
  const claimed = await claimJobs(pool, { workerId: "jev-0428", maxConcurrency: 2 });
  expect(claimed.map((c) => c.id).sort()).toEqual([...jobs.keys()].sort());
  // AO MESMO TEMPO: os dois turnos em voo juntos.
  await Promise.all(
    claimed.map(async (job) => {
      const lado = jobs.get(job.id)!;
      try {
        await createInboundTurnHandler(depsDoLado(lado))(job, pool, { workerId: "jev-0428" });
        await completeJob(pool, job.id, "jev-0428");
      } catch (err) {
        await failJob(pool, job.id, "jev-0428", err);
        throw err;
      }
    }),
  );
}, 120_000);

beforeEach(() => undefined);
afterAll(() => pool.end());

describe("1. a chave de uma empresa nunca sai pela outra", () => {
  it("todo pedido leva a chave do lado que o fez, e a busca da chave só pergunta pela empresa do turno", () => {
    for (const l of [A, B]) {
      expect(l.pedidos.length, `lado ${l.nome} chamou o Jev`).toBeGreaterThan(0);
      expect(l.pedidos.every((p) => p.chave === l.chave), `chave de ${l.nome}`).toBe(true);
      expect(l.chavesPedidasPor.length).toBeGreaterThan(0);
      expect(l.chavesPedidasPor.every((o) => o === l.org), `buscarChave de ${l.nome}`).toBe(true);
    }
    expect(A.chave).not.toBe(B.chave);
  });

  it("os estados diferentes valem: A faz ANTES e DEPOIS (a resposta ruim volta ao modelo uma vez); B só o ANTES", () => {
    const n = (l: Lado, t: Pedido["tarefa"]) => l.pedidos.filter((p) => p.tarefa === t).length;
    expect(n(A, "triagem")).toBe(1);
    expect(n(A, "conferencia")).toBe(2);
    expect(n(B, "triagem")).toBe(1);
    expect(n(B, "conferencia")).toBe(0);
  });
});

describe("2. toda linha carrega a empresa certa", () => {
  it("llm_calls: cada linha do Jev tem a empresa do contato dela", async () => {
    const linhas = await q(
      `select l.organization_id, l.purpose, c.organization_id as org_do_contato
         from llm_calls l left join contacts c on c.id = l.contact_id
        where l.provider = 'typesafe' and l.organization_id = any($1)`,
      [[A.org, B.org]],
    );
    expect(linhas.length).toBeGreaterThan(0);
    for (const x of linhas) expect(x.org_do_contato === null || x.org_do_contato === x.organization_id).toBe(true);
    const por = (org: string) => linhas.filter((x) => x.organization_id === org).map((x) => x.purpose).sort();
    expect(por(A.org)).toEqual(["jev_antes", "jev_depois", "jev_depois"]);
    expect(por(B.org)).toEqual(["jev_antes"]);
  });

  it("jev_observacoes: mensagem e conversa de cada linha são da mesma empresa", async () => {
    const linhas = await q(
      `select o.organization_id, o.tarefa, o.estado, m.organization_id as org_msg, cv.organization_id as org_conv
         from jev_observacoes o
         left join messages m on m.id = o.message_id
         left join conversations cv on cv.id = o.conversation_id
        where o.organization_id = any($1)`,
      [[A.org, B.org]],
    );
    expect(linhas.length).toBeGreaterThan(0);
    for (const x of linhas) {
      expect(x.org_msg).toBe(x.organization_id);
      expect(x.org_conv).toBe(x.organization_id);
    }
    expect(linhas.find((x) => x.organization_id === B.org && x.tarefa === "conferencia")).toBeUndefined();
    expect(linhas.find((x) => x.organization_id === A.org && x.tarefa === "triagem")?.estado).toBe("observando");
    expect(linhas.find((x) => x.organization_id === B.org && x.tarefa === "triagem")?.estado).toBe("decidindo");
  });
});

describe("3. o caso e o aviso nascem na empresa certa", () => {
  it("só A tem caso (a resposta ruim foi segurada duas vezes), na conversa de A", async () => {
    const casos = await q(`select organization_id, conversation_id from agent_cases where organization_id = any($1)`, [[A.org, B.org]]);
    expect(casos).toHaveLength(1);
    expect(casos[0]).toMatchObject({ organization_id: A.org, conversation_id: A.conversa });
  });

  it("o cliente de A não recebeu o rascunho ruim; o de B recebeu a resposta dele; nada atravessou", () => {
    expect(A.enviadas).not.toContain(RASCUNHO_RUIM);
    expect(A.enviadas.length).toBe(1);
    expect(B.enviadas).toEqual([RASCUNHO_BOM]);
    expect(B.enviadas.join(" ")).not.toContain("250,00");
  });
});

describe("4. o custo soma no gasto da empresa certa", () => {
  it("fn_gasto_de_ia_do_mes de cada empresa é a soma das linhas dela, e só dela", async () => {
    for (const l of [A, B]) {
      const [{ soma }] = await q(`select coalesce(sum(cost_cents), 0)::float8 as soma from llm_calls where organization_id = $1 and provider = 'typesafe'`, [l.org]);
      const [{ gasto }] = await q(`select public.fn_gasto_de_ia_do_mes($1)::float8 as gasto`, [l.org]);
      expect(gasto).toBeGreaterThanOrEqual(soma);
    }
    const [{ a }] = await q(`select count(*)::int as a from llm_calls where organization_id = $1 and provider = 'typesafe'`, [A.org]);
    const [{ b }] = await q(`select count(*)::int as b from llm_calls where organization_id = $1 and provider = 'typesafe'`, [B.org]);
    expect(a).toBe(3);
    expect(b).toBe(1);
  });
});
