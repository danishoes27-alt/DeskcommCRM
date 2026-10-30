import { randomUUID } from "node:crypto";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { wahaDaOrganizacaoParaRota, wahaDoCanalParaRota } from "@/lib/channels/waha-endpoint-app";
import { env } from "@/lib/env";
import { connectWahaChannel, ChannelConnectionError } from "@/lib/channels/connect-waha";
import { loadOnboardingChannel } from "@/lib/channels/onboarding-session";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const user = await loadAuthUser(); if (!user) return fail("unauthenticated", "Sessão expirada", 401, { requestId });
  const org = await resolveActiveOrg(user); if (!org) return fail("tenant_not_found", "Sem organização ativa", 404, { requestId });
  if (await mfaEmDivida()) return fail("mfa_required", "Confirme a verificação em duas etapas.", 403, { requestId });
  try {
    const db = await createClient(); const channel = await loadOnboardingChannel(db, org.orgId);
    if (!channel || channel.archived_at) {
      // Ainda não há canal: "WAHA_NOT_CONFIGURED" só quando a EMPRESA não tem WhatsApp cadastrado
      // (nem o dela, nem o global). Com cadastro, o passo é "ainda não iniciado".
      const daEmpresa = await wahaDaOrganizacaoParaRota(org.orgId);
      if (!daEmpresa.ok) return ok({ status: "WAHA_NOT_CONFIGURED", session: null }, { requestId });
      return ok({ status: "NOT_STARTED", session: null }, { requestId });
    }
    const wahaDoCanal = await wahaDoCanalParaRota(channel.waha_session_name);
    if (!wahaDoCanal.ok) return ok({ status: "WAHA_NOT_CONFIGURED", session: null }, { requestId });
    const remote = await wahaDoCanal.valor.client.getVerifiedSession(channel.waha_session_name);
    const status = remote?.status ?? "STOPPED";
    const { error, data } = await db.from("channel_sessions").update({ status, last_health_check_at: new Date().toISOString() })
      .eq("organization_id", org.orgId).eq("id", channel.id).is("archived_at", null).select("id").maybeSingle();
    if (error || !data) throw new Error("connection_sync_failed");
    return ok({ status, session: channel.waha_session_name, channel_session_id: channel.id }, { requestId });
  } catch { return fail("connection_status_failed", "Não foi possível conferir a conexão. Tente novamente.", 502, { requestId }); }
}

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "channel_sessions", allowPlatformAdmin: true });
  if (!auth.ok) return auth.response;
  if (await mfaEmDivida()) return fail("mfa_required", "Confirme a verificação em duas etapas.", 403, { requestId });
  const wahaDaEmpresa = await wahaDaOrganizacaoParaRota(auth.org.orgId);
  if (!wahaDaEmpresa.ok) {
    const preparando = wahaDaEmpresa.motivo === "nao_configurado";
    return fail(preparando ? "waha_not_configured" : "waha_cadastro_quebrado", preparando ? "Estamos preparando o seu WhatsApp. Assim que estiver pronto, o código para conectar aparece aqui." : "O WhatsApp desta empresa está com um problema. Fale com o suporte.", 503, { requestId });
  }
  // WAHA próprio exige a URL pública do webhook: sem ela a conexão falharia depois de reservar o canal (uma linha
  // `FAILED` a cada tentativa). Recusa antes de criar qualquer coisa.
  if (wahaDaEmpresa.valor.colunas && !env.WAHA_WEBHOOK_BASE_URL?.trim()) {
    return fail("webhook_base_url_missing", "O WhatsApp desta empresa ainda não pode ser conectado: falta uma configuração do servidor. Fale com o suporte.", 503, { requestId });
  }
  try {
    const result = await connectWahaChannel(await createClient(), createAdminClient(), wahaDaEmpresa.valor.client, {
      organizationId: auth.org.orgId, idempotencyKey: req.headers.get("Idempotency-Key") ?? "",
      userId: auth.user.id, requestId, onboarding: true, restart: new URL(req.url).searchParams.get("restart") === "1",
      wahaDoCanal: wahaDaEmpresa.valor.colunas as { waha_base_url: string; waha_api_key_encrypted: string } | null,
      urlBaseDoWebhook: env.WAHA_WEBHOOK_BASE_URL,
    });
    return ok({ status: result.channel.status, session: result.channel.waha_session_name, channel_session_id: result.channel.id }, { requestId });
  } catch (error) {
    if (error instanceof ChannelConnectionError) return fail(error.code,
      error.code === "connection_in_progress" ? "A conexão ainda está sendo preparada. Aguarde e tente novamente."
        : error.code === "connection_session_name_too_long" ? "O identificador desta conexão passou do limite que o WhatsApp aceita. Nada foi criado no WhatsApp — atualize o sistema e tente novamente."
        : "Não foi possível concluir a conexão. Tente novamente ou repare o número em Conexões.",
      error.status, { requestId, details: error.technical });
    return fail("internal_error", "Não foi possível concluir a conexão. Tente novamente.", 500, { requestId });
  }
}
