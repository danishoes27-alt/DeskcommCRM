import { afterEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { createLogger } from "../../obs/logger";

import { deveRetomarSessao, redriveQueued } from "./session-reconciler";

afterEach(() => vi.restoreAllMocks());

/**
 * A regra que decide se o watchdog RELIGA a sessão. Religar FAILED é o que o
 * vigia de saúde recusa (pode ser banimento); SCAN_QR_CODE e STARTING já têm
 * dono. Só STOPPED: credencial no disco, sessão parada depois de restart.
 */
describe("deveRetomarSessao", () => {
  it("retoma só STOPPED", () => {
    expect(deveRetomarSessao("STOPPED")).toBe(true);
    expect(deveRetomarSessao("stopped")).toBe(true);
  });

  it.each(["WORKING", "STARTING", "SCAN_QR_CODE", "FAILED", ""])(
    "não religa %s — ou já está no ar, ou precisa de humano",
    (status) => {
      expect(deveRetomarSessao(status)).toBe(false);
    },
  );
});

describe("redrive pré-go-live", () => {
  it("não envia se a releitura da configuração falha", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        id: "message-test", organization_id: "org-test", body: "Resposta de teste",
        waha_session_name: "session-test", phone_number: "+5511999998888",
        wa_identity: null, wa_lid: null, is_group: false, group_chat_id: null,
      }] })
      .mockResolvedValueOnce({ rows: [{ n: "0" }] })
      .mockRejectedValueOnce(new Error("banco indisponível"));

    expect(await redriveQueued({ query } as unknown as pg.Pool, {
      wahaBaseUrl: "http://127.0.0.1:9999", wahaApiKey: "test-key",
      intervalMs: 1, redriveMinAgeMs: 0, redriveBatchSize: 10, redriveSpacingMs: 0,
    }, createLogger())).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("m.organization_id = $2"), ["message-test", "org-test"]);
  });
});

/**
 * O RESGATE ALCANÇA A MENSAGEM QUE A AUTOMAÇÃO DEIXOU NA FILA (#652).
 *
 * O carimbo novo só é honesto se o resgate de `queued` souber dele. O registro
 * da automação conta com este resgate quando diz que o envio ficou adiado
 * (`lib/automation/desfecho-do-envio.ts`): uma linha `'automation'` presa com o
 * canal fora ficaria `queued` para sempre enquanto a Atividade da regra diz que
 * a mensagem ainda vai sair.
 *
 * O banco falso abaixo APLICA o filtro de `sent_via` que está na consulta —
 * devolver a linha de qualquer jeito faria o teste passar nos dois mundos, e é
 * justamente o vocabulário da consulta que está sob teste.
 */
function vocabularioDeSentVia(sql: string): string[] | null {
  const igual = /sent_via\s*=\s*'([a-z_]+)'/i.exec(sql);
  if (igual) return [igual[1]!];
  const conjunto = /sent_via\s+in\s*\(([^)]*)\)/i.exec(sql);
  if (conjunto) return [...conjunto[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
  return null;
}

interface LinhaPresa {
  id: string;
  organization_id: string;
  conversation_id: string;
  body: string;
  sent_via: string;
  waha_session_name: string;
  wa_identity: string | null;
  wa_lid: string | null;
  phone_number: string | null;
  is_group: boolean;
  group_chat_id: string | null;
}

function bancoComFila(fila: LinhaPresa[]) {
  const consultas: string[] = [];
  const query = vi.fn(async (sql: string) => {
    consultas.push(sql);
    if (/count\(\*\)/i.test(sql)) return { rows: [{ n: "0" }] };
    if (/select\s+m\.id/i.test(sql)) {
      const vocabulario = vocabularioDeSentVia(sql);
      if (vocabulario === null) return { rows: [] };
      return { rows: fila.filter((l) => vocabulario.includes(l.sent_via)).map((l) => ({ ...l })) };
    }
    if (/select\s+s\.metadata/i.test(sql)) {
      return { rows: fila.length === 0 ? [] : [{ metadata: {}, phone_number: "+5531999998888" }] };
    }
    return { rows: [] };
  });
  return { query, consultas };
}

describe("resgate da fila — a mensagem da AUTOMAÇÃO é alcançada (#652)", () => {
  it("⭐ linha `sent_via='automation'` presa em queued é reenviada pelo watchdog", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: { id: "3EB0ABCDEF" } }), { status: 200 }));
    const { query } = bancoComFila([
      {
        id: "m-automacao",
        organization_id: "org-1",
        conversation_id: "conversa-1",
        body: "Olá! Vi que você preencheu o formulário.",
        sent_via: "automation",
        waha_session_name: "default",
        wa_identity: null,
        wa_lid: null,
        phone_number: "+5531999998888",
        is_group: false,
        group_chat_id: null,
      },
    ]);

    const reenviadas = await redriveQueued({ query } as unknown as pg.Pool, {
      wahaBaseUrl: "http://127.0.0.1:9999",
      wahaApiKey: "test-key",
      intervalMs: 1,
      redriveMinAgeMs: 0,
      redriveBatchSize: 10,
      redriveSpacingMs: 0,
    }, createLogger());

    expect(
      reenviadas,
      "a mensagem da automação ficou presa em `queued`: o resgate só olha sent_via='ai'",
    ).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE: a linha de dispositivo externo não é reenviada — quem a mandou não foi o CRM", async () => {
    // Sem esta direção, um resgate que ignorasse o filtro passaria — e reenviar
    // uma mensagem do celular é mandar de novo o que a pessoa já escreveu.
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const { query } = bancoComFila([
      {
        id: "m-celular",
        organization_id: "org-1",
        conversation_id: "conversa-1",
        body: "oi, tudo bem?",
        sent_via: "external_device",
        waha_session_name: "default",
        wa_identity: null,
        wa_lid: null,
        phone_number: "+5531999998888",
        is_group: false,
        group_chat_id: null,
      },
    ]);

    expect(
      await redriveQueued({ query } as unknown as pg.Pool, {
        wahaBaseUrl: "http://127.0.0.1:9999",
        wahaApiKey: "test-key",
        intervalMs: 1,
        redriveMinAgeMs: 0,
        redriveBatchSize: 10,
        redriveSpacingMs: 0,
      }, createLogger()),
    ).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});


/**
 * UM WAHA POR EMPRESA (migration 9001): o vigia fala com o WAHA de CADA canal. Um WAHA que cai pula só os
 * canais dele; cadastro quebrado nunca cai no WAHA global; o reenvio sai só pelo WAHA do próprio canal.
 */
import { reconcileSessions } from "./session-reconciler";

const CFG_SEM_GLOBAL = { intervalMs: 1, redriveMinAgeMs: 0, redriveBatchSize: 10, redriveSpacingMs: 0 };
const CFG_COM_GLOBAL = { ...CFG_SEM_GLOBAL, wahaBaseUrl: "http://waha-global:3000", wahaApiKey: "chave-global" };

interface CanalDeTeste {
  id: string;
  name: string;
  waha_base_url: string | null;
  waha_cifra: string | null;
}

/** Banco falso do reconciliador: lista de canais, decifra por tabela e registra os UPDATEs. */
function bancoDeCanais(canais: CanalDeTeste[], chaves: Record<string, string | null> = {}) {
  const atualizacoes: Array<{ nome: string; status: string }> = [];
  const consultasDeDecifra: string[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/from channel_sessions cs\s+where cs\.waha_session_name is not null/i.test(sql)) return { rows: canais };
    if (/fn_decrypt_oauth/i.test(sql)) {
      const hex = String(params[0]);
      consultasDeDecifra.push(hex);
      return { rows: [{ chave: chaves[hex] ?? null }] };
    }
    if (/update channel_sessions/i.test(sql)) {
      atualizacoes.push({ nome: String(params[0]), status: String(params[1]) });
      return { rows: [{ id: `id-${params[0]}`, status: params[1] }] };
    }
    return { rows: [] };
  });
  return { pool: { query } as unknown as pg.Pool, atualizacoes, consultasDeDecifra };
}

/** fetch de mentira por endereço: `respostas[base]` = lista de sessões, ou `null` para o WAHA fora do ar. */
function wahasDeMentira(respostas: Record<string, Array<{ name: string; status: string }> | null>) {
  const chamadas: Array<{ url: string; chave: string | null; metodo: string }> = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const chave = (init?.headers as Record<string, string> | undefined)?.["X-Api-Key"] ?? null;
    chamadas.push({ url: u, chave, metodo: init?.method ?? "GET" });
    const base = Object.keys(respostas).find((b) => u.startsWith(b));
    if (!base) throw new Error(`destino inesperado: ${u}`);
    const r = respostas[base];
    if (r === null) throw new Error("fetch failed");
    if (u.includes("/start")) return new Response("{}", { status: 200 });
    return new Response(JSON.stringify(r), { status: 200 });
  }) as typeof fetch);
  return { chamadas, spy };
}

describe("vigia — reconcilia por WAHA, um endereço de cada vez", () => {
  it("cada canal é consultado no WAHA dele, com a chave dele", async () => {
    const { pool, atualizacoes } = bancoDeCanais(
      [
        { id: "1", name: "org_a_1", waha_base_url: "http://waha-a:3000", waha_cifra: "\\xaa" },
        { id: "2", name: "org_b_2", waha_base_url: "http://waha-b:3000", waha_cifra: "\\xbb" },
        { id: "3", name: "global_3", waha_base_url: null, waha_cifra: null },
      ],
      { aa: "chave-a", bb: "chave-b" },
    );
    const { chamadas } = wahasDeMentira({
      "http://waha-a:3000": [{ name: "org_a_1", status: "WORKING" }],
      "http://waha-b:3000": [{ name: "org_b_2", status: "FAILED" }],
      "http://waha-global:3000": [{ name: "global_3", status: "SCAN_QR_CODE" }],
    });

    const corrigidos = await reconcileSessions(pool, CFG_COM_GLOBAL, createLogger());

    expect(corrigidos).toBe(3);
    expect(chamadas.map((c) => [c.url, c.chave])).toEqual([
      ["http://waha-a:3000/api/sessions?all=true", "chave-a"],
      ["http://waha-b:3000/api/sessions?all=true", "chave-b"],
      ["http://waha-global:3000/api/sessions?all=true", "chave-global"],
    ]);
    expect(atualizacoes).toEqual([
      { nome: "org_a_1", status: "WORKING" },
      { nome: "org_b_2", status: "FAILED" },
      { nome: "global_3", status: "SCAN_QR_CODE" },
    ]);
  });

  it("⭐ um WAHA fora do ar pula só os canais dele: os das outras empresas seguem, e ninguém vira STOPPED", async () => {
    const { pool, atualizacoes } = bancoDeCanais(
      [
        { id: "1", name: "org_a_1", waha_base_url: "http://waha-a:3000", waha_cifra: "\\xaa" },
        { id: "2", name: "org_b_2", waha_base_url: "http://waha-b:3000", waha_cifra: "\\xbb" },
      ],
      { aa: "chave-a", bb: "chave-b" },
    );
    wahasDeMentira({
      "http://waha-a:3000": null, // caiu
      "http://waha-b:3000": [{ name: "org_b_2", status: "WORKING" }],
    });

    const corrigidos = await reconcileSessions(pool, CFG_SEM_GLOBAL, createLogger());

    expect(corrigidos).toBe(1);
    expect(atualizacoes).toEqual([{ nome: "org_b_2", status: "WORKING" }]);
    expect(atualizacoes.some((a) => a.nome === "org_a_1")).toBe(false);
  });

  it("canais da mesma empresa no mesmo WAHA fazem UMA consulta de sessões e UMA decifragem", async () => {
    const { pool, consultasDeDecifra } = bancoDeCanais(
      [
        { id: "1", name: "org_a_1", waha_base_url: "http://waha-a:3000", waha_cifra: "\\xaa" },
        { id: "2", name: "org_a_2", waha_base_url: "http://waha-a:3000", waha_cifra: "\\xaa" },
      ],
      { aa: "chave-a" },
    );
    const { chamadas } = wahasDeMentira({
      "http://waha-a:3000": [
        { name: "org_a_1", status: "WORKING" },
        { name: "org_a_2", status: "WORKING" },
      ],
    });

    await reconcileSessions(pool, CFG_SEM_GLOBAL, createLogger());

    expect(chamadas.filter((c) => c.url.includes("/api/sessions?all=true"))).toHaveLength(1);
    expect(consultasDeDecifra).toEqual(["aa"]);
  });

  it("⭐ cadastro quebrado (chave ilegível) NÃO cai no WAHA global: o canal fica sem vigia neste tick", async () => {
    const { pool, atualizacoes } = bancoDeCanais(
      [{ id: "1", name: "org_a_1", waha_base_url: "http://waha-a:3000", waha_cifra: "\\xaa" }],
      { aa: null },
    );
    const { chamadas } = wahasDeMentira({ "http://waha-global:3000": [{ name: "org_a_1", status: "STOPPED" }] });

    const corrigidos = await reconcileSessions(pool, CFG_COM_GLOBAL, createLogger());

    expect(corrigidos).toBe(0);
    expect(chamadas).toEqual([]);
    expect(atualizacoes).toEqual([]);
  });

  it("sem WAHA global no worker, o canal que não tem WAHA próprio não é vigiado (e nada quebra)", async () => {
    const { pool, atualizacoes } = bancoDeCanais([{ id: "1", name: "global_1", waha_base_url: null, waha_cifra: null }]);
    const { chamadas } = wahasDeMentira({});
    await expect(reconcileSessions(pool, CFG_SEM_GLOBAL, createLogger())).resolves.toBe(0);
    expect(chamadas).toEqual([]);
    expect(atualizacoes).toEqual([]);
  });

  it("sessão STOPPED é religada no WAHA do PRÓPRIO canal", async () => {
    const { pool, atualizacoes } = bancoDeCanais(
      [{ id: "1", name: "org_a_1", waha_base_url: "http://waha-a:3000", waha_cifra: "\\xaa" }],
      { aa: "chave-a" },
    );
    const { chamadas } = wahasDeMentira({ "http://waha-a:3000": [{ name: "org_a_1", status: "STOPPED" }] });

    await reconcileSessions(pool, CFG_COM_GLOBAL, createLogger());

    const start = chamadas.find((c) => c.url.endsWith("/api/sessions/org_a_1/start"));
    expect(start).toMatchObject({ metodo: "POST", chave: "chave-a" });
    expect(chamadas.some((c) => c.url.startsWith("http://waha-global"))).toBe(false);
    expect(atualizacoes).toEqual([{ nome: "org_a_1", status: "STARTING" }]);
  });
});

describe("resgate da fila — reenvia só pelo WAHA do próprio canal", () => {
  const mensagem = (id: string, extra: Record<string, unknown>) => ({
    id,
    organization_id: "org-1",
    conversation_id: "conversa-1",
    body: "Olá",
    sent_via: "ai",
    waha_session_name: "org_a_1",
    wa_identity: null,
    wa_lid: null,
    phone_number: "+5531999998888",
    is_group: false,
    group_chat_id: null,
    channel_session_id: "canal-1",
    waha_base_url: null,
    waha_cifra: null,
    ...extra,
  });

  function bancoDoResgate(fila: Array<Record<string, unknown>>, chaves: Record<string, string | null> = {}) {
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/count\(\*\)/i.test(sql)) return { rows: [{ n: "0" }] };
      if (/select\s+m\.id/i.test(sql)) return { rows: fila };
      if (/select\s+s\.metadata/i.test(sql)) return { rows: [{ metadata: {}, phone_number: "+5531999998888" }] };
      if (/fn_decrypt_oauth/i.test(sql)) return { rows: [{ chave: chaves[String(params[0])] ?? null }] };
      return { rows: [] };
    });
    return { pool: { query } as unknown as pg.Pool, query };
  }

  it("a mensagem de um canal com WAHA próprio sai pelo WAHA dele, com a chave dele", async () => {
    const { pool } = bancoDoResgate(
      [mensagem("m1", { waha_base_url: "http://waha-a:3000", waha_cifra: "\\xaa" }), mensagem("m2", {})],
      { aa: "chave-a" },
    );
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: { id: "X" } }), { status: 200 }));

    const reenviadas = await redriveQueued(pool, CFG_COM_GLOBAL, createLogger());

    expect(reenviadas).toBe(2);
    const alvos = send.mock.calls.map(([url, init]) => [String(url), (init?.headers as Record<string, string>)["X-Api-Key"]]);
    expect(alvos).toEqual([
      ["http://waha-a:3000/api/sendText", "chave-a"],
      ["http://waha-global:3000/api/sendText", "chave-global"],
    ]);
  });

  it("⭐ cadastro quebrado: a mensagem FICA em queued e nada é enviado — nem pelo WAHA global", async () => {
    const { pool } = bancoDoResgate([mensagem("m1", { waha_base_url: "http://waha-a:3000", waha_cifra: "\\xaa" })], { aa: null });
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    expect(await redriveQueued(pool, CFG_COM_GLOBAL, createLogger())).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("sem WAHA global no worker e sem WAHA próprio no canal: fica em queued, sem enviar", async () => {
    const { pool } = bancoDoResgate([mensagem("m1", {})]);
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await redriveQueued(pool, CFG_SEM_GLOBAL, createLogger())).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
