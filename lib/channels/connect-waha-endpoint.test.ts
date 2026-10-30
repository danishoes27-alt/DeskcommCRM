/**
 * Conectar um número num WAHA POR EMPRESA:
 *  - o endereço e a chave da empresa vão para o canal reservado ANTES de qualquer chamada ao WAHA — assim
 *    quem resolver o canal depois (envio, QR, vigia) acha o mesmo WAHA com que a conexão foi feita;
 *  - a sessão nasce com o WEBHOOK PRÓPRIO (URL com o token do canal + segredo de assinatura do canal), e o
 *    contêiner da empresa não precisa de `WHATSAPP_HOOK_URL`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { connectWahaChannel } from "./connect-waha";
import { limparCacheDoWaha } from "./waha-endpoint";
import { EVENTOS_DO_WEBHOOK_DO_WAHA } from "./waha-webhook";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG = "20000000-0000-4000-8000-000000000001";
const CANAL = "20000000-0000-4000-8000-000000000002";
const TOKEN = "d9001000222240008000000000000a01";
const BASE_DO_WEBHOOK = "https://crm.exemplo.com.br";
const COLUNAS = { waha_base_url: "http://waha-acme:3000", waha_api_key_encrypted: "\\xabcdef" };

interface Opcoes {
  falhaAoGravar?: boolean;
  /** Segredo já gravado no canal (decifrado). `null` = placeholder/ilegível. */
  segredoExistente?: string | null;
  cifraIndisponivel?: boolean;
}

function montar(opcoes: Opcoes = {}) {
  const ordem: string[] = [];
  const gravacoes: Array<{ row: Record<string, unknown>; filtros: Record<string, unknown> }> = [];
  const finishes: Array<Record<string, unknown>> = [];
  const canal = {
    id: CANAL,
    organization_id: ORG,
    waha_session_name: "org_aaaaaaaa_bbbb",
    status: "STARTING",
    archived_at: null,
    webhook_path_token: TOKEN,
    webhook_secret_encrypted: "\\x00",
  };

  const db = {
    rpc: vi.fn(async (nome: string, args: Record<string, unknown>) => {
      if (nome === "fn_reserve_channel_connection") {
        return { data: { channel: canal, receipt_id: CANAL, lease_token: CANAL, replay: false }, error: null };
      }
      if (nome === "fn_decrypt_oauth") {
        ordem.push("decifra");
        return opcoes.segredoExistente ? { data: opcoes.segredoExistente, error: null } : { data: null, error: { message: "x" } };
      }
      if (nome === "fn_encrypt_oauth") {
        ordem.push("cifra");
        return opcoes.cifraIndisponivel ? { data: null, error: { message: "x" } } : { data: "\\xcifrado", error: null };
      }
      finishes.push(args);
      return { data: { ...canal, status: args.p_status }, error: null };
    }),
    from: vi.fn((tabela: string) => {
      const filtros: Record<string, unknown> = {};
      let row: Record<string, unknown> = {};
      const builder = {
        update(r: Record<string, unknown>) { row = r; return builder; },
        eq(coluna: string, valor: unknown) { filtros[coluna] = valor; return builder; },
        // `await builder` -> { error }
        then(resolve: (v: { error: unknown }) => void) {
          if (tabela === "channel_sessions" && "waha_base_url" in row) {
            ordem.push("grava-endereco");
            gravacoes.push({ row, filtros });
            resolve({ error: opcoes.falhaAoGravar ? { message: "boom" } : null });
          } else if (tabela === "channel_sessions" && "webhook_secret_encrypted" in row) {
            ordem.push("grava-segredo");
            gravacoes.push({ row, filtros });
            resolve({ error: null });
          } else {
            resolve({ error: null });
          }
        },
      };
      return builder;
    }),
  } as unknown as SupabaseClient;

  const criacoes: Array<{ nome: string; webhook: unknown }> = [];
  const transporte = {
    createSession: vi.fn(async (nome: string, webhook?: unknown) => {
      ordem.push("createSession");
      criacoes.push({ nome, webhook });
      return { created: true, session: { name: nome, status: "STOPPED" } };
    }),
    startExistingSession: vi.fn(async (nome: string) => { ordem.push("startExistingSession"); return { name: nome, status: "SCAN_QR_CODE" }; }),
    stopSession: vi.fn(async () => { ordem.push("stopSession"); }),
  };
  const entrada = { organizationId: ORG, idempotencyKey: CANAL, userId: CANAL, requestId: CANAL };
  return { db, transporte, ordem, gravacoes, finishes, criacoes, entrada };
}

const PROPRIO = { wahaDoCanal: COLUNAS, urlBaseDoWebhook: BASE_DO_WEBHOOK };

describe("connectWahaChannel — o WAHA da empresa vai para o canal antes de o WAHA ser chamado", () => {
  it("grava endereço e chave cifrada no canal reservado, escopado pela organização, e SÓ depois cria a sessão", async () => {
    limparCacheDoWaha();
    const f = montar();
    const r = await connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, ...PROPRIO });

    expect(r.channel.status).toBe("SCAN_QR_CODE");
    expect(f.gravacoes[0]).toEqual({ row: COLUNAS, filtros: { organization_id: ORG, id: CANAL } });
    expect(f.ordem.indexOf("grava-endereco")).toBeLessThan(f.ordem.indexOf("createSession"));
  });

  it("modo compartilhado (sem wahaDoCanal): não grava nada no canal e a sessão nasce SEM webhook próprio", async () => {
    const f = montar();
    await connectWahaChannel(f.db, f.db, f.transporte, f.entrada);
    expect(f.gravacoes).toEqual([]);
    expect(f.ordem).toEqual(["createSession", "startExistingSession"]);
    expect(f.criacoes[0]?.webhook).toBeUndefined();
  });

  it("wahaDoCanal null (a empresa usa o WAHA global): não grava nada e sem webhook próprio", async () => {
    const f = montar();
    await connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, wahaDoCanal: null });
    expect(f.gravacoes).toEqual([]);
    expect(f.criacoes[0]?.webhook).toBeUndefined();
  });

  it("se não conseguir gravar o endereço, fecha a reserva em FAILED e NÃO chama o WAHA", async () => {
    const f = montar({ falhaAoGravar: true });
    await expect(connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, ...PROPRIO })).rejects.toMatchObject({
      code: "connection_checkpoint_failed",
    });
    expect(f.transporte.createSession).not.toHaveBeenCalled();
    expect(f.finishes.at(-1)).toMatchObject({ p_status: "FAILED", p_reason: "waha_endpoint_not_saved" });
  });

  it("a chave cifrada, o token e o segredo nunca voltam no resultado da conexão", async () => {
    const f = montar();
    const r = await connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, ...PROPRIO });
    const texto = JSON.stringify(r);
    for (const segredo of ["abcdef", "waha-acme", TOKEN, "cifrado"]) expect(texto).not.toContain(segredo);
  });
});

describe("connectWahaChannel — webhook POR SESSÃO", () => {
  it("⭐ gera o segredo do canal (48 hex), cifra, grava ANTES de criar a sessão e a cria com a URL do token", async () => {
    const f = montar();
    await connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, ...PROPRIO });

    const segredo = f.gravacoes.find((g) => "webhook_secret_encrypted" in g.row);
    expect(segredo).toEqual({ row: { webhook_secret_encrypted: "\\xcifrado" }, filtros: { organization_id: ORG, id: CANAL } });
    expect(f.ordem.indexOf("grava-segredo")).toBeLessThan(f.ordem.indexOf("createSession"));

    const webhook = f.criacoes[0]?.webhook as { url: string; events: string[]; hmacKey: string };
    expect(webhook.url).toBe(`${BASE_DO_WEBHOOK}/api/v1/webhooks/waha/${TOKEN}`);
    expect(webhook.events).toEqual([...EVENTOS_DO_WEBHOOK_DO_WAHA]);
    expect(webhook.hmacKey).toMatch(/^[0-9a-f]{48}$/);
  });

  it("conexão retentada: reaproveita o segredo que já está gravado (o WAHA e o banco não podem divergir)", async () => {
    const f = montar({ segredoExistente: "e".repeat(48) });
    await connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, ...PROPRIO });

    expect(f.ordem).not.toContain("cifra");
    expect(f.ordem).not.toContain("grava-segredo");
    expect((f.criacoes[0]?.webhook as { hmacKey: string }).hmacKey).toBe("e".repeat(48));
  });

  it("segredo gravado curto demais (o byte de enfeite) é trocado por um de verdade", async () => {
    const f = montar({ segredoExistente: "x" });
    await connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, ...PROPRIO });
    expect(f.ordem).toContain("grava-segredo");
    expect((f.criacoes[0]?.webhook as { hmacKey: string }).hmacKey).toMatch(/^[0-9a-f]{48}$/);
  });

  it("⭐ sem a base pública do webhook: FAILED e o WAHA nem é chamado (o contêiner não saberia para onde mandar)", async () => {
    const f = montar();
    await expect(
      connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, wahaDoCanal: COLUNAS, urlBaseDoWebhook: "" }),
    ).rejects.toMatchObject({ code: "webhook_base_url_missing", status: 503 });
    expect(f.transporte.createSession).not.toHaveBeenCalled();
    expect(f.finishes.at(-1)).toMatchObject({ p_status: "FAILED", p_reason: "webhook_not_prepared" });
  });

  it("base pública torta (sem esquema): FAILED, sem chamar o WAHA", async () => {
    const f = montar();
    await expect(
      connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, wahaDoCanal: COLUNAS, urlBaseDoWebhook: "crm.exemplo.com.br" }),
    ).rejects.toMatchObject({ code: "connection_webhook_not_prepared" });
    expect(f.transporte.createSession).not.toHaveBeenCalled();
  });

  it("cifra indisponível (chave mestra ausente): FAILED, e a sessão NÃO é criada sem segredo", async () => {
    const f = montar({ cifraIndisponivel: true });
    await expect(connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, ...PROPRIO })).rejects.toMatchObject({
      code: "connection_webhook_not_prepared",
    });
    expect(f.transporte.createSession).not.toHaveBeenCalled();
  });

  it("o segredo em claro nunca aparece no resultado nem nos erros", async () => {
    const f = montar({ cifraIndisponivel: true });
    const erro = await connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, ...PROPRIO }).catch((e: unknown) => e);
    expect(JSON.stringify(erro)).not.toMatch(/[0-9a-f]{48}/);
  });
});
