import { describe, expect, it, vi } from "vitest";
import type pg from "pg";

import { CATEGORIAS_PADRAO } from "@/lib/ai/decisao/categorias";
import type { Resposta } from "@/lib/ai/decisao/cliente";
import { veredictoDasRespostas } from "@/lib/ai/decisao/triagem";
import { avisarQueEPraEquipe, AVISO_DA_EQUIPE, TITULOS_DO_AVISO_DA_EQUIPE } from "@/lib/ai/decisao/aviso-da-triagem";
import { conversaMarcadaComoUrgente } from "@/lib/inbox/urgente-do-jev";

import { dicaDaTriagem } from "./dica-da-triagem";
import { marcarOuDesmarcarUrgente, type TriagemDoTurno } from "./triagem-no-turno";

const ch = (e: string, p: number, c: number): Resposta => ({ tipo: "choice", escolha: e, probabilidades: { [e]: p }, confianca: c });
function triagem(estado: "observando" | "decidindo", cat: [string, number, number], dest: [string, number, number], primeira = true): TriagemDoTurno {
  const veredito = veredictoDasRespostas(
    { categoria: ch(...cat), destino: ch(...dest), urgente: { tipo: "noul", noul: 0.1 } },
    CATEGORIAS_PADRAO,
    primeira,
  )!;
  return { estado, veredito, categorias: CATEGORIAS_PADRAO };
}

describe("a dica de uma linha (T19)", () => {
  it("decidindo + alta + atender: 'categoria: conserto; destino: atender', numa linha só", () => {
    const d = dicaDaTriagem(triagem("decidindo", ["conserto", 0.95, 0.9], ["atender", 0.95, 0.9]));
    expect(d).toBe("Dica da triagem: categoria: conserto; destino: atender.");
    expect(d).not.toContain("\n");
  });

  it("decidindo + alta + pedir_dado na 1ª mensagem: 'peça primeiro…'", () => {
    expect(dicaDaTriagem(triagem("decidindo", ["conserto", 0.95, 0.9], ["pedir_dado", 0.95, 0.9]))).toMatch(/^Dica da triagem: peça primeiro/);
  });

  it("pedir_dado fora da 1ª mensagem, equipe, confiança média/baixa: SEM dica (o prompt fica como hoje)", () => {
    expect(dicaDaTriagem(triagem("decidindo", ["conserto", 0.95, 0.9], ["pedir_dado", 0.95, 0.9], false))).toBe("");
    expect(dicaDaTriagem(triagem("decidindo", ["conserto", 0.95, 0.9], ["equipe", 0.95, 0.9]))).toBe("");
    expect(dicaDaTriagem(triagem("decidindo", ["conserto", 0.75, 0.65], ["atender", 0.75, 0.65]))).toBe("");
    expect(dicaDaTriagem(triagem("decidindo", ["conserto", 0.4, 0.4], ["atender", 0.4, 0.4]))).toBe("");
  });

  it("atender com categoria só média: não há o que dizer", () => {
    expect(dicaDaTriagem(triagem("decidindo", ["conserto", 0.75, 0.65], ["atender", 0.95, 0.9]))).toBe("");
  });

  it("OBSERVANDO nunca altera o prompt, e sem triagem (Jev fora do ar) também não", () => {
    expect(dicaDaTriagem(triagem("observando", ["conserto", 0.95, 0.9], ["atender", 0.95, 0.9]))).toBe("");
    expect(dicaDaTriagem(undefined)).toBe("");
  });

  it("usa o rótulo da categoria DA EMPRESA, e nunca texto do cliente", () => {
    const t = triagem("decidindo", ["impressao", 0.95, 0.9], ["atender", 0.95, 0.9]);
    expect(dicaDaTriagem(t)).toContain("impressão");
  });
});

describe("o aviso 'equipe' na Central (T20)", () => {
  const pool = (rowCount: number, locale: string | null = null) => {
    const query = vi.fn(async (sql: string, _p?: unknown[]) => (/from public.organizations/.test(sql) ? { rows: [{ locale }] } : { rows: [], rowCount }));
    return { pool: { query } as unknown as pg.Pool, query };
  };

  it("abre UM aviso 'other' ligado à conversa, na empresa do turno — sem caso e sem mexer na conversa", async () => {
    const { pool: p, query } = pool(1);
    expect(await avisarQueEPraEquipe(p, { organizationId: "org-a", conversationId: "conv-1" })).toBe("aberto");
    const insert = query.mock.calls.find(([s]) => String(s).includes("insert into public.agent_inbox_items"))!;
    expect(String(insert[0])).toContain("'other'");
    expect(String(insert[0])).toContain("'conversation'");
    expect(String(insert[0])).toContain("where not exists");
    expect(insert[1]).toEqual(["org-a", AVISO_DA_EQUIPE.titulo, AVISO_DA_EQUIPE.corpo, "conv-1", TITULOS_DO_AVISO_DA_EQUIPE]);
    const todos = query.mock.calls.map(([s]) => String(s)).join("\n");
    expect(todos).not.toMatch(/agent_cases|update public.conversations|performHumanHandoff/);
  });

  it("já havia um aberto para a conversa: não abre outro", async () => {
    const { pool: p } = pool(0);
    expect(await avisarQueEPraEquipe(p, { organizationId: "org-a", conversationId: "conv-1" })).toBe("ja_havia");
  });

  it("sai no idioma da organização e o texto não repete o que o cliente escreveu", async () => {
    const { pool: p, query } = pool(1, "es");
    await avisarQueEPraEquipe(p, { organizationId: "org-a", conversationId: "conv-1" });
    const insert = query.mock.calls.find(([s]) => String(s).includes("insert into"))!;
    expect(String((insert[1] as unknown[])[1])).toBe("Jev cree que esta conversación necesita al equipo");
    expect(TITULOS_DO_AVISO_DA_EQUIPE).toContain("O Jev acha que esta conversa precisa da equipe");
    expect(TITULOS_DO_AVISO_DA_EQUIPE).toContain("Jev cree que esta conversación necesita al equipo");
  });

  it("banco que falha: não lança", async () => {
    const p = { query: vi.fn().mockRejectedValue(new Error("x")) } as unknown as pg.Pool;
    expect(await avisarQueEPraEquipe(p, { organizationId: "o", conversationId: "c" })).toBe("falhou");
  });
});

describe("a marca 'Urgente' (T21)", () => {
  it("lê a marca de metadata e tolera lixo", () => {
    expect(conversaMarcadaComoUrgente({ jev_urgente: { em: "2026-11-01T00:00:00Z", message_id: "m" } })).toBe(true);
    for (const ruim of [null, undefined, "x", [], {}, { jev_urgente: null }, { jev_urgente: "sim" }]) {
      expect(conversaMarcadaComoUrgente(ruim)).toBe(false);
    }
  });

  it("urgente grava a marca na conversa da empresa do turno; não urgente só tira a marca existente", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const p = { query } as unknown as pg.Pool;
    await marcarOuDesmarcarUrgente(p, "org-a", "conv-1", "msg-1", true);
    await marcarOuDesmarcarUrgente(p, "org-a", "conv-1", "msg-2", false);
    const marca = query.mock.calls[0] as [string, unknown[]];
    const tira = query.mock.calls[1] as [string, unknown[]];
    expect(marca[0]).toContain("jsonb_build_object('jev_urgente'");
    expect(marca[0]).toContain("where organization_id = $1 and id = $2");
    expect(marca[1]).toEqual(["org-a", "conv-1", "msg-1"]);
    expect(tira[0]).toContain("metadata - 'jev_urgente'");
    expect(tira[0]).toContain("metadata ? 'jev_urgente'");
    expect(tira[1]).toEqual(["org-a", "conv-1"]);
    // Só marca: nada de destino, status, dono ou caso.
    expect(marca[0] + tira[0]).not.toMatch(/status|assigned|agent_cases/);
  });
});
