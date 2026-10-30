/**
 * O resolvedor para o app, com o admin client do Supabase de mentira: o que as ROTAS recebem.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  porSessao: new Map<string, { waha_base_url: string | null; waha_api_key_encrypted: string | null }>(),
  porOrganizacao: new Map<string, { waha_base_url: string | null; waha_api_key_encrypted: string | null }>(),
  settings: new Map<string, Record<string, unknown>>(), // organization_id -> organizations.settings
  chaves: new Map<string, string | null>(), // cifra -> chave em claro (null = RPC falha)
  consultaFalha: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const filtros: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (coluna: string, valor: unknown) => ((filtros[coluna] = valor), builder),
        not: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          if (banco.consultaFalha) return { data: null, error: { message: "boom" } };
          if (tabela === "organizations") {
            const settings = banco.settings.get(String(filtros.id));
            return { data: settings ? { settings } : null, error: null };
          }
          if ("waha_session_name" in filtros) return { data: banco.porSessao.get(filtros.waha_session_name as string) ?? null, error: null };
          return { data: banco.porOrganizacao.get(filtros.organization_id as string) ?? null, error: null };
        },
      };
      return builder;
    },
    rpc: async (_nome: string, args: { ciphertext: string }) => {
      const chave = banco.chaves.get(args.ciphertext) ?? null;
      return chave === null ? { data: null, error: { message: "x" } } : { data: chave, error: null };
    },
  }),
}));

import { limparCacheDoWaha } from "./waha-endpoint";
import { wahaDaOrganizacaoParaRota, wahaDoCanalParaRota } from "./waha-endpoint-app";

const COLUNAS_ACME = { waha_base_url: "http://waha-acme:3000", waha_api_key_encrypted: "\\xaaaa" };

beforeEach(() => {
  banco.porSessao.clear();
  banco.porOrganizacao.clear();
  banco.settings.clear();
  banco.chaves.clear();
  banco.chaves.set("\\xaaaa", "chave-da-acme");
  banco.consultaFalha = false;
  limparCacheDoWaha();
  vi.stubEnv("WAHA_API_BASE_URL", "");
  vi.stubEnv("WAHA_API_KEY", "");
});

describe("wahaDoCanalParaRota", () => {
  it("canal com WAHA próprio: o endereço e a chave são os dele", async () => {
    banco.porSessao.set("org_acme", COLUNAS_ACME);
    const r = await wahaDoCanalParaRota("org_acme");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.endereco).toEqual({ baseUrl: "http://waha-acme:3000", apiKey: "chave-da-acme", origem: "canal" });
  });

  it("canal sem cadastro próprio, com WAHA global: usa o global", async () => {
    vi.stubEnv("WAHA_API_BASE_URL", "http://waha-global:3000");
    vi.stubEnv("WAHA_API_KEY", "chave-global");
    banco.porSessao.set("org_x", { waha_base_url: null, waha_api_key_encrypted: null });
    const r = await wahaDoCanalParaRota("org_x");
    expect(r.ok && r.valor.endereco).toEqual({ baseUrl: "http://waha-global:3000", apiKey: "chave-global", origem: "ambiente" });
  });

  it("sem cadastro próprio e sem WAHA global: nao_configurado", async () => {
    banco.porSessao.set("org_x", { waha_base_url: null, waha_api_key_encrypted: null });
    expect(await wahaDoCanalParaRota("org_x")).toEqual({ ok: false, motivo: "nao_configurado" });
  });

  it("cadastro próprio com a chave ilegível: cadastro_quebrado com o código, MESMO havendo WAHA global", async () => {
    vi.stubEnv("WAHA_API_BASE_URL", "http://waha-global:3000");
    vi.stubEnv("WAHA_API_KEY", "chave-global");
    banco.porSessao.set("org_acme", { ...COLUNAS_ACME, waha_api_key_encrypted: "\\xbbbb" });
    expect(await wahaDoCanalParaRota("org_acme")).toEqual({ ok: false, motivo: "cadastro_quebrado", code: "chave_ilegivel" });
  });

  it("banco fora do ar: cadastro_quebrado/consulta_falhou (nunca o WAHA global por adivinhação)", async () => {
    vi.stubEnv("WAHA_API_BASE_URL", "http://waha-global:3000");
    vi.stubEnv("WAHA_API_KEY", "chave-global");
    banco.consultaFalha = true;
    expect(await wahaDoCanalParaRota("org_acme")).toEqual({ ok: false, motivo: "cadastro_quebrado", code: "consulta_falhou" });
  });
});

describe("wahaDaOrganizacaoParaRota — o canal novo herda o WAHA da empresa", () => {
  it("empresa com WAHA próprio: devolve o endereço dela e as colunas a copiar para o canal novo", async () => {
    banco.porOrganizacao.set("org-1", COLUNAS_ACME);
    const r = await wahaDaOrganizacaoParaRota("org-1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.endereco).toMatchObject({ baseUrl: "http://waha-acme:3000", apiKey: "chave-da-acme", origem: "canal" });
      expect(r.valor.colunas).toEqual(COLUNAS_ACME);
    }
  });

  it("empresa sem WAHA próprio, com global: usa o global e não há nada a copiar", async () => {
    vi.stubEnv("WAHA_API_BASE_URL", "http://waha-global:3000");
    vi.stubEnv("WAHA_API_KEY", "chave-global");
    const r = await wahaDaOrganizacaoParaRota("org-2");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.endereco.origem).toBe("ambiente");
      expect(r.valor.colunas).toBeNull();
    }
  });

  it("empresa sem WAHA próprio e sem global: ainda não dá para conectar (nao_configurado)", async () => {
    expect(await wahaDaOrganizacaoParaRota("org-3")).toEqual({ ok: false, motivo: "nao_configurado" });
  });

  it("cadastro da empresa quebrado: cadastro_quebrado, nunca o global", async () => {
    vi.stubEnv("WAHA_API_BASE_URL", "http://waha-global:3000");
    vi.stubEnv("WAHA_API_KEY", "chave-global");
    banco.porOrganizacao.set("org-1", { ...COLUNAS_ACME, waha_api_key_encrypted: "\\xbbbb" });
    expect(await wahaDaOrganizacaoParaRota("org-1")).toEqual({ ok: false, motivo: "cadastro_quebrado", code: "chave_ilegivel" });
  });
});

describe("wahaDaOrganizacaoParaRota — o cadastro DA EMPRESA vem antes do canal", () => {
  it("⭐ com cadastro da empresa e sem nenhum canal ainda: o número novo herda o cadastro", async () => {
    banco.settings.set("org-9", { waha: { base_url: "http://waha-acme:3000", api_key_encrypted: "\\xaaaa" } });
    const r = await wahaDaOrganizacaoParaRota("org-9");
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) {
      expect(r.valor.endereco).toEqual({ baseUrl: "http://waha-acme:3000", apiKey: "chave-da-acme", origem: "canal" });
      expect(r.valor.colunas).toEqual({ waha_base_url: "http://waha-acme:3000", waha_api_key_encrypted: "\\xaaaa" });
    }
  });

  it("o cadastro da empresa vence o endereço de um canal antigo", async () => {
    banco.settings.set("org-9", { waha: { base_url: "http://waha-novo:3000", api_key_encrypted: "\\xaaaa" } });
    banco.porOrganizacao.set("org-9", { waha_base_url: "http://waha-velho:3000", waha_api_key_encrypted: "\\xaaaa" });
    const r = await wahaDaOrganizacaoParaRota("org-9");
    expect(r.ok && r.valor.endereco.baseUrl).toBe("http://waha-novo:3000");
  });

  it("sem cadastro da empresa, cai no canal que já tinha endereço (quem conectou antes do cadastro)", async () => {
    banco.porOrganizacao.set("org-9", COLUNAS_ACME);
    const r = await wahaDaOrganizacaoParaRota("org-9");
    expect(r.ok && r.valor.endereco.baseUrl).toBe("http://waha-acme:3000");
  });

  it("⭐ cadastro da empresa quebrado (sem chave): cadastro_quebrado — não cai no canal nem no global", async () => {
    vi.stubEnv("WAHA_API_BASE_URL", "http://waha-global:3000");
    vi.stubEnv("WAHA_API_KEY", "chave-global");
    banco.settings.set("org-9", { waha: { base_url: "http://waha-acme:3000" } });
    banco.porOrganizacao.set("org-9", COLUNAS_ACME);
    expect(await wahaDaOrganizacaoParaRota("org-9")).toEqual({ ok: false, motivo: "cadastro_quebrado", code: "canal_sem_chave" });
  });
});
