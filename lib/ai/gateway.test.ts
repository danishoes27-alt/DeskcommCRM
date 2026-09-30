/**
 * ⛔ TRAVA CENTRAL do AI Gateway inteiro (decisão do Berg, 30/09/2026).
 *
 * Preencher `AI_GATEWAY_API_KEY` sozinha NÃO pode ligar nada: sem
 * `AI_GATEWAY_PLANO_CONFIRMADO` (`pro` | `so_dado_de_teste`), `gatewayConfig()` devolve
 * `null` e todo o resto (`isEmbeddingProviderConfigured`, `resolveLanguageModel` —
 * coberto em `gateway-resolve-model.test.ts` — e a escada de `embeddings/chave.ts`)
 * cai em cascata.
 *
 * Achado que motivou esta trava: preencher só a chave já ligava, sem nenhuma
 * confirmação, o worker de sentimento, o worker de resposta legado (ai-response-worker,
 * caminho de fallback) e a busca por embeddings — na conta Hobby, sem ZDR garantido.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock: Record<string, string> = {};
vi.mock("@/lib/env", () => ({
  get env() {
    return envMock;
  },
}));

import {
  gatewayConfig,
  isEmbeddingProviderConfigured,
  planoConfirmadoDoGateway,
} from "./gateway";

beforeEach(() => {
  for (const k of Object.keys(envMock)) delete envMock[k];
});

describe("planoConfirmadoDoGateway", () => {
  it("só aceita 'pro' e 'so_dado_de_teste' (sem se importar com espaço/caixa)", () => {
    expect(planoConfirmadoDoGateway("pro")).toBe("pro");
    expect(planoConfirmadoDoGateway("so_dado_de_teste")).toBe("so_dado_de_teste");
    expect(planoConfirmadoDoGateway("  PRO ")).toBe("pro");
    expect(planoConfirmadoDoGateway("  So_Dado_De_Teste ")).toBe("so_dado_de_teste");
  });

  it("qualquer outra coisa — ausente, vazio, lixo — é 'não confirmado' (null), nunca lança", () => {
    for (const ruim of [undefined, null, "", " ", "hobby", "enterprise", "true", "1"]) {
      expect(planoConfirmadoDoGateway(ruim as string | undefined)).toBeNull();
    }
  });

  it("sem argumento, lê env.AI_GATEWAY_PLANO_CONFIRMADO", () => {
    envMock.AI_GATEWAY_PLANO_CONFIRMADO = "pro";
    expect(planoConfirmadoDoGateway()).toBe("pro");
  });
});

describe("gatewayConfig — a trava central", () => {
  it("sem AI_GATEWAY_API_KEY: null, mesmo com o plano confirmado", () => {
    envMock.AI_GATEWAY_PLANO_CONFIRMADO = "pro";
    expect(gatewayConfig()).toBeNull();
  });

  it("com a chave mas SEM plano confirmado: null — a chave sozinha não liga nada", () => {
    envMock.AI_GATEWAY_API_KEY = "gw-key";
    expect(gatewayConfig()).toBeNull();
  });

  it("com a chave e plano 'so_dado_de_teste' confirmado: configurado", () => {
    envMock.AI_GATEWAY_API_KEY = "gw-key";
    envMock.AI_GATEWAY_PLANO_CONFIRMADO = "so_dado_de_teste";
    expect(gatewayConfig()).toEqual({ apiKey: "gw-key", baseURL: undefined });
  });

  it("com a chave e plano 'pro' confirmado: configurado, com baseURL quando presente", () => {
    envMock.AI_GATEWAY_API_KEY = "gw-key";
    envMock.AI_GATEWAY_PLANO_CONFIRMADO = "pro";
    envMock.AI_GATEWAY_BASE_URL = "https://proxy.example.com";
    expect(gatewayConfig()).toEqual({ apiKey: "gw-key", baseURL: "https://proxy.example.com" });
  });

  it("plano confirmado com valor inválido conta como não confirmado", () => {
    envMock.AI_GATEWAY_API_KEY = "gw-key";
    envMock.AI_GATEWAY_PLANO_CONFIRMADO = "talvez";
    expect(gatewayConfig()).toBeNull();
  });
});

describe("isEmbeddingProviderConfigured — mesma trava central, mas OPENAI_API_KEY e OPENROUTER_API_KEY direto continuam livres", () => {
  it("só a chave do gateway, sem plano confirmado: false", () => {
    envMock.AI_GATEWAY_API_KEY = "gw-key";
    expect(isEmbeddingProviderConfigured()).toBe(false);
  });

  it("chave do gateway + plano confirmado: true", () => {
    envMock.AI_GATEWAY_API_KEY = "gw-key";
    envMock.AI_GATEWAY_PLANO_CONFIRMADO = "so_dado_de_teste";
    expect(isEmbeddingProviderConfigured()).toBe(true);
  });

  it("OPENAI_API_KEY direto continua funcionando sem nenhuma confirmação do Gateway", () => {
    envMock.OPENAI_API_KEY = "sk-openai";
    expect(isEmbeddingProviderConfigured()).toBe(true);
  });

  it("OPENROUTER_API_KEY direto também continua livre (a trava é só do caminho do Gateway)", () => {
    envMock.OPENROUTER_API_KEY = "sk-or-xxx";
    expect(isEmbeddingProviderConfigured()).toBe(true);
  });

  it("a chave do gateway sem plano confirmado não atrapalha quem tem chave direta", () => {
    envMock.AI_GATEWAY_API_KEY = "gw-key";
    envMock.OPENROUTER_API_KEY = "sk-or-xxx";
    expect(isEmbeddingProviderConfigured()).toBe(true);
  });

  it("nada configurado: false", () => {
    expect(isEmbeddingProviderConfigured()).toBe(false);
  });
});
