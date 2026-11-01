/**
 * O INTERRUPTOR DO JEV: ler nunca lança e falha DESLIGADO; gravar não apaga o
 * resto de `settings` e só alcança a própria organização.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  aceiteCobre,
  ALCANCES,
  gravarConfigDoJev,
  idDaTarefaSchema,
  lerConfigDoJev,
  mesclar,
  VERSAO_DO_ACEITE_DE_RESPOSTA,
  type MudancaDaConfig,
  type TarefaGravada,
} from "@/lib/ai/decisao/config";

const ORG = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const ACEITE = { em: "2026-09-23T12:00:00.000Z", por: ADMIN };

describe("lerConfigDoJev", () => {
  it("sem nada gravado, desligado em observação", () => {
    expect(lerConfigDoJev({})).toEqual({ ligado: false, modo: "observacao", aceite: null });
    expect(lerConfigDoJev(null)).toEqual({ ligado: false, modo: "observacao", aceite: null });
  });

  it("lê o que foi gravado", () => {
    const c = lerConfigDoJev({ jev: { ligado: true, modo: "decide", aceite: ACEITE } });
    expect(c.ligado).toBe(true);
    expect(c.modo).toBe("decide");
  });

  it.each([
    ["modo desconhecido", { ligado: true, modo: "turbo", aceite: ACEITE }],
    ["ligado não-booleano", { ligado: "sim", aceite: ACEITE }],
    ["aceite torto", { ligado: true, aceite: { em: "ontem", por: "eu" } }],
    ["jev não é objeto", "ligado"],
    // LGPD: ligar manda a mensagem do cliente para fora do país. Sem o aceite
    // do administrador, o JSON não liga nada — mesmo que diga `ligado: true`.
    ["ligado sem aceite", { ligado: true }],
    // Não é "uma tarefa ruim": o contêiner delas nem é objeto (ver `./config.ts`).
    ["tarefas não é objeto", { ligado: true, aceite: ACEITE, tarefas: "clima" }],
    ["tarefas é lista", { ligado: true, aceite: ACEITE, tarefas: [{ estado: "decidindo" }] }],
  ])("%s → desligado, sem lançar", (_caso, jev) => {
    expect(lerConfigDoJev({ jev }).ligado).toBe(false);
  });
});

type Linha = { settings: Record<string, unknown> } | null;

function adminFalso(linha: Linha, gravaLinhas = true) {
  const filtros: Array<[string, unknown]> = [];
  const updates: Array<Record<string, unknown>> = [];
  const admin = {
    from: (tabela: string) => {
      expect(tabela).toBe("organizations");
      let op: "select" | "update" = "select";
      const chain = {
        select: () => chain,
        update: (patch: Record<string, unknown>) => {
          op = "update";
          updates.push(patch);
          return chain;
        },
        eq: (coluna: string, valor: unknown) => {
          filtros.push([coluna, valor]);
          return chain;
        },
        maybeSingle: async () =>
          op === "update"
            ? { data: gravaLinhas ? { settings: updates.at(-1)?.settings } : null, error: null }
            : { data: linha, error: null },
      };
      return chain;
    },
  };
  return { admin: admin as unknown as Parameters<typeof gravarConfigDoJev>[0]["admin"], filtros, updates };
}

describe("gravarConfigDoJev", () => {
  it("mescla sem apagar as outras chaves de settings", async () => {
    const f = adminFalso({ settings: { branding: { nome: "X" }, llm: { provider: "anthropic" } } });
    const r = await gravarConfigDoJev({
      admin: f.admin,
      orgId: ORG,
      actorUserId: ADMIN,
      mudanca: { ligado: true, aceite: ACEITE },
      agora: new Date("2026-09-23T13:00:00.000Z"),
    });

    expect(r.ok).toBe(true);
    const gravado = f.updates[0]!.settings as Record<string, unknown>;
    expect(gravado.branding).toEqual({ nome: "X" });
    expect(gravado.llm).toEqual({ provider: "anthropic" });
    expect(gravado.jev).toMatchObject({
      ligado: true,
      modo: "observacao",
      aceite: ACEITE,
      alterado_em: "2026-09-23T13:00:00.000Z",
      alterado_por: ADMIN,
    });
  });

  it("toda leitura e escrita é cercada pela organização da sessão", async () => {
    const f = adminFalso({ settings: {} });
    await gravarConfigDoJev({ admin: f.admin, orgId: ORG, actorUserId: ADMIN, mudanca: { modo: "decide" } });
    expect(f.filtros).toEqual([
      ["id", ORG],
      ["id", ORG],
    ]);
  });

  it("recusa ligar sem aceite, e não grava nada", async () => {
    const f = adminFalso({ settings: {} });
    const r = await gravarConfigDoJev({ admin: f.admin, orgId: ORG, actorUserId: ADMIN, mudanca: { ligado: true } });
    expect(r).toEqual({ ok: false, motivo: "config_invalida" });
    expect(f.updates).toEqual([]);
  });

  it("zero linha gravada não vira sucesso", async () => {
    const f = adminFalso({ settings: {} }, false);
    const r = await gravarConfigDoJev({ admin: f.admin, orgId: ORG, actorUserId: ADMIN, mudanca: { modo: "decide" } });
    expect(r).toEqual({ ok: false, motivo: "escrita_recusada" });
  });

  it("organização inexistente não é criada", async () => {
    const f = adminFalso(null);
    const r = await gravarConfigDoJev({ admin: f.admin, orgId: ORG, actorUserId: ADMIN, mudanca: { modo: "decide" } });
    expect(r).toEqual({ ok: false, motivo: "leitura_falhou" });
    expect(f.updates).toEqual([]);
  });
});

describe("lerConfigDoJev — por tarefa", () => {
  const LIGADO = { ligado: true, modo: "decide", aceite: ACEITE };
  const GRAVADA = { estado: "decidindo", alterado_em: "2026-09-24T10:00:00.000Z", alterado_por: ADMIN };
  const LIXO = [
    ["estado desconhecido", { estado: "turbo" }],
    ["carimbo torto", { estado: "decidindo", alterado_por: "eu" }],
    ["tarefa não é objeto", "decidindo"],
    ["tarefa nula", null],
  ] as const;

  /**
   * Para CADA chave, e com as outras gravadas: o valor ruim desliga só ela.
   * Sem o `.catch` de uma chave, a config inteira cai no desligado — medido
   * trocando o do clima por `.optional()`: este caso fica vermelho. Na segunda
   * tarefa, as outras passam a existir e o "as outras intactas" passa a pesar
   * sem ninguém editar o caso.
   */
  it.each(idDaTarefaSchema.options.flatMap((id) => LIXO.map(([caso, lixo]) => [id, caso, lixo] as const)))(
    "%s com %s: só ela cai (desligada), o interruptor, o `modo` e as outras ficam de pé",
    (id, _caso, lixo) => {
      const outras = Object.fromEntries(idDaTarefaSchema.options.filter((o) => o !== id).map((o) => [o, GRAVADA]));
      const c = lerConfigDoJev({ jev: { ...LIGADO, tarefas: { ...outras, [id]: lixo } } });
      expect(c.ligado).toBe(true);
      expect(c.modo).toBe("decide");
      expect(c.aceite).toEqual(ACEITE);
      expect(c.tarefas).toEqual({ ...outras, [id]: { estado: "desligada" } });
    },
  );

  it("a tarefa ruim não leva a boa junto: chave de versão mais nova é descartada, o clima fica", () => {
    const c = lerConfigDoJev({
      jev: { ...LIGADO, tarefas: { clima: { estado: "observando" }, futura: { estado: "decidindo" } } },
    });
    expect(c.tarefas).toEqual({ clima: { estado: "observando" } });
  });

  it("o aceite da onda 1 (sem alcance nem versão) continua valendo", () => {
    expect(lerConfigDoJev({ jev: LIGADO }).aceite).toEqual(ACEITE);
    expect(lerConfigDoJev({ jev: { ...LIGADO, aceite: { ...ACEITE, alcance: "mensagem", versao: 1 } } }).ligado).toBe(
      true,
    );
  });
});

describe("gravarConfigDoJev — mescla profunda de `tarefas`", () => {
  const GRAVADA = { estado: "decidindo", alterado_em: "2026-09-24T10:00:00.000Z", alterado_por: ADMIN };
  const AGORA = new Date("2026-09-25T13:00:00.000Z");

  it("mudar o interruptor não apaga o estado de nenhuma tarefa", async () => {
    const f = adminFalso({ settings: { jev: { ligado: true, modo: "decide", aceite: ACEITE, tarefas: { clima: GRAVADA } } } });
    const r = await gravarConfigDoJev({ admin: f.admin, orgId: ORG, actorUserId: ADMIN, mudanca: { ligado: false }, agora: AGORA });
    expect(r.ok).toBe(true);
    const jev = (f.updates[0]!.settings as { jev: Record<string, unknown> }).jev;
    expect(jev.ligado).toBe(false);
    expect(jev.tarefas).toEqual({ clima: GRAVADA });
  });

  it("mudar uma tarefa carimba só ela, e o clima espelha no `modo` (o que a imagem anterior lê)", async () => {
    const f = adminFalso({ settings: { jev: { ligado: true, modo: "observacao", aceite: ACEITE } } });
    await gravarConfigDoJev({
      admin: f.admin,
      orgId: ORG,
      actorUserId: ADMIN,
      mudanca: { tarefas: { clima: "decidindo" } },
      agora: AGORA,
    });
    const jev = (f.updates[0]!.settings as { jev: Record<string, unknown> }).jev;
    expect(jev.modo).toBe("decide");
    expect(jev.tarefas).toEqual({
      clima: { estado: "decidindo", alterado_em: AGORA.toISOString(), alterado_por: ADMIN },
    });
  });

  it("o `modo` da onda 1 também grava a tarefa do clima", async () => {
    const f = adminFalso({ settings: { jev: { ligado: true, modo: "decide", aceite: ACEITE, tarefas: { clima: GRAVADA } } } });
    await gravarConfigDoJev({ admin: f.admin, orgId: ORG, actorUserId: ADMIN, mudanca: { modo: "observacao" }, agora: AGORA });
    const jev = (f.updates[0]!.settings as { jev: Record<string, unknown> }).jev;
    expect(jev.modo).toBe("observacao");
    expect(jev.tarefas).toMatchObject({ clima: { estado: "observando" } });
  });

  it("desligar só o clima não inventa um `modo`: a imagem anterior segue com o de antes", async () => {
    const f = adminFalso({ settings: { jev: { ligado: true, modo: "decide", aceite: ACEITE } } });
    await gravarConfigDoJev({ admin: f.admin, orgId: ORG, actorUserId: ADMIN, mudanca: { tarefas: { clima: "desligada" } } });
    const jev = (f.updates[0]!.settings as { jev: Record<string, unknown> }).jev;
    expect(jev.modo).toBe("decide");
    expect(jev.tarefas).toMatchObject({ clima: { estado: "desligada" } });
  });

  /**
   * Com só o clima não há par de tarefas no schema, e mesclar raso passaria em
   * todos os casos acima: o `...atual` já devolve `tarefas` quando nenhuma é
   * escrita. A mescla em si (`mesclar`, antes do schema) se prova aqui com uma
   * segunda tarefa que só existe no teste — a trava do achado: trocar a cópia
   * de `atual.tarefas` por `{}` reprova este caso.
   */
  it("mudar uma tarefa nunca apaga outra (a mescla, com uma segunda tarefa de mentira)", () => {
    const gravada: TarefaGravada = { estado: "desligada", alterado_em: "2026-09-24T10:00:00.000Z", alterado_por: ADMIN };
    const tarefas = { clima: gravada, segunda: gravada };
    const atual = { ...lerConfigDoJev({ jev: { ligado: true, modo: "decide", aceite: ACEITE } }), tarefas };
    const proxima = mesclar(atual, { tarefas: { clima: "observando" } }, { em: AGORA.toISOString(), por: ADMIN });
    expect(proxima).toMatchObject({
      modo: "observacao",
      tarefas: { clima: { estado: "observando", alterado_em: AGORA.toISOString() }, segunda: gravada },
    });
  });

  /**
   * O mesmo, pelo caminho inteiro (schema e banco): PULADO — não verde — até a
   * segunda tarefa existir; aí ele passa a valer sem ninguém editá-lo.
   */
  const pares = idDaTarefaSchema.options.flatMap((a) =>
    idDaTarefaSchema.options.filter((b) => b !== a).map((b) => [a, b] as const),
  );
  it.skipIf(pares.length === 0)("mudar uma tarefa nunca apaga outra", async () => {
    for (const [mudada, outra] of pares) {
      const f = adminFalso({
        settings: { jev: { ligado: true, aceite: ACEITE, tarefas: { [outra]: GRAVADA } } },
      });
      await gravarConfigDoJev({
        admin: f.admin,
        orgId: ORG,
        actorUserId: ADMIN,
        mudanca: { tarefas: { [mudada]: "observando" } },
        agora: AGORA,
      });
      const jev = (f.updates[0]!.settings as { jev: { tarefas: Record<string, unknown> } }).jev;
      expect(jev.tarefas[outra], `mudar ${mudada} apagou ${outra}`).toEqual(GRAVADA);
    }
  });

  it("a tarefa de uma versão mais nova sobrevive à escrita desta (o rollback que mexe no Jev)", async () => {
    const DA_VERSAO_NOVA = { estado: "desligada", campo_novo: 1 };
    const casos: Array<[MudancaDaConfig, string]> = [
      [{ ligado: false }, "decidindo"],
      [{ tarefas: { clima: "observando" } }, "observando"],
    ];
    for (const [mudanca, clima] of casos) {
      const f = adminFalso({
        settings: { jev: { ligado: true, modo: "decide", aceite: ACEITE, tarefas: { clima: GRAVADA, futura: DA_VERSAO_NOVA } } },
      });
      const r = await gravarConfigDoJev({ admin: f.admin, orgId: ORG, actorUserId: ADMIN, mudanca, agora: AGORA });
      expect(r.ok).toBe(true);
      const jev = (f.updates[0]!.settings as { jev: { tarefas: Record<string, unknown> } }).jev;
      expect(jev.tarefas.futura, `${JSON.stringify(mudanca)} apagou a tarefa da versão nova`).toEqual(DA_VERSAO_NOVA);
      expect(jev.tarefas.clima).toMatchObject({ estado: clima });
    }
  });

  it("nada de tarefa gravada, nada de `tarefas` escrito", async () => {
    const f = adminFalso({ settings: {} });
    await gravarConfigDoJev({ admin: f.admin, orgId: ORG, actorUserId: ADMIN, mudanca: { ligado: true, aceite: ACEITE } });
    expect((f.updates[0]!.settings as { jev: Record<string, unknown> }).jev).not.toHaveProperty("tarefas");
  });
});

/**
 * O ACEITE DE `resposta` (T01 da r3): o rascunho da IA e os trechos consultados,
 * sem a mensagem do cliente. Outro tipo de dado para o fornecedor ⇒ outro aceite,
 * com a versão nova do texto, por cima do de `mensagem`.
 */
describe("o alcance `resposta` e o aceite novo", () => {
  const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
  const DE_MENSAGEM = { ...ACEITE, alcance: "mensagem" as const };
  const DE_RESPOSTA = { em: "2026-11-01T12:00:00.000Z", por: ADMIN, alcance: "resposta" as const, versao: 2 };

  it("`resposta` fica entre `mensagem` e `conversa`, e o texto novo é a versão 2", () => {
    expect([...ALCANCES]).toEqual(["mensagem", "resposta", "conversa"]);
    expect(VERSAO_DO_ACEITE_DE_RESPOSTA).toBe(2);
  });

  it("o aceite de `resposta` com a versão nova é lido como está", () => {
    const c = lerConfigDoJev({ jev: { ligado: true, aceite: DE_RESPOSTA } });
    expect(c.ligado).toBe(true);
    expect(c.aceite).toEqual(DE_RESPOSTA);
  });

  it.each([
    ["sem versão", { ...ACEITE, alcance: "resposta" }],
    ["com a versão do texto antigo (1)", { ...ACEITE, alcance: "resposta", versao: 1 }],
  ])(
    "aceite de `resposta` %s não é aceite: a config inteira cai no desligado",
    (_caso, aceite) => {
      // Sem esta cerca, bastaria o JSON dizer `alcance: "resposta"` para passar por um
      // aceite que o administrador nunca deu ao texto novo.
      expect(lerConfigDoJev({ jev: { ligado: true, aceite } }).ligado).toBe(false);
    },
  );

  it("o aceite da onda 1 e o de `mensagem` seguem valendo, sem versão nova", () => {
    expect(lerConfigDoJev({ jev: { ligado: true, aceite: ACEITE } }).ligado).toBe(true);
    expect(lerConfigDoJev({ jev: { ligado: true, aceite: DE_MENSAGEM } }).ligado).toBe(true);
  });

  it("aceiteCobre: o alcance mais largo cobre o mais estreito, e nunca o contrário", () => {
    const cobre = (aceite: Parameters<typeof aceiteCobre>[0]) => ALCANCES.map((a) => aceiteCobre(aceite, a));
    expect(cobre(null), "sem aceite, nada").toEqual([false, false, false]);
    expect(cobre(ACEITE), "a onda 1 é só `mensagem`").toEqual([true, false, false]);
    expect(cobre(DE_MENSAGEM)).toEqual([true, false, false]);
    expect(cobre(DE_RESPOSTA)).toEqual([true, true, false]);
    expect(cobre({ ...ACEITE, alcance: "conversa", versao: 3 })).toEqual([true, true, true]);
  });

  it("gravar o aceite de `resposta` mantém o resto: ligado, tarefas e as outras chaves de settings", async () => {
    const GRAVADA = { estado: "observando", alterado_em: "2026-09-24T10:00:00.000Z", alterado_por: ADMIN };
    const f = adminFalso({
      settings: { branding: { nome: "X" }, jev: { ligado: true, modo: "observacao", aceite: DE_MENSAGEM, tarefas: { clima: GRAVADA } } },
    });
    const r = await gravarConfigDoJev({
      admin: f.admin,
      orgId: ORG,
      actorUserId: ADMIN,
      mudanca: { aceite: DE_RESPOSTA },
      agora: new Date("2026-11-01T12:00:00.000Z"),
    });
    expect(r.ok).toBe(true);
    const gravado = f.updates[0]!.settings as { branding: unknown; jev: Record<string, unknown> };
    expect(gravado.branding).toEqual({ nome: "X" });
    expect(gravado.jev).toMatchObject({ ligado: true, aceite: DE_RESPOSTA, tarefas: { clima: GRAVADA } });
    expect(f.filtros, "toda leitura e escrita é cercada pela organização").toEqual([
      ["id", ORG],
      ["id", ORG],
    ]);
  });

  it("gravar um aceite de `resposta` sem a versão nova é recusado, e não grava nada", async () => {
    const f = adminFalso({ settings: { jev: { ligado: true, aceite: DE_MENSAGEM } } });
    const r = await gravarConfigDoJev({
      admin: f.admin,
      orgId: ORG,
      actorUserId: ADMIN,
      mudanca: { aceite: { ...ACEITE, alcance: "resposta" } },
    });
    expect(r).toEqual({ ok: false, motivo: "config_invalida" });
    expect(f.updates).toEqual([]);
  });

  /** Duas empresas no mesmo banco: o aceite de uma nunca chega à outra. */
  it("isolamento: o aceite de `resposta` da empresa A não muda a empresa B", async () => {
    const linhas: Record<string, { settings: Record<string, unknown> }> = {
      [ORG]: { settings: { jev: { ligado: true, aceite: DE_MENSAGEM } } },
      [OUTRA_ORG]: { settings: { jev: { ligado: true, aceite: DE_MENSAGEM } } },
    };
    const deB = structuredClone(linhas[OUTRA_ORG]);
    // Um banco com as duas linhas: o `update` só alcança a linha que o `eq("id", …)` nomeia.
    const admin = {
      from: () => {
        let escrita: { settings: Record<string, unknown> } | null = null;
        let alvo: string | null = null;
        const chain = {
          select: () => chain,
          update: (patch: { settings: Record<string, unknown> }) => {
            escrita = patch;
            return chain;
          },
          eq: (_coluna: string, id: string) => {
            alvo = id;
            if (escrita !== null && linhas[id]) linhas[id] = { settings: escrita.settings };
            return chain;
          },
          maybeSingle: async () => ({ data: alvo === null ? null : (linhas[alvo] ?? null), error: null }),
        };
        return chain;
      },
    } as unknown as Parameters<typeof gravarConfigDoJev>[0]["admin"];

    const r = await gravarConfigDoJev({ admin, orgId: ORG, actorUserId: ADMIN, mudanca: { aceite: DE_RESPOSTA } });
    expect(r.ok).toBe(true);
    expect(lerConfigDoJev(linhas[ORG]!.settings).aceite).toEqual(DE_RESPOSTA);
    expect(linhas[OUTRA_ORG], "a empresa B ficou exatamente como estava").toEqual(deB);
    expect(aceiteCobre(lerConfigDoJev(linhas[OUTRA_ORG]!.settings).aceite, "resposta")).toBe(false);
  });
});

/**
 * O ROLLBACK: o `agent.sh` volta a imagem, nunca o banco. A imagem da onda 1
 * lê o que esta grava — com o schema DELA, congelado aqui como estava na
 * v1.48 (`git show aaf1b3bce:lib/ai/decisao/config.ts`). É cópia de propósito:
 * o que se prova é a convivência com o código que já está nas VPS, que não
 * muda quando este muda.
 */
const schemaDaOnda1 = z
  .object({
    ligado: z.boolean().default(false),
    modo: z.enum(["observacao", "decide"]).default("observacao"),
    aceite: z.object({ em: z.string().datetime(), por: z.string().uuid() }).nullable().default(null),
    alterado_em: z.string().datetime().optional(),
    alterado_por: z.string().uuid().optional(),
  })
  .refine((c) => !c.ligado || c.aceite !== null);

describe("rollback para a imagem da onda 1", () => {
  it("a imagem anterior lê o que esta grava: ligada, no mesmo `modo`, sem erro", async () => {
    const f = adminFalso({ settings: {} });
    await gravarConfigDoJev({
      admin: f.admin,
      orgId: ORG,
      actorUserId: ADMIN,
      mudanca: { ligado: true, aceite: { ...ACEITE, alcance: "mensagem" }, tarefas: { clima: "decidindo" } },
    });
    const gravado = (f.updates[0]!.settings as { jev: unknown }).jev;
    const naImagemVelha = schemaDaOnda1.safeParse(gravado);
    expect(naImagemVelha.success).toBe(true);
    expect(naImagemVelha.data).toMatchObject({ ligado: true, modo: "decide", aceite: ACEITE });
    // O que ela não conhece, ela descarta — não recusa.
    expect(naImagemVelha.data).not.toHaveProperty("tarefas");
  });

  it("o primeiro clique na imagem velha apaga `tarefas`; de volta nesta, o clima vale o `modo` que ela gravou", () => {
    const antes = { ligado: true, modo: "decide", aceite: ACEITE, tarefas: { clima: { estado: "decidindo" } } };
    // A gravação da onda 1: lê com o schema dela e espalha a mudança por cima.
    const peloCartaoVelho = { ...schemaDaOnda1.parse(antes), modo: "observacao" };
    const c = lerConfigDoJev({ jev: peloCartaoVelho });
    expect(c.tarefas).toBeUndefined();
    expect(c.modo).toBe("observacao");
    expect(c.ligado).toBe(true);
  });
});
