import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * /api/v1/admin/tenants/[id]/whatsapp — o servidor de WhatsApp de UMA empresa, na mão do operador da plataforma.
 *
 * GET   o que a tela mostra: o cadastro (sem a chave), os canais e o estado de cada um.
 * POST  uma ação por vez, escolhida em `acao`:
 *   testar              pergunta ao servidor do WhatsApp se ele responde e aceita a chave (não grava nada);
 *   cadastrar           grava o servidor de WhatsApp da empresa (chave CIFRADA) e, se pedido, repassa aos canais atuais;
 *   reaplicar_webhook   põe o webhook por sessão nas sessões que já existem;
 *   gerar_chave         chave nova + hash para o contêiner (só em memória, devolvida UMA vez).
 *
 * Só administrador da plataforma com MFA (`requirePlatformAdmin`); toda escrita é auditada, e a auditoria leva
 * só FATOS (ação, quantos canais), nunca endereço nem chave. A chave de API cadastrada NUNCA volta nesta
 * resposta: a tela mostra apenas "cadastrada".
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import {
  baseDoWebhookConfigurada,
  CadastroDoTransporteError,
  cadastrarTransporteDaEmpresa,
  gerarChaveDeApi,
  kitDoContainer,
  lerEstadoDoTransporteDaEmpresa,
  reaplicarWebhookDosCanais,
  testarConexaoDaEmpresa,
} from "@/lib/channels/transporte-operador";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
const enderecoSchema = z.string().trim().min(1).max(300);
const chaveSchema = z.string().trim().min(1).max(200);

const corpoSchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("testar"), base_url: enderecoSchema, api_key: chaveSchema.optional() }),
  z.object({
    acao: z.literal("cadastrar"),
    base_url: enderecoSchema,
    api_key: chaveSchema.optional(),
    atualizar_canais: z.boolean().default(false),
  }),
  z.object({ acao: z.literal("reaplicar_webhook") }),
  z.object({ acao: z.literal("gerar_chave"), nome_do_servico: z.string().trim().max(60).optional() }),
]);

type Ctx = { params: Promise<{ id: string }> };

async function empresaExiste(admin: ReturnType<typeof createAdminClient>, id: string): Promise<boolean> {
  const { data } = await admin.from("organizations").select("id").eq("id", id).maybeSingle();
  return Boolean(data);
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const requestId = randomUUID();
  const { id } = await params;
  try {
    await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  if (!idSchema.safeParse(id).success) return fail("validation_failed", "Invalid tenant id", 400, { requestId });

  const admin = createAdminClient();
  if (!(await empresaExiste(admin, id))) return fail("not_found", "Tenant not found", 404, { requestId });
  try {
    return ok(await lerEstadoDoTransporteDaEmpresa(admin, id), { requestId });
  } catch {
    return fail("internal_error", "Não foi possível ler o WhatsApp desta empresa.", 500, { requestId });
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supportDenied = await requireSupportWrite(id);
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  // Escopo de suporte somente-leitura (`platform_admins.scope`) não altera o WhatsApp de empresa nenhuma — nem testa
  // com a chave guardada, nem cadastra. Só o escopo "full" escreve aqui (mesma regra de criar organização).
  if (adminCtx.platformAdmin.scope !== "full") {
    return fail("forbidden", "Seu acesso de suporte não permite alterar o WhatsApp da empresa", 403, { requestId });
  }
  if (!idSchema.safeParse(id).success) return fail("validation_failed", "Invalid tenant id", 400, { requestId });

  const bruto = await req.json().catch(() => null);
  const corpo = corpoSchema.safeParse(bruto);
  if (!corpo.success) return fail("validation_failed", "Invalid request body", 400, { requestId });

  const admin = createAdminClient();
  if (!(await empresaExiste(admin, id))) return fail("not_found", "Tenant not found", 404, { requestId });

  const auditar = (
    action: "platform_admin.tenant_whatsapp_registered" | "platform_admin.tenant_whatsapp_webhook_reapplied" | "platform_admin.tenant_whatsapp_key_generated",
    metadata: Record<string, unknown>,
  ) =>
    void audit({
      action,
      actorUserId: adminCtx.user.id,
      actingAsPlatformAdmin: true,
      bypassedRls: true,
      organizationId: id,
      resourceType: "organization",
      resourceId: id,
      requestId,
      metadata,
    });

  const dados = corpo.data;

  // ─── gerar_chave: só em memória; a resposta é a ÚNICA vez que a chave aparece ───────────────────────
  if (dados.acao === "gerar_chave") {
    const { chave, hashSha512 } = gerarChaveDeApi();
    auditar("platform_admin.tenant_whatsapp_key_generated", {});
    return ok(
      { chave, hash_sha512: hashSha512, kit: kitDoContainer({ nomeDoServico: dados.nome_do_servico ?? "whatsapp-empresa" }) },
      { requestId, headers: { "Cache-Control": "no-store" } },
    );
  }

  // ─── reaplicar_webhook ───────────────────────────────────────────────────────────────────────────
  if (dados.acao === "reaplicar_webhook") {
    const base = baseDoWebhookConfigurada();
    if (!base) return fail("webhook_base_url_missing", "A URL pública do webhook não está configurada neste servidor.", 409, { requestId });
    try {
      const canais = await reaplicarWebhookDosCanais(admin, { organizationId: id, urlBaseDoWebhook: base });
      auditar("platform_admin.tenant_whatsapp_webhook_reapplied", {
        canais: canais.length,
        aplicados: canais.filter((c) => c.resultado === "aplicado").length,
        falhas: canais.filter((c) => c.resultado === "falhou").length,
      });
      return ok({ canais }, { requestId });
    } catch {
      return fail("internal_error", "Não foi possível reaplicar o webhook.", 500, { requestId });
    }
  }

  // ─── testar ──────────────────────────────────────────────────────────────────────────────────────
  if (dados.acao === "testar") {
    const resultado = await testarConexaoDaEmpresa(admin, { organizationId: id, baseUrl: dados.base_url, apiKey: dados.api_key });
    if (!resultado.ok && "codigo" in resultado) return fail("validation_failed", resultado.motivo, 422, { requestId });
    return ok(resultado, { requestId });
  }

  // ─── cadastrar ───────────────────────────────────────────────────────────────────────────────────
  try {
    const r = await cadastrarTransporteDaEmpresa(admin, {
      organizationId: id,
      baseUrl: dados.base_url,
      apiKey: dados.api_key ?? null,
      atualizarCanais: dados.atualizar_canais,
    });
    auditar("platform_admin.tenant_whatsapp_registered", { canais_atualizados: r.canaisAtualizados, trocou_chave: Boolean(dados.api_key), repassou_aos_canais: dados.atualizar_canais });
    const estado = await lerEstadoDoTransporteDaEmpresa(admin, id);
    return ok({ ...estado, canais_atualizados: r.canaisAtualizados }, { requestId });
  } catch (err) {
    if (err instanceof CadastroDoTransporteError) {
      const status = err.code === "cifra_indisponivel" || err.code === "falha_ao_gravar" ? 500 : 422;
      return fail(err.code, err.message, status, { requestId });
    }
    return fail("internal_error", "Não foi possível gravar o cadastro.", 500, { requestId });
  }
}
