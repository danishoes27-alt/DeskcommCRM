/**
 * Busca a imagem do QR no WAHA DE UM CANAL, para as duas rotas que a entregam ao navegador.
 *
 * O endereço vem do cadastro (o do operador, ou o global do modo compartilhado) e a chave de API vai no
 * cabeçalho; por isso a chamada é fechada de todos os lados:
 *
 *  - `redirect: "error"`: um redirecionamento do servidor NÃO é seguido. Seguir levaria a chave (e a requisição)
 *    para onde o servidor mandar, e a resposta voltaria ao navegador;
 *  - prazo de 10 s: um WAHA parado (que não responde nem recusa) não prende a requisição, e a tela, que
 *    recarrega o QR a cada poucos segundos, não acumula pedidos pendurados;
 *  - o que volta tem de SER uma imagem (assinatura PNG ou JPEG) e de tamanho razoável. O corpo do servidor nunca
 *    é repassado como está: quem recebe é um `<img>`, e texto/HTML vindo de fora não chega à origem do app.
 */
export type ResultadoDoQr =
  | { ok: true; imagem: ArrayBuffer; tipo: "image/png" | "image/jpeg" }
  | { ok: false; status: number };

const PRAZO_MS = 10_000;
const TAMANHO_MAXIMO = 512 * 1024;

function tipoPelaAssinatura(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export async function buscarQrDoWaha(entrada: {
  baseUrl: string;
  apiKey: string;
  sessionName: string;
}): Promise<ResultadoDoQr> {
  let resposta: Response;
  try {
    resposta = await fetch(`${entrada.baseUrl}/api/${encodeURIComponent(entrada.sessionName)}/auth/qr?format=image`, {
      headers: { "X-Api-Key": entrada.apiKey },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(PRAZO_MS),
    });
  } catch {
    // Sem resposta no prazo, recusa de conexão, DNS, ou redirecionamento: para a tela é "o serviço não respondeu".
    return { ok: false, status: 502 };
  }
  if (!resposta.ok) return { ok: false, status: resposta.status };

  const imagem = await resposta.arrayBuffer();
  const tipo = imagem.byteLength <= TAMANHO_MAXIMO ? tipoPelaAssinatura(new Uint8Array(imagem)) : null;
  if (!tipo) return { ok: false, status: 502 };
  return { ok: true, imagem, tipo };
}

/** Cabeçalhos da resposta ao navegador: tipo fixo (nunca o do servidor) e nada de interpretar como página. */
export function cabecalhosDoQr(tipo: "image/png" | "image/jpeg"): Record<string, string> {
  return {
    "content-type": tipo,
    "cache-control": "no-store, max-age=0",
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox",
  };
}
