/** A triagem do "antes" (T17): perguntas, ordem das opções, `state`, cortes e a chamada (fetch simulado). */
import { beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({ settings: null as Record<string, unknown> | null }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "order", "limit"]) chain[m] = () => chain;
      chain.maybeSingle = async () =>
        tabela === "organizations"
          ? { data: { settings: banco.settings }, error: null }
          : { data: { api_key_encrypted: "c", api_key_iv: "i", api_key_tag: "t" }, error: null };
      return chain;
    },
  }),
}));
vi.mock("@/lib/crypto/aes_gcm", () => ({ byteaToBuffer: (v: unknown) => v, decryptKey: () => "apikey_de_teste" }));
vi.mock("@/lib/logger", () => ({ logger: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined } }));

import { env } from "@/lib/env";

import { CATEGORIAS_PADRAO } from "./categorias";
import type { Resposta } from "./cliente";
import {
  CARACTERES_NO_MAXIMO,
  CORTES_DO_ANTES,
  faixaDoAntes,
  montarEstadoDaTriagem,
  perguntarATriagem,
  perguntasDaTriagem,
  veredictoDasRespostas,
} from "./triagem";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POR = "22222222-2222-4222-8222-222222222222";
const escrevivel = env as unknown as Record<string, unknown>;

const choice = (escolha: string, p: number, confianca: number): Resposta => ({
  tipo: "choice",
  escolha,
  probabilidades: { [escolha]: p },
  confianca,
});
const respostas = (c: [string, number, number], d: [string, number, number], u: number) => ({
  categoria: choice(...c),
  destino: choice(...d),
  urgente: { tipo: "noul", noul: u } as Resposta,
});

beforeEach(() => {
  escrevivel.JEV_TRIAGEM_DO_SISTEMA_ENABLED = true;
  banco.settings = {
    jev: { ligado: true, aceite: { em: "2026-10-01T12:00:00.000Z", por: POR, alcance: "mensagem" }, tarefas: { triagem: { estado: "observando" } } },
  };
});

describe("as perguntas", () => {
  const p = perguntasDaTriagem(CATEGORIAS_PADRAO);
  it("três: categoria e destino (escolha) e urgente (sim/não)", () => {
    expect(Object.keys(p)).toEqual(["categoria", "destino", "urgente"]);
    expect(p.categoria!.tipo).toBe("choice");
    expect(p.destino!.tipo).toBe("choice");
    expect(p.urgente!.tipo).toBe("noul");
  });

  it("a ORDEM das opções é fixa: outro por último na categoria; atender primeiro no destino", () => {
    const cat = Object.keys((p.categoria as { criterios: Record<string, string> }).criterios);
    expect(cat).toEqual(["conserto", "venda", "impressao", "outro"]);
    expect(Object.keys((p.destino as { criterios: Record<string, string> }).criterios)).toEqual(["atender", "pedir_dado", "equipe"]);
  });

  it("usa a lista da empresa", () => {
    const propria = perguntasDaTriagem([
      { id: "troca", rotulo: "Troca", descricao: "trocar tela" },
      { id: "outro", rotulo: "Outro", descricao: "nada" },
    ]);
    expect(Object.keys((propria.categoria as { criterios: Record<string, string> }).criterios)).toEqual(["troca", "outro"]);
  });
});

describe("o state: só o texto digitado, mascarado, até 2.000 caracteres", () => {
  it("é uma string — nenhum objeto com nome, telefone, id ou empresa", () => {
    expect(typeof montarEstadoDaTriagem("oi")).toBe("string");
  });

  it("mascara senha, nome, telefone, CPF e e-mail antes de sair", () => {
    const s = montarEstadoDaTriagem(
      "Sou a Maria Souza, senha 4321, tel (11) 98765-4321, cpf 123.456.789-09, maria@x.com. Tela quebrada.",
      "Maria Souza",
    );
    for (const v of ["Maria", "Souza", "4321", "98765", "123.456", "maria@x.com"]) expect(s).not.toContain(v);
    expect(s).toContain("Tela quebrada");
  });

  it("corta em 2.000 caracteres DEPOIS de mascarar", () => {
    expect(montarEstadoDaTriagem("x".repeat(5000))).toHaveLength(CARACTERES_NO_MAXIMO);
  });
});

describe("os cortes do ANTES (D7)", () => {
  it.each([
    [0.8, 0.7, "alta"],
    [0.79, 0.9, "media"],
    [0.9, 0.69, "media"],
    [0.7, 0.6, "media"],
    [0.69, 0.9, "baixa"],
    [0.95, 0.59, "baixa"],
  ] as const)("p=%s conf=%s → %s", (p, c, faixa) => {
    expect(faixaDoAntes(p, c)).toBe(faixa);
  });

  it("os números são os da spec", () => {
    expect(CORTES_DO_ANTES).toEqual({ piso: { probabilidade: 0.7, confianca: 0.6 }, alta: { probabilidade: 0.8, confianca: 0.7 }, urgente: 0.8 });
  });
});

describe("o veredito", () => {
  it("alta age: o destino vale", () => {
    const v = veredictoDasRespostas(respostas(["conserto", 0.9, 0.9], ["equipe", 0.9, 0.9], 0.1), CATEGORIAS_PADRAO, true)!;
    expect(v.destinoEfetivo).toBe("equipe");
    expect(v.categoria).toMatchObject({ id: "conserto", faixa: "alta" });
  });

  it("média só registra: nenhum destino efetivo", () => {
    const v = veredictoDasRespostas(respostas(["venda", 0.75, 0.65], ["equipe", 0.75, 0.65], 0.1), CATEGORIAS_PADRAO, true)!;
    expect(v.destinoEfetivo).toBeNull();
    expect(v.destino.faixa).toBe("media");
  });

  it("baixa é ignorada", () => {
    const v = veredictoDasRespostas(respostas(["venda", 0.5, 0.5], ["equipe", 0.5, 0.5], 0.1), CATEGORIAS_PADRAO, true)!;
    expect(v.destinoEfetivo).toBeNull();
    expect(v.destino.faixa).toBe("baixa");
  });

  it("pedir_dado só vale na PRIMEIRA mensagem; fora dela é ignorado (e dito)", () => {
    const r = respostas(["conserto", 0.9, 0.9], ["pedir_dado", 0.9, 0.9], 0.1);
    expect(veredictoDasRespostas(r, CATEGORIAS_PADRAO, true)!.destinoEfetivo).toBe("pedir_dado");
    const fora = veredictoDasRespostas(r, CATEGORIAS_PADRAO, false)!;
    expect(fora.destinoEfetivo).toBeNull();
    expect(fora.pedirDadoIgnorado).toBe(true);
  });

  it("equipe e atender valem em qualquer mensagem", () => {
    for (const d of ["equipe", "atender"]) {
      expect(veredictoDasRespostas(respostas(["venda", 0.9, 0.9], [d, 0.9, 0.9], 0.1), CATEGORIAS_PADRAO, false)!.destinoEfetivo).toBe(d);
    }
  });

  it("urgente marca a partir de 0,80 e NÃO muda o destino", () => {
    const v = veredictoDasRespostas(respostas(["venda", 0.9, 0.9], ["atender", 0.9, 0.9], 0.8), CATEGORIAS_PADRAO, true)!;
    expect(v.urgente).toEqual({ probabilidade: 0.8, marcar: true });
    expect(v.destinoEfetivo).toBe("atender");
    expect(veredictoDasRespostas(respostas(["venda", 0.9, 0.9], ["atender", 0.9, 0.9], 0.79), CATEGORIAS_PADRAO, true)!.urgente.marcar).toBe(false);
  });

  it("resposta ilegível, categoria fora da lista ou destino inventado: nenhum veredito", () => {
    const ok = respostas(["venda", 0.9, 0.9], ["atender", 0.9, 0.9], 0.1);
    expect(veredictoDasRespostas({ ...ok, urgente: { tipo: "noul", noul: 2 } }, CATEGORIAS_PADRAO, true)).toBeNull();
    expect(veredictoDasRespostas({ ...ok, categoria: choice("financeiro", 0.9, 0.9) }, CATEGORIAS_PADRAO, true)).toBeNull();
    expect(veredictoDasRespostas({ ...ok, destino: choice("passar", 0.9, 0.9) }, CATEGORIAS_PADRAO, true)).toBeNull();
    expect(veredictoDasRespostas({ categoria: ok.categoria, destino: ok.destino }, CATEGORIAS_PADRAO, true)).toBeNull();
    expect(veredictoDasRespostas({ ...ok, destino: { tipo: "choice", escolha: "atender", probabilidades: {}, confianca: 1 } }, CATEGORIAS_PADRAO, true)).toBeNull();
  });
});

const corpo = (c: [string, number, number], d: [string, number, number], u: number) => ({
  model: "jev-1.13.0",
  answers: {
    categoria: { type: "choice", choice: c[0], probabilities: { [c[0]]: c[1] }, confidence: c[2] },
    destino: { type: "choice", choice: d[0], probabilities: { [d[0]]: d[1] }, confidence: d[2] },
    urgente: { type: "noul", noul: u },
  },
  usage: { input_tokens: 300, output_tokens: 3 },
});
const ok = (c: unknown) => new Response(JSON.stringify(c), { status: 200, headers: { "content-type": "application/json" } });
const entrada = { texto: "Minha tela quebrou, quanto custa?", primeiraMensagem: true, categorias: CATEGORIAS_PADRAO };

describe("perguntarATriagem (fetchImpl simulado)", () => {
  it("manda UMA chamada com o modelo fixo, as três perguntas e o texto como state", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(corpo(["conserto", 0.9, 0.9], ["atender", 0.9, 0.9], 0.1)));
    const r = await perguntarATriagem(ORG, entrada, { fetchImpl });
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const b = JSON.parse(String(init.body)) as { model: string; state: unknown; questions: Record<string, unknown> };
    expect(b.model).toBe("jev-1.13.0");
    expect(b.state).toBe("Minha tela quebrou, quanto custa?");
    expect(Object.keys(b.questions)).toEqual(["categoria", "destino", "urgente"]);
  });

  it("sem texto digitado: nenhuma chamada", async () => {
    const fetchImpl = vi.fn();
    expect(await perguntarATriagem(ORG, { ...entrada, texto: "  " }, { fetchImpl })).toMatchObject({ ok: false, motivo: "sem_texto" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sem o interruptor da instalação, nada sai", async () => {
    escrevivel.JEV_TRIAGEM_DO_SISTEMA_ENABLED = false;
    const fetchImpl = vi.fn();
    const r = await perguntarATriagem(ORG, entrada, { fetchImpl });
    expect(r).toMatchObject({ ok: false, motivo: "sem_credencial" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("tarefa desligada ou sem aceite: nada sai", async () => {
    banco.settings = { jev: { ligado: true, aceite: { em: "2026-10-01T12:00:00.000Z", por: POR, alcance: "mensagem" }, tarefas: { triagem: { estado: "desligada" } } } };
    const fetchImpl = vi.fn();
    expect((await perguntarATriagem(ORG, entrada, { fetchImpl })).ok).toBe(false);
    banco.settings = { jev: { ligado: true, tarefas: { triagem: { estado: "observando" } } } };
    expect((await perguntarATriagem(ORG, entrada, { fetchImpl })).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, "credencial_invalida"],
    [429, "limite_de_taxa"],
    [529, "provedor_sobrecarregado"],
    [500, "provedor_indisponivel"],
  ] as const)("erro %s vira %s, sem lançar", async (status, motivo) => {
    const r = await perguntarATriagem(ORG, entrada, { fetchImpl: vi.fn().mockResolvedValue(new Response("{}", { status })) });
    expect(r).toMatchObject({ ok: false, motivo });
  });

  it("resposta fora do formato vira resposta_ilegivel", async () => {
    const r = await perguntarATriagem(ORG, entrada, { fetchImpl: vi.fn().mockResolvedValue(ok({ model: "jev-1.13.0", answers: {}, usage: { input_tokens: 1, output_tokens: 0 } })) });
    expect(r.ok).toBe(false);
  });
});
