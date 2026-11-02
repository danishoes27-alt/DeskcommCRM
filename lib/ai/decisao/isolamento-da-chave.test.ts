import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/lib/env";

/**
 * A CHAVE DO JEV NUNCA ATRAVESSA EMPRESAS (r3, T26, item 1 da seção 8.5), pela LINHA da
 * credencial, e não pelo valor da chave: em D2 = B o valor pode ser o mesmo em todas as
 * empresas, então o que se prova é qual linha foi pedida e qual foi lida.
 *
 * O cliente admin é um dublê que guarda cada filtro `.eq(...)` de cada consulta e devolve só a
 * linha que casa com TODOS os filtros — como o banco faria.
 */

interface Consulta {
  tabela: string;
  filtros: Record<string, unknown>;
}
const consultas: Consulta[] = [];

const LINHAS: Record<string, Array<Record<string, unknown>>> = {
  organizations: [
    { id: "org-a", settings: { jev: { ligado: true, aceite: { em: "2026-11-01T12:00:00.000Z", por: "aaaaaaaa-0428-4000-8000-000000000001", alcance: "resposta", versao: 2 }, tarefas: { triagem: { estado: "observando" } } } } },
    { id: "org-b", settings: { jev: { ligado: true, aceite: { em: "2026-11-01T12:00:00.000Z", por: "aaaaaaaa-0428-4000-8000-000000000001", alcance: "resposta", versao: 2 }, tarefas: { triagem: { estado: "observando" } } } } },
    { id: "org-sem-credencial", settings: { jev: { ligado: true, aceite: { em: "2026-11-01T12:00:00.000Z", por: "aaaaaaaa-0428-4000-8000-000000000001", alcance: "resposta", versao: 2 }, tarefas: { triagem: { estado: "observando" } } } } },
  ],
  ai_provider_credentials: [
    { id: "cred-a", organization_id: "org-a", provider: "typesafe", is_active: true, validated_at: "2026-10-01", api_key_encrypted: "\\xAA", api_key_iv: "\\x01", api_key_tag: "\\x02" },
    // Mesmo valor de chave, outra linha e outra empresa: o D2 = B do piloto.
    { id: "cred-b", organization_id: "org-b", provider: "typesafe", is_active: true, validated_at: "2026-10-01", api_key_encrypted: "\\xAA", api_key_iv: "\\x01", api_key_tag: "\\x02" },
  ],
};
const linhaLida: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const filtros: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        eq: (col: string, v: unknown) => ((filtros[col] = v), chain),
        not: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          consultas.push({ tabela, filtros: { ...filtros } });
          const achada = (LINHAS[tabela] ?? []).find((l) => Object.entries(filtros).every(([k, v]) => l[k] === v));
          if (achada && tabela === "ai_provider_credentials") linhaLida.push(String(achada.id));
          return { data: achada ?? null, error: null };
        },
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/crypto/aes_gcm", () => ({
  byteaToBuffer: (x: string) => Buffer.from(x),
  decryptKey: () => "tsk_o_mesmo_valor_nas_duas",
}));

import { chaveDasTarefas } from "./ponto";
import { TAREFA_DA_TRIAGEM } from "./tarefas";

const escrevivel = env as unknown as Record<string, unknown>;
beforeEach(() => {
  consultas.length = 0;
  linhaLida.length = 0;
  escrevivel.JEV_TRIAGEM_DO_SISTEMA_ENABLED = true;
});

describe("a chave é buscada pela linha da empresa do turno", () => {
  it("empresa A lê a linha de A; empresa B lê a linha de B (mesmo valor, linhas diferentes)", async () => {
    expect(await chaveDasTarefas("org-a", [TAREFA_DA_TRIAGEM])).toBe("tsk_o_mesmo_valor_nas_duas");
    expect(linhaLida).toEqual(["cred-a"]);
    expect(await chaveDasTarefas("org-b", [TAREFA_DA_TRIAGEM])).toBe("tsk_o_mesmo_valor_nas_duas");
    expect(linhaLida).toEqual(["cred-a", "cred-b"]);
  });

  it("TODA consulta filtra pela empresa pedida: nenhuma leitura de credencial sem organization_id", async () => {
    await chaveDasTarefas("org-a", [TAREFA_DA_TRIAGEM]);
    const credenciais = consultas.filter((c) => c.tabela === "ai_provider_credentials");
    expect(credenciais.length).toBeGreaterThan(0);
    for (const c of credenciais) expect(c.filtros.organization_id).toBe("org-a");
    const orgs = consultas.filter((c) => c.tabela === "organizations");
    for (const c of orgs) expect(c.filtros.id).toBe("org-a");
  });

  it("empresa sem credencial NÃO herda a de outra: não há chave", async () => {
    expect(await chaveDasTarefas("org-sem-credencial", [TAREFA_DA_TRIAGEM])).toBeNull();
    expect(linhaLida).toEqual([]);
  });
});
