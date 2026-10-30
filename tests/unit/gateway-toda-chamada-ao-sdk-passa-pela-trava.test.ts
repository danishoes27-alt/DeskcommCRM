/**
 * AUDITORIA DA TRAVA CENTRAL DO GATEWAY, EM FORMA DE CERCA.
 *
 * `AI_GATEWAY_PLANO_CONFIRMADO` (lib/ai/gateway.ts) só funciona se NENHUM caminho entregar ao
 * SDK `ai` o nome do modelo como TEXTO (`provedor/modelo`) por fora de `gatewayConfig()`: no SDK,
 * string com barra é roteada pelo AI Gateway da Vercel, que lê `AI_GATEWAY_API_KEY` direto do
 * `process.env` — a trava não é consultada. Esta cerca lê o código-fonte e prende o mapa dos
 * pontos que chamam o SDK: um ponto novo (ou um que mude de forma) reprova aqui, e quem o
 * escreveu precisa dizer, na tabela abaixo, como a trava o cobre.
 *
 * Auditoria feita em 30/10/2026. Cada linha de `PONTOS_AUDITADOS` diz de onde vem o `model`.
 */
import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { arquivosDeCodigo, caminhoRelativo } from "./helpers/varrer-codigo";

/** Funções do SDK `ai` que recebem um modelo. */
const FUNCOES_DO_SDK = new Set([
  "generateText",
  "streamText",
  "generateObject",
  "streamObject",
  "embed",
  "embedMany",
  "experimental_evaluate",
  "rerank",
  "generateImage",
  "experimental_generateImage",
  "generateSpeech",
  "experimental_generateSpeech",
  "transcribe",
  "experimental_transcribe",
  "ToolLoopAgent",
  "Experimental_Agent",
]);

interface Ponto {
  funcoes: string[];
  /** De onde vem o `model` e por que a trava cobre. */
  cobertura: string;
}

const PONTOS_AUDITADOS: Record<string, Ponto> = {
  "workers/ai-response-worker.ts": {
    funcoes: ["generateText"],
    cobertura:
      "`resolverModeloDoPonto` -> objeto de provider; só devolve o id (texto) pelo degrau do Gateway de `resolveLanguageModel`, que exige `gatewayConfig()`.",
  },
  "workers/ai-sentiment-worker.ts": {
    funcoes: ["generateObject"],
    cobertura: "Mesmo caminho do worker de resposta: `resolverModeloDoPonto` -> `resolveLanguageModel` sob `gatewayConfig()`.",
  },
  "workers/media-derive-worker.ts": {
    funcoes: ["generateText"],
    cobertura: "Fábrica do registry BYOK (`providers.ts`): sempre objeto de provider com a chave da empresa; nunca texto.",
  },
  "lib/agent-engine/edge/llm/run-model-call.ts": {
    funcoes: ["generateText"],
    cobertura:
      "Fábrica do registry BYOK (`providers.ts`): sempre objeto de provider; o motor de agentes (worker) fala direto com cada provedor.",
  },
  "lib/ai/runtime/agent.ts": {
    funcoes: ["generateText"],
    cobertura: "`buildModel`: objeto de provider; provedor desconhecido lança `unsupported_provider`.",
  },
  "app/actions/onboarding/montarQuadro.ts": {
    funcoes: ["generateText"],
    cobertura: "`buildModel` (a mesma de `lib/ai/runtime/agent.ts`): objeto de provider com a chave da empresa.",
  },
  "lib/ai/embed.ts": {
    funcoes: ["embed"],
    cobertura:
      "Texto só quando `chave.viaGateway`, que só nasce em `lib/ai/embeddings/chave.ts` dentro de `if (gatewayConfig())`; nos outros casos, provider explícito.",
  },
  "lib/ai/triagem/jev.ts": {
    funcoes: ["experimental_evaluate"],
    cobertura:
      "Texto (`JEV_MODEL_ID`) de propósito. Cobertura em duas camadas: `aplicar.ts` (única chamadora) e a própria `triarMensagem`, que sem `AI_GATEWAY_PLANO_CONFIRMADO` devolve `gateway_nao_confirmado` sem chamar o SDK.",
  },
};

interface Achado {
  funcao: string;
  /** `texto` = o `model` é um literal de texto (proibido); `expressao` = qualquer outra coisa. */
  modelo: "texto" | "expressao" | "ausente";
}

/** Chamadas ao SDK `ai` num arquivo: resolve apelidos (`as`) e `import * as ai`. */
function chamadasAoSdk(texto: string, nomeDoArquivo: string): Achado[] {
  const ast = ts.createSourceFile(
    nomeDoArquivo,
    texto,
    ts.ScriptTarget.Latest,
    true,
    nomeDoArquivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const apelidos = new Map<string, string>(); // nome local -> nome no SDK
  const espacos = new Set<string>(); // `import * as ai from "ai"`
  for (const s of ast.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    if (s.moduleSpecifier.text !== "ai") continue;
    const b = s.importClause?.namedBindings;
    if (b && ts.isNamedImports(b)) {
      for (const el of b.elements) apelidos.set(el.name.text, (el.propertyName ?? el.name).text);
    } else if (b && ts.isNamespaceImport(b)) {
      espacos.add(b.name.text);
    }
  }
  if (apelidos.size === 0 && espacos.size === 0) return [];

  const achados: Achado[] = [];
  const modeloDoPrimeiroArgumento = (args: readonly ts.Expression[] | undefined): Achado["modelo"] => {
    const objeto = args?.[0];
    if (!objeto || !ts.isObjectLiteralExpression(objeto)) return "ausente";
    for (const p of objeto.properties) {
      if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue;
      if (p.name.getText(ast) !== "model") continue;
      if (ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer)) return "texto";
      if (ts.isPropertyAssignment(p) && ts.isTemplateExpression(p.initializer)) return "texto";
      return "expressao";
    }
    return "ausente";
  };
  const visita = (no: ts.Node) => {
    if (ts.isCallExpression(no) || ts.isNewExpression(no)) {
      const alvo = no.expression;
      let funcao: string | undefined;
      if (ts.isIdentifier(alvo) && apelidos.has(alvo.text)) funcao = apelidos.get(alvo.text);
      else if (ts.isPropertyAccessExpression(alvo) && ts.isIdentifier(alvo.expression) && espacos.has(alvo.expression.text))
        funcao = alvo.name.text;
      if (funcao && FUNCOES_DO_SDK.has(funcao)) {
        achados.push({ funcao, modelo: modeloDoPrimeiroArgumento(no.arguments) });
      }
    }
    ts.forEachChild(no, visita);
  };
  visita(ast);
  return achados;
}

const RAIZES = ["lib", "workers", "app", "scripts"] as const;

function pontosNoCodigo(): Map<string, Achado[]> {
  const mapa = new Map<string, Achado[]>();
  for (const arquivo of arquivosDeCodigo(RAIZES)) {
    const achados = chamadasAoSdk(readFileSync(arquivo, "utf8"), arquivo);
    if (achados.length > 0) mapa.set(caminhoRelativo(arquivo), achados);
  }
  return mapa;
}

describe("trava central do Gateway: toda chamada ao SDK `ai` está auditada", () => {
  it("o instrumento enxerga apelido, namespace e a forma `new`, e separa texto de objeto", () => {
    const fonte = `
      import { generateText as gerar, embed, experimental_evaluate as avaliar } from "ai";
      import * as ia from "ai";
      import { tool } from "ai";
      gerar({ model: "anthropic/claude-x", prompt: "oi" });
      embed({ model: construir(), value: "oi" });
      avaliar({ model: JEV, state: "oi" });
      ia.streamText({ model, prompt: "oi" });
      new ia.ToolLoopAgent({ model: \`openai/\${x}\` });
      tool({ description: "nao conta" });
    `;
    expect(chamadasAoSdk(fonte, "exemplo.ts")).toEqual([
      { funcao: "generateText", modelo: "texto" },
      { funcao: "embed", modelo: "expressao" },
      { funcao: "experimental_evaluate", modelo: "expressao" },
      { funcao: "streamText", modelo: "expressao" },
      { funcao: "ToolLoopAgent", modelo: "texto" },
    ]);
    // Não importa de "ai": nada a achar (um `generateText` homônimo de outra biblioteca não conta).
    expect(chamadasAoSdk(`import { generateText } from "outra"; generateText({ model: "a/b" });`, "x.ts")).toEqual([]);
  });

  it("a varredura achou o código (controle positivo: zero arquivos seria falso verde)", () => {
    expect(arquivosDeCodigo(RAIZES).length).toBeGreaterThan(500);
    expect(pontosNoCodigo().size).toBeGreaterThan(0);
  });

  it("os pontos que chamam o SDK são exatamente os auditados", () => {
    const achados = pontosNoCodigo();
    const doCodigo = Object.fromEntries(
      [...achados.entries()].map(([arquivo, lista]) => [arquivo, [...new Set(lista.map((a) => a.funcao))].sort()]),
    );
    const auditados = Object.fromEntries(
      Object.entries(PONTOS_AUDITADOS).map(([arquivo, p]) => [arquivo, [...p.funcoes].sort()]),
    );
    // Se reprovou: um chamador novo do SDK apareceu (ou um sumiu). Diga em `PONTOS_AUDITADOS` de onde
    // vem o `model` e como `gatewayConfig()` / `AI_GATEWAY_PLANO_CONFIRMADO` o cobre — ou use um provider explícito.
    expect(doCodigo).toEqual(auditados);
  });

  it("nenhum ponto passa o modelo como literal de texto", () => {
    const literais = [...pontosNoCodigo().entries()].flatMap(([arquivo, lista]) =>
      lista.filter((a) => a.modelo === "texto").map((a) => `${arquivo}: ${a.funcao}`),
    );
    expect(literais).toEqual([]);
  });

  it("todo ponto auditado tem a explicação de cobertura escrita", () => {
    for (const [arquivo, p] of Object.entries(PONTOS_AUDITADOS)) {
      expect(p.cobertura.length, arquivo).toBeGreaterThan(30);
    }
  });
});

describe("trava central do Gateway: as únicas portas para o modelo-como-texto", () => {
  const codigo = () => arquivosDeCodigo(RAIZES).map((a) => ({ arquivo: caminhoRelativo(a), texto: readFileSync(a, "utf8") }));

  it("a única conversão de texto para `LanguageModel` está em gateway.ts, atrás de `gatewayConfig()`", () => {
    const conversoes = codigo().flatMap(({ arquivo, texto }) =>
      [...texto.matchAll(/\bas\s+(?:unknown\s+as\s+)?LanguageModel\b/g)].map(() => arquivo),
    );
    expect(conversoes).toEqual(["lib/ai/gateway.ts"]);
    const gateway = readFileSync("lib/ai/gateway.ts", "utf8");
    expect(gateway).toMatch(/if \(gatewayConfig\(\)\) return id as LanguageModel;/);
  });

  it("`viaGateway: true` só nasce em chave.ts, dentro de `if (gatewayConfig())`", () => {
    const quem = codigo()
      .filter(({ texto }) => /viaGateway:\s*true/.test(texto))
      .map(({ arquivo }) => arquivo);
    expect(quem).toEqual(["lib/ai/embeddings/chave.ts"]);
    const chave = readFileSync("lib/ai/embeddings/chave.ts", "utf8");
    expect(chave).toMatch(/if \(gatewayConfig\(\)\) \{[^}]*viaGateway:\s*true/s);
  });

  it("ninguém lê `AI_GATEWAY_API_KEY` do process.env por fora do `lib/env.ts`", () => {
    const leitores: string[] = [];
    for (const { arquivo, texto } of codigo()) {
      if (arquivo === "lib/env.ts") continue;
      const ast = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true, arquivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visita = (no: ts.Node) => {
        if (ts.isPropertyAccessExpression(no) && no.name.text === "AI_GATEWAY_API_KEY" && no.expression.getText(ast) === "process.env") {
          leitores.push(arquivo);
        }
        if (
          ts.isElementAccessExpression(no) &&
          no.expression.getText(ast) === "process.env" &&
          ts.isStringLiteralLike(no.argumentExpression) &&
          no.argumentExpression.text === "AI_GATEWAY_API_KEY"
        ) {
          leitores.push(arquivo);
        }
        ts.forEachChild(no, visita);
      };
      visita(ast);
    }
    expect(leitores).toEqual([]);
  });

  it("`triarMensagem` só é chamada por `aplicar.ts` (a triagem do Jev tem um único chamador)", () => {
    const chamadores = codigo()
      .filter(({ arquivo, texto }) => arquivo !== "lib/ai/triagem/jev.ts" && /\btriarMensagem\b/.test(texto))
      .map(({ arquivo }) => arquivo);
    expect(chamadores).toEqual(["lib/ai/triagem/aplicar.ts"]);
  });
});
