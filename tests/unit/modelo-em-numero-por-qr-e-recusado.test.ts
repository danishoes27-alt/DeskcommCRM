/**
 * Modelo aprovado (template) mandado a uma conversa de número conectado por QR.
 *
 * Esse canal não tem definição aprovada. Antes, o envio de modelo caía no caminho do canal oficial, que lê a
 * credencial do ambiente: a mensagem saía (ou falhava) por OUTRO número. Agora a recusa vem antes de qualquer
 * linha nascer, com a saída indicada — e o canal que usa modelo segue como sempre.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { usaModeloAprovado } from "@/lib/channels/capabilities";
import type { SendMessageInput } from "@/lib/schemas";
import { criarDubleDoHandler } from "@/tests/helpers/duble-do-handler";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/a.jpg" }, error: null }) }) },
  }),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";

const ctxTela: HandlerCtx = {
  organization_id: ORG,
  actor: { type: "user", id: "55555555-5555-4555-8555-555555555555" },
  requestId: "req-modelo-qr",
};

function conversa(provider: string) {
  return {
    id: CONV,
    organization_id: ORG,
    contact_id: CONTACT,
    channel_session_id: SESSION,
    is_group: false,
    group_chat_id: null,
    bot_silenced_until: null,
    provider_conversation_id: null,
    last_inbound_at: null,
    contacts: { phone_number: "+5531999998888", wa_identity: null, wa_lid: null, is_blocked: false },
    channel_sessions: {
      id: SESSION,
      organization_id: ORG,
      provider,
      waha_session_name: provider === "waha" ? "default" : null,
      status: "WORKING",
      archived_at: null,
    },
  };
}

const modelo = {
  conversation_id: CONV,
  type: "template",
  template_name: "pedido_confirmado",
  template_language: "pt_BR",
  template_values: { "1": "Rafael" },
} as SendMessageInput;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("quem usa modelo aprovado", () => {
  it("só o canal que exige modelo responde que usa; o de QR não", () => {
    expect(usaModeloAprovado("waha")).toBe(false);
    expect(usaModeloAprovado("meta_cloud")).toBe(true);
    expect(usaModeloAprovado("zernio")).toBe(true);
    expect(usaModeloAprovado(null)).toBe(false); // sem provider vale o canal padrão, que é o de QR
  });
});

describe("modelo aprovado numa conversa de número por QR", () => {
  it("⭐ 422 modelo_indisponivel, com a saída indicada, e NADA é gravado nem enviado", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { supabase, capturas } = criarDubleDoHandler({ conversation: conversa("waha") });

    const erro = await sendMessageHandler(supabase, ctxTela, modelo).catch((e) => e);

    expect(erro, "o modelo foi aceito num número que não usa modelo").toBeInstanceOf(ApiError);
    expect((erro as ApiError).status).toBe(422);
    expect((erro as ApiError).code).toBe("modelo_indisponivel");
    expect((erro as ApiError).details).toMatchObject({ codigo: "modelo_indisponivel", use: "text" });
    expect((erro as ApiError).message).toMatch(/QR/);
    expect(capturas.inserts.messages, "uma linha nasceu para um envio já recusado").toHaveLength(0);
    expect(fetchSpy, "nada pode sair por outro número").not.toHaveBeenCalled();
  });

  it("texto livre no mesmo número segue como sempre", async () => {
    const { supabase, capturas } = criarDubleDoHandler({ conversation: conversa("waha") });

    await sendMessageHandler(supabase, ctxTela, { conversation_id: CONV, type: "text", body: "oi" } as SendMessageInput);

    expect(capturas.inserts.messages).toHaveLength(1);
  });

  it("o canal que usa modelo não é alcançado pela recusa", async () => {
    vi.stubEnv("META_PHONE_NUMBER_ID", "1103328999528818");
    vi.stubEnv("META_SYSTEM_USER_TOKEN", "tok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.OK" }] }) }));
    const { supabase, capturas } = criarDubleDoHandler({
      conversation: conversa("meta_cloud"),
      templateRow: {
        name: "pedido_confirmado",
        language: "pt_BR",
        status: "APPROVED",
        contract_hash: "h",
        components: [{ type: "BODY", text: "Ola {{1}}" }],
      },
    });

    const msg = await sendMessageHandler(supabase, ctxTela, modelo);

    expect(capturas.inserts.messages).toHaveLength(1);
    expect((msg as { status: string }).status).toBe("sent");
    vi.unstubAllEnvs();
  });
});
