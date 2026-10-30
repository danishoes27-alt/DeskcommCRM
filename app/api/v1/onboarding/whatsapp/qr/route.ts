import { loadOnboardingChannel } from "@/lib/channels/onboarding-session";
import { buscarQrDoWaha, cabecalhosDoQr } from "@/lib/channels/waha-qr";
import { wahaDoCanalParaRota } from "@/lib/channels/waha-endpoint-app";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";

/**
 * Proxy WAHA's QR endpoint so the browser can <img src="..." /> without
 * exposing the API key.
 *
 * WAHA exposes: GET /api/{session}/auth/qr?format=image → image/png bytes.
 */
export async function GET() {
  const user = await loadAuthUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return new NextResponse(null, { status: 404 });

  const channel = await loadOnboardingChannel(await createClient(), activeOrg.orgId);
  if (!channel || channel.archived_at) return new NextResponse(null, { status: 404 });
  const sessionName = channel.waha_session_name;
  // O QR vem do WAHA DESTE canal (o da empresa, ou o global no modo compartilhado).
  const wahaDoCanal = await wahaDoCanalParaRota(sessionName);
  if (!wahaDoCanal.ok) return new NextResponse(null, { status: 503 });
  const { baseUrl, apiKey } = wahaDoCanal.valor.endereco;
  const qr = await buscarQrDoWaha({ baseUrl, apiKey, sessionName });
  if (!qr.ok) {
    return new NextResponse(null, {
      status: qr.status,
      headers: { "x-waha-status": String(qr.status) },
    });
  }
  return new NextResponse(qr.imagem, { status: 200, headers: cabecalhosDoQr(qr.tipo) });
}
