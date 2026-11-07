/**
 * ONDE FICA O ENDEREÇO DO ARQUIVO DE APARELHOS — e quais endereços valem.
 *
 * Spec 23 §1–§2. A URL mora em `organizations.settings.aparelhos.url` (sem tabela nova, sem
 * migration) e é gravada por um UPDATE único, decidido pelo dono do produto. Este arquivo é o
 * ÚNICO lugar que sabe o que é uma URL aceitável, e a mesma regra vale na gravação (o SQL
 * preparado só grava o que `validarUrlDeAparelhos` aceitaria) e na leitura, que roda a cada
 * consulta — a configuração pode ter sido alterada por fora do app.
 *
 * ─── A allowlist é CONSTANTE no código, de propósito ───────────────────────────────
 * Acrescentar um host exige release. Variável de ambiente deixaria o `.env` do cliente decidir
 * para onde o servidor faz GET, e a allowlist é justamente a barreira que impede um settings
 * adulterado de virar "o servidor busca qualquer coisa" (SSRF).
 *
 * `lerConfiguracaoDeAparelhos` NUNCA lança: roda no turno de um cliente e um throw aqui mataria
 * a resposta por causa de um campo de configuração.
 */
import { z } from "zod";

/** Os únicos hosts que a ferramenta de aparelhos alcança. Comparação EXATA (sem sufixo/curinga). */
export const HOSTS_PERMITIDOS_APARELHOS = ["aparelhos.graucell.com"] as const;

export type MotivoDeUrlRecusada = "invalida" | "esquema" | "host" | "credencial" | "porta" | "fragmento";

export type ResultadoDaUrl = { ok: true; url: string } | { ok: false; motivo: MotivoDeUrlRecusada };

/**
 * https, host na allowlist, sem credencial, sem porta que não seja a padrão, sem fragmento.
 * Mais estrita que `assertSafeOutboundUrl`, que aceita http fora de produção: aqui é https
 * SEMPRE. Devolve a URL normalizada (esquema e host em minúsculas).
 */
export function validarUrlDeAparelhos(entrada: string): ResultadoDaUrl {
  let url: URL;
  try {
    url = new URL(entrada.trim());
  } catch {
    return { ok: false, motivo: "invalida" };
  }
  if (url.protocol !== "https:") return { ok: false, motivo: "esquema" };
  if (url.username !== "" || url.password !== "") return { ok: false, motivo: "credencial" };
  // `URL` descarta a porta padrão (443): `port === ""` cobre "sem porta" e ":443".
  if (url.port !== "") return { ok: false, motivo: "porta" };
  if (!(HOSTS_PERMITIDOS_APARELHOS as readonly string[]).includes(url.hostname)) {
    return { ok: false, motivo: "host" };
  }
  if (url.hash !== "") return { ok: false, motivo: "fragmento" };
  return { ok: true, url: url.href };
}

/** O formato de `organizations.settings.aparelhos`. Estrito: chave desconhecida é recusada. */
export const configuracaoDeAparelhosSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .refine((v) => validarUrlDeAparelhos(v).ok, { message: "url_nao_permitida" }),
  })
  .strict();

export type ConfiguracaoDeAparelhos = z.infer<typeof configuracaoDeAparelhosSchema>;

export type LeituraDaConfiguracao =
  | { ok: true; url: string }
  /** `sem_url`: não configurado. `url_nao_permitida`: há URL, mas fora da regra (adulteração). */
  | { ok: false; motivo: "sem_url" | "url_nao_permitida" };

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** `organizations.settings` → a URL a ler. Pura; nunca lança. */
export function lerConfiguracaoDeAparelhos(settings: unknown): LeituraDaConfiguracao {
  const bloco = objeto(objeto(settings)?.aparelhos);
  const url = bloco?.url;
  if (typeof url !== "string" || url.trim() === "") return { ok: false, motivo: "sem_url" };
  const valida = validarUrlDeAparelhos(url);
  return valida.ok ? { ok: true, url: valida.url } : { ok: false, motivo: "url_nao_permitida" };
}
