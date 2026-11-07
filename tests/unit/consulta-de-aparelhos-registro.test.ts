/**
 * Spec 23 §7 — a ferramenta `crm_search_aparelhos` está registrada em TODOS os lugares que a
 * fazem existir de verdade para o agente, e nasce desligada.
 *
 * Esquecer um destes lugares não quebra o build: a ferramenta só some do Testar, ou o detector de
 * repetição a trata como escrita, ou a fronteira de atendimento a barra. É o tipo de falha que
 * só aparece com cliente na conversa.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ORIGEM_DA_FERRAMENTA } from "@/lib/agent-engine/agent/evidencias-das-ferramentas";
import { SCENARIO_READS } from "@/lib/agent-engine/agent/preview";
import { READ_ONLY_TOOLS } from "@/lib/agent-engine/agent/tool-breaker";
import { TOOL_CATALOG } from "@/lib/mcp/tools/catalogo";
import { allTools } from "@/lib/mcp/tools";
import { TETO_TOOLS_POR_AGENTE } from "@/lib/mcp/tools/selecao-por-pacote";

const NOME = "crm_search_aparelhos";
const raiz = join(__dirname, "..", "..");

describe("crm_search_aparelhos: registro completo", () => {
  it("T-REG-01 está nos handlers E no catálogo de apresentação, com texto de leigo", () => {
    expect(allTools.some((t) => t.name === NOME)).toBe(true);
    const entrada = TOOL_CATALOG.find((t) => t.name === NOME);
    expect(entrada).toBeDefined();
    expect(entrada!.category).toBe("read");
    expect(entrada!.risco).toBe("seguro");
    expect(entrada!.rotulo).toBe("Consultar aparelhos e preços da loja");
    expect(entrada!.explicacao.length).toBeGreaterThanOrEqual(40);
    // Só em "organizar", como o banco externo: "atender"/"vender" já estão no teto do agente
    // que nasce hoje (tests/unit/pacote-reserva-vaga-da-critica.test.ts reprova a vaga a mais).
    expect([...entrada!.pacotes]).toEqual(["organizar"]);
    expect(entrada!.apenasHumano).toBeUndefined();
  });

  it("T-REG-02 está nas listas de leitura: breaker, Testar, fronteira e origem da evidência", () => {
    expect((READ_ONLY_TOOLS as readonly string[]).includes(NOME)).toBe(true);
    expect(SCENARIO_READS.has(NOME)).toBe(true);
    expect(ORIGEM_DA_FERRAMENTA[NOME]).toBe("catalogo");
    const fronteira = readFileSync(join(raiz, "lib/atendimento/fronteira-server.ts"), "utf8");
    const bloco = fronteira.slice(fronteira.indexOf("const reads = new Set(["));
    expect(bloco.slice(0, bloco.indexOf("]);")).includes(`"${NOME}"`)).toBe(true);
  });

  it("T-REG-04 nasce DESLIGADA: nenhuma lista de capacidades já gravada em código a inclui", () => {
    // O que liga é o tool_ids da versão do agente (banco). Em código, nenhum agente-padrão a leva.
    const padrao = readFileSync(join(raiz, "lib/mcp/tools/selecao-por-pacote.ts"), "utf8");
    expect(padrao.includes(NOME)).toBe(false);
    for (const arquivo of ["supabase/baseline.sql"]) {
      const sql = readFileSync(join(raiz, arquivo), "utf8");
      expect(sql.includes(NOME), arquivo).toBe(false);
    }
  });

  it("D10 cabe no agente da Grau Cell: 14 capacidades ligadas + 1 fica abaixo do teto", () => {
    const LIGADAS_NO_ATENDENTE_DA_GRAU_CELL = 14; // informado pelo dono em 2026-11-07
    expect(LIGADAS_NO_ATENDENTE_DA_GRAU_CELL + 1).toBeLessThanOrEqual(TETO_TOOLS_POR_AGENTE);
    expect(TETO_TOOLS_POR_AGENTE).toBe(27);
  });

  it("a ferramenta não declara escrita, módulo opcional nem capacidade da organização", () => {
    const tool = allTools.find((t) => t.name === NOME)!;
    expect(tool.category).toBe("read");
    const entrada = TOOL_CATALOG.find((t) => t.name === NOME)!;
    expect(entrada.modulo).toBeUndefined();
    expect(entrada.capacidade).toBeUndefined();
  });
});
