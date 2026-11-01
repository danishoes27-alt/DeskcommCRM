/**
 * A conferência do "depois" no turno (T11): quando ela não faz nada, quando confere,
 * o que devolve à cadeia, e que nunca toma o lock do número (nunca pede conexão ao pool).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";

import { env } from "@/lib/env";

import { criarEvidenciasDoTurno } from "./evidencias-do-turno";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
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

import { conferirOTurno, detalheDoTrace, motivoParaOModelo } from "./conferencia-no-turno";
import { juntarOsAchados, veredictoDasRespostas } from "@/lib/ai/decisao/conferencia";
import { conferirLocalmente } from "../guardrails/conferencia-local";

const escrevivel = env as unknown as Record<string, unknown>;

function configDaEmpresa(estado: "observando" | "decidindo" | "desligada", aceite: "mensagem" | "resposta" = "resposta") {
  banco.settings = {
    jev: {
      ligado: true,
      aceite: { em: "2026-11-01T12:00:00.000Z", por: POR, alcance: aceite, ...(aceite === "resposta" ? { versao: 2 } : {}) },
      tarefas: { conferencia: { estado } },
    },
  };
}

/** O pool do turno: lê `organizations.settings` e aceita a gravação; NUNCA deve ser pedido `connect`. */
function poolDoTurno() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("from public.organizations")) return { rows: [{ settings: banco.settings }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const connect = vi.fn();
  return { pool: { query, connect } as unknown as pg.Pool, query, connect };
}

const corpo = (a: number, b: number, c: number) => {
  const r = (n: number) => ({ type: "noul", noul: n });
  return { model: "jev-1.13.0", answers: { sem_fonte: r(a), promete_aprovacao: r(b), inventa_dado: r(c) }, usage: { input_tokens: 900, output_tokens: 0 } };
};
const ok = (c: unknown) => new Response(JSON.stringify(c), { status: 200, headers: { "content-type": "application/json" } });

function entrada(extra: Partial<Parameters<typeof conferirOTurno>[0]> = {}) {
  const { pool } = poolDoTurno();
  const evidencias = criarEvidenciasDoTurno(ORG);
  evidencias.registrar("base_de_conhecimento", [{ texto: "Troca de tela: R$ 250,00" }], ORG);
  return {
    pool,
    organizationId: ORG,
    tipoDoJob: "inbound_turn",
    preview: false,
    rascunho: "A troca de tela custa R$ 250,00.",
    evidencias,
    nomeDoContato: "Maria Souza",
    conversationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    messageId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    jobId: null,
    contactId: null,
    agentId: null,
    ...extra,
  };
}

beforeEach(() => {
  escrevivel.JEV_CONFERENCIA_ENABLED = true;
  configDaEmpresa("observando");
});

describe("quando a conferência NÃO faz nada — e nada sai", () => {
  it.each([
    ["prévia de teste", { preview: true }],
    ["um turno que não é o da mensagem nova (case_reply_turn)", { tipoDoJob: "case_reply_turn" }],
    ["o follow-up", { tipoDoJob: "followup_turn" }],
    ["rascunho vazio", { rascunho: "   " }],
  ])("%s", async (_n, extra) => {
    const fetchImpl = vi.fn();
    expect(await conferirOTurno(entrada(extra), { fetchImpl })).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("o interruptor da instalação desligado: nem as regras locais rodam, e nada sai", async () => {
    escrevivel.JEV_CONFERENCIA_ENABLED = false;
    const fetchImpl = vi.fn();
    const e = entrada({ rascunho: "O crédito está aprovado!" });
    expect(await conferirOTurno(e, { fetchImpl })).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a tarefa desligada na empresa: nada", async () => {
    configDaEmpresa("desligada");
    const fetchImpl = vi.fn();
    expect(await conferirOTurno(entrada(), { fetchImpl })).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("o aceite só de `mensagem` deixa a conferência desligada: nada", async () => {
    configDaEmpresa("observando", "mensagem");
    const fetchImpl = vi.fn();
    expect(await conferirOTurno(entrada(), { fetchImpl })).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("quando confere", () => {
  it("OBSERVANDO: devolve o veredito com o estado, para a cadeia NÃO segurar, e grava custo e observação", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(corpo(0.9, 0.05, 0.1)));
    const { pool, query } = poolDoTurno();
    const r = await conferirOTurno(entrada({ pool }), { fetchImpl });
    expect(r).toMatchObject({ estado: "observando", segurar: true });
    expect(r!.detail).toMatchObject({ faixa: "alta", origem: "jev", conferida_pelo_jev: 1, pergunta: "sem_fonte", jev_maior: 0.9 });
    const gravacao = query.mock.calls.find(([sql]) => String(sql).includes("jev_observacoes"));
    expect(gravacao, "gravou custo e observação").toBeDefined();
  });

  it("DECIDINDO com achado local: segura, com o motivo ao modelo; o Jev dizendo 'tudo bem' não liberta", async () => {
    configDaEmpresa("decidindo");
    const fetchImpl = vi.fn().mockResolvedValue(ok(corpo(0.01, 0.01, 0.01)));
    const r = await conferirOTurno(
      entrada({ rascunho: "O crédito está aprovado, pode vir buscar!" }),
      { fetchImpl },
    );
    expect(r).toMatchObject({ estado: "decidindo", segurar: true });
    expect(r!.motivo).toContain("NÃO foi enviada");
    expect(r!.motivo).toMatch(/aprovação/);
    expect(r!.detail).toMatchObject({ origem: "local", regras: "L3" });
  });

  it("OBSERVANDO com o mesmo achado: o veredito diz segurar, mas o estado é observando — a cadeia não veta", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(corpo(0.01, 0.01, 0.01)));
    const r = await conferirOTurno(
      entrada({ rascunho: "O crédito está aprovado, pode vir buscar!" }),
      { fetchImpl },
    );
    expect(r).toMatchObject({ estado: "observando", segurar: true });
  });

  it("resposta limpa: libera, sem motivo", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(corpo(0.05, 0.01, 0.02)));
    const r = await conferirOTurno(entrada(), { fetchImpl });
    expect(r).toMatchObject({ estado: "observando", segurar: false, motivo: "" });
  });

  it("Jev fora do ar e nenhuma regra segurou: libera, 'não conferida'", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fora do ar"));
    const r = await conferirOTurno(entrada(), { fetchImpl });
    expect(r).toMatchObject({ segurar: false });
    expect(r!.detail).toMatchObject({ conferida_pelo_jev: 0 });
  });

  it("NUNCA toma o lock do número: o pool do turno não recebe `connect` (a cadeia é quem pega a conexão)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(corpo(0.1, 0.1, 0.1)));
    const { pool, connect } = poolDoTurno();
    await conferirOTurno(entrada({ pool }), { fetchImpl });
    expect(connect).not.toHaveBeenCalled();
  });

  it("banco que falha ao ler o estado vale desligada: nada sai", async () => {
    const fetchImpl = vi.fn();
    const pool = { query: vi.fn().mockRejectedValue(new Error("banco caiu")), connect: vi.fn() } as unknown as pg.Pool;
    expect(await conferirOTurno(entrada({ pool }), { fetchImpl })).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("o `state` enviado não leva o nome do contato nem a senha do cofre", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(corpo(0.1, 0.1, 0.1)));
    const comSenha = criarEvidenciasDoTurno(ORG);
    comSenha.guardarSenhaDoCliente("4321", ORG);
    const e = entrada({ rascunho: "Oi Maria Souza, anotei a senha 4321. A troca custa R$ 250,00.", evidencias: comSenha });
    await conferirOTurno(e, { fetchImpl });
    // senha no rascunho = L4 → o Jev nem é chamado.
    expect(fetchImpl).not.toHaveBeenCalled();
    const e2 = entrada({ rascunho: "Oi Maria Souza, a troca custa R$ 250,00." });
    await conferirOTurno(e2, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).not.toMatch(/Maria|Souza/);
  });
});

describe("o texto para o modelo e o detalhe do trace", () => {
  const evidencias = criarEvidenciasDoTurno(ORG);
  const local = conferirLocalmente({ rascunho: "O crédito está aprovado e custa R$ 99,00.", evidencias });
  const jev = veredictoDasRespostas({
    sem_fonte: { tipo: "noul", noul: 0.85 },
    promete_aprovacao: { tipo: "noul", noul: 0.1 },
    inventa_dado: { tipo: "noul", noul: 0.1 },
  });

  it("junta os motivos locais e o do Jev, e ensina o que fazer", () => {
    const v = juntarOsAchados(local, jev);
    const m = motivoParaOModelo(v);
    expect(m).toContain("NÃO foi enviada");
    expect(m).toContain("aprovação");
    expect(m).toContain("o verificador");
    expect(m).toMatch(/SOMENTE o que está nas fontes/);
  });

  it("o detalhe é só rótulo e número: nada do rascunho", () => {
    const d = detalheDoTrace(juntarOsAchados(local, jev));
    expect(d).toMatchObject({ faixa: "alta", origem: "local_e_jev", regras: "L1,L3", pergunta: "sem_fonte", jev_maior: 0.85 });
    expect(JSON.stringify(d)).not.toMatch(/crédito|99/);
  });
});
