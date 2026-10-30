/**
 * MediaSource do WAHA: baixa o binário hospedado pelo container WAHA.
 *
 * A URL anunciada no webhook NÃO é confiável nem correta: o HMAC é
 * best-effort (payload forjado é possível) e o WAHA anuncia seu endereço
 * INTERNO (ex.: localhost:3000 dentro do container, mapeado p/ 3030 no
 * host). Por isso o fetch é SEMPRE reconstruído sobre o endereço do WAHA
 * DO CANAL (ou o global, no modo compartilhado), aproveitando apenas
 * path+query da URL anunciada — SSRF impossível por construção (o host nunca
 * vem do payload). A futura MetaMediaSource
 * implementa a mesma assinatura baixando via media_id + Graph API.
 */
import { enderecoDoAmbiente } from "@/lib/channels/waha-endpoint";
import {
  MAX_MEDIA_BYTES,
  MediaTooLargeError,
  type FetchedMedia,
} from "@/lib/messaging/media/types";

const FETCH_TIMEOUT_MS = 30_000;

/** O WAHA de onde baixar: o do canal (resolvido por quem chama) ou, sem ele, o global do ambiente. */
export interface DestinoDaMidiaDoWaha {
  baseUrl: string;
  apiKey: string;
}

export async function fetchWahaMedia(
  mediaUrl: string,
  hintMime?: string | null,
  destino?: DestinoDaMidiaDoWaha | null,
): Promise<FetchedMedia> {
  const alvo = destino ?? enderecoDoAmbiente();
  const base = alvo?.baseUrl;
  let url: URL;
  try {
    const advertised = new URL(mediaUrl);
    // Host/porta descartados: só path+query sobrevivem, resolvidos na base.
    url = new URL(advertised.pathname + advertised.search, base ?? "");
  } catch {
    throw new Error("waha_media_untrusted_host");
  }

  const apiKey = alvo?.apiKey;
  const res = await fetch(url.toString(), {
    headers: apiKey ? { "X-Api-Key": apiKey } : {},
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`waha_media_${res.status}`);

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_MEDIA_BYTES) throw new MediaTooLargeError();

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_MEDIA_BYTES) throw new MediaTooLargeError();

  const mime = res.headers.get("content-type") || hintMime || "application/octet-stream";
  return { buffer, mime };
}
