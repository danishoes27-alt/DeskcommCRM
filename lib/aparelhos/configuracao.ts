/**
 * ONDE FICA O ENDEREÇO DO ARQUIVO DE APARELHOS — e quais endereços valem para ESTA organização.
 *
 * Spec 23 §1–§2. A configuração mora em `organizations.settings.aparelhos` (sem tabela nova, sem
 * migration) e tem DUAS chaves que andam juntas:
 *
 *     { "url": "https://<host>/<arquivo>.json", "hosts": ["<host>"] }
 *
 * Este arquivo é o ÚNICO lugar que sabe o que é uma configuração aceitável, e a mesma regra vale
 * na gravação (o SQL preparado grava só o que o schema aceitaria) e na leitura, que roda a cada
 * consulta — a configuração pode ter sido alterada por fora do app.
 *
 * ─── Por que a lista de hosts é da ORGANIZAÇÃO, e não uma constante ─────────────────
 * O Celuzap é multicliente: domínio de loja escrito no código é o defeito que a régua de marca
 * (`tests/unit/branding.test.ts`) existe para barrar. A allowlist continua sendo uma allowlist —
 * a ferramenta só lê se o host da URL estiver em `hosts` da MESMA organização —, mas quem a
 * escreve é o administrador do servidor (um UPDATE), nunca o modelo: `hosts` não é argumento da
 * ferramenta e não existe caminho do corpo de uma chamada até aqui.
 *
 * ─── O que isto NÃO é ───────────────────────────────────────────────────────────────
 * Não substitui as guardas anti-SSRF: a URL, mesmo com o host na lista, ainda passa por
 * `assertSafeOutboundUrl` e `assertDestinoResolvidoSeguro` antes do `fetch`. A lista reduz o
 * alvo a "o host que o administrador declarou"; quem barra IP interno é o resolvedor.
 *
 * `lerConfiguracaoDeAparelhos` NUNCA lança: roda no turno de um cliente.
 */
import { z } from "zod";

/** Quantos hosts uma organização pode declarar. Uma loja precisa de um; dez é folga. */
export const MAX_HOSTS_DE_APARELHOS = 10;

/**
 * Hostname em minúsculas, SEM esquema, porta, caminho nem credencial, com ao menos um ponto e um
 * TLD só de letras. IP literal (TLD numérico) e `localhost` (sem ponto) não passam.
 */
const HOSTNAME = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const hostsDeAparelhosSchema = z
  .array(z.string().regex(HOSTNAME))
  .min(1)
  .max(MAX_HOSTS_DE_APARELHOS)
  .refine((lista) => new Set(lista).size === lista.length, { message: "hosts_repetidos" });

export type MotivoDeUrlRecusada = "invalida" | "esquema" | "host" | "credencial" | "porta" | "fragmento";

export type ResultadoDaUrl = { ok: true; url: string } | { ok: false; motivo: MotivoDeUrlRecusada };

/**
 * https, host DENTRO de `hosts`, sem credencial, sem porta que não seja a padrão, sem fragmento.
 * Mais estrita que `assertSafeOutboundUrl`, que aceita http fora de produção: aqui é https
 * SEMPRE. Devolve a URL normalizada (esquema e host em minúsculas). Comparação EXATA do host:
 * sem sufixo, sem curinga, sem subdomínio implícito.
 */
export function validarUrlDeAparelhos(entrada: string, hosts: readonly string[]): ResultadoDaUrl {
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
  if (!hosts.includes(url.hostname)) return { ok: false, motivo: "host" };
  if (url.hash !== "") return { ok: false, motivo: "fragmento" };
  return { ok: true, url: url.href };
}

/**
 * O formato de `organizations.settings.aparelhos`. Estrito: chave desconhecida é recusada, e a
 * `url` só vale se o host dela estiver em `hosts` (a mesma regra da leitura).
 */
export const configuracaoDeAparelhosSchema = z
  .object({
    url: z.string().trim().min(1).max(2048),
    hosts: hostsDeAparelhosSchema,
  })
  .strict()
  .superRefine((cfg, ctx) => {
    if (!validarUrlDeAparelhos(cfg.url, cfg.hosts).ok) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "url_fora_da_lista_de_hosts" });
    }
  });

export type ConfiguracaoDeAparelhos = z.infer<typeof configuracaoDeAparelhosSchema>;

/** Por que a configuração não vale. Todos viram `nao_configurado` para o agente. */
export type MotivoDeNaoConfigurado = "sem_url" | "sem_hosts" | "hosts_invalidos" | "url_fora_da_regra";

export type LeituraDaConfiguracao =
  | { ok: true; url: string; hosts: string[] }
  | { ok: false; motivo: MotivoDeNaoConfigurado };

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** `organizations.settings` → a URL a ler e os hosts permitidos. Pura; nunca lança. */
export function lerConfiguracaoDeAparelhos(settings: unknown): LeituraDaConfiguracao {
  const bloco = objeto(objeto(settings)?.aparelhos);
  const url = bloco?.url;
  if (typeof url !== "string" || url.trim() === "") return { ok: false, motivo: "sem_url" };

  const brutos = bloco?.hosts;
  if (!Array.isArray(brutos) || brutos.length === 0) return { ok: false, motivo: "sem_hosts" };
  const hosts = hostsDeAparelhosSchema.safeParse(brutos);
  if (!hosts.success) return { ok: false, motivo: "hosts_invalidos" };

  const valida = validarUrlDeAparelhos(url, hosts.data);
  return valida.ok
    ? { ok: true, url: valida.url, hosts: hosts.data }
    : { ok: false, motivo: "url_fora_da_regra" };
}
