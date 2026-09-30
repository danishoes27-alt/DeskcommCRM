/**
 * O que este teste protege: **o modelo de CHAT tem que virar um provider
 * explícito quando não há gateway.**
 *
 * `isAiGatewayConfigured()` já devolvia `true` com só `ANTHROPIC_API_KEY` — a
 * única chave que o `install.sh` exige. Mas quem executava passava o id como
 * STRING, e no AI SDK id com barra é resolvido pelo **gateway da Vercel mesmo
 * sem chave**, caindo no plano anônimo:
 *
 *     Unauthenticated. Configure AI_GATEWAY_API_KEY or use a provider module.
 *
 * Resultado observado numa instalação self-host real: o `ai-sentiment-worker`
 * falhava em loop, uma vez por mensagem recebida. Ou seja, a checagem dizia
 * "tem IA" e a execução dizia "não tem" — desalinhados.
 *
 * A asserção é sobre o TIPO do retorno, mesma lógica do `embed.test.ts`:
 * string = "deixa o gateway resolver"; objeto = "provider explícito". É a única
 * diferença observável sem rede.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock: Record<string, string> = {};
vi.mock("@/lib/env", () => ({
  get env() {
    return envMock;
  },
}));

import { resolveLanguageModel } from "@/lib/ai/gateway";

beforeEach(() => {
  for (const k of Object.keys(envMock)) delete envMock[k];
});

describe("resolveLanguageModel", () => {
  it("com gateway da Vercel E a trava central confirmada devolve a STRING (o gateway roteia e fatura)", () => {
    envMock.AI_GATEWAY_API_KEY = "gw-key";
    envMock.AI_GATEWAY_PLANO_CONFIRMADO = "pro";
    expect(resolveLanguageModel("anthropic/claude-haiku-4-5")).toBe(
      "anthropic/claude-haiku-4-5",
    );
  });

  it("⛔ TRAVA CENTRAL: com a chave mas SEM AI_GATEWAY_PLANO_CONFIRMADO, o gateway conta como null — cai para o próximo provider", () => {
    envMock.AI_GATEWAY_API_KEY = "gw-key";
    // sem AI_GATEWAY_PLANO_CONFIRMADO
    envMock.ANTHROPIC_API_KEY = "sk-ant-xxx";
    const model = resolveLanguageModel("anthropic/claude-haiku-4-5");
    expect(model).not.toBeNull();
    expect(typeof model, "a chave sozinha não pode ligar o gateway").not.toBe("string");
  });

  it("só com ANTHROPIC_API_KEY devolve PROVIDER, não string — o bug do worker", () => {
    envMock.ANTHROPIC_API_KEY = "sk-ant-xxx";
    const model = resolveLanguageModel("anthropic/claude-haiku-4-5");
    expect(model).not.toBeNull();
    expect(typeof model).not.toBe("string");
  });

  it("com OPENROUTER_API_KEY devolve provider (ids da OpenRouter são provider/modelo)", () => {
    envMock.OPENROUTER_API_KEY = "sk-or-xxx";
    const model = resolveLanguageModel("anthropic/claude-haiku-4-5");
    expect(model).not.toBeNull();
    expect(typeof model).not.toBe("string");
  });

  it("gateway da Vercel tem precedência sobre OpenRouter (com a trava central confirmada)", () => {
    envMock.AI_GATEWAY_API_KEY = "gw-key";
    envMock.AI_GATEWAY_PLANO_CONFIRMADO = "pro";
    envMock.OPENROUTER_API_KEY = "sk-or-xxx";
    expect(typeof resolveLanguageModel("anthropic/claude-haiku-4-5")).toBe("string");
  });

  it("id openai/* cai no provider OpenAI quando só há OPENAI_API_KEY", () => {
    envMock.OPENAI_API_KEY = "sk-openai";
    const model = resolveLanguageModel("openai/gpt-4o-mini");
    expect(model).not.toBeNull();
    expect(typeof model).not.toBe("string");
  });

  it("sem chave nenhuma devolve null, para o chamador PULAR com motivo claro", () => {
    expect(resolveLanguageModel("anthropic/claude-haiku-4-5")).toBeNull();
  });

  it("chave errada para o prefixo do id também é null (não inventa provider)", () => {
    // Só OpenAI configurada, mas o id pede Anthropic: não dá para atender.
    envMock.OPENAI_API_KEY = "sk-openai";
    expect(resolveLanguageModel("anthropic/claude-haiku-4-5")).toBeNull();
  });
});
