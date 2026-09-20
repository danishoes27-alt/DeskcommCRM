/**
 * O MÊS DO CALENDÁRIO DE TAREFAS NÃO PODE VIRAR "SETEMBRO DE 2026" → "SETEMBRO DE".
 *
 * O `Intl` devolve "setembro de 2026" e o `capitalize` do CSS põe maiúscula em
 * TODA palavra: "Setembro De 2026". Preposição com maiúscula é o detalhe que faz o
 * produto parecer traduzido em vez de escrito. A Agenda já resolvia isso com
 * `first-letter:uppercase`; o calendário de tarefas tinha a classe errada.
 *
 * É teste de fonte porque o que decide é a classe no elemento — jsdom não aplica
 * `text-transform`, então um teste de renderização passaria com as duas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("CalendarioDeTarefas · título do mês", () => {
  it("usa first-letter:uppercase e não capitalize", () => {
    const fonte = readFileSync(
      join(process.cwd(), "app/app/tasks/_components/CalendarioDeTarefas.tsx"),
      "utf8",
    );
    const titulo = fonte.match(/<h2[^>]*>\{nomeDoMes\}<\/h2>/)?.[0] ?? "";

    expect(titulo).not.toBe("");
    expect(titulo).toContain("first-letter:uppercase");
    expect(titulo).not.toMatch(/\bcapitalize\b/);
  });
});
