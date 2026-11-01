/**
 * OS INTERRUPTORES DA INSTALAÇÃO — o que o dono do servidor liga, por tarefa.
 *
 * A tarefa do Jev só fala com a TypeSafe com TODAS estas condições juntas:
 * interruptor mestre da empresa, aceite do administrador cobrindo o alcance dela,
 * tarefa ligada, credencial `typesafe` ativa e validada (as quatro primeiras são
 * `chaveDasTarefas`, `./ponto.ts`) e, para as tarefas novas da r3, o interruptor
 * da INSTALAÇÃO aqui. É o que impede publicar a r3 de fazer a `triagem` (alcance
 * `mensagem`, já coberto pelo aceite antigo) nascer observando em toda empresa que
 * já tem o Jev ligado e mandar mensagens para fora sem um clique novo.
 *
 * As tarefas da onda 1 e 2 não têm interruptor de instalação: ficam como estavam.
 * Lê o `env` a cada chamada, e não uma constante do módulo — o teste liga e
 * desliga sem recarregar o módulo, e um `.env` lido uma vez no boot é o mesmo valor.
 */
import { env } from "@/lib/env";

import type { IdDaTarefa } from "./config";

const INTERRUPTOR_DA_TAREFA: Partial<Record<IdDaTarefa, () => boolean>> = {
  triagem: () => env.JEV_TRIAGEM_DO_SISTEMA_ENABLED === true,
  conferencia: () => env.JEV_CONFERENCIA_ENABLED === true,
};

/** A tarefa tem o interruptor da instalação ligado? Sem interruptor próprio, sim. */
export function interruptorDaInstalacaoLigado(id: string): boolean {
  const interruptor = INTERRUPTOR_DA_TAREFA[id as IdDaTarefa];
  return interruptor === undefined ? true : interruptor();
}

/** As tarefas que têm interruptor de instalação — para o teste cobrar a lista. */
export const TAREFAS_COM_INTERRUPTOR_DA_INSTALACAO: readonly IdDaTarefa[] = ["triagem", "conferencia"];
