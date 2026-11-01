/**
 * Os interruptores da instalação das tarefas novas da r3 (T03): desligados por
 * padrão, lidos do `env` a cada chamada, e só as duas tarefas novas têm um.
 */
import { afterEach, describe, expect, it } from "vitest";

import { env } from "@/lib/env";
import { idDaTarefaSchema } from "@/lib/ai/decisao/config";
import { interruptorDaInstalacaoLigado, TAREFAS_COM_INTERRUPTOR_DA_INSTALACAO } from "@/lib/ai/decisao/interruptores";

const escrevivel = env as unknown as Record<string, unknown>;
const original = { t: env.JEV_TRIAGEM_DO_SISTEMA_ENABLED, c: env.JEV_CONFERENCIA_ENABLED };

afterEach(() => {
  escrevivel.JEV_TRIAGEM_DO_SISTEMA_ENABLED = original.t;
  escrevivel.JEV_CONFERENCIA_ENABLED = original.c;
});

describe("interruptores da instalação", () => {
  it("nascem DESLIGADOS: um .env antigo, sem as variáveis, não liga nada", () => {
    expect(original).toEqual({ t: false, c: false });
    expect(interruptorDaInstalacaoLigado("triagem")).toBe(false);
    expect(interruptorDaInstalacaoLigado("conferencia")).toBe(false);
  });

  it("cada tarefa lê o SEU interruptor, e só ele", () => {
    escrevivel.JEV_TRIAGEM_DO_SISTEMA_ENABLED = true;
    expect(interruptorDaInstalacaoLigado("triagem")).toBe(true);
    expect(interruptorDaInstalacaoLigado("conferencia")).toBe(false);
    escrevivel.JEV_TRIAGEM_DO_SISTEMA_ENABLED = false;
    escrevivel.JEV_CONFERENCIA_ENABLED = true;
    expect(interruptorDaInstalacaoLigado("triagem")).toBe(false);
    expect(interruptorDaInstalacaoLigado("conferencia")).toBe(true);
  });

  it("as tarefas da onda 1 e 2 não têm interruptor de instalação: seguem como estavam", () => {
    for (const id of idDaTarefaSchema.options.filter((x) => !TAREFAS_COM_INTERRUPTOR_DA_INSTALACAO.includes(x))) {
      expect(interruptorDaInstalacaoLigado(id), id).toBe(true);
    }
  });

  it("a lista de tarefas com interruptor é exatamente as duas novas", () => {
    expect([...TAREFAS_COM_INTERRUPTOR_DA_INSTALACAO].sort()).toEqual(["conferencia", "triagem"]);
  });
});
