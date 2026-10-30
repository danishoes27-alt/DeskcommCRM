import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { WAHA_API_BASE_URL: "", WAHA_API_KEY: "", WAHA_WEBHOOK_BASE_URL: "https://crm.exemplo.com.br" },
}));

import { limparCacheDoWaha } from "./waha-endpoint";
import {
  CadastroDoTransporteError,
  IMAGEM_DO_SERVICO_PARA_EMPRESAS,
  cadastrarTransporteDaEmpresa,
  gerarChaveDeApi,
  kitDoContainer,
  lerEstadoDoTransporteDaEmpresa,
  reaplicarWebhookDosCanais,
  testarConexaoComTransporte,
  testarConexaoDaEmpresa,
} from "./transporte-operador";

/**
 * A lógica da tela do operador (cadastrar o servidor de WhatsApp de uma empresa): sem HTTP, com um
 * Supabase de mentira que registra o que foi lido e escrito.
 */
const ORG = "20000000-0000-4000-8000-000000000001";
const CHAVE_EM_CLARO = "chave-do-waha-da-acme-so-de-teste";

interface Atualizacao {
  tabela: string;
  patch: Record<string, unknown>;
  filtros: Record<string, unknown>;
}

function criarAdmin(estado: {
  organizacao?: { settings: Record<string, unknown> } | null;
  canais?: Array<Record<string, unknown>>;
  cifraIndisponivel?: boolean;
  /** Toda leitura devolve erro do banco. */
  erroDeLeitura?: boolean;
  /** O que `fn_decrypt_oauth` devolve por cifra. */
  chaves?: Record<string, string | null>;
}) {
  const atualizacoes: Atualizacao[] = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const organizacao = estado.organizacao === undefined ? { settings: {} } : estado.organizacao;
  const canais = estado.canais ?? [];

  const from = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    const linhas = () => (tabela === "organizations" ? (organizacao ? [organizacao] : []) : canais.filter((c) => c.organization_id === ORG || filtros.organization_id === undefined));
    const resolver = () => {
      if (patch) {
        atualizacoes.push({ tabela, patch, filtros: { ...filtros } });
        const alvo = tabela === "organizations" ? [organizacao] : canais;
        return { data: patch ? alvo.map((l) => ({ id: (l as Record<string, unknown>).id ?? "org" })) : null, error: null };
      }
      return estado.erroDeLeitura ? { data: null, error: { message: "boom" } } : { data: linhas(), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => ((filtros[c] = v), q),
      is: () => q,
      not: (c: string, op: string, v: unknown) => ((filtros[`nao:${c}`] = `${op}:${String(v)}`), q),
      order: () => q,
      limit: () => q,
      update: (p: Record<string, unknown>) => ((patch = p), q),
      maybeSingle: async () => (estado.erroDeLeitura ? { data: null, error: { message: "boom" } } : { data: linhas()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => void) => ok(resolver()),
    };
    return q;
  };
  const rpc = async (nome: string, args: Record<string, unknown>) => {
    rpcs.push({ nome, args });
    if (nome === "fn_encrypt_oauth") {
      return estado.cifraIndisponivel ? { data: null, error: { message: "x" } } : { data: `\\xcifrado-de-${String(args.plaintext).length}`, error: null };
    }
    const chave = estado.chaves?.[String(args.ciphertext)] ?? null;
    return chave === null ? { data: null, error: { message: "x" } } : { data: chave, error: null };
  };
  return { admin: { from, rpc } as unknown as SupabaseClient, atualizacoes, rpcs };
}

beforeEach(() => limparCacheDoWaha());
afterEach(() => vi.restoreAllMocks());

describe("testarConexaoComTransporte", () => {
  it("responde: devolve versão e motor, sem a chave", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ version: "2026.7.2", engine: "NOWEB", tier: "CORE" }), { status: 200 }));
    const r = await testarConexaoComTransporte({ baseUrl: "http://waha-a:3000", apiKey: CHAVE_EM_CLARO });
    expect(r).toEqual({ ok: true, versao: "2026.7.2", motor: "NOWEB" });
    expect(JSON.stringify(r)).not.toContain(CHAVE_EM_CLARO);
  });

  it("chave recusada (401): diz que a chave foi recusada", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const r = await testarConexaoComTransporte({ baseUrl: "http://waha-a:3000", apiKey: "errada" });
    expect(r).toMatchObject({ ok: false, motivo: expect.stringContaining("chave") });
  });

  it("endereço que responde mas não é um WAHA (404): motivo próprio", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nada", { status: 404 }));
    const r = await testarConexaoComTransporte({ baseUrl: "http://qualquer:3000", apiKey: "k" });
    expect(r).toMatchObject({ ok: false, motivo: expect.stringContaining("não parece") });
  });

  it("servidor inalcançável: o motivo vem explicado, sem repetir endereço nem chave", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch failed"));
    const r = await testarConexaoComTransporte({ baseUrl: "http://waha-sumiu:3000", apiKey: CHAVE_EM_CLARO });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(CHAVE_EM_CLARO);
  });
});

describe("testarConexaoDaEmpresa", () => {
  it("endereço inválido: recusa com o código, sem tocar na rede", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const { admin } = criarAdmin({});
    const r = await testarConexaoDaEmpresa(admin, { organizationId: ORG, baseUrl: "ftp://x", apiKey: "k" });
    expect(r).toMatchObject({ ok: false, codigo: "endereco_invalido" });
    expect(f).not.toHaveBeenCalled();
  });

  it("sem chave digitada e sem cadastro: pede a chave", async () => {
    const { admin } = criarAdmin({});
    expect(await testarConexaoDaEmpresa(admin, { organizationId: ORG, baseUrl: "http://waha-a:3000" })).toMatchObject({ ok: false, codigo: "chave_obrigatoria" });
  });

  it("⭐ sem chave digitada, usa a cadastrada (decifrada no servidor) e a manda ao WAHA", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ version: "x", engine: "NOWEB" }), { status: 200 }));
    const { admin } = criarAdmin({
      organizacao: { settings: { waha: { base_url: "http://waha-a:3000", api_key_encrypted: "\\xaaaa" } } },
      chaves: { "\\xaaaa": CHAVE_EM_CLARO },
    });
    const r = await testarConexaoDaEmpresa(admin, { organizationId: ORG, baseUrl: "http://waha-a:3000" });
    expect(r).toMatchObject({ ok: true });
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>)["X-Api-Key"]).toBe(CHAVE_EM_CLARO);
    expect(JSON.stringify(r)).not.toContain(CHAVE_EM_CLARO);
  });

  it("⭐ a chave cadastrada NUNCA é mandada a um endereço diferente do cadastrado (sem a chave digitada, nem chama)", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const { admin } = criarAdmin({
      organizacao: { settings: { waha: { base_url: "http://waha-a:3000", api_key_encrypted: "\\xaaaa" } } },
      chaves: { "\\xaaaa": CHAVE_EM_CLARO },
    });

    const r = await testarConexaoDaEmpresa(admin, { organizationId: ORG, baseUrl: "https://atacante.exemplo" });

    expect(r).toMatchObject({ ok: false, codigo: "chave_obrigatoria" });
    expect(f, "a chave cadastrada foi usada contra outro endereço").not.toHaveBeenCalled();
  });

  it("com a chave DIGITADA, qualquer endereço válido pode ser testado (é a chave de quem está digitando)", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ version: "x", engine: "NOWEB" }), { status: 200 }));
    const { admin } = criarAdmin({
      organizacao: { settings: { waha: { base_url: "http://waha-a:3000", api_key_encrypted: "\\xaaaa" } } },
      chaves: { "\\xaaaa": CHAVE_EM_CLARO },
    });

    const r = await testarConexaoDaEmpresa(admin, { organizationId: ORG, baseUrl: "http://waha-novo:3000", apiKey: "chave-digitada" });

    expect(r).toMatchObject({ ok: true });
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>)["X-Api-Key"]).toBe("chave-digitada");
  });
});

describe("cadastrarTransporteDaEmpresa", () => {
  it("⭐ grava o endereço normalizado e a chave CIFRADA em organizations.settings.waha, sem apagar o resto das configurações", async () => {
    const { admin, atualizacoes, rpcs } = criarAdmin({ organizacao: { settings: { jev: { ligado: true }, outra: 1 } } });
    const r = await cadastrarTransporteDaEmpresa(admin, { organizationId: ORG, baseUrl: " http://waha-acme:3000/ ", apiKey: CHAVE_EM_CLARO, atualizarCanais: false });

    expect(r.canaisAtualizados).toBe(0);
    expect(rpcs[0]).toMatchObject({ nome: "fn_encrypt_oauth", args: { plaintext: CHAVE_EM_CLARO } });
    const escrita = atualizacoes.find((a) => a.tabela === "organizations")!;
    const settings = escrita.patch.settings as Record<string, unknown>;
    expect(settings).toMatchObject({ jev: { ligado: true }, outra: 1, waha: { base_url: "http://waha-acme:3000", api_key_encrypted: expect.stringContaining("cifrado") } });
    // a chave em claro NUNCA vai para o banco
    expect(JSON.stringify(atualizacoes)).not.toContain(CHAVE_EM_CLARO);
    expect(escrita.filtros).toEqual({ id: ORG });
  });

  it("primeira vez sem chave: recusa (chave_obrigatoria)", async () => {
    const { admin, atualizacoes } = criarAdmin({});
    await expect(cadastrarTransporteDaEmpresa(admin, { organizationId: ORG, baseUrl: "http://waha-a:3000", atualizarCanais: false })).rejects.toMatchObject({ code: "chave_obrigatoria" });
    expect(atualizacoes).toEqual([]);
  });

  it("troca só o endereço: MANTÉM a chave cifrada já cadastrada (sem pedir a chave de novo)", async () => {
    const { admin, atualizacoes, rpcs } = criarAdmin({ organizacao: { settings: { waha: { base_url: "http://velho:3000", api_key_encrypted: "\\xmantida" } } } });
    await cadastrarTransporteDaEmpresa(admin, { organizationId: ORG, baseUrl: "http://novo:3000", atualizarCanais: false });
    expect(rpcs).toEqual([]);
    expect((atualizacoes[0]!.patch.settings as { waha: Record<string, unknown> }).waha).toMatchObject({ base_url: "http://novo:3000", api_key_encrypted: "\\xmantida" });
  });

  it("endereço inválido: recusa sem gravar nada", async () => {
    const { admin, atualizacoes } = criarAdmin({});
    await expect(cadastrarTransporteDaEmpresa(admin, { organizationId: ORG, baseUrl: "http://u:s@x:3000", apiKey: "k", atualizarCanais: false })).rejects.toMatchObject({ code: "endereco_invalido" });
    expect(atualizacoes).toEqual([]);
  });

  it("cifra indisponível (chave mestra ausente): recusa, e nada é gravado em claro", async () => {
    const { admin, atualizacoes } = criarAdmin({ cifraIndisponivel: true });
    await expect(cadastrarTransporteDaEmpresa(admin, { organizationId: ORG, baseUrl: "http://waha-a:3000", apiKey: CHAVE_EM_CLARO, atualizarCanais: false })).rejects.toMatchObject({ code: "cifra_indisponivel" });
    expect(atualizacoes).toEqual([]);
  });

  it("empresa inexistente: recusa", async () => {
    const { admin } = criarAdmin({ organizacao: null });
    await expect(cadastrarTransporteDaEmpresa(admin, { organizationId: ORG, baseUrl: "http://waha-a:3000", apiKey: "k", atualizarCanais: false })).rejects.toBeInstanceOf(CadastroDoTransporteError);
  });

  it("atualizarCanais: repassa o mesmo cadastro às colunas dos canais ativos da empresa e conta quantos", async () => {
    const { admin, atualizacoes } = criarAdmin({ canais: [{ id: "c1", organization_id: ORG }, { id: "c2", organization_id: ORG }] });
    const r = await cadastrarTransporteDaEmpresa(admin, { organizationId: ORG, baseUrl: "http://waha-acme:3000", apiKey: CHAVE_EM_CLARO, atualizarCanais: true });

    expect(r.canaisAtualizados).toBe(2);
    const doCanal = atualizacoes.find((a) => a.tabela === "channel_sessions")!;
    expect(doCanal.patch).toEqual({ waha_base_url: "http://waha-acme:3000", waha_api_key_encrypted: expect.stringContaining("cifrado") });
    expect(doCanal.filtros).toMatchObject({ organization_id: ORG, provider: "waha" });
    expect(JSON.stringify(atualizacoes)).not.toContain(CHAVE_EM_CLARO);
  });

  it("⭐ o repasse só alcança canais que JÁ têm servidor próprio — nunca os do modo compartilhado", async () => {
    const { admin, atualizacoes } = criarAdmin({ canais: [{ id: "c1", organization_id: ORG }] });
    await cadastrarTransporteDaEmpresa(admin, { organizationId: ORG, baseUrl: "http://waha-acme:3000", apiKey: CHAVE_EM_CLARO, atualizarCanais: true });

    const doCanal = atualizacoes.find((a) => a.tabela === "channel_sessions")!;
    // `.not("waha_base_url", "is", null)`: canal com endereço NULL (compartilhado) fica de fora
    expect(doCanal.filtros["nao:waha_base_url"]).toBe("is:null");
  });

  it("sem atualizarCanais, nenhum canal é tocado", async () => {
    const { admin, atualizacoes } = criarAdmin({ canais: [{ id: "c1", organization_id: ORG }] });
    await cadastrarTransporteDaEmpresa(admin, { organizationId: ORG, baseUrl: "http://waha-acme:3000", apiKey: CHAVE_EM_CLARO, atualizarCanais: false });
    expect(atualizacoes.some((a) => a.tabela === "channel_sessions")).toBe(false);
  });
});

describe("lerEstadoDoTransporteDaEmpresa", () => {
  it("⭐ erro de leitura do banco NÃO vira 'falta cadastrar / nenhum canal' — lança, para a tela não mentir", async () => {
    const { admin } = criarAdmin({ erroDeLeitura: true });
    await expect(lerEstadoDoTransporteDaEmpresa(admin, ORG)).rejects.toThrow("consulta_falhou");
  });

  it("⭐ nunca devolve a chave nem a cifra: só 'tem_chave' e o endereço", async () => {
    const { admin } = criarAdmin({
      organizacao: { settings: { waha: { base_url: "http://waha-acme:3000", api_key_encrypted: "\\xsegredo-cifrado" } } },
      canais: [
        { id: "c1", organization_id: ORG, display_name: "Comercial", phone_number: null, status: "WORKING", waha_base_url: "http://waha-acme:3000" },
        { id: "c2", organization_id: ORG, display_name: null, phone_number: "5531998966398", status: "STOPPED", waha_base_url: null },
      ],
    });
    const estado = await lerEstadoDoTransporteDaEmpresa(admin, ORG, { WAHA_WEBHOOK_BASE_URL: "https://crm.exemplo.com.br" });

    expect(estado).toMatchObject({
      cadastrado: true,
      endereco: "http://waha-acme:3000",
      tem_chave: true,
      webhook_base_configurada: true,
      tem_transporte_global: false,
      canais_com_falha: 1,
    });
    expect(estado.canais).toEqual([
      { id: "c1", nome: "Comercial", status: "WORKING", transporte_proprio: true },
      { id: "c2", nome: "5531998966398", status: "STOPPED", transporte_proprio: false },
    ]);
    expect(JSON.stringify(estado)).not.toContain("segredo-cifrado");
  });

  it("empresa sem cadastro: cadastrado = false, e o estado do ambiente aparece", async () => {
    const { admin } = criarAdmin({});
    const estado = await lerEstadoDoTransporteDaEmpresa(admin, ORG, { WAHA_API_BASE_URL: "http://g:3000", WAHA_API_KEY: "k" });
    expect(estado).toMatchObject({ cadastrado: false, endereco: null, tem_chave: false, webhook_base_configurada: false, tem_transporte_global: true });
  });
});

describe("reaplicarWebhookDosCanais", () => {
  const SEGREDO_DO_CANAL = "s".repeat(48);
  const canal = (extra: Record<string, unknown>) => ({
    id: "c1",
    organization_id: ORG,
    waha_session_name: "org_aaaaaaaa_bbbb",
    webhook_path_token: "d9001000222240008000000000000a01",
    webhook_secret_encrypted: "\\xseg",
    waha_base_url: "http://waha-a:3000",
    waha_api_key_encrypted: "\\xkey",
    ...extra,
  });
  const chaves = { "\\xseg": SEGREDO_DO_CANAL, "\\xkey": CHAVE_EM_CLARO };

  function wahaDeMentira(config: Record<string, unknown>) {
    const chamadas: Array<{ metodo: string; url: string; corpo: unknown }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: unknown, init?: RequestInit) => {
      chamadas.push({ metodo: init?.method ?? "GET", url: String(url), corpo: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ name: "org_aaaaaaaa_bbbb", status: "WORKING", config }), { status: 200 });
    }) as typeof fetch);
    return chamadas;
  }

  it("⭐ põe o webhook do canal (URL com o token + segredo do canal) na sessão do WAHA DELE", async () => {
    const chamadas = wahaDeMentira({ ignore: {}, webhooks: [] });
    const { admin } = criarAdmin({ canais: [canal({})], chaves });
    const r = await reaplicarWebhookDosCanais(admin, { organizationId: ORG, urlBaseDoWebhook: "https://crm.exemplo.com.br" });

    expect(r).toEqual([{ canalId: "c1", resultado: "aplicado" }]);
    const put = chamadas.find((c) => c.metodo === "PUT")!;
    expect(put.url).toBe("http://waha-a:3000/api/sessions/org_aaaaaaaa_bbbb");
    expect(put.corpo).toMatchObject({
      config: { webhooks: [{ url: "https://crm.exemplo.com.br/api/v1/webhooks/waha/d9001000222240008000000000000a01", hmac: { key: SEGREDO_DO_CANAL } }] },
    });
  });

  it("canal do modo compartilhado (sem WAHA próprio) é pulado, sem falar com o WAHA", async () => {
    const chamadas = wahaDeMentira({});
    const { admin } = criarAdmin({ canais: [canal({ waha_base_url: null, waha_api_key_encrypted: null })], chaves });
    expect(await reaplicarWebhookDosCanais(admin, { organizationId: ORG, urlBaseDoWebhook: "https://crm.exemplo.com.br" })).toEqual([
      { canalId: "c1", resultado: "pulado", motivo: "waha_global" },
    ]);
    expect(chamadas).toEqual([]);
  });

  it("segredo do canal ainda é o byte de enfeite: gera um de verdade, grava e usa", async () => {
    const chamadas = wahaDeMentira({ ignore: {} });
    const { admin, atualizacoes } = criarAdmin({ canais: [canal({ webhook_secret_encrypted: "\\x00" })], chaves: { "\\xkey": CHAVE_EM_CLARO } });
    const r = await reaplicarWebhookDosCanais(admin, { organizationId: ORG, urlBaseDoWebhook: "https://crm.exemplo.com.br" });

    expect(r[0]!.resultado).toBe("aplicado");
    expect(atualizacoes.find((a) => "webhook_secret_encrypted" in a.patch)).toBeTruthy();
    const chave = (chamadas.find((c) => c.metodo === "PUT")!.corpo as { config: { webhooks: Array<{ hmac: { key: string } }> } }).config.webhooks[0]!.hmac.key;
    expect(chave).toMatch(/^[0-9a-f]{48}$/);
  });

  it("⭐ uma falha (chave ilegível) não interrompe os outros canais, e o motivo é um código", async () => {
    wahaDeMentira({ ignore: {} });
    const { admin } = criarAdmin({
      canais: [canal({ id: "c1", waha_api_key_encrypted: "\\xruim" }), canal({ id: "c2" })],
      chaves,
    });
    const r = await reaplicarWebhookDosCanais(admin, { organizationId: ORG, urlBaseDoWebhook: "https://crm.exemplo.com.br" });
    expect(r.map((x) => [x.canalId, x.resultado])).toEqual([["c1", "falhou"], ["c2", "aplicado"]]);
    expect(r[0]!.motivo).toBe("chave_ilegivel");
  });
});

describe("gerarChaveDeApi e kitDoContainer", () => {
  it("a chave é aleatória, e o hash é o SHA-512 hexadecimal dela", () => {
    const a = gerarChaveDeApi();
    const b = gerarChaveDeApi();
    expect(a.chave).toMatch(/^[0-9a-f]{48}$/);
    expect(a.chave).not.toBe(b.chave);
    expect(a.hashSha512).toBe(createHash("sha512").update(a.chave, "utf8").digest("hex"));
    expect(a.hashSha512).toMatch(/^[0-9a-f]{128}$/);
  });

  it("o kit traz a imagem, o limite de memória e o aviso de não pôr o webhook global — e nenhum segredo", () => {
    const kit = kitDoContainer({ nomeDoServico: "Acme Calçados!" });
    expect(kit).toContain("Serviço: acme-cal-ados-");
    expect(kit).toContain(IMAGEM_DO_SERVICO_PARA_EMPRESAS);
    expect(kit).toContain("768 MB");
    expect(kit).toContain("NENHUM");
    expect(kit).toContain("sha512:<cole aqui o hash da chave gerada>");
    expect(kit).toContain("NÃO coloque WHATSAPP_HOOK_URL");
    expect(kit).not.toMatch(/[0-9a-f]{40,}/);
  });
});
