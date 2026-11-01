/**
 * O caso da resposta segurada (T14): abre na empresa certa, não duplica quando já há
 * caso aberto, registra o desfecho no rastro, e nunca leva a senha do cliente.
 * O isolamento no banco de verdade é o invariante da T26.
 */
import { describe, expect, it, vi } from "vitest";
import type pg from "pg";

import { abrirOCasoDaRespostaSegurada, razoesDoMotivo, type EntradaDoCasoDaConferencia } from "./caso-da-conferencia";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONVERSA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CASO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const MOTIVO =
  "A sua resposta NÃO foi enviada, porque a conferência antes do envio encontrou:\n" +
  "- o valor R$ 250,00 não aparece nas fontes que você consultou neste turno.\n" +
  "- o verificador acha muito provável que a resposta afirma um preço que não aparece nas fontes.\n" +
  "Reescreva usando SOMENTE o que está nas fontes que você consultou neste turno.";

/** Um pool que responde por tipo de SQL: `caso` = o insert do openCase; `jaTem` = o select do caso aberto. */
function poolDe(opcoes: { caso?: "novo" | "ja_tem" | "erro"; naoAcha?: boolean } = {}) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes("insert into agent_cases")) {
      if (opcoes.caso === "erro") throw new Error("banco caiu");
      return { rows: opcoes.caso === "ja_tem" ? [] : [{ case_id: CASO }], rowCount: 1 };
    }
    if (sql.includes("select id from agent_cases")) {
      return { rows: opcoes.naoAcha ? [] : [{ id: CASO }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  return { pool: { query } as unknown as pg.Pool, query };
}

const sqls = (q: ReturnType<typeof poolDe>["query"]) => q.mock.calls.map((c) => String(c[0]));

function entrada(extra: Partial<EntradaDoCasoDaConferencia> = {}): EntradaDoCasoDaConferencia {
  return {
    ids: { tenantId: ORG_A, conversationId: CONVERSA, agentId: null },
    rascunho: "A troca de tela custa R$ 250,00. Pode vir hoje.",
    motivoDoVeto: MOTIVO,
    contextSnapshot: { contact_name: "Maria", last_messages: [] },
    rastro: { jobId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", contactId: "ffffffff-ffff-4fff-8fff-ffffffffffff", channelSessionId: "99999999-9999-4999-8999-999999999999" },
    detalhe: { faixa: "alta", origem: "local", regras: "L1" },
    ...extra,
  };
}

describe("razoesDoMotivo", () => {
  it("tira as linhas '- …' e deixa a instrução ao modelo de fora", () => {
    expect(razoesDoMotivo(MOTIVO)).toEqual([
      "o valor R$ 250,00 não aparece nas fontes que você consultou neste turno.",
      "o verificador acha muito provável que a resposta afirma um preço que não aparece nas fontes.",
    ]);
    expect(razoesDoMotivo("sem lista")).toEqual([]);
  });
});

describe("abrir o caso da resposta segurada", () => {
  it("abre o caso NA EMPRESA DO TURNO, com origem guardrail_autofallback, e registra o rastro", async () => {
    const { pool, query } = poolDe();
    const r = await abrirOCasoDaRespostaSegurada(pool, entrada());
    expect(r).toEqual({ desfecho: "caso_aberto", caseId: CASO });

    const insert = query.mock.calls.find(([sql]) => String(sql).includes("insert into agent_cases"))!;
    const p = insert[1] as unknown[];
    expect(p[0]).toBe(ORG_A);
    expect(p[1]).toBe(CONVERSA);
    expect(p[3]).toBe("Resposta da IA segurada pela conferência");
    expect(String(p[4])).toContain("NÃO foi enviada ao cliente");
    expect(String(p[4])).toContain("A troca de tela custa");
    expect(String(p[5])).toContain("reprovou a resposta duas vezes");
    expect(String(p[5])).toContain("R$ 250,00");
    expect(String(p[5])).not.toContain("Reescreva");
    expect(JSON.parse(String(p[6]))).toMatchObject({ origem: "jev_conferencia", contact_name: "Maria" });
    expect(p[7]).toBe("guardrail_autofallback");
    expect(p[10]).toBe("duvida");

    const rastro = query.mock.calls.find(([sql]) => String(sql).includes("insert into before_send_traces"))!;
    const rp = rastro[1] as unknown[];
    expect(rp[0]).toBe(ORG_A);
    const trace = JSON.parse(String(rp[4])) as Array<Record<string, unknown>>;
    expect(trace).toEqual([
      { gate: "jev_conferencia", verdict: "veto", code: "resposta_segurada", detail: { faixa: "alta", origem: "local", regras: "L1", caso: "caso_aberto" } },
    ]);
  });

  it("ISOLAMENTO: o caso nasce na empresa do turno; a outra empresa nem aparece nos parâmetros", async () => {
    const { pool, query } = poolDe();
    await abrirOCasoDaRespostaSegurada(pool, entrada({ ids: { tenantId: ORG_B, conversationId: CONVERSA, agentId: null } }));
    for (const [, params] of query.mock.calls) {
      expect(JSON.stringify(params)).not.toContain(ORG_A);
    }
    const insert = query.mock.calls.find(([sql]) => String(sql).includes("insert into agent_cases"))!;
    expect((insert[1] as unknown[])[0]).toBe(ORG_B);
  });

  it("JÁ HAVIA caso aberto: nenhum caso novo; a nota entra no caso existente e o desfecho vai ao rastro", async () => {
    const { pool, query } = poolDe({ caso: "ja_tem" });
    const r = await abrirOCasoDaRespostaSegurada(pool, entrada());
    expect(r).toEqual({ desfecho: "caso_ja_aberto", caseId: CASO });
    // Procurou o caso aberto DESTA conversa e DESTA empresa…
    const busca = query.mock.calls.find(([sql]) => String(sql).includes("select id from agent_cases"))!;
    expect(busca[1]).toEqual([ORG_A, CONVERSA, ["awaiting_human", "awaiting_lead"]]);
    // …e anotou nele, como o AGENTE (a timeline não mente sobre o autor).
    const nota = query.mock.calls.find(([sql]) => String(sql).includes("'agent_noted'"))!;
    expect((nota[1] as unknown[])[0]).toBe(ORG_A);
    expect((nota[1] as unknown[])[1]).toBe(CASO);
    expect(String((nota[1] as unknown[])[2])).toContain("Outra resposta da IA foi segurada");
    // Só UM insert em agent_cases foi tentado, e nenhum depois dele.
    expect(sqls(query).filter((s) => s.includes("insert into agent_cases"))).toHaveLength(1);
    const trace = JSON.parse(String(((query.mock.calls.find(([sql]) => String(sql).includes("before_send_traces"))![1]) as unknown[])[4])) as Array<{ detail: { caso: string } }>;
    expect(trace[0]!.detail.caso).toBe("caso_ja_aberto");
  });

  it("já havia caso, mas ele não foi achado (fechou no meio): caso_ja_aberto sem id, sem nota, sem lançar", async () => {
    const { pool, query } = poolDe({ caso: "ja_tem", naoAcha: true });
    expect(await abrirOCasoDaRespostaSegurada(pool, entrada())).toEqual({ desfecho: "caso_ja_aberto", caseId: null });
    expect(sqls(query).some((s) => s.includes("'agent_noted'"))).toBe(false);
  });

  it("banco que falha: caso_falhou, o rastro ainda tenta, nunca lança", async () => {
    const { pool, query } = poolDe({ caso: "erro" });
    expect(await abrirOCasoDaRespostaSegurada(pool, entrada())).toEqual({ desfecho: "caso_falhou" });
    expect(sqls(query).some((s) => s.includes("before_send_traces"))).toBe(true);
  });

  it("A SENHA DO CLIENTE NÃO MORA NO CASO: sai do rascunho antes de ir ao resumo", async () => {
    const { pool, query } = poolDe();
    await abrirOCasoDaRespostaSegurada(pool, entrada({ rascunho: "Anotei: abri com 987654 e ficou ok.", senhasDoCliente: ["987654"] }));
    const insert = query.mock.calls.find(([sql]) => String(sql).includes("insert into agent_cases"))!;
    expect(JSON.stringify(insert[1])).not.toContain("987654");
    expect(String((insert[1] as unknown[])[4])).toContain("[SENHA]");
  });

  it("o rastro leva só rótulos: nem o rascunho nem a senha", async () => {
    const { pool, query } = poolDe();
    await abrirOCasoDaRespostaSegurada(pool, entrada({ senhasDoCliente: ["987654"], rascunho: "senha 987654, R$ 250,00" }));
    const rastro = query.mock.calls.find(([sql]) => String(sql).includes("before_send_traces"))!;
    expect(JSON.stringify(rastro[1])).not.toMatch(/987654|250,00|senha/);
  });

  it("o resumo do caso tem teto (o rascunho pode ser longo)", async () => {
    const { pool, query } = poolDe();
    await abrirOCasoDaRespostaSegurada(pool, entrada({ rascunho: "x".repeat(20_000) }));
    const insert = query.mock.calls.find(([sql]) => String(sql).includes("insert into agent_cases"))!;
    expect(String((insert[1] as unknown[])[4]).length).toBeLessThanOrEqual(3_900);
  });
});

describe("a fiação no turno", () => {
  it("a 2ª reprovação chama o caso com a empresa, a conversa e o agente do TURNO", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const fonte = readFileSync(resolve(__dirname, "inbound-turn.ts"), "utf8");
    const bloco = fonte.slice(fonte.indexOf("await abrirOCasoDaRespostaSegurada("), fonte.indexOf("return erroDaRespostaSegurada();", fonte.indexOf("await abrirOCasoDaRespostaSegurada(")));
    expect(bloco).toContain("ids: { tenantId, conversationId: input.conversationId, agentId: agentConfig?.agentId ?? null }");
    expect(bloco).toContain("senhasDoCliente: evidencias.senhasDoCliente()");
    expect(bloco).toContain("rastro: { jobId: liveJob().id");
  });
});
