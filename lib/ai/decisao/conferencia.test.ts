/**
 * A conferência do "depois" perguntada ao Jev (T09): as três perguntas, o `state`
 * sem nenhum campo proibido, os cortes, a junção em que o Jev só aperta, e a
 * chamada com `fetchImpl` simulado (nunca o Jev real).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { criarEvidenciasDoTurno } from "@/lib/agent-engine/agent/evidencias-do-turno";
import { conferirLocalmente } from "@/lib/agent-engine/guardrails/conferencia-local";

const banco = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  chamadas: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      banco.chamadas.push(tabela);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "order", "limit"]) chain[m] = () => chain;
      chain.maybeSingle = async () =>
        tabela === "organizations"
          ? { data: { settings: banco.settings }, error: null }
          : { data: { api_key_encrypted: "c", api_key_iv: "i", api_key_tag: "t" }, error: null };
      return chain;
    },
  }),
}));
vi.mock("@/lib/crypto/aes_gcm", () => ({ byteaToBuffer: (v: unknown) => v, decryptKey: () => "apikey_de_teste" }));
vi.mock("@/lib/logger", () => ({ logger: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined } }));

import { env } from "@/lib/env";

import { MODELO_DO_JEV, type Resposta } from "./cliente";
import {
  conferirOMeuRascunho,
  CORTES_DO_DEPOIS,
  faixaDaProbabilidade,
  juntarOsAchados,
  montarEstadoDaConferencia,
  PERGUNTAS,
  PERGUNTAS_DA_CONFERENCIA,
  perguntarAoJev,
  RASCUNHO_NO_MAXIMO,
  veredictoDasRespostas,
} from "./conferencia";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POR = "22222222-2222-4222-8222-222222222222";
const escrevivel = env as unknown as Record<string, unknown>;

const noul = (n: number): Resposta => ({ tipo: "noul", noul: n });
const respostas = (a: number, b: number, c: number) => ({ sem_fonte: noul(a), promete_aprovacao: noul(b), inventa_dado: noul(c) });

function corpoDaApi(a: number, b: number, c: number) {
  const r = (n: number) => ({ type: "noul", noul: n });
  return {
    model: MODELO_DO_JEV,
    answers: { sem_fonte: r(a), promete_aprovacao: r(b), inventa_dado: r(c) },
    usage: { input_tokens: 800, output_tokens: 0 },
  };
}
const ok = (corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });

function ligarTudo() {
  escrevivel.JEV_CONFERENCIA_ENABLED = true;
  banco.settings = {
    jev: {
      ligado: true,
      aceite: { em: "2026-11-01T12:00:00.000Z", por: POR, alcance: "resposta", versao: 2 },
      tarefas: { conferencia: { estado: "observando" } },
    },
  };
}

beforeEach(() => {
  banco.settings = null;
  banco.chamadas.length = 0;
  escrevivel.JEV_CONFERENCIA_ENABLED = false;
});

describe("as perguntas", () => {
  it("são três, todas sim/não, com os nomes da spec, e a resposta é a probabilidade de haver problema", () => {
    expect([...PERGUNTAS_DA_CONFERENCIA]).toEqual(["sem_fonte", "promete_aprovacao", "inventa_dado"]);
    for (const nome of PERGUNTAS_DA_CONFERENCIA) {
      expect(PERGUNTAS[nome].tipo).toBe("noul");
      expect(PERGUNTAS[nome].instrucao.endsWith("?")).toBe(true);
    }
    expect(PERGUNTAS.sem_fonte.instrucao).toContain("preço, um prazo ou uma garantia");
    expect(PERGUNTAS.promete_aprovacao.instrucao).toContain("aprovação de crédito, financiamento ou boleto");
    expect(PERGUNTAS.inventa_dado.instrucao).toContain("estoque, loja ou regra");
  });

  it("o modelo é o fixo jev-1.13.0 (D8)", () => {
    expect(MODELO_DO_JEV).toBe("jev-1.13.0");
  });
});

describe("o state: só { resposta_da_ia, evidencias }, já mascarado", () => {
  const SEGREDOS = {
    cliente: "Quero trocar a tela do meu celular, sou a Maria Souza, cpf 123.456.789-09",
    nome: "Maria",
    sobrenome: "Souza",
    telefone: "(11) 98765-4321",
    email: "maria.souza@gmail.com",
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    senha: "4321",
    documento: "Laudo técnico do aparelho com oxidação severa na placa principal",
  };

  function turnoComSegredos() {
    const e = criarEvidenciasDoTurno(ORG);
    e.registrar(
      "base_de_conhecimento",
      [{ fonte: "Tabela", texto: "Troca de tela: R$ 250,00. Atendemos de segunda a sexta." }],
      ORG,
    );
    e.guardarSenhaDoCliente(SEGREDOS.senha, ORG);
    e.guardarDocumentoDoCliente(SEGREDOS.documento, ORG);
    return e;
  }

  it("só as duas chaves, e as evidências são uma lista de textos", () => {
    const estado = montarEstadoDaConferencia({
      rascunho: "A troca de tela custa R$ 250,00.",
      evidencias: turnoComSegredos(),
      nomeDoContato: "Maria Souza",
    });
    expect(Object.keys(estado).sort()).toEqual(["evidencias", "resposta_da_ia"]);
    expect(estado.evidencias).toEqual(["Tabela: Troca de tela: R$ 250,00. Atendemos de segunda a sexta."]);
  });

  it("NENHUM campo proibido entra: mensagem do cliente, nome, telefone, e-mail, id, empresa, senha, documento", () => {
    const rascunho =
      `Olá Maria Souza! Anotei o telefone ${SEGREDOS.telefone}, o e-mail ${SEGREDOS.email}, a senha ${SEGREDOS.senha} ` +
      `e o usuário ${SEGREDOS.id}. Moro na Rua das Flores, 12.`;
    const e = turnoComSegredos();
    e.registrar("bling", [{ fonte: "clientes", texto: `nome: Maria Souza; telefone: ${SEGREDOS.telefone}` }], ORG);
    const estado = montarEstadoDaConferencia({ rascunho, evidencias: e, nomeDoContato: "Maria Souza" });
    const enviado = JSON.stringify(estado);
    for (const proibido of [SEGREDOS.nome, SEGREDOS.sobrenome, "98765", SEGREDOS.email, SEGREDOS.senha, "Rua das Flores"]) {
      expect(enviado, proibido).not.toContain(proibido);
    }
    // O documento do cliente e a mensagem do cliente não são entrada da função: não há por onde entrar.
    expect(enviado).not.toContain(SEGREDOS.documento);
    expect(enviado).not.toContain("trocar a tela do meu celular");
    expect(estado.resposta_da_ia).toContain("[NOME]");
    expect(estado.resposta_da_ia).toContain("[SENHA]");
  });

  it("a senha do cofre é apagada mesmo SEM o rótulo 'senha' na frente", () => {
    const estado = montarEstadoDaConferencia({ rascunho: "Usei o 4321 para entrar.", evidencias: turnoComSegredos() });
    expect(estado.resposta_da_ia).toBe("Usei o [SENHA] para entrar.");
  });

  it("o rascunho e as evidências têm teto: o que passa dele é cortado, nunca enviado", () => {
    const e = criarEvidenciasDoTurno(ORG);
    e.registrar("base_de_conhecimento", [{ texto: "x".repeat(30_000) }], ORG);
    const estado = montarEstadoDaConferencia({ rascunho: "y".repeat(10_000), evidencias: e });
    expect(estado.resposta_da_ia).toHaveLength(RASCUNHO_NO_MAXIMO);
    expect(estado.evidencias.join("").length).toBeLessThanOrEqual(24_000);
  });
});

describe("os cortes do DEPOIS (D7)", () => {
  it.each([
    [0.0, "baixa"], [0.49, "baixa"], [0.5, "media"], [0.79, "media"], [0.8, "alta"], [0.99, "alta"], [1, "alta"],
  ] as const)("%s → %s", (p, faixa) => {
    expect(faixaDaProbabilidade(p)).toBe(faixa);
  });

  it("os números são os da spec", () => {
    expect(CORTES_DO_DEPOIS).toEqual({ alta: 0.8, media: 0.5 });
  });

  it("o veredito é a MAIOR das três, e diz qual pergunta pesou", () => {
    const v = veredictoDasRespostas(respostas(0.1, 0.9, 0.3))!;
    expect(v).toMatchObject({ pergunta: "promete_aprovacao", maior: 0.9, faixa: "alta" });
  });

  it("em empate fica a primeira (sem_fonte)", () => {
    expect(veredictoDasRespostas(respostas(0.6, 0.6, 0.6))!.pergunta).toBe("sem_fonte");
  });

  it("qualquer resposta ilegível derruba o veredito inteiro", () => {
    expect(veredictoDasRespostas({ sem_fonte: noul(0.1), promete_aprovacao: noul(0.1) })).toBeNull();
    expect(veredictoDasRespostas({ ...respostas(0.1, 0.1, 0.1), inventa_dado: noul(1.5) })).toBeNull();
    expect(veredictoDasRespostas({ ...respostas(0.1, 0.1, 0.1), inventa_dado: noul(Number.NaN) })).toBeNull();
    expect(
      veredictoDasRespostas({
        ...respostas(0.1, 0.1, 0.1),
        inventa_dado: { tipo: "choice", escolha: "a", probabilidades: {}, confianca: 1 },
      }),
    ).toBeNull();
  });
});

describe("a junção: o Jev SÓ APERTA", () => {
  const evidenciasVazias = criarEvidenciasDoTurno(ORG);
  const comAchado = conferirLocalmente({ rascunho: "O crédito está aprovado.", evidencias: evidenciasVazias });
  const semAchado = conferirLocalmente({ rascunho: "Oi! Como posso ajudar?", evidencias: evidenciasVazias });

  it("sanidade: um tem achado local alto, o outro não", () => {
    expect(comAchado.faixa).toBe("alta");
    expect(semAchado.faixa).toBeNull();
  });

  it.each([
    ["baixa", respostas(0.01, 0.01, 0.01)],
    ["média", respostas(0.6, 0.1, 0.1)],
    ["alta", respostas(0.95, 0.1, 0.1)],
    ["ausente", null],
  ] as const)("achado local + Jev %s: SEGURA, sempre — o achado local nunca vira 'passou'", (_n, r) => {
    const v = juntarOsAchados(comAchado, r === null ? null : veredictoDasRespostas(r));
    expect(v.segurar).toBe(true);
    expect(v.faixa).toBe("alta");
    expect(v.duvida).toBe(false);
    expect(["local", "local_e_jev"]).toContain(v.origem);
  });

  it("sem achado local: Jev alto segura; médio só registra a dúvida; baixo ou ausente libera", () => {
    expect(juntarOsAchados(semAchado, veredictoDasRespostas(respostas(0.9, 0, 0)))).toMatchObject({ segurar: true, origem: "jev", faixa: "alta" });
    expect(juntarOsAchados(semAchado, veredictoDasRespostas(respostas(0.6, 0, 0)))).toMatchObject({ segurar: false, duvida: true, faixa: "media" });
    expect(juntarOsAchados(semAchado, veredictoDasRespostas(respostas(0.1, 0, 0)))).toMatchObject({ segurar: false, duvida: false, faixa: "baixa" });
    expect(juntarOsAchados(semAchado, null)).toMatchObject({ segurar: false, duvida: false, faixa: "baixa", conferidaPeloJev: false });
  });

  it("os dois seguram: a origem diz isso", () => {
    expect(juntarOsAchados(comAchado, veredictoDasRespostas(respostas(0.9, 0, 0)))!.origem).toBe("local_e_jev");
  });

  it("propriedade: para toda probabilidade do Jev, a faixa final nunca é menor que a local", () => {
    for (let p = 0; p <= 1; p += 0.05) {
      const v = juntarOsAchados(comAchado, veredictoDasRespostas(respostas(p, p, p)));
      expect(v.segurar, String(p)).toBe(true);
    }
  });
});

describe("perguntarAoJev (fetchImpl simulado)", () => {
  const evidencias = () => {
    const e = criarEvidenciasDoTurno(ORG);
    e.registrar("base_de_conhecimento", [{ texto: "Troca de tela: R$ 250,00" }], ORG);
    return e;
  };
  const local = (rascunho: string, e = evidencias()) => conferirLocalmente({ rascunho, evidencias: e });

  it("com tudo ligado, manda { resposta_da_ia, evidencias } com as três perguntas e o modelo fixo, e devolve o veredito", async () => {
    ligarTudo();
    const fetchImpl = vi.fn().mockResolvedValue(ok(corpoDaApi(0.1, 0.05, 0.9)));
    const e = evidencias();
    const r = await perguntarAoJev(
      ORG,
      { rascunho: "A troca custa R$ 250,00.", evidencias: e },
      local("A troca custa R$ 250,00.", e),
      { fetchImpl },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.veredito).toMatchObject({ pergunta: "inventa_dado", maior: 0.9, faixa: "alta" });
    expect(r.modelo).toBe(MODELO_DO_JEV);
    expect(r.uso.tokensDeEntrada).toBe(800);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/systemone");
    const corpo = JSON.parse(String(init.body)) as { model: string; state: Record<string, unknown>; questions: Record<string, unknown> };
    expect(corpo.model).toBe("jev-1.13.0");
    expect(Object.keys(corpo.state).sort()).toEqual(["evidencias", "resposta_da_ia"]);
    expect(Object.keys(corpo.questions).sort()).toEqual(["inventa_dado", "promete_aprovacao", "sem_fonte"]);
  });

  it("sem o interruptor da instalação, nada sai", async () => {
    ligarTudo();
    escrevivel.JEV_CONFERENCIA_ENABLED = false;
    const fetchImpl = vi.fn();
    const r = await perguntarAoJev(ORG, { rascunho: "Oi", evidencias: evidencias() }, local("Oi"), { fetchImpl });
    expect(r).toMatchObject({ ok: false, motivo: "sem_credencial" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("com o aceite só de `mensagem`, nada sai (a conferência pede `resposta`)", async () => {
    ligarTudo();
    banco.settings = {
      jev: { ligado: true, aceite: { em: "2026-11-01T12:00:00.000Z", por: POR, alcance: "mensagem" }, tarefas: { conferencia: { estado: "observando" } } },
    };
    const fetchImpl = vi.fn();
    const r = await perguntarAoJev(ORG, { rascunho: "Oi", evidencias: evidencias() }, local("Oi"), { fetchImpl });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rascunho vazio: nada a conferir, nada sai", async () => {
    ligarTudo();
    const fetchImpl = vi.fn();
    expect(await perguntarAoJev(ORG, { rascunho: "  ", evidencias: evidencias() }, local(""), { fetchImpl })).toMatchObject({
      ok: false,
      motivo: "sem_rascunho",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("segredo no rascunho (L4 ou L5): ele já está segurado e NADA sai para o fornecedor", async () => {
    ligarTudo();
    const fetchImpl = vi.fn();
    const e = evidencias();
    e.guardarSenhaDoCliente("987654", ORG);
    const r = await perguntarAoJev(ORG, { rascunho: "Usei 987654 para abrir.", evidencias: e }, local("Usei 987654 para abrir.", e), { fetchImpl });
    expect(r).toMatchObject({ ok: false, motivo: "segredo_no_rascunho" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, "credencial_invalida", true],
    [429, "limite_de_taxa", false],
    [529, "provedor_sobrecarregado", false],
    [500, "provedor_indisponivel", false],
  ] as const)("erro %s da API vira o motivo %s, sem lançar", async (status, motivo, exigeAcao) => {
    ligarTudo();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status }));
    const r = await perguntarAoJev(ORG, { rascunho: "Oi", evidencias: evidencias() }, local("Oi"), { fetchImpl });
    expect(r).toMatchObject({ ok: false, motivo, exigeAcao });
  });

  it("resposta fora do formato vira resposta_ilegivel", async () => {
    ligarTudo();
    const fetchImpl = vi.fn().mockResolvedValue(ok({ model: "jev-1.13.0", answers: { sem_fonte: { type: "noul", noul: 0.1 } }, usage: { input_tokens: 1, output_tokens: 0 } }));
    const r = await perguntarAoJev(ORG, { rascunho: "Oi", evidencias: evidencias() }, local("Oi"), { fetchImpl });
    expect(r.ok).toBe(false);
  });

  it("falha de rede vira provedor_indisponivel", async () => {
    ligarTudo();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("rede caiu"));
    const r = await perguntarAoJev(ORG, { rascunho: "Oi", evidencias: evidencias() }, local("Oi"), { fetchImpl });
    expect(r).toMatchObject({ ok: false, motivo: "provedor_indisponivel" });
  });
});

describe("conferirOMeuRascunho: regras locais + Jev + junção", () => {
  it("achado local segura mesmo com o Jev dizendo 'tudo bem'", async () => {
    ligarTudo();
    const fetchImpl = vi.fn().mockResolvedValue(ok(corpoDaApi(0.01, 0.01, 0.01)));
    const { veredito, pergunta } = await conferirOMeuRascunho(
      ORG,
      { rascunho: "O crédito está aprovado, pode vir!", evidencias: criarEvidenciasDoTurno(ORG) },
      { fetchImpl },
    );
    expect(pergunta.ok).toBe(true);
    expect(veredito.segurar).toBe(true);
    expect(veredito.origem).toBe("local");
  });

  it("Jev fora do ar e nenhuma regra segurou: a resposta passa, 'não conferida'", async () => {
    ligarTudo();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fora do ar"));
    const { veredito } = await conferirOMeuRascunho(
      ORG,
      { rascunho: "Oi! Como posso ajudar?", evidencias: criarEvidenciasDoTurno(ORG) },
      { fetchImpl },
    );
    expect(veredito).toMatchObject({ segurar: false, conferidaPeloJev: false, origem: "nenhuma" });
  });

  it("Jev fora do ar e uma regra segurou: segura (faixa alta com o Jev ausente)", async () => {
    ligarTudo();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fora do ar"));
    const { veredito } = await conferirOMeuRascunho(
      ORG,
      { rascunho: "O boleto está liberado!", evidencias: criarEvidenciasDoTurno(ORG) },
      { fetchImpl },
    );
    expect(veredito).toMatchObject({ segurar: true, origem: "local", conferidaPeloJev: false });
  });
});
