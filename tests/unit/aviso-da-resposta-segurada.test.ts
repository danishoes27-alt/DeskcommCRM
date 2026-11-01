/**
 * O AVISO FIXO AO CLIENTE QUANDO A RESPOSTA É SEGURADA (T15, D6 e ambiguidade 4).
 *
 * Três propriedades: (1) a FRASE — de código, sem modelo, que não promete atendente
 * nem passagem de conversa, no idioma da organização; (2) o ENVIO — pela mesma
 * cadeia de guardrails de qualquer saída (contato bloqueado não recebe); (3) a
 * REGRA — uma vez por resposta segurada e, com caso já aberto, uma única vez por
 * conversa. O turno ponta a ponta é o invariante da T25.
 */
import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const cadeia = vi.hoisted(() => ({
  corpos: [] as string[],
  resultado: { status: "sent", outcome: { kind: "sent" }, trace: [] } as Record<string, unknown>,
}));

vi.mock("@/lib/agent-engine/guardrails/before-send", () => ({
  runBeforeSend: vi.fn(async (args: { body: string; optedOutThisTurn: boolean }) => {
    cadeia.corpos.push(args.body);
    // O gate de verdade vetaria o contato bloqueado (o `stop` é o 1º da cadeia).
    if (args.optedOutThisTurn) {
      return { status: "vetoed", gate: "stop", code: "contato_bloqueado", message: "bloqueado", trace: [] };
    }
    return cadeia.resultado;
  }),
}));
vi.mock("@/lib/escalacao/disponibilidade", () => ({
  expectativaDeAtendimento: vi.fn(async () => ({ quem: { disponiveis: 2, total: 3 }, frase: "" })),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { avisarLeadDaEscalacao } from "@/lib/agent-engine/agent/aviso-de-escalacao";
import { devoAvisarOCliente } from "@/lib/agent-engine/agent/caso-da-conferencia";
import { decideSpinning } from "@/lib/agent-engine/spinning/engine";
import { textoDoAviso } from "@/lib/escalacao/aviso-ao-lead";

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "33333333-3333-4333-8333-333333333333";
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
void decideSpinning;

function pool(locale: string | null = null) {
  return {
    query: vi.fn(async (sql: string) => (/from organizations/.test(sql) ? { rows: [{ locale }] } : { rows: [] })),
  };
}

function avisa(opts: { bloqueado?: boolean; locale?: string | null } = {}) {
  return avisarLeadDaEscalacao(
    pool(opts.locale ?? null) as never,
    { tenantId: ORG, leadId: LEAD, conversationId: CONVERSA, channelSessionId: "sessao", jobId: "job" },
    {
      motivo: "resposta_segurada",
      channel: { send: vi.fn() } as never,
      optedOutThisTurn: opts.bloqueado === true,
      now: new Date("2026-11-01T15:00:00Z"),
      log,
    },
  );
}

beforeEach(() => {
  cadeia.corpos.length = 0;
  cadeia.resultado = { status: "sent", outcome: { kind: "sent" }, trace: [] };
});

describe("a frase", () => {
  it("uma das variantes é exatamente a frase proposta, e ela diz que a equipe confirma", () => {
    const todas = new Set<string>();
    for (let i = 0; i < 200; i++) {
      todas.add(textoDoAviso("resposta_segurada", { disponiveis: 2, total: 3 }, `lead-${i}`));
    }
    expect([...todas].some((t) => t.startsWith("Vou confirmar essa informação com a equipe e já te respondo."))).toBe(true);
    for (const t of todas) expect(t).toMatch(/confirmar/);
  });

  it("NÃO fala em atendente, em passar a conversa nem em transferir: a IA não saiu de campo", () => {
    for (let i = 0; i < 200; i++) {
      for (const quem of [null, { disponiveis: 0, total: 0 }, { disponiveis: 0, total: 3 }, { disponiveis: 2, total: 3 }]) {
        const t = textoDoAviso("resposta_segurada", quem, `lead-${i}`);
        expect(t).not.toMatch(/atendente|transfer|passei|passar (a|sua) conversa|humano/i);
      }
    }
  });

  it("é de CÓDIGO: não leva o nome do cliente nem nada do rascunho (a semente do sorteio é o id do lead, e só ela)", () => {
    const t = textoDoAviso("resposta_segurada", null, "abc12345-dead-4beef-8888-000000000001");
    expect(t).not.toContain("abc12345");
  });

  it("em espanhol, no idioma da organização, sem uma palavra em português", () => {
    const portugues = /\b(você|seu|sua|equipe|não|já|ninguém|aguarde)\b/i;
    for (let i = 0; i < 60; i++) {
      const t = textoDoAviso("resposta_segurada", { disponiveis: 2, total: 3 }, `lead-${i}`, "es");
      expect(t).not.toMatch(portugues);
      expect(t).toMatch(/equipo/);
    }
  });

  it("com a equipe disponível, a frase pode prometer resposta; sem ninguém, NÃO promete 'já' e diz que pode demorar", () => {
    for (let i = 0; i < 100; i++) {
      const ocupada = textoDoAviso("resposta_segurada", { disponiveis: 0, total: 3 }, `lead-${i}`);
      expect(ocupada, `lead-${i}`).not.toMatch(/já te respondo/i);
      expect(ocupada).toMatch(/anotad|registrad|assim que/i);
      const semEquipe = textoDoAviso("resposta_segurada", null, `lead-${i}`);
      expect(semEquipe).not.toMatch(/já te respondo/i);
    }
  });

  it("não usa a palavra atendente nem 'conversa na fila' em estado nenhum (o fecho é próprio deste aviso)", () => {
    for (let i = 0; i < 100; i++) {
      for (const quem of [null, { disponiveis: 0, total: 0 }, { disponiveis: 0, total: 3 }, { disponiveis: 3, total: 3 }]) {
        expect(textoDoAviso("resposta_segurada", quem, `lead-${i}`)).not.toMatch(/atendente|fila|conversa entrou/i);
        expect(textoDoAviso("resposta_segurada", quem, `lead-${i}`, "es")).not.toMatch(/agente|cola|conversación/i);
      }
    }
  });
});

describe("o envio passa pela cadeia de guardrails", () => {
  it("manda o texto fixo pela cadeia e devolve avisado: true", async () => {
    const r = await avisa();
    expect(r).toEqual({ avisado: true });
    expect(cadeia.corpos).toHaveLength(1);
    expect(cadeia.corpos[0]).toMatch(/confirmar/);
  });

  it("CONTATO BLOQUEADO não recebe: o `stop` da cadeia veta e o aviso volta avisado: false", async () => {
    const r = await avisa({ bloqueado: true });
    expect(r).toMatchObject({ avisado: false, porque: "contato_bloqueado" });
  });

  it("janela de resposta/anti-ban fechada: o veto da cadeia volta como não avisado, sem lançar", async () => {
    cadeia.resultado = { status: "vetoed", gate: "pacing", code: "messaging_window_closed", message: "fechada", trace: [] };
    const r = await avisa();
    expect(r).toMatchObject({ avisado: false, motivoCodigo: "fora_da_janela" });
  });

  it("o idioma da organização escolhe a língua do aviso", async () => {
    await avisa({ locale: "es" });
    expect(cadeia.corpos[0]).toMatch(/equipo/);
  });
});

describe("a regra: uma vez por resposta segurada, e uma só por conversa quando já havia caso", () => {
  it("caso aberto AGORA: avisa", () => {
    expect(devoAvisarOCliente({ desfecho: "caso_aberto", caseId: "c1" })).toBe(true);
  });

  it("o caso falhou ao abrir: o cliente ainda assim é avisado", () => {
    expect(devoAvisarOCliente({ desfecho: "caso_falhou" })).toBe(true);
  });

  it("já havia caso e o cliente AINDA não fora avisado: avisa essa vez", () => {
    expect(devoAvisarOCliente({ desfecho: "caso_ja_aberto", caseId: "c1", avisoJaDado: false })).toBe(true);
  });

  it("já havia caso e o cliente JÁ fora avisado: NÃO avisa de novo (uma única vez por conversa)", () => {
    expect(devoAvisarOCliente({ desfecho: "caso_ja_aberto", caseId: "c1", avisoJaDado: true })).toBe(false);
  });

  it("duas respostas seguradas na mesma conversa com caso aberto geram UM aviso só", () => {
    let avisos = 0;
    let marca = false; // a nota do caso
    for (let i = 0; i < 2; i++) {
      const caso = i === 0
        ? ({ desfecho: "caso_aberto", caseId: "c1" } as const)
        : ({ desfecho: "caso_ja_aberto", caseId: "c1", avisoJaDado: marca } as const);
      if (devoAvisarOCliente(caso)) {
        avisos += 1;
        marca = true; // `marcarOAvisoNoCaso` depois do envio
      }
    }
    expect(avisos).toBe(1);
  });
});

describe("a fiação no turno", () => {
  const fonte = fs.readFileSync(path.resolve(__dirname, "../../lib/agent-engine/agent/inbound-turn.ts"), "utf8");
  const bloco = fonte.slice(
    fonte.indexOf("if (devoAvisarOCliente(casoDaResposta))"),
    fonte.indexOf("return erroDaRespostaSegurada();", fonte.indexOf("if (devoAvisarOCliente(casoDaResposta))")),
  );

  it("o aviso usa o motivo resposta_segurada e a cadeia de aviso de escalação (não um caminho por fora)", () => {
    expect(bloco).toContain("avisarLeadDaEscalacao(pool, avisoDaEscalacao().ids");
    expect(bloco).toContain("motivo: 'resposta_segurada'");
    expect(bloco).not.toMatch(/channel\.send|liveChannel\(\)\.send/);
  });

  it("depois de enviado, marca o aviso no caso", () => {
    expect(bloco).toContain("marcarOAvisoNoCaso(pool, tenantId, caseId)");
  });

  it("o aviso não leva a conferência: o aviso de código não é conferido pelo Jev", () => {
    expect(bloco).not.toContain("conferenciaJev");
  });
});
