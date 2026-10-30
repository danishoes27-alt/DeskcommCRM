import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rota do operador para o servidor de WhatsApp de uma empresa: quem pode, o que ela aceita, o que ela
 * audita, e — acima de tudo — o que NUNCA sai nela (a chave de acesso cadastrada).
 */
const TENANT = "20000000-0000-4000-8000-000000000001";
const OPERADOR = "20000000-0000-4000-8000-0000000000aa";
const CHAVE_GERADA = "a".repeat(48);

const mundo = vi.hoisted(() => ({
  platformAdmin: true,
  suporteBloqueia: null as Response | null,
  empresaExiste: true,
  auditorias: [] as Array<Record<string, unknown>>,
  chamadas: [] as Array<{ fn: string; args: unknown[] }>,
  falhaDoCadastro: null as Error | null,
}));

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: async () => {
    if (!mundo.platformAdmin) throw new Error("NEXT_REDIRECT");
    return { user: { id: OPERADOR }, platformAdmin: {} };
  },
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => mundo.suporteBloqueia }));
vi.mock("@/lib/audit", () => ({ audit: async (e: Record<string, unknown>) => void mundo.auditorias.push(e) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mundo.empresaExiste ? { id: TENANT } : null, error: null }) }) }),
    }),
  }),
}));
vi.mock("@/lib/channels/transporte-operador", async (original) => {
  const real = await original<typeof import("@/lib/channels/transporte-operador")>();
  const registra = <T>(fn: string, valor: () => T) => (...args: unknown[]) => {
    mundo.chamadas.push({ fn, args });
    return valor();
  };
  return {
    ...real,
    baseDoWebhookConfigurada: () => "https://crm.exemplo.com.br",
    lerEstadoDoTransporteDaEmpresa: registra("ler", async () => ({ cadastrado: true, endereco: "http://waha-acme:3000", tem_chave: true, canais: [], canais_com_falha: 0 })),
    testarConexaoDaEmpresa: registra("testar", async () => ({ ok: true, versao: "2026.7.2", motor: "NOWEB" })),
    cadastrarTransporteDaEmpresa: registra("cadastrar", async () => {
      if (mundo.falhaDoCadastro) throw mundo.falhaDoCadastro;
      return { canaisAtualizados: 2 };
    }),
    reaplicarWebhookDosCanais: registra("reaplicar", async () => [{ canalId: "c1", resultado: "aplicado" }]),
    gerarChaveDeApi: () => ({ chave: CHAVE_GERADA, hashSha512: "h".repeat(128) }),
  };
});

import { GET, POST } from "@/app/api/v1/admin/tenants/[id]/whatsapp/route";
import { CadastroDoTransporteError } from "@/lib/channels/transporte-operador";

const ctx = (id = TENANT) => ({ params: Promise.resolve({ id }) });
const post = (corpo: unknown, id = TENANT) =>
  POST(new NextRequest(`http://localhost/api/v1/admin/tenants/${id}/whatsapp`, { method: "POST", body: JSON.stringify(corpo), headers: { "content-type": "application/json" } }), ctx(id));
const get = (id = TENANT) => GET(new NextRequest(`http://localhost/api/v1/admin/tenants/${id}/whatsapp`), ctx(id));

beforeEach(() => {
  mundo.platformAdmin = true;
  mundo.suporteBloqueia = null;
  mundo.empresaExiste = true;
  mundo.auditorias.length = 0;
  mundo.chamadas.length = 0;
  mundo.falhaDoCadastro = null;
});

describe("quem pode", () => {
  it("⭐ quem não é administrador da plataforma leva 403 — GET e POST, sem tocar em nada", async () => {
    mundo.platformAdmin = false;
    expect((await get()).status).toBe(403);
    expect((await post({ acao: "gerar_chave" })).status).toBe(403);
    expect(mundo.chamadas).toEqual([]);
    expect(mundo.auditorias).toEqual([]);
  });

  it("modo suporte somente-leitura bloqueia o POST (a barreira de suporte vale aqui também)", async () => {
    mundo.suporteBloqueia = new Response("{}", { status: 403 });
    const res = await post({ acao: "cadastrar", base_url: "http://waha:3000", api_key: "k" });
    expect(res.status).toBe(403);
    expect(mundo.chamadas).toEqual([]);
  });

  it("id que não é UUID: 400; empresa que não existe: 404", async () => {
    expect((await get("nao-e-uuid")).status).toBe(400);
    mundo.empresaExiste = false;
    expect((await get()).status).toBe(404);
    expect((await post({ acao: "gerar_chave" })).status).toBe(404);
  });
});

describe("GET", () => {
  it("devolve o estado da lib e nada além dele", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ cadastrado: true, tem_chave: true });
  });
});

describe("POST — corpo", () => {
  it.each([
    ["ação desconhecida", { acao: "apagar_tudo" }],
    ["testar sem endereço", { acao: "testar" }],
    ["cadastrar sem endereço", { acao: "cadastrar", api_key: "k" }],
    ["chave comprida demais", { acao: "cadastrar", base_url: "http://waha:3000", api_key: "k".repeat(500) }],
    ["corpo que não é objeto", "texto"],
  ])("recusa %s com 400", async (_nome, corpo) => {
    expect((await post(corpo)).status).toBe(400);
    expect(mundo.chamadas).toEqual([]);
  });
});

describe("POST — ações", () => {
  it("testar: devolve o resultado do teste", async () => {
    const res = await post({ acao: "testar", base_url: "http://waha-acme:3000", api_key: "k" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ ok: true, versao: "2026.7.2", motor: "NOWEB" });
    expect(mundo.chamadas[0]).toMatchObject({ fn: "testar" });
    expect(mundo.auditorias).toEqual([]); // testar não muda nada: não audita
  });

  it("cadastrar: grava, devolve o estado novo com o número de canais repassados, e audita SÓ fatos", async () => {
    const res = await post({ acao: "cadastrar", base_url: "http://waha-acme:3000", api_key: "chave-secreta-acme", atualizar_canais: true });
    const corpo = JSON.stringify(await res.json());

    expect(res.status).toBe(200);
    expect(corpo).toContain('"canais_atualizados":2');
    expect(mundo.chamadas.map((c) => c.fn)).toEqual(["cadastrar", "ler"]);
    expect(mundo.auditorias).toHaveLength(1);
    expect(mundo.auditorias[0]).toMatchObject({
      action: "platform_admin.tenant_whatsapp_registered",
      actorUserId: OPERADOR,
      actingAsPlatformAdmin: true,
      organizationId: TENANT,
      metadata: { canais_atualizados: 2, trocou_chave: true, repassou_aos_canais: true },
    });
    // ⭐ nem a chave nem o endereço entram na auditoria nem na resposta
    for (const saida of [corpo, JSON.stringify(mundo.auditorias)]) {
      expect(saida).not.toContain("chave-secreta-acme");
    }
    expect(JSON.stringify(mundo.auditorias)).not.toContain("waha-acme");
  });

  it("cadastrar com erro de validação da lib vira 422 com o código", async () => {
    mundo.falhaDoCadastro = new CadastroDoTransporteError("chave_obrigatoria", "informe a chave");
    const res = await post({ acao: "cadastrar", base_url: "http://waha:3000" });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("chave_obrigatoria");
    expect(mundo.auditorias).toEqual([]);
  });

  it("falha de gravação ou de cifra vira 500 (não 422: não é erro de quem digitou)", async () => {
    mundo.falhaDoCadastro = new CadastroDoTransporteError("cifra_indisponivel", "sem cifra");
    expect((await post({ acao: "cadastrar", base_url: "http://waha:3000", api_key: "k" })).status).toBe(500);
  });

  it("reaplicar_webhook: devolve o resultado por canal e audita as contagens", async () => {
    const res = await post({ acao: "reaplicar_webhook" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.canais).toEqual([{ canalId: "c1", resultado: "aplicado" }]);
    expect(mundo.auditorias[0]).toMatchObject({ action: "platform_admin.tenant_whatsapp_webhook_reapplied", metadata: { canais: 1, aplicados: 1, falhas: 0 } });
  });

  it("gerar_chave: devolve a chave, o hash e o kit UMA vez; a auditoria diz que gerou, sem a chave", async () => {
    const res = await post({ acao: "gerar_chave", nome_do_servico: "waha-acme" });
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(corpo.data.chave).toBe(CHAVE_GERADA);
    expect(corpo.data.hash_sha512).toHaveLength(128);
    expect(corpo.data.kit).toContain("sha512:<cole aqui");
    expect(JSON.stringify(mundo.auditorias)).not.toContain(CHAVE_GERADA);
    expect(mundo.auditorias[0]).toMatchObject({ action: "platform_admin.tenant_whatsapp_key_generated" });
  });
});
