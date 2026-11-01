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
 * A TRIAGEM DO "ANTES" PELO TURNO DE VERDADE (r3, T18 e T25): Postgres real, o modelo de
 * linguagem num registry dublê, o Jev num `fetch` dublê (`deps.jev`) e o canal num dublê.
 * Prova a FIAÇÃO: as guardas do turno (interruptor da instalação, tarefa, aceite, prévia,
 * contato bloqueado, opt-out e pedido de atendente SEMPRE antes), o que sai ao fornecedor
 * (só o texto digitado, mascarado), o que se grava (custo, observação, metadado) e o
 * isolamento entre empresas.
 */

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`, max: 4 });

const ADMIN = "aaaaaaaa-0426-4000-8000-000000000001";
const INSTANTE = new Date("2026-09-04T17:30:00Z");
const PERGUNTA = "Minha tela quebrou, quanto custa a troca?";

const CHECKPOINT = JSON.stringify({ commitments: [], objections: [], next_action: null, rolling_summary: "turno de teste" });
const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

interface Rodada {
  pedidosAoJev: Array<{ corpo: { model: string; state: unknown; questions: Record<string, unknown> } }>;
  enviadas: string[];
  prompts: string[];
}
const novaRodada = (): Rodada => ({ pedidosAoJev: [], enviadas: [], prompts: [] });

/** O agente manda UMA mensagem e fecha o turno. */
function modelo(r: Rodada) {
  let mandou = false;
  return async (options: { prompt: unknown }) => {
    r.prompts.push(JSON.stringify(options.prompt));
    if (!mandou) {
      mandou = true;
      return {
        content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "send_message", input: JSON.stringify({ body: "Posso ajudar com o seu pedido." }) }],
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

type Resp = { categoria: [string, number, number]; destino: [string, number, number]; urgente: number } | number;
const ALTA: Resp = { categoria: ["conserto", 0.95, 0.9], destino: ["atender", 0.95, 0.9], urgente: 0.1 };

function jevDuble(r: Rodada, resp: Resp) {
  return {
    buscarChave: async () => "tsk_duble_do_teste",
    baseUrl: "https://jev.duble.test",
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      r.pedidosAoJev.push({ corpo: JSON.parse(String(init?.body)) });
      if (typeof resp === "number") return new Response("{}", { status: resp });
      const ch = (x: [string, number, number]) => ({ type: "choice", choice: x[0], probabilities: { [x[0]]: x[1] }, confidence: x[2] });
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: { categoria: ch(resp.categoria), destino: ch(resp.destino), urgente: { type: "noul", noul: resp.urgente } },
          usage: { input_tokens: 350, output_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
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
    registry: createFakeRegistry(modelo(r) as never),
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

type Estado = "observando" | "decidindo" | "desligada";
const settingsDoJev = (estado: Estado) => ({
  jev: { ligado: true, aceite: { em: "2026-10-01T12:00:00.000Z", por: ADMIN, alcance: "mensagem" }, tarefas: { triagem: { estado } } },
});

interface Cenario { org: string; sessao: string; contato: string; conversa: string; mensagem: string }

async function novaMensagem(c: Cenario, texto: string, tipo = "text", anterior = false) {
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via, sent_at, created_at)
     values ($1, $2, $3, $4, $5, $7, 'inbound', 'delivered', $6, 'external_device', now(), now() - ($8 || ' minutes')::interval)`,
    [c.mensagem, c.org, c.conversa, c.sessao, c.contato, texto, tipo, anterior ? "30" : "0"],
  );
}

async function cenario(estado: Estado, opcoes: { texto?: string; tipo?: string; bloqueado?: boolean } = {}): Promise<Cenario> {
  const [org, contato, sessao, conversa, mensagem] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name, settings) values ($1, $2, 'Jev Triagem', 'Jev Triagem', $3)`,
    [org, `jev-0426-${org}`, JSON.stringify(settingsDoJev(estado))],
  );
  await pool.query(`insert into contacts (id, organization_id, name, phone_number, is_blocked) values ($1, $2, 'Maria Souza', '+5511900000426', $3)`, [contato, org, opcoes.bloqueado === true]);
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted) values ($1, $2, $3, 'WORKING', '\\x00'::bytea)`,
    [sessao, org, `jev-0426-${sessao}`],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group) values ($1, $2, $3, $4, 'ai_handling', false)`,
    [conversa, org, contato, sessao],
  );
  const c = { org, sessao, contato, conversa, mensagem };
  await novaMensagem(c, opcoes.texto ?? PERGUNTA, opcoes.tipo ?? "text");
  return c;
}

async function rodaTurno(c: Cenario, d: ReturnType<typeof deps>): Promise<string> {
  await pool.query("update job_queue set status = 'done' where status = 'pending'");
  const { job } = await enqueueJob(pool, c.org, {
    kind: "inbound_turn",
    leadId: c.contato,
    payload: { conversation_id: c.conversa, contact_id: c.contato, channel_session_id: c.sessao, inbound_message_id: c.mensagem, crm_event_id: randomUUID() },
    maxAttempts: 1,
  });
  const [claimed] = await claimJobs(pool, { workerId: "jev-0426", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await createInboundTurnHandler(d)(claimed!, pool, { workerId: "jev-0426" });
    await completeJob(pool, claimed!.id, "jev-0426");
  } catch (err) {
    await failJob(pool, claimed!.id, "jev-0426", err);
    throw err;
  }
  return job.id;
}

const q = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows;
const observacoes = (org: string) =>
  q(`select tarefa, estado, rotulo_jev, rotulo_atual, concordou, probabilidade_jev::float8 as p, confianca_jev::float8 as conf, message_id, conversation_id, job_id from jev_observacoes where organization_id = $1`, [org]);
const chamadas = (org: string) =>
  q(`select purpose, status, origem_da_escolha, cost_cents::float8 as custo, model, job_id, contact_id, input_tokens from llm_calls where organization_id = $1 and provider = 'typesafe'`, [org]);
const metadado = async (c: Cenario) =>
  (await q(`select metadata->'triagem_jev' as t, metadata ? 'triagem' as legado from messages where id = $1`, [c.mensagem]))[0] as { t: Record<string, unknown> | null; legado: boolean };

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
  escrevivel.JEV_TRIAGEM_DO_SISTEMA_ENABLED = true;
});

describe("a triagem do antes, pelo turno real", () => {
  it("OBSERVANDO: uma chamada com o texto digitado e as três perguntas; grava custo, observação sem par e metadado; a IA atende como sempre", async () => {
    const c = await cenario("observando");
    const r = novaRodada();
    const jobId = await rodaTurno(c, deps(r, jevDuble(r, ALTA)));

    expect(r.pedidosAoJev).toHaveLength(1);
    const pedido = r.pedidosAoJev[0]!.corpo;
    expect(pedido.model).toBe("jev-1.13.0");
    expect(pedido.state).toBe(PERGUNTA); // só o texto, e nada mais
    expect(Object.keys(pedido.questions)).toEqual(["categoria", "destino", "urgente"]);

    expect(await observacoes(c.org)).toEqual([
      { tarefa: "triagem", estado: "observando", rotulo_jev: "atender", rotulo_atual: null, concordou: null, p: 0.95, conf: 0.9, message_id: c.mensagem, conversation_id: c.conversa, job_id: jobId },
    ]);
    const cs = await chamadas(c.org);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ purpose: "jev_antes", status: "ok", origem_da_escolha: "jev_observacao", model: "typesafe/jev-1.13.0", job_id: jobId, contact_id: c.contato, input_tokens: 350 });
    expect(cs[0].custo).toBeGreaterThan(0);

    const m = await metadado(c);
    expect(m.legado).toBe(false);
    expect(m.t).toMatchObject({ v: 1, estado: "observando", categoria: { id: "conserto", faixa: "alta" }, destino: { id: "atender", efetivo: "atender" }, urgente: { marcar: false } });
    expect(r.enviadas).toEqual(["Posso ajudar com o seu pedido."]);
  });

  it("mascara o que o cliente digitou antes de sair: senha, nome, telefone e CPF", async () => {
    const c = await cenario("observando", { texto: "Sou a Maria Souza, senha 4321, tel (11) 98765-4321, cpf 123.456.789-09. Tela quebrada." });
    const r = novaRodada();
    await rodaTurno(c, deps(r, jevDuble(r, ALTA)));
    const enviado = JSON.stringify(r.pedidosAoJev);
    for (const proibido of ["Maria", "Souza", "4321", "98765", "123.456"]) expect(enviado, proibido).not.toContain(proibido);
    expect(String(r.pedidosAoJev[0]!.corpo.state)).toContain("Tela quebrada");
  });

  it("pedir_dado vale só na PRIMEIRA mensagem da conversa", async () => {
    const pedir: Resp = { categoria: ["conserto", 0.95, 0.9], destino: ["pedir_dado", 0.95, 0.9], urgente: 0.1 };
    const primeira = await cenario("observando");
    await rodaTurno(primeira, deps(novaRodada(), jevDuble(novaRodada(), pedir)));
    expect((await metadado(primeira)).t).toMatchObject({ destino: { id: "pedir_dado", efetivo: "pedir_dado" } });

    const c = await cenario("observando");
    // Uma mensagem anterior do cliente, na MESMA conversa.
    const anterior = { ...c, mensagem: randomUUID() };
    await novaMensagem(anterior, "Oi, bom dia", "text", true);
    await rodaTurno(c, deps(novaRodada(), jevDuble(novaRodada(), pedir)));
    expect((await metadado(c)).t).toMatchObject({ destino: { id: "pedir_dado", efetivo: null } });
  });

  it("NADA sai: interruptor da instalação desligado, tarefa desligada, contato bloqueado, áudio, mensagem sem texto", async () => {
    const casos: Array<[string, Cenario]> = [
      ["tarefa desligada", await cenario("desligada")],
      ["contato bloqueado", await cenario("observando", { bloqueado: true })],
      ["áudio", await cenario("observando", { tipo: "audio", texto: "transcrição do áudio do cliente" })],
      ["marcador sem texto", await cenario("observando", { texto: "[figurinha]" })],
    ];
    for (const [nome, c] of casos) {
      const r = novaRodada();
      await rodaTurno(c, deps(r, jevDuble(r, ALTA)));
      expect(r.pedidosAoJev, nome).toEqual([]);
      expect(await chamadas(c.org), nome).toEqual([]);
      expect(await observacoes(c.org), nome).toEqual([]);
    }
    escrevivel.JEV_TRIAGEM_DO_SISTEMA_ENABLED = false;
    const c = await cenario("observando");
    const r = novaRodada();
    await rodaTurno(c, deps(r, jevDuble(r, ALTA)));
    expect(r.pedidosAoJev).toEqual([]);
    expect(await chamadas(c.org)).toEqual([]);
    expect(r.enviadas).toEqual(["Posso ajudar com o seu pedido."]);
  });

  it("o OPT-OUT e o pedido de atendente vêm ANTES: o Jev nem é perguntado, e só o aviso de código sai", async () => {
    for (const texto of ["para de me mandar mensagem por favor", "quero falar com um atendente de verdade"]) {
      const c = await cenario("observando", { texto });
      const r = novaRodada();
      await rodaTurno(c, deps(r, jevDuble(r, ALTA)));
      expect(r.pedidosAoJev, texto).toEqual([]);
      expect(await observacoes(c.org), texto).toEqual([]);
      expect(await chamadas(c.org), texto).toEqual([]);
      expect(r.enviadas, texto).not.toContain("Posso ajudar com o seu pedido.");
    }
  });

  it("a triagem ANTIGA (legado) segue desligada e não é tocada: nada em metadata.triagem", async () => {
    const c = await cenario("observando");
    const r = novaRodada();
    await rodaTurno(c, deps(r, jevDuble(r, ALTA)));
    expect((await metadado(c)).legado).toBe(false);
  });
});

describe("isolamento entre empresas", () => {
  it("duas empresas, estados e respostas diferentes: cada linha carrega a empresa certa", async () => {
    registrarSucesso("x");
    const a = await cenario("observando");
    const b = await cenario("desligada");
    const ra = novaRodada();
    const rb = novaRodada();
    await rodaTurno(a, deps(ra, jevDuble(ra, ALTA)));
    await rodaTurno(b, deps(rb, jevDuble(rb, ALTA)));
    expect((await observacoes(a.org)).length).toBe(1);
    expect(await observacoes(b.org)).toEqual([]);
    expect((await chamadas(a.org)).length).toBe(1);
    expect(await chamadas(b.org)).toEqual([]);
    expect((await metadado(a)).t).not.toBeNull();
    expect((await metadado(b)).t).toBeNull();
    const cruzado = await q(`select count(*)::int as n from jev_observacoes where organization_id = $1 and conversation_id = $2`, [a.org, b.conversa]);
    expect(cruzado[0].n).toBe(0);
  });
});

describe("DECIDINDO: o efeito da triagem no atendimento (T19, T20, T21)", () => {
  const dicaNoPrompt = (r: Rodada) => r.prompts.some((p) => p.includes("Dica da triagem"));
  const avisosDaCentral = (org: string) =>
    q(`select kind, ref_kind, ref_id, status, organization_id from agent_inbox_items where organization_id = $1 and title like 'O Jev acha%'`, [org]);
  const marcaUrgente = async (c: Cenario) =>
    (await q(`select metadata->'jev_urgente' as m, status, assigned_to_user_id from conversations where id = $1`, [c.conversa]))[0];

  it("alta + atender: a IA recebe a dica de uma linha; OBSERVANDO com a mesma resposta recebe o prompt INTACTO", async () => {
    const decidindo = await cenario("decidindo");
    const rd = novaRodada();
    await rodaTurno(decidindo, deps(rd, jevDuble(rd, ALTA)));
    expect(dicaNoPrompt(rd)).toBe(true);
    expect(rd.prompts.join("")).toContain("categoria: conserto; destino: atender.");

    const observando = await cenario("observando");
    const ro = novaRodada();
    await rodaTurno(observando, deps(ro, jevDuble(ro, ALTA)));
    expect(dicaNoPrompt(ro)).toBe(false);
  });

  it("confiança média: nenhuma dica, nem em decidindo", async () => {
    const c = await cenario("decidindo");
    const r = novaRodada();
    await rodaTurno(c, deps(r, jevDuble(r, { categoria: ["conserto", 0.75, 0.65], destino: ["atender", 0.75, 0.65], urgente: 0.1 })));
    expect(dicaNoPrompt(r)).toBe(false);
    expect((await metadado(c)).t).toMatchObject({ estado: "decidindo", destino: { efetivo: null } });
  });

  it("alta + equipe: UM aviso na Central ligado à conversa; sem caso, sem mudar de dono; a IA segue atendendo", async () => {
    const c = await cenario("decidindo");
    const r = novaRodada();
    await rodaTurno(c, deps(r, jevDuble(r, { categoria: ["venda", 0.95, 0.9], destino: ["equipe", 0.95, 0.9], urgente: 0.1 })));
    expect(await avisosDaCentral(c.org)).toEqual([{ kind: "other", ref_kind: "conversation", ref_id: c.conversa, status: "open", organization_id: c.org }]);
    expect((await q(`select count(*)::int as n from agent_cases where organization_id = $1`, [c.org]))[0].n).toBe(0);
    const conv = await marcaUrgente(c);
    expect(conv.assigned_to_user_id).toBeNull();
    expect(r.enviadas).toEqual(["Posso ajudar com o seu pedido."]);
    expect(dicaNoPrompt(r)).toBe(false);

    // Uma segunda mensagem na mesma conversa, com o aviso ainda aberto: não abre outro.
    const segunda = { ...c, mensagem: randomUUID() };
    await novaMensagem(segunda, "Alô? Ninguém me responde", "text");
    const r2 = novaRodada();
    registrarSucesso({ organizationId: c.org, tarefa: "triagem" });
    await rodaTurno(segunda, deps(r2, jevDuble(r2, { categoria: ["venda", 0.95, 0.9], destino: ["equipe", 0.95, 0.9], urgente: 0.1 })));
    expect((await avisosDaCentral(c.org)).length).toBe(1);
  });

  it("equipe em OBSERVANDO ou com confiança média: nenhum aviso", async () => {
    const o = await cenario("observando");
    const ro = novaRodada();
    await rodaTurno(o, deps(ro, jevDuble(ro, { categoria: ["venda", 0.95, 0.9], destino: ["equipe", 0.95, 0.9], urgente: 0.1 })));
    expect(await avisosDaCentral(o.org)).toEqual([]);
    const m = await cenario("decidindo");
    const rm = novaRodada();
    await rodaTurno(m, deps(rm, jevDuble(rm, { categoria: ["venda", 0.75, 0.65], destino: ["equipe", 0.75, 0.65], urgente: 0.1 })));
    expect(await avisosDaCentral(m.org)).toEqual([]);
  });

  it("urgente ≥ 0,80 marca o cartão e NÃO muda o destino; o aviso 'equipe' não aparece por causa dele", async () => {
    const c = await cenario("decidindo");
    const r = novaRodada();
    await rodaTurno(c, deps(r, jevDuble(r, { categoria: ["conserto", 0.95, 0.9], destino: ["atender", 0.95, 0.9], urgente: 0.85 })));
    const conv = await marcaUrgente(c);
    expect(conv.m).toMatchObject({ message_id: c.mensagem });
    expect(conv.status).toBe("ai_handling");
    expect(dicaNoPrompt(r)).toBe(true); // continua "atender"
    expect(await avisosDaCentral(c.org)).toEqual([]);

    // A mensagem seguinte, tranquila, tira a marca.
    const segunda = { ...c, mensagem: randomUUID() };
    await novaMensagem(segunda, "Obrigado, deu certo!", "text");
    registrarSucesso({ organizationId: c.org, tarefa: "triagem" });
    const r2 = novaRodada();
    await rodaTurno(segunda, deps(r2, jevDuble(r2, ALTA)));
    expect((await marcaUrgente(c)).m).toBeNull();
  });

  it("em OBSERVANDO a marca de urgente não é gravada (observar não muda nada para ninguém)", async () => {
    const c = await cenario("observando");
    const r = novaRodada();
    await rodaTurno(c, deps(r, jevDuble(r, { ...(ALTA as Exclude<Resp, number>), urgente: 0.95 })));
    expect((await marcaUrgente(c)).m).toBeNull();
    expect((await metadado(c)).t).toMatchObject({ urgente: { marcar: true } });
  });

  it("ISOLAMENTO: o aviso e a marca de uma empresa nunca aparecem na outra", async () => {
    const a = await cenario("decidindo");
    const b = await cenario("decidindo");
    const ra = novaRodada();
    const rb = novaRodada();
    await rodaTurno(a, deps(ra, jevDuble(ra, { categoria: ["venda", 0.95, 0.9], destino: ["equipe", 0.95, 0.9], urgente: 0.9 })));
    await rodaTurno(b, deps(rb, jevDuble(rb, ALTA)));
    expect((await avisosDaCentral(a.org)).length).toBe(1);
    expect(await avisosDaCentral(b.org)).toEqual([]);
    expect((await marcaUrgente(a)).m).not.toBeNull();
    expect((await marcaUrgente(b)).m).toBeNull();
  });
});

describe("a queda do Jev e o teto no ANTES (T22)", () => {
  const incidentes = (tipo: string) => q(`select organization_id, severity, status, payload from incidents where type = $1`, [tipo]);
  const errosDoJev = (org: string) => q(`select purpose, status, error_code from llm_calls where organization_id = $1 and provider = 'typesafe' and status = 'erro'`, [org]);

  beforeEach(async () => {
    await pool.query(`delete from incidents where type in ('jev_chave_recusada', 'jev_sem_credito')`);
  });

  it("Jev recusa a chave: o ANTES é pulado, a IA atende sem dica, a queda fica registrada e o DONO DA PLATAFORMA é avisado", async () => {
    const c = await cenario("decidindo");
    const r = novaRodada();
    await rodaTurno(c, deps(r, jevDuble(r, 401)));
    expect(r.enviadas).toEqual(["Posso ajudar com o seu pedido."]);
    expect(r.prompts.some((p) => p.includes("Dica da triagem"))).toBe(false);
    expect(await observacoes(c.org)).toEqual([]);
    expect(await errosDoJev(c.org)).toEqual([{ purpose: "jev_antes", status: "erro", error_code: "jev_credencial_invalida" }]);
    expect((await metadado(c)).t).toBeNull();
    const inc = await incidentes("jev_chave_recusada");
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ organization_id: null, severity: "critical", status: "open" });
    expect(inc[0].payload).toMatchObject({ tarefas: { triagem: expect.any(String) }, primeira_organizacao: c.org });
  });

  it("conta sem crédito: outro tipo de incidente; e uma segunda loja com a mesma chave ATUALIZA o aberto em vez de abrir outro", async () => {
    const a = await cenario("observando");
    const b = await cenario("observando");
    const ra = novaRodada();
    const rb = novaRodada();
    await rodaTurno(a, deps(ra, jevDuble(ra, 402)));
    await rodaTurno(b, deps(rb, jevDuble(rb, 402)));
    const inc = await incidentes("jev_sem_credito");
    expect(inc).toHaveLength(1);
    expect(inc[0].payload).toMatchObject({ primeira_organizacao: a.org, ultima_organizacao: b.org, ocorrencias: 2 });
  });

  it("falha que passa sozinha (500): linha de erro, mas NENHUM incidente para o dono", async () => {
    const c = await cenario("observando");
    const r = novaRodada();
    await rodaTurno(c, deps(r, jevDuble(r, 500)));
    expect(await errosDoJev(c.org)).toEqual([{ purpose: "jev_antes", status: "erro", error_code: "jev_provedor_indisponivel" }]);
    expect(await incidentes("jev_chave_recusada")).toEqual([]);
    expect(await incidentes("jev_sem_credito")).toEqual([]);
    expect(r.enviadas).toEqual(["Posso ajudar com o seu pedido."]);
  });

  it("o disjuntor: depois de um 429 o ANTES nem tenta a rede na mensagem seguinte; outra loja não é afetada", async () => {
    const a = await cenario("observando");
    const r1 = novaRodada();
    await rodaTurno(a, deps(r1, jevDuble(r1, 429)));
    expect(r1.pedidosAoJev).toHaveLength(1);
    const segunda = { ...a, mensagem: randomUUID() };
    await novaMensagem(segunda, "Alô?");
    const r2 = novaRodada();
    await rodaTurno(segunda, deps(r2, jevDuble(r2, ALTA)));
    expect(r2.pedidosAoJev).toEqual([]);

    const b = await cenario("observando");
    const rb = novaRodada();
    await rodaTurno(b, deps(rb, jevDuble(rb, ALTA)));
    expect(rb.pedidosAoJev).toHaveLength(1);
  });

  it("TETO estourado em modo bloquear PULA o ANTES (a IA principal fica bloqueada pelo mesmo teto); teto folgado não pula", async () => {
    const estourada = await cenario("observando");
    await pool.query(
      `insert into ai_budgets (organization_id, monthly_limit_cents, enforcement_mode, enforcement_effective_at, alarm_threshold_pct)
       values ($1, 100, 'bloquear', now() - interval '10 days', 80)`,
      [estourada.org],
    );
    await pool.query(
      `insert into llm_calls (organization_id, purpose, provider, model, input_tokens, output_tokens, cost_cents, status)
       values ($1, 'agent_turn', 'anthropic', 'claude', 1, 1, 500, 'ok')`,
      [estourada.org],
    );
    await pool.query(
      `insert into agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
       values ($1, 'budget_warning', 'warn', 't', 'b', 'ai_budget', $1)`,
      [estourada.org],
    );
    const r = novaRodada();
    await rodaTurno(estourada, deps(r, jevDuble(r, ALTA))).catch(() => undefined);
    expect(r.pedidosAoJev).toEqual([]);
    expect(await observacoes(estourada.org)).toEqual([]);

    const folgada = await cenario("observando");
    await pool.query(
      `insert into ai_budgets (organization_id, monthly_limit_cents, enforcement_mode, enforcement_effective_at, alarm_threshold_pct)
       values ($1, 100000, 'bloquear', now() - interval '10 days', 80)`,
      [folgada.org],
    );
    const rf = novaRodada();
    await rodaTurno(folgada, deps(rf, jevDuble(rf, ALTA)));
    expect(rf.pedidosAoJev).toHaveLength(1);
  });
});
