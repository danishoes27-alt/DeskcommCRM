/**
 * A QUEDA DO JEV NO DEPOIS (T12): o Jev falha de todo jeito e a conferência segue só
 * com as regras L1 a L6 — a regra das 2 tentativas fica para a T13, mas o veredito que
 * a alimenta já tem de estar certo aqui. Cobre: rede, tempo esgotado, 5xx, 529, 429,
 * chave recusada, sem crédito; disjuntor; "não conferida"; aviso ao dono da plataforma;
 * teto estourado que NÃO bloqueia; isolamento entre lojas.
 */
import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";

import { env } from "@/lib/env";

import { criarEvidenciasDoTurno } from "./evidencias-do-turno";

const POR = "22222222-2222-4222-8222-222222222222";
const banco = vi.hoisted(() => ({ settings: null as Record<string, unknown> | null }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "order", "limit"]) chain[m] = () => chain;
      chain.maybeSingle = async () =>
        tabela === "organizations"
          ? { data: { settings: banco.settings }, error: null }
          : { data: { api_key_encrypted: "c", api_key_iv: "i", api_key_tag: "t" }, error: null };
      return chain;
    },
  }),
}));
vi.mock("@/lib/crypto/aes_gcm", () => ({ byteaToBuffer: (v: unknown) => v, decryptKey: () => "apikey_de_teste" }));
vi.mock("@/lib/logger", () => ({ logger: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined } }));

import { podeTentar, registrarSucesso } from "@/lib/ai/decisao/disjuntor";

import { conferirOTurno } from "./conferencia-no-turno";

const escrevivel = env as unknown as Record<string, unknown>;
let contador = 0;
/** Uma organização nova por teste: o disjuntor é por organização e mora em memória. */
const novaOrg = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++contador).padStart(12, "0")}`;

function configDaEmpresa() {
  banco.settings = {
    jev: {
      ligado: true,
      aceite: { em: "2026-11-01T12:00:00.000Z", por: POR, alcance: "resposta", versao: 2 },
      tarefas: { conferencia: { estado: "observando" } },
    },
  };
}

function poolDoTurno() {
  const query = vi.fn(async (sql: string, _parametros?: unknown[]) => {
    if (sql.includes("from public.organizations")) return { rows: [{ settings: banco.settings }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  return { pool: { query, connect: vi.fn() } as unknown as pg.Pool, query };
}
const sqls = (query: ReturnType<typeof poolDoTurno>["query"]) => query.mock.calls.map((c) => String(c[0]));

function entrada(org: string, pool: pg.Pool, rascunho = "Oi! Como posso ajudar?") {
  const evidencias = criarEvidenciasDoTurno(org);
  return {
    pool,
    organizationId: org,
    tipoDoJob: "inbound_turn",
    preview: false,
    rascunho,
    evidencias,
    nomeDoContato: null,
    conversationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    messageId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    jobId: null,
    contactId: null,
    agentId: null,
  };
}

const corpoOk = {
  model: "jev-1.13.0",
  answers: {
    sem_fonte: { type: "noul", noul: 0.1 },
    promete_aprovacao: { type: "noul", noul: 0.1 },
    inventa_dado: { type: "noul", noul: 0.1 },
  },
  usage: { input_tokens: 500, output_tokens: 0 },
};

beforeEach(() => {
  escrevivel.JEV_CONFERENCIA_ENABLED = true;
  configDaEmpresa();
});

describe("com o Jev indisponível, a resposta que nenhuma regra segurou SAI — registrada como 'não conferida'", () => {
  it.each([
    ["falha de rede", () => vi.fn().mockRejectedValue(new Error("rede caiu")), undefined],
    [
      "tempo esgotado",
      // Um fornecedor que nunca responde: o teto aborta a chamada (o fetch real honra o sinal).
      () =>
        vi.fn(
          (_url: unknown, init?: RequestInit) =>
            new Promise<Response>((_resolve, rejeitar) => {
              init?.signal?.addEventListener("abort", () => rejeitar(new DOMException("aborted", "AbortError")));
            }),
        ),
      25,
    ],
    ["erro do servidor (500)", () => vi.fn().mockResolvedValue(new Response("{}", { status: 500 })), undefined],
    ["sobrecarga (529)", () => vi.fn().mockResolvedValue(new Response("{}", { status: 529 })), undefined],
    ["limite de taxa (429)", () => vi.fn().mockResolvedValue(new Response("{}", { status: 429 })), undefined],
    ["chave recusada (401)", () => vi.fn().mockResolvedValue(new Response("{}", { status: 401 })), undefined],
    ["sem crédito (402)", () => vi.fn().mockResolvedValue(new Response("{}", { status: 402 })), undefined],
  ])("%s", async (_n, criarFetch, tetoMs) => {
    const org = novaOrg();
    const { pool } = poolDoTurno();
    const r = await conferirOTurno(entrada(org, pool), { fetchImpl: criarFetch(), ...(tetoMs ? { tetoMs } : {}) });
    expect(r).toMatchObject({ estado: "observando", segurar: false, motivo: "" });
    expect(r!.detail).toMatchObject({ conferida_pelo_jev: 0, origem: "nenhuma", faixa: "baixa" });
  });

  it("com o Jev fora do ar, uma regra local ainda SEGURA (faixa alta, sem Jev)", async () => {
    const org = novaOrg();
    const { pool } = poolDoTurno();
    const r = await conferirOTurno(entrada(org, pool, "O crédito está aprovado!"), {
      fetchImpl: vi.fn().mockRejectedValue(new Error("fora do ar")),
    });
    expect(r).toMatchObject({ segurar: true });
    expect(r!.detail).toMatchObject({ origem: "local", conferida_pelo_jev: 0, regras: "L3" });
  });
});

describe("a queda fica registrada, e quem precisa agir é avisado", () => {
  it("falha que chegou à rede: UMA linha de erro em llm_calls com a finalidade jev_depois", async () => {
    const org = novaOrg();
    const { pool, query } = poolDoTurno();
    await conferirOTurno(entrada(org, pool), { fetchImpl: vi.fn().mockResolvedValue(new Response("{}", { status: 500 })) });
    const erro = query.mock.calls.find(([sql]) => String(sql).includes("insert into public.llm_calls"));
    expect(erro, "gravou a linha de erro").toBeDefined();
    const params = erro![1] as unknown[];
    expect(params).toContain("jev_depois");
    expect(params).toContain("jev_provedor_indisponivel");
  });

  it("chave recusada: avisa o DONO DA PLATAFORMA (incidente da instalação), além da linha de erro", async () => {
    const org = novaOrg();
    const { pool, query } = poolDoTurno();
    await conferirOTurno(entrada(org, pool), { fetchImpl: vi.fn().mockResolvedValue(new Response("{}", { status: 401 })) });
    const incidente = query.mock.calls.find(([sql]) => String(sql).includes("public.incidents"));
    expect(incidente, "abriu o incidente da plataforma").toBeDefined();
    const params = incidente![1] as unknown[];
    expect(params[0]).toBe("jev_chave_recusada");
    expect(params[1]).toBe(org);
    expect(params[2]).toBe("conferencia");
  });

  it("conta sem crédito: avisa o dono da plataforma com o outro tipo", async () => {
    const org = novaOrg();
    const { pool, query } = poolDoTurno();
    await conferirOTurno(entrada(org, pool), { fetchImpl: vi.fn().mockResolvedValue(new Response("{}", { status: 402 })) });
    const incidente = query.mock.calls.find(([sql]) => String(sql).includes("public.incidents"));
    expect((incidente![1] as unknown[])[0]).toBe("jev_sem_credito");
  });

  it.each([
    ["rede caiu", () => vi.fn().mockRejectedValue(new Error("rede"))],
    ["500", () => vi.fn().mockResolvedValue(new Response("{}", { status: 500 }))],
    ["429", () => vi.fn().mockResolvedValue(new Response("{}", { status: 429 }))],
    ["529", () => vi.fn().mockResolvedValue(new Response("{}", { status: 529 }))],
  ])("falha que passa sozinha (%s): NÃO incomoda o dono da plataforma", async (_n, criarFetch) => {
    const org = novaOrg();
    const { pool, query } = poolDoTurno();
    await conferirOTurno(entrada(org, pool), { fetchImpl: criarFetch() });
    expect(sqls(query).some((s) => s.includes("public.incidents"))).toBe(false);
  });
});

describe("o disjuntor: com o Jev caído, a resposta não paga o teto de 1,5 s toda vez", () => {
  it("3 falhas seguidas abrem o disjuntor; a quarta resposta NEM tenta a rede (e as regras locais seguem valendo)", async () => {
    const org = novaOrg();
    const { pool } = poolDoTurno();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    for (let i = 0; i < 3; i++) await conferirOTurno(entrada(org, pool), { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(podeTentar({ organizationId: org, tarefa: "conferencia" })).toBe(false);

    const r = await conferirOTurno(entrada(org, pool, "O crédito está aprovado!"), { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ segurar: true });
    expect(r!.detail).toMatchObject({ conferida_pelo_jev: 0, origem: "local" });
  });

  it("429 abre NA HORA (o fornecedor pediu para esperar)", async () => {
    const org = novaOrg();
    const { pool } = poolDoTurno();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 429 }));
    await conferirOTurno(entrada(org, pool), { fetchImpl });
    await conferirOTurno(entrada(org, pool), { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("um sucesso fecha o disjuntor e zera a contagem", async () => {
    const org = novaOrg();
    const { pool } = poolDoTurno();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValue(new Response(JSON.stringify(corpoOk), { status: 200, headers: { "content-type": "application/json" } }));
    for (let i = 0; i < 3; i++) await conferirOTurno(entrada(org, pool), { fetchImpl });
    expect(podeTentar({ organizationId: org, tarefa: "conferencia" })).toBe(true);
    registrarSucesso({ organizationId: org, tarefa: "conferencia" });
  });

  it("ISOLAMENTO: o disjuntor aberto da loja A não segura a loja B", async () => {
    const lojaA = novaOrg();
    const lojaB = novaOrg();
    const { pool } = poolDoTurno();
    const caida = vi.fn().mockResolvedValue(new Response("{}", { status: 429 }));
    await conferirOTurno(entrada(lojaA, pool), { fetchImpl: caida });
    expect(podeTentar({ organizationId: lojaA, tarefa: "conferencia" })).toBe(false);
    const viva = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(corpoOk), { status: 200, headers: { "content-type": "application/json" } }));
    const r = await conferirOTurno(entrada(lojaB, pool), { fetchImpl: viva });
    expect(viva).toHaveBeenCalledTimes(1);
    expect(r!.detail).toMatchObject({ conferida_pelo_jev: 1 });
  });
});

describe("o teto mensal NUNCA bloqueia a conferência", () => {
  const raiz = path.resolve(__dirname, "../../..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");

  it("nenhum arquivo da conferência consulta o orçamento: o custo soma no teto, mas a conferência não desliga por ele", () => {
    for (const rel of [
      "lib/ai/decisao/conferencia.ts",
      "lib/ai/decisao/observacao-da-conferencia.ts",
      "lib/ai/decisao/queda.ts",
      "lib/agent-engine/agent/conferencia-no-turno.ts",
    ]) {
      expect(ler(rel), rel).not.toMatch(/orcamento|ai_budgets|enforcement_mode|gasto_de_ia/i);
    }
  });

  it("e a finalidade jev_depois está na lista de isentos do teto (a isenção escrita para o dia em que passar por lá)", () => {
    expect(ler("lib/agent-engine/edge/llm/orcamento.ts")).toMatch(/PURPOSES_ISENTOS = \[[^\]]*'jev_depois'/s);
  });
});
