import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BEFORE_SEND_CHAIN_VERSION,
  BEFORE_SEND_GATES,
  evaluateBeforeSend,
  jevConferenciaGate,
  type ConferenciaJevNoGate,
  type GateContext,
} from "@/lib/agent-engine/guardrails/before-send";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { SPINNING_DEFAULTS } from "@/lib/agent-engine/spinning/defaults";

/**
 * O gate `jev_conferencia` (v8 da cadeia before_send): a conferência do "depois" da IA.
 * Ele é puro e síncrono — lê o veredito que o turno calculou ANTES do lock — e a regra
 * que importa é a assimetria entre os dois estados: `observando` NUNCA veta (só deixa no
 * trace o que faria), `decidindo` segura.
 */
function baseCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    now: new Date("2026-11-01T13:00:00Z"),
    body: "A troca de tela custa R$ 250,00.",
    optedOut: false,
    provider: "waha",
    pacing: {
      knobs: PACING_DEFAULTS,
      state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null },
      crmDailyLimit: null,
    },
    spinning: { knobs: SPINNING_DEFAULTS, window: [] },
    promise: { table: null },
    semanticPromise: null,
    disclosure: { template: null, isFirstOutbound: false, mode: "inject" },
    lgpd: null,
    casesEnabled: false,
    hasOpenCase: false,
    openedCaseThisTurn: false,
    ...overrides,
  };
}

const SEGURA: Omit<ConferenciaJevNoGate, "estado"> = {
  segurar: true,
  motivo: "A sua resposta NÃO foi enviada: o valor R$ 250,00 não aparece nas fontes.",
  detail: { faixa: "alta", origem: "local", regras: "L1", conferida_pelo_jev: 0 },
};
const LIBERA: Omit<ConferenciaJevNoGate, "estado"> = {
  segurar: false,
  motivo: "",
  detail: { faixa: "baixa", origem: "nenhuma", conferida_pelo_jev: 1 },
};

describe("jevConferenciaGate", () => {
  it("sem veredito (tarefa desligada, instalação desligada, prévia, outro caminho): no-op", () => {
    expect(jevConferenciaGate.evaluate(baseCtx())).toEqual({ pass: true });
  });

  it("OBSERVANDO nunca segura — nem com achado local, nem com o Jev dizendo que sim", () => {
    const v = jevConferenciaGate.evaluate(baseCtx({ conferenciaJev: { estado: "observando", ...SEGURA } }));
    expect(v.pass).toBe(true);
  });

  it("observando deixa no trace o que FARIA: segurar, com o detalhe em rótulos", () => {
    const { veto, trace } = evaluateBeforeSend(
      baseCtx({ conferenciaJev: { estado: "observando", ...SEGURA } }),
      [jevConferenciaGate],
    );
    expect(veto).toBeNull();
    expect(trace).toEqual([
      {
        gate: "jev_conferencia",
        verdict: "skipped",
        code: "observando",
        detail: { faixa: "alta", origem: "local", regras: "L1", conferida_pelo_jev: 0, faria: "segurar" },
      },
    ]);
  });

  it("observando que liberaria registra 'liberar'", () => {
    const { trace } = evaluateBeforeSend(baseCtx({ conferenciaJev: { estado: "observando", ...LIBERA } }), [jevConferenciaGate]);
    expect(trace[0]).toMatchObject({ code: "observando", detail: { faria: "liberar" } });
  });

  it("DECIDINDO segura: veto com o código jev_conferencia, o motivo ao modelo e o detalhe no trace", () => {
    const { veto, trace } = evaluateBeforeSend(
      baseCtx({ conferenciaJev: { estado: "decidindo", ...SEGURA } }),
      [jevConferenciaGate],
    );
    expect(veto).toMatchObject({ gate: "jev_conferencia", code: "jev_conferencia", message: SEGURA.motivo });
    expect(trace).toEqual([{ gate: "jev_conferencia", verdict: "veto", code: "jev_conferencia", detail: SEGURA.detail }]);
  });

  it("decidindo que não manda segurar passa em silêncio", () => {
    const v = jevConferenciaGate.evaluate(baseCtx({ conferenciaJev: { estado: "decidindo", ...LIBERA } }));
    expect(v).toEqual({ pass: true });
  });

  it("o trace nunca leva o corpo da resposta", () => {
    const { trace } = evaluateBeforeSend(baseCtx({ conferenciaJev: { estado: "decidindo", ...SEGURA } }), [jevConferenciaGate]);
    expect(JSON.stringify(trace)).not.toContain("troca de tela");
  });
});

describe("o gate na cadeia completa (v8)", () => {
  it("a versão é 8 e o gate está depois do agenda_stall e ANTES do disclosure", () => {
    expect(BEFORE_SEND_CHAIN_VERSION).toBe(8);
    const nomes = BEFORE_SEND_GATES.map((g) => g.name);
    expect(nomes.indexOf("jev_conferencia")).toBe(nomes.indexOf("agenda_stall") + 1);
    expect(nomes.indexOf("jev_conferencia")).toBe(nomes.indexOf("disclosure") - 1);
  });

  it("DECIDINDO + segurar vence os gates que passam: a resposta não sai", () => {
    const { veto, trace } = evaluateBeforeSend(baseCtx({ conferenciaJev: { estado: "decidindo", ...SEGURA } }));
    expect(veto?.gate).toBe("jev_conferencia");
    // E o disclosure, depois dele, nem é avaliado.
    expect(trace.find((t) => t.gate === "disclosure")?.verdict).toBe("skipped");
  });

  it("OBSERVANDO deixa a cadeia inteira passar", () => {
    const { veto } = evaluateBeforeSend(baseCtx({ conferenciaJev: { estado: "observando", ...SEGURA } }));
    expect(veto).toBeNull();
  });

  it("um veto ANTERIOR (stop) é irrevogável: a conferência nem é avaliada", () => {
    const { veto, trace } = evaluateBeforeSend(
      baseCtx({ optedOut: true, conferenciaJev: { estado: "decidindo", ...SEGURA } }),
    );
    expect(veto?.gate).toBe("stop");
    expect(trace.find((t) => t.gate === "jev_conferencia")?.verdict).toBe("skipped");
  });
});

describe("a chamada ao Jev acontece FORA do lock do número", () => {
  const raiz = path.resolve(__dirname, "../..");
  const turno = fs.readFileSync(path.join(raiz, "lib/agent-engine/agent/inbound-turn.ts"), "utf8");
  const cadeia = fs.readFileSync(path.join(raiz, "lib/agent-engine/guardrails/before-send.ts"), "utf8");

  it("o turno calcula o veredito ANTES de chamar runBeforeSend, e o passa pronto", () => {
    const conferir = turno.indexOf("await conferirOTurno(");
    const primeiraCadeia = turno.indexOf("let chain = await runBeforeSend(beforeSendArgs)");
    expect(conferir, "o turno não chama conferirOTurno").toBeGreaterThan(0);
    expect(primeiraCadeia).toBeGreaterThan(conferir);
    expect(turno).toContain("...(conferenciaJev !== undefined ? { conferenciaJev } : {}),");
  });

  it("a cadeia só LÊ o veredito: não importa o cliente do Jev nem chama rede", () => {
    const trecho = cadeia.slice(cadeia.indexOf("export const jevConferenciaGate"), cadeia.indexOf("export const BEFORE_SEND_CHAIN_VERSION"));
    expect(trecho).not.toMatch(/fetch\(|decidirNoPonto|perguntarAoJev|await /);
    expect(cadeia).not.toMatch(/from ['"]@\/lib\/ai\/decisao/);
  });
});
