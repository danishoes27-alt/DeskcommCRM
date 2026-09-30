import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O BOOT SÓ SABE O QUE ESTÁ NO AMBIENTE.
 *
 * A credencial que uma organização cadastra em IA › Credenciais mora no banco e
 * só é resolvida quando o turno conhece a organização. Logo, três variáveis
 * vazias não autorizam `lib/env.ts` a concluir que o agente ficará mudo.
 *
 * Este teste prende as duas metades da regra: sem chave no ambiente o aviso é
 * informativo e não anuncia o desfecho do worker; com QUALQUER chave que o
 * produto usa no ambiente o aviso específico continua silencioso.
 *
 * `OPENAI_API_KEY` entrou nessa lista com a issue #1181: o catálogo serve o id
 * do modelo da OpenAI SEM prefixo, e a chave do ambiente passou a atender o
 * ponto pelo provedor da organização — uma instalação que responde pelo OpenAI
 * não pode ler no boot que "nenhuma chave de IA" está configurada.
 */
const PREFIXO = "[env] Nenhuma chave de IA";

function ambienteMinimo(): void {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://teste.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-teste");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-teste");

  vi.stubEnv("AI_GATEWAY_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  // Evita ruído de outro aviso de boot sem relação com esta issue.
  vi.stubEnv("IMPERSONATE_COOKIE_SECRET", "x".repeat(32));
}

async function avisosDoBoot(): Promise<string[]> {
  const avisos: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args) => {
    avisos.push(args.join(" "));
  });

  await import("@/lib/env");
  return avisos;
}

beforeEach(() => {
  vi.resetModules();
  ambienteMinimo();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("aviso de chave de IA no boot", () => {
  it("sem chave no ambiente, diz apenas o que o boot sabe", async () => {
    const avisos = await avisosDoBoot();
    const aviso = avisos.find((texto) => texto.startsWith(PREFIXO));

    expect(aviso).toBeDefined();
    expect(aviso).toContain("no ambiente");
    expect(aviso).toContain("IA › Credenciais");
    expect(aviso).not.toContain("o agente vai pular toda resposta");
    expect(aviso).not.toContain("ai_gateway_key_missing");
  });

  it("com chave no ambiente, não emite o aviso de ausência", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-teste");

    const avisos = await avisosDoBoot();

    expect(avisos.some((texto) => texto.startsWith(PREFIXO))).toBe(false);
  });

  it("com só OPENAI_API_KEY no ambiente, também não emite", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-teste");

    const avisos = await avisosDoBoot();

    expect(avisos.some((texto) => texto.startsWith(PREFIXO))).toBe(false);
  });
});

describe("aviso da TRAVA CENTRAL do Gateway no boot (achado da 2ª auditoria do Jev, 30/09/2026)", () => {
  const PREFIXO_TRAVA = "[env] AI_GATEWAY_API_KEY está preenchida";

  it("chave do Gateway preenchida SEM AI_GATEWAY_PLANO_CONFIRMADO: avisa", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "vck_teste");

    const avisos = await avisosDoBoot();

    expect(avisos.some((texto) => texto.startsWith(PREFIXO_TRAVA))).toBe(true);
  });

  it.each(["pro", "so_dado_de_teste", "  PRO  "])(
    "chave do Gateway + AI_GATEWAY_PLANO_CONFIRMADO='%s': NÃO avisa",
    async (valor) => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "vck_teste");
      vi.stubEnv("AI_GATEWAY_PLANO_CONFIRMADO", valor);

      const avisos = await avisosDoBoot();

      expect(avisos.some((texto) => texto.startsWith(PREFIXO_TRAVA))).toBe(false);
    },
  );

  it("sem AI_GATEWAY_API_KEY: não avisa, mesmo sem o plano confirmado (nada pra travar)", async () => {
    const avisos = await avisosDoBoot();

    expect(avisos.some((texto) => texto.startsWith(PREFIXO_TRAVA))).toBe(false);
  });

  it("plano com valor inválido conta como não confirmado: avisa", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "vck_teste");
    vi.stubEnv("AI_GATEWAY_PLANO_CONFIRMADO", "talvez");

    const avisos = await avisosDoBoot();

    expect(avisos.some((texto) => texto.startsWith(PREFIXO_TRAVA))).toBe(true);
  });
});
