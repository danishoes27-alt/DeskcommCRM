/**
 * O custo e a observação do DEPOIS (T10): o rótulo de cada lado, os parâmetros da
 * gravação, o preço do modelo fixo (o teste que reprova "id sem preço") e que
 * gravar nunca derruba o atendimento. O SQL em si, contra um Postgres de
 * verdade, é `tests/invariants/jev-conferencia-gravacao.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import type pg from "pg";

import { criarEvidenciasDoTurno } from "@/lib/agent-engine/agent/evidencias-do-turno";
import { conferirLocalmente } from "@/lib/agent-engine/guardrails/conferencia-local";
import { costCents, precoDoModelo } from "@/lib/agent-engine/edge/llm/pricing";

import { MODELO_DO_JEV } from "./cliente";
import { juntarOsAchados, veredictoDasRespostas } from "./conferencia";
import {
  custoDaChamada,
  registrarConferenciaDoJev,
  rotuloDasRegrasLocais,
  rotuloDoJev,
  type RegistroDaConferencia,
} from "./observacao-da-conferencia";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const noul = (n: number) => ({ tipo: "noul" as const, noul: n });
const jev = (a: number, b: number, c: number) =>
  veredictoDasRespostas({ sem_fonte: noul(a), promete_aprovacao: noul(b), inventa_dado: noul(c) })!;
const vazias = () => criarEvidenciasDoTurno(ORG);
const local = (rascunho: string) => conferirLocalmente({ rascunho, evidencias: vazias() });

describe("o rótulo de cada lado, no mesmo vocabulário", () => {
  it("Jev: a pergunta mais provável de 0,50 em diante; abaixo, ok", () => {
    expect(rotuloDoJev(jev(0.9, 0.1, 0.2))).toBe("sem_fonte");
    expect(rotuloDoJev(jev(0.1, 0.5, 0.2))).toBe("promete_aprovacao");
    expect(rotuloDoJev(jev(0.1, 0.2, 0.7))).toBe("inventa_dado");
    expect(rotuloDoJev(jev(0.49, 0.1, 0.2))).toBe("ok");
  });

  it("regras da casa: a pergunta da família do achado; nenhum achado = ok", () => {
    expect(rotuloDasRegrasLocais(local("Custa R$ 250,00."))).toBe("sem_fonte");
    expect(rotuloDasRegrasLocais(local("Fica pronto em 2 dias."))).toBe("sem_fonte");
    expect(rotuloDasRegrasLocais(local("O crédito está aprovado."))).toBe("promete_aprovacao");
    expect(rotuloDasRegrasLocais(local("Temos em estoque."))).toBe("inventa_dado");
    expect(rotuloDasRegrasLocais(local("Oi! Como posso ajudar?"))).toBe("ok");
  });

  it("senha e documento não têm pergunta do Jev: não viram rótulo", () => {
    const e = vazias();
    e.guardarSenhaDoCliente("987654", ORG);
    const l = conferirLocalmente({ rascunho: "Usei 987654 para abrir.", evidencias: e });
    expect(l.achados.map((a) => a.regra)).toEqual(["L4"]);
    expect(rotuloDasRegrasLocais(l)).toBe("ok");
  });
});

describe("o custo: o modelo fixo TEM preço (a soma do mês nunca perde esta chamada)", () => {
  it("jev-1.13.0 está na tabela de preços, e o custo de uma chamada normal NÃO é nulo", () => {
    expect(precoDoModelo(MODELO_DO_JEV)).toBeDefined();
    const custo = custoDaChamada(MODELO_DO_JEV, { tokensDeEntrada: 2_500, tokensDeSaida: 0 });
    expect(custo).not.toBeNull();
    // US$ 0,042 por milhão de entrada = 4,2 centavos de dólar por milhão → 2.500 tokens = 0,0105 centavo.
    expect(custo).toBeCloseTo(0.0105, 6);
  });

  it("saída é grátis: o custo só depende da entrada", () => {
    const a = custoDaChamada(MODELO_DO_JEV, { tokensDeEntrada: 1_000, tokensDeSaida: 0 });
    const b = custoDaChamada(MODELO_DO_JEV, { tokensDeEntrada: 1_000, tokensDeSaida: 9_999 });
    expect(b).toBe(a);
  });

  it("CASO QUE ESTE TESTE EXISTE PARA REPROVAR: id de modelo sem preço grava custo vazio — e some do teto em silêncio", () => {
    // Quem subir o MODELO_DO_JEV sem pôr a linha em pricing.ts quebra aqui, e não em produção.
    expect(costCents("jev-9.99.9", { inputTokens: 1_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
    expect(custoDaChamada("jev-latest", { tokensDeEntrada: 1_000, tokensDeSaida: 0 })).toBeNull();
    expect(custoDaChamada(MODELO_DO_JEV, { tokensDeEntrada: 1_000, tokensDeSaida: 0 })).not.toBeNull();
  });
});

function registroDe(extra: Partial<RegistroDaConferencia> = {}): RegistroDaConferencia {
  return {
    organizationId: ORG,
    estado: "observando",
    conversationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    messageId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    jobId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    contactId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    agentId: "99999999-9999-4999-8999-999999999999",
    veredito: juntarOsAchados(local("Oi! Como posso ajudar?"), jev(0.7, 0.1, 0.1)),
    uso: { tokensDeEntrada: 2_500, tokensDeSaida: 3 },
    modelo: MODELO_DO_JEV,
    latenciaMs: 410,
    ...extra,
  };
}

function poolQueGrava() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  return { pool: { query } as unknown as pg.Pool, query };
}

describe("registrarConferenciaDoJev", () => {
  it("UM comando por chamada: a observação (CTE) e a linha de custo de finalidade jev_depois", async () => {
    const { pool, query } = poolQueGrava();
    await registrarConferenciaDoJev(pool, registroDe());
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("insert into public.jev_observacoes");
    expect(sql).toContain("insert into public.llm_calls");
    // Idempotente: o retry do job e a 2ª chamada da reescrita não duplicam a observação.
    expect(sql).toContain("on conflict (organization_id, tarefa, message_id) where message_id is not null do nothing");
    expect(params).toEqual([
      ORG, // $1 organização — a do turno, nunca de outra
      "conferencia", // $2 tarefa
      "observando", // $3 estado
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      "sem_fonte", // $7 rótulo do Jev
      0.7, // $8 a maior probabilidade
      "ok", // $9 rótulo das regras da casa
      MODELO_DO_JEV,
      410,
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      "99999999-9999-4999-8999-999999999999",
      "jev_depois", // $14 finalidade
      `typesafe/${MODELO_DO_JEV}`,
      2_500,
      3,
      custoDaChamada(MODELO_DO_JEV, { tokensDeEntrada: 2_500, tokensDeSaida: 3 }),
      "jev_observacao", // $19 observando só registra
    ]);
  });

  it("decidindo, a origem da escolha é o Jev", async () => {
    const { pool, query } = poolQueGrava();
    await registrarConferenciaDoJev(pool, registroDe({ estado: "decidindo" }));
    const params = (query.mock.calls[0] as [string, unknown[]])[1];
    expect(params[2]).toBe("decidindo");
    expect(params[18]).toBe("jev");
  });

  it("sem veredito do Jev (queda, ilegível) não há observação: rótulo e probabilidade nulos", async () => {
    const { pool, query } = poolQueGrava();
    await registrarConferenciaDoJev(pool, registroDe({ veredito: juntarOsAchados(local("Custa R$ 250,00."), null) }));
    const params = (query.mock.calls[0] as [string, unknown[]])[1];
    expect(params[6]).toBeNull();
    expect(params[7]).toBeNull();
    expect(params[8]).toBe("sem_fonte");
  });

  it("não leva texto de cliente nem de rascunho: nenhum parâmetro tem frase", async () => {
    const { pool, query } = poolQueGrava();
    const rascunho = "Olá Maria, o seu aparelho custa R$ 250,00 e a senha 4321.";
    await registrarConferenciaDoJev(pool, registroDe({ veredito: juntarOsAchados(local(rascunho), jev(0.7, 0, 0)) }));
    const params = (query.mock.calls[0] as [string, unknown[]])[1];
    expect(JSON.stringify(params)).not.toMatch(/Maria|aparelho|4321|R\$/);
  });

  it("uma segunda chamada da mesma mensagem (a reescrita) grava a PRÓPRIA linha de custo: dois comandos, mesma chave de observação", async () => {
    const { pool, query } = poolQueGrava();
    await registrarConferenciaDoJev(pool, registroDe());
    await registrarConferenciaDoJev(pool, registroDe({ uso: { tokensDeEntrada: 2_600, tokensDeSaida: 3 } }));
    expect(query).toHaveBeenCalledTimes(2);
    const [a, b] = query.mock.calls.map((c) => (c as [string, unknown[]])[1]);
    expect(a![4]).toBe(b![4]);
    expect(a![15]).not.toBe(b![15]);
  });

  it("falha de banco não lança (telemetria não derruba atendimento)", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("conexão caiu")) } as unknown as pg.Pool;
    await expect(registrarConferenciaDoJev(pool, registroDe())).resolves.toBeUndefined();
  });
});
