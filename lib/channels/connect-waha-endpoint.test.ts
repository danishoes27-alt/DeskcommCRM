/**
 * Conectar um número num WAHA POR EMPRESA: o endereço e a chave da empresa vão para o canal reservado
 * ANTES de qualquer chamada ao WAHA — assim, quem resolver o canal depois (envio, QR, vigia) acha o
 * mesmo WAHA com que a conexão foi feita.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { connectWahaChannel } from "./connect-waha";
import { limparCacheDoWaha } from "./waha-endpoint";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG = "20000000-0000-4000-8000-000000000001";
const CANAL = "20000000-0000-4000-8000-000000000002";
const COLUNAS = { waha_base_url: "http://waha-acme:3000", waha_api_key_encrypted: "\\xabcdef" };

function montar(opcoes: { falhaAoGravar?: boolean } = {}) {
  const ordem: string[] = [];
  const gravacoes: Array<{ row: Record<string, unknown>; filtros: Record<string, unknown> }> = [];
  const finishes: Array<Record<string, unknown>> = [];
  const canal = { id: CANAL, organization_id: ORG, waha_session_name: "org_aaaaaaaa_bbbb", status: "STARTING", archived_at: null };

  const db = {
    rpc: vi.fn(async (nome: string, args: Record<string, unknown>) => {
      if (nome === "fn_reserve_channel_connection") {
        return { data: { channel: canal, receipt_id: CANAL, lease_token: CANAL, replay: false }, error: null };
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
          } else {
            resolve({ error: null });
          }
        },
      };
      return builder;
    }),
  } as unknown as SupabaseClient;

  const transporte = {
    createSession: vi.fn(async (nome: string) => { ordem.push("createSession"); return { created: true, session: { name: nome, status: "STOPPED" } }; }),
    startExistingSession: vi.fn(async (nome: string) => { ordem.push("startExistingSession"); return { name: nome, status: "SCAN_QR_CODE" }; }),
    stopSession: vi.fn(async () => { ordem.push("stopSession"); }),
  };
  const entrada = { organizationId: ORG, idempotencyKey: CANAL, userId: CANAL, requestId: CANAL };
  return { db, transporte, ordem, gravacoes, finishes, entrada };
}

describe("connectWahaChannel — o WAHA da empresa vai para o canal antes de o WAHA ser chamado", () => {
  it("grava endereço e chave cifrada no canal reservado, escopado pela organização, e SÓ depois cria a sessão", async () => {
    limparCacheDoWaha();
    const f = montar();
    const r = await connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, wahaDoCanal: COLUNAS });

    expect(r.channel.status).toBe("SCAN_QR_CODE");
    expect(f.gravacoes).toEqual([
      { row: COLUNAS, filtros: { organization_id: ORG, id: CANAL } },
    ]);
    expect(f.ordem).toEqual(["grava-endereco", "createSession", "startExistingSession"]);
  });

  it("modo compartilhado (sem wahaDoCanal): não grava nada no canal", async () => {
    const f = montar();
    await connectWahaChannel(f.db, f.db, f.transporte, f.entrada);
    expect(f.gravacoes).toEqual([]);
    expect(f.ordem).toEqual(["createSession", "startExistingSession"]);
  });

  it("wahaDoCanal null (a empresa usa o WAHA global): não grava nada", async () => {
    const f = montar();
    await connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, wahaDoCanal: null });
    expect(f.gravacoes).toEqual([]);
  });

  it("se não conseguir gravar o endereço, fecha a reserva em FAILED e NÃO chama o WAHA", async () => {
    const f = montar({ falhaAoGravar: true });
    await expect(connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, wahaDoCanal: COLUNAS })).rejects.toMatchObject({
      code: "connection_checkpoint_failed",
    });
    expect(f.transporte.createSession).not.toHaveBeenCalled();
    expect(f.finishes.at(-1)).toMatchObject({ p_status: "FAILED", p_reason: "waha_endpoint_not_saved" });
  });

  it("a chave cifrada nunca volta no resultado da conexão", async () => {
    const f = montar();
    const r = await connectWahaChannel(f.db, f.db, f.transporte, { ...f.entrada, wahaDoCanal: COLUNAS });
    expect(JSON.stringify(r)).not.toContain("abcdef");
    expect(JSON.stringify(r)).not.toContain("waha-acme");
  });
});
