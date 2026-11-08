import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/aparelhos/leitura", () => ({ lerArquivoDeAparelhos: vi.fn() }));

import { ARQUIVO_EXEMPLO } from "@/lib/aparelhos/arquivo-exemplo";
import { cacheDeAparelhos } from "@/lib/aparelhos/cache";
import { lerArquivoDeAparelhos } from "@/lib/aparelhos/leitura";
import { validarArquivo } from "@/lib/aparelhos/schema";
import type { ArquivoDeAparelhos } from "@/lib/aparelhos/schema";
import type { McpContext } from "@/lib/mcp/types";

import { AVISO_APARELHOS, consultarAparelhos, crmSearchAparelhos, motivoDoVazioAparelhos } from "./aparelhos";

const URL_A = "https://catalogo.example.com/aparelhos.json";
const AGORA = new Date("2026-11-08T12:00:00-03:00");

function arquivoValidado(bruto: unknown = ARQUIVO_EXEMPLO): ArquivoDeAparelhos {
  const r = validarArquivo(JSON.parse(JSON.stringify(bruto)), AGORA);
  if (!r.ok) throw new Error(`fixture inválida: ${r.detalhe}`);
  return r.arquivo;
}

const leituraOk = (arquivo = arquivoValidado()) => ({
  ok: true as const,
  arquivo,
  geradoEm: new Date(arquivo.geradoEm),
});

/** supabase falso: organizations.settings por id, registrando em quem o filtro foi aplicado. */
function ctxFake(organizationId: string, settingsPorOrg: Record<string, unknown>) {
  const filtros: Array<[string, unknown]> = [];
  const chain = {
    select: () => chain,
    eq: (coluna: string, valor: unknown) => {
      filtros.push([coluna, valor]);
      return chain;
    },
    maybeSingle: async () => {
      const id = filtros.at(-1)?.[1] as string;
      return { data: id in settingsPorOrg ? { settings: settingsPorOrg[id] } : null, error: null };
    },
  };
  const ctx = {
    organizationId,
    role: "agent",
    actor: { type: "ai_agent", id: "agent-1" },
    apiTokenId: "tok-1",
    requestId: "req-1",
    supabase: { from: (_t: string) => chain },
  } as unknown as McpContext;
  return { ctx, filtros };
}

const HOSTS_A = ["catalogo.example.com"];
const CONFIG_OK = { aparelhos: { url: URL_A, hosts: HOSTS_A } };

beforeEach(() => {
  cacheDeAparelhos.limpar();
  vi.mocked(lerArquivoDeAparelhos).mockReset();
  vi.mocked(lerArquivoDeAparelhos).mockResolvedValue(leituraOk());
});

describe("retorno (a): achou", () => {
  it("T-RET-01 volta o aparelho com TODAS as variantes, na ordem do arquivo", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const r = await consultarAparelhos({ busca: "redmi note 15" }, ctx, AGORA);
    const itens = r.itens as Array<{ id: string; variantes: unknown[] }>;
    expect(itens.map((i) => i.id)).toEqual(["redmi-note-15"]);
    const original = ARQUIVO_EXEMPLO.aparelhos.find((a) => a.id === "redmi-note-15")!;
    expect(itens[0]!.variantes).toHaveLength(original.variantes.length);
    expect(itens[0]!.variantes).toEqual(JSON.parse(JSON.stringify(original.variantes)));
  });

  it("T-RET-02 preço e parcelas saem IDÊNTICOS ao arquivo, byte a byte, para todos os aparelhos", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    for (const original of ARQUIVO_EXEMPLO.aparelhos) {
      const r = await consultarAparelhos({ busca: original.nome, condicao: original.condicao }, ctx, AGORA);
      const itens = r.itens as unknown[];
      expect(itens, original.id).toHaveLength(1);
      expect(JSON.stringify(itens[0])).toBe(JSON.stringify(original));
      for (const v of original.variantes) {
        expect(JSON.stringify(itens[0])).toContain(JSON.stringify(v.preco));
      }
    }
    // textos reais do arquivo publicado
    const r = await consultarAparelhos({ busca: "redmi note 15" }, ctx, AGORA);
    const texto = JSON.stringify(r);
    expect(texto).toContain('"avista":"R$ 1.429"');
    expect(texto).toContain('"parcelas":"até 18x no boleto"');
  });

  it("T-RET-02b preço de formato inesperado passa sem tratamento", async () => {
    const arq = JSON.parse(JSON.stringify(ARQUIVO_EXEMPLO));
    arq.aparelhos[0].variantes[0].preco = { avista: "R$ 1429,90", parcelas: "12x de R$ 119,99 sem juros" };
    vi.mocked(lerArquivoDeAparelhos).mockResolvedValue(leituraOk(arquivoValidado(arq)));
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const r = await consultarAparelhos({ busca: "redmi note 15" }, ctx, AGORA);
    expect(JSON.stringify(r)).toContain('"avista":"R$ 1429,90"');
    expect(JSON.stringify(r)).toContain('"parcelas":"12x de R$ 119,99 sem juros"');
  });

  it("T-RET-05/06 sempre mostra gerado_em (verbatim) e leva o aviso fixo", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const r = await consultarAparelhos({ busca: "iphone 17e" }, ctx, AGORA);
    expect(r.gerado_em).toBe("2026-11-07T19:25:17-03:00");
    expect(r.aviso).toBe(AVISO_APARELHOS);
    expect(r.nota_do_arquivo).toBe("Aparelho que não está nesta lista não está disponível no site.");
  });

  it("o mesmo modelo em duas condições volta com as duas (e não é empate)", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const r = await consultarAparelhos({ busca: "iphone 16" }, ctx, AGORA);
    const itens = r.itens as Array<{ id: string; condicao: string }>;
    expect(itens.map((i) => [i.id, i.condicao])).toEqual([
      ["iphone-16-lacrado", "novo"],
      ["iphone-16-seminovo", "seminovo"],
    ]);
    expect(r.empate).toBeUndefined();
  });

  it("aproximado vem marcado", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const r = await consultarAparelhos({ busca: "ipone 17e" }, ctx, AGORA);
    expect(r.aproximado).toBe(true);
    expect((r.itens as unknown[]).length).toBe(1);
  });

  it("T-LIM-02 corte por bytes é por aparelho: nunca corta variante", async () => {
    const base = ARQUIVO_EXEMPLO.aparelhos[0]!;
    const variantes = Array.from({ length: 50 }, (_, i) => ({
      ...base.variantes[0]!,
      nome: `Variante ${i}`,
      observacao: "x".repeat(400),
    }));
    const aparelhos = Array.from({ length: 5 }, (_, i) => ({
      ...base,
      id: `galaxy-${i}`,
      nome: `Galaxy Teste ${i + 1}`,
      variantes,
    }));
    const arq = { ...ARQUIVO_EXEMPLO, totalAparelhos: 5, totalVariantes: 250, aparelhos };
    vi.mocked(lerArquivoDeAparelhos).mockResolvedValue(leituraOk(arquivoValidado(arq)));
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const r = await consultarAparelhos({ busca: "galaxy" }, ctx, AGORA);
    const itens = r.itens as Array<{ variantes: unknown[] }>;
    expect(r.truncado).toBe(true);
    expect(itens.length).toBeLessThan(5);
    expect(itens.length).toBeGreaterThanOrEqual(1);
    for (const i of itens) expect(i.variantes).toHaveLength(50);
    expect((r.outros_modelos as string[]).length).toBeGreaterThan(0);
  });
});

describe("retorno (b): não listado", () => {
  it("T-RET-03 arquivo lido e modelo ausente: itens vazios, motivo nao_listado, sem chave erro", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const r = await consultarAparelhos({ busca: "iphone 99 pro" }, ctx, AGORA);
    expect(r.itens).toEqual([]);
    expect(r.motivo).toBe("nao_listado");
    expect("erro" in r).toBe(false);
    expect(r.gerado_em).toBe("2026-11-07T19:25:17-03:00");
    expect(r.total_aparelhos_no_arquivo).toBe(4);
    expect(r.aviso).toBe(AVISO_APARELHOS);
  });

  it("redmi note 14 não existe: nao_listado (nunca devolve o Note 15)", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const r = await consultarAparelhos({ busca: "redmi note 14" }, ctx, AGORA);
    expect(r.motivo).toBe("nao_listado");
    expect(r.itens).toEqual([]);
  });

  it("filtro com valor inexistente lista os valores do arquivo", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const r = await consultarAparelhos({ busca: "iphone 16", condicao: "lacrado" }, ctx, AGORA);
    expect(r.motivo).toBe("nao_listado");
    expect(r.condicoes_disponiveis).toEqual(["novo", "seminovo"]);
  });

  it("busca sem nome de modelo NÃO é 'em falta': motivo busca_vazia", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const r = await consultarAparelhos({ busca: "quero um celular" }, ctx, AGORA);
    expect(r.itens).toEqual([]);
    expect(r.motivo).toBe("busca_vazia");
    expect(r.motivo).not.toBe("nao_listado");
    expect(r.gerado_em).toBe("2026-11-07T19:25:17-03:00");
  });
});

describe("retorno (c): erro", () => {
  it("T-RET-04 erro nunca traz itens nem motivo", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const casos: Array<[Awaited<ReturnType<typeof lerArquivoDeAparelhos>>, string, string]> = [
      [{ ok: false, erro: "falha_na_leitura", detalhe: "timeout" }, "falha_na_leitura", "timeout"],
      [{ ok: false, erro: "arquivo_invalido", detalhe: "schema_invalido" }, "arquivo_invalido", "schema_invalido"],
    ];
    for (const [leitura, esperado, detalhe] of casos) {
      cacheDeAparelhos.limpar();
      vi.mocked(lerArquivoDeAparelhos).mockResolvedValue(leitura);
      const r = await consultarAparelhos({ busca: "iphone 16" }, ctx, AGORA);
      expect(r.erro).toBe(esperado);
      expect(r.detalhe).toBe(detalhe);
      expect("itens" in r).toBe(false);
      expect("motivo" in r).toBe(false);
      expect(String(r.mensagem)).toContain("chame um atendente");
    }
  });

  it("T-VAL-05 desatualizado: 31 dias ⇒ erro sem itens, com gerado_em e idade; 29 dias ⇒ passa", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const trintaEUm = new Date(new Date("2026-11-07T19:25:17-03:00").getTime() + 31 * 86_400_000);
    const velho = await consultarAparelhos({ busca: "iphone 16" }, ctx, trintaEUm);
    expect(velho.erro).toBe("desatualizado");
    expect(velho.gerado_em).toBe("2026-11-07T19:25:17-03:00");
    expect(velho.idade_dias).toBe(31);
    expect("itens" in velho).toBe(false);
    expect(JSON.stringify(velho)).not.toContain("R$");

    const vinteENove = new Date(new Date("2026-11-07T19:25:17-03:00").getTime() + 29 * 86_400_000);
    const novo = await consultarAparelhos({ busca: "iphone 16" }, ctx, vinteENove);
    expect(novo.erro).toBeUndefined();
    expect((novo.itens as unknown[]).length).toBeGreaterThan(0);
  });

  it("T-RET-08 nenhum retorno carrega a URL configurada", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const ok = JSON.stringify(await consultarAparelhos({ busca: "iphone 16" }, ctx, AGORA));
    vi.mocked(lerArquivoDeAparelhos).mockResolvedValue({ ok: false, erro: "falha_na_leitura", detalhe: "http_500" });
    cacheDeAparelhos.limpar();
    const ruim = JSON.stringify(await consultarAparelhos({ busca: "iphone 16" }, ctx, AGORA));
    for (const t of [ok, ruim]) {
      expect(t).not.toContain("example.com");
      expect(t).not.toContain("https://");
    }
  });
});

describe("T-RET-07 motivoDoVazio (vazio não é sucesso no audit)", () => {
  it("nao_listado, busca_vazia e erro são vazios com código; achou não é", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    expect(motivoDoVazioAparelhos(await consultarAparelhos({ busca: "iphone 99" }, ctx, AGORA))).toBe("nao_listado");
    expect(motivoDoVazioAparelhos(await consultarAparelhos({ busca: "celular" }, ctx, AGORA))).toBe("busca_vazia");
    expect(motivoDoVazioAparelhos(await consultarAparelhos({ busca: "iphone 16" }, ctx, AGORA))).toBeNull();
    expect(motivoDoVazioAparelhos({ erro: "falha_na_leitura", detalhe: "timeout" })).toBe("falha_na_leitura");
    expect(motivoDoVazioAparelhos(null)).toBeNull();
    expect(crmSearchAparelhos.motivoDoVazio).toBe(motivoDoVazioAparelhos);
  });
});

describe("isolamento entre organizações e argumentos do modelo", () => {
  it("T-ISO-01 organização sem URL: nao_configurado e nenhuma leitura de rede", async () => {
    const { ctx } = ctxFake("org-sem", { "org-sem": { routing: {} } });
    const r = await consultarAparelhos({ busca: "iphone 16" }, ctx, AGORA);
    expect(r.erro).toBe("nao_configurado");
    expect(r.detalhe).toBe("sem_url");
    expect("itens" in r).toBe(false);
    expect(lerArquivoDeAparelhos).not.toHaveBeenCalled();

    const { ctx: ctx2 } = ctxFake("org-nula", {});
    expect((await consultarAparelhos({ busca: "iphone 16" }, ctx2, AGORA)).erro).toBe("nao_configurado");
  });

  it("T-ISO-02 a organização vem do contexto: o filtro usa ctx.organizationId, ignorando organization_id do input", async () => {
    const { ctx, filtros } = ctxFake("org-1", { "org-1": CONFIG_OK, "org-2": { aparelhos: { url: "https://evil.example/x.json", hosts: ["evil.example"] } } });
    const entradaMaliciosa = { busca: "iphone 16", organization_id: "org-2", organizationId: "org-2" } as never;
    const r = await crmSearchAparelhos.handler(entradaMaliciosa, ctx);
    expect(filtros).toEqual([["id", "org-1"]]);
    expect((r as { itens: unknown[] }).itens.length).toBeGreaterThan(0);
    expect(lerArquivoDeAparelhos).toHaveBeenCalledTimes(1);
    expect(lerArquivoDeAparelhos).toHaveBeenCalledWith(URL_A, HOSTS_A);
  });

  it("T-ISO-03 duas organizações com a mesma URL leem (e guardam) separado; com URLs diferentes, cada uma a sua", async () => {
    const settings = {
      "org-a": CONFIG_OK,
      "org-b": CONFIG_OK,
    };
    const a = ctxFake("org-a", settings).ctx;
    const b = ctxFake("org-b", settings).ctx;
    await consultarAparelhos({ busca: "iphone 16" }, a, AGORA);
    await consultarAparelhos({ busca: "iphone 16" }, b, AGORA);
    await consultarAparelhos({ busca: "iphone 16" }, a, AGORA); // hit de a
    expect(lerArquivoDeAparelhos).toHaveBeenCalledTimes(2);

    // cada organização enxerga o SEU arquivo
    cacheDeAparelhos.limpar();
    vi.mocked(lerArquivoDeAparelhos).mockReset();
    const so17e = { ...ARQUIVO_EXEMPLO, totalAparelhos: 1, totalVariantes: ARQUIVO_EXEMPLO.aparelhos[3]!.variantes.length, aparelhos: [ARQUIVO_EXEMPLO.aparelhos[3]!] };
    vi.mocked(lerArquivoDeAparelhos).mockImplementation(async (url: string, _hosts: readonly string[]) =>
      url === URL_A ? leituraOk() : leituraOk(arquivoValidado(so17e)),
    );
    const outraUrl = "https://catalogo.example.com/aparelhos.json?loja=2";
    const lojaA = ctxFake("org-a", { "org-a": CONFIG_OK }).ctx;
    const lojaB = ctxFake("org-b", { "org-b": { aparelhos: { url: outraUrl, hosts: HOSTS_A } } }).ctx;
    const ra = await consultarAparelhos({ busca: "iphone 16" }, lojaA, AGORA);
    const rb = await consultarAparelhos({ busca: "iphone 16" }, lojaB, AGORA);
    expect((ra.itens as unknown[]).length).toBe(2);
    expect(rb.motivo).toBe("nao_listado"); // a loja B só tem o 17e
  });

  it("T-ARGS-02 argumento de URL vindo do modelo é ignorado: a leitura usa só a URL da configuração", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": CONFIG_OK });
    const entrada = { busca: "iphone 16", url: "https://evil.example/x.json", host: "evil.example", endpoint: "http://169.254.169.254/" } as never;
    await crmSearchAparelhos.handler(entrada, ctx);
    expect(lerArquivoDeAparelhos).toHaveBeenCalledTimes(1);
    expect(lerArquivoDeAparelhos).toHaveBeenCalledWith(URL_A, HOSTS_A);
    expect(JSON.stringify(vi.mocked(lerArquivoDeAparelhos).mock.calls)).not.toContain("evil");
  });

  it("T-ARGS-01 o schema da ferramenta só declara busca, categoria e condicao; chave desconhecida some", () => {
    expect(Object.keys(crmSearchAparelhos.inputSchema).sort()).toEqual(["busca", "categoria", "condicao"]);
    const lido = z.object(crmSearchAparelhos.inputSchema).parse({ busca: "iphone", url: "https://evil.example" });
    expect(lido).toEqual({ busca: "iphone" });
    expect(z.object(crmSearchAparelhos.inputSchema).safeParse({ busca: "" }).success).toBe(false);
    expect(z.object(crmSearchAparelhos.inputSchema).safeParse({ busca: "x".repeat(121) }).success).toBe(false);
  });

  it("T-HOST-01 sem hosts, hosts vazio, hosts inválido ou host da URL fora da lista: nao_configurado, SEM rede", async () => {
    const casos: Array<[string, unknown]> = [
      ["sem a chave hosts", { aparelhos: { url: URL_A } }],
      ["hosts vazio", { aparelhos: { url: URL_A, hosts: [] } }],
      ["hosts que não é lista", { aparelhos: { url: URL_A, hosts: "catalogo.example.com" } }],
      ["host com esquema", { aparelhos: { url: URL_A, hosts: ["https://catalogo.example.com"] } }],
      ["host com porta", { aparelhos: { url: URL_A, hosts: ["catalogo.example.com:443"] } }],
      ["host com caminho", { aparelhos: { url: URL_A, hosts: ["catalogo.example.com/aparelhos.json"] } }],
      ["host em maiúsculas", { aparelhos: { url: URL_A, hosts: ["Catalogo.Example.com"] } }],
      ["host da URL fora da lista", { aparelhos: { url: URL_A, hosts: ["outro.example.com"] } }],
      ["lista com host parecido", { aparelhos: { url: URL_A, hosts: ["example.com", "catalogo.example.com.evil.io"] } }],
      ["url sem hosts nem nada", { aparelhos: { url: "https://evil.example/aparelhos.json" } }],
    ];
    for (const [nome, settings] of casos) {
      vi.mocked(lerArquivoDeAparelhos).mockClear();
      const { ctx } = ctxFake("org-1", { "org-1": settings });
      const r = await consultarAparelhos({ busca: "iphone 16" }, ctx, AGORA);
      expect(r.erro, nome).toBe("nao_configurado");
      expect("itens" in r, nome).toBe(false);
      expect("motivo" in r, nome).toBe(false);
    }
    expect(lerArquivoDeAparelhos).not.toHaveBeenCalled();
  });

  it("T-HOST-02 a lista de hosts NÃO pode vir do modelo: hosts/url no argumento não mudam a leitura nem destravam o bloqueio", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": { aparelhos: { url: URL_A, hosts: ["outro.example.com"] } } });
    const entrada = { busca: "iphone 16", hosts: ["catalogo.example.com"], url: URL_A } as never;
    const r = (await crmSearchAparelhos.handler(entrada, ctx)) as Record<string, unknown>;
    expect(r.erro).toBe("nao_configurado");
    expect(lerArquivoDeAparelhos).not.toHaveBeenCalled();
    expect(Object.keys(crmSearchAparelhos.inputSchema)).not.toContain("hosts");
  });

  it("T-HOST-03 com a lista da organização e o host dentro dela, lê normalmente e repassa url + hosts", async () => {
    const { ctx } = ctxFake("org-1", { "org-1": { aparelhos: { url: URL_A, hosts: ["x.example.com", "catalogo.example.com"] } } });
    const r = await consultarAparelhos({ busca: "iphone 16" }, ctx, AGORA);
    expect(r.erro).toBeUndefined();
    expect(lerArquivoDeAparelhos).toHaveBeenCalledWith(URL_A, ["x.example.com", "catalogo.example.com"]);
  });

  it("cada organização usa a PRÓPRIA lista: o host liberado numa não vale na outra", async () => {
    const a = ctxFake("org-a", { "org-a": CONFIG_OK }).ctx;
    const b = ctxFake("org-b", { "org-b": { aparelhos: { url: URL_A, hosts: ["so-da-b.example.com"] } } }).ctx;
    expect((await consultarAparelhos({ busca: "iphone 16" }, a, AGORA)).erro).toBeUndefined();
    expect((await consultarAparelhos({ busca: "iphone 16" }, b, AGORA)).erro).toBe("nao_configurado");
  });

  it("falha ao ler a configuração: erro, não 'em falta'", async () => {
    const ctx = {
      organizationId: "org-1",
      supabase: { from: () => { throw new Error("db fora"); } },
    } as unknown as McpContext;
    const r = await consultarAparelhos({ busca: "iphone 16" }, ctx, AGORA);
    expect(r.erro).toBe("falha_na_leitura");
    expect("motivo" in r).toBe(false);
  });
});

describe("definição da ferramenta", () => {
  it("é leitura, nível de agente, e a descrição manda tratar erro como 'não sei'", () => {
    expect(crmSearchAparelhos.name).toBe("crm_search_aparelhos");
    expect(crmSearchAparelhos.category).toBe("read");
    expect(crmSearchAparelhos.requiresRole).toBe("agent");
    expect(crmSearchAparelhos.requiresScope).toBe("mcp:read");
    expect(crmSearchAparelhos.description).toContain("EXATAMENTE");
    expect(crmSearchAparelhos.description).toContain("atendente");
  });
});
