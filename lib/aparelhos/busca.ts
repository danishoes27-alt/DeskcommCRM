/**
 * COMO "iphone 16 pro max", "16 promax" e "redmi note 15" achem o aparelho certo.
 *
 * Spec 23 §4. Função PURA sobre os aparelhos já validados: não lê rede, não lê relógio, não lê
 * banco. A tabela de casamento da spec é o contrato; todo caso novo vira linha lá e teste aqui.
 *
 * ─── As três regras que seguram o resto ───────────────────────────────────────────
 *
 *  1. **Número é SEMPRE exato e SEMPRE do nome.** "Redmi Note 15" jamais casa "Redmi Note 14", nem
 *     por tolerância, nem por prefixo, nem porque a RAM do aparelho é "8 GB" e o cliente digitou 8.
 *     Um número só vale como atributo quando vem com unidade ("256 gb", "5 g").
 *  2. **Todo token da busca precisa ser satisfeito.** Um token sem par derruba o aparelho. A busca
 *     "devolve o mais parecido" é exatamente o defeito que faz o agente dizer um preço de OUTRO
 *     modelo; aqui o parecido vai em `outrosModelos` (só o nome), nunca em `itens`.
 *  3. **Aproximado é dito.** Uma letra de tolerância em palavra de 5+ letras, e o resultado volta
 *     marcado, para o agente confirmar com o cliente antes de dar preço.
 *
 * Devolve os OBJETOS do arquivo (mesma referência): nada aqui reescreve preço ou parcela.
 */
import type { AparelhoDoArquivo, VarianteDeAparelho } from "./schema";

/** Aparelhos por resposta. O corte é por aparelho, nunca por variante. */
export const LIMITE_DE_APARELHOS = 5;

/** Nomes citados em `outrosModelos`. */
export const LIMITE_DE_OUTROS_MODELOS = 20;

/** Palavras que não dizem qual aparelho é. Só saem da BUSCA, e antes de separar letra de dígito. */
const PALAVRAS_VAZIAS = new Set([
  "o", "a", "os", "as", "um", "uma", "de", "do", "da", "dos", "das", "no", "na", "em", "com", "para", "pra", "por",
  "quero", "queria", "tem", "tenho", "voces", "vcs", "ai", "ola", "oi", "bom", "dia", "tarde", "noite",
  "celular", "cel", "aparelho", "telefone", "smartphone", "modelo", "preco", "valor", "quanto", "custa", "fica", "sai",
]);

/** Unidades que transformam um número em atributo ("256 gb", "5 g"). */
const UNIDADES = new Set(["gb", "tb", "mb", "g"]);

const ehNumero = (t: string) => /^\d+$/.test(t);
const ehLetras = (t: string) => /^[a-z]+$/.test(t);

/** Minúsculas, sem acento, só `a-z0-9` separados por um espaço. NÃO separa letra de dígito. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "a56" → ["a","56"]; "17e" → ["17","e"]. Depois disto todo token é só letras ou só dígitos. */
function separarLetraDeDigito(palavras: string[]): string[] {
  return palavras.flatMap((p) => p.replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2").split(" "));
}

/** Tokens de um texto do ARQUIVO (nome, marca, atributo): sem descartar palavra nenhuma. */
export function tokensDoTexto(texto: string): string[] {
  const n = normalizar(texto);
  return n === "" ? [] : separarLetraDeDigito(n.split(" "));
}

/** Tokens da BUSCA: palavras vazias saem primeiro, depois letra e dígito se separam. */
export function tokensDaBusca(texto: string): string[] {
  const n = normalizar(texto);
  if (n === "") return [];
  return separarLetraDeDigito(n.split(" ").filter((p) => !PALAVRAS_VAZIAS.has(p)));
}

/** Junta "256" + "gb" em "256gb" (atributo com unidade). Os demais tokens passam como estão. */
interface TokenDaBusca {
  texto: string;
  unidade: boolean;
}

function comUnidades(tokens: string[]): TokenDaBusca[] {
  const saida: TokenDaBusca[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const prox = tokens[i + 1];
    if (ehNumero(t) && prox !== undefined && UNIDADES.has(prox)) {
      saida.push({ texto: t + prox, unidade: true });
      i++;
    } else {
      saida.push({ texto: t, unidade: false });
    }
  }
  return saida;
}

/** Distância de Damerau-Levenshtein (alinhamento ótimo): troca de vizinhas custa 1. */
function distancia(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return 2; // só interessa saber se é ≤ 1
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[m]![n]!;
}

interface Indice {
  aparelho: AparelhoDoArquivo;
  ordem: number;
  /** marca + nome, tokenizados. */
  nome: string[];
  /** Só o nome do modelo, tokenizado e junto ("iphone16promax"): para o casamento exato. */
  soNomeCompacto: string;
  marcaENomeCompacto: string;
  /** tokens de nome + junções de 2 e 3 palavras seguidas só-de-letras ("pro"+"max" → "promax"). */
  nomeComJuncoes: Set<string>;
  /** Palavras de atributo: condição, categoria, cor, rede, processador (só letras, sem números soltos). */
  atributos: Set<string>;
  /** Atributos com unidade: "256gb", "8gb", "5g". */
  unidades: Set<string>;
}

function juncoes(tokens: string[]): string[] {
  const saida: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const tam of [2, 3]) {
      const grupo = tokens.slice(i, i + tam);
      if (grupo.length === tam && grupo.every(ehLetras)) saida.push(grupo.join(""));
    }
  }
  return saida;
}

function camposDaVariante(v: VarianteDeAparelho): string[] {
  return [v.nome, v.cor, v.armazenamento, v.ram, v.rede, v.processador].filter(
    (x): x is string => typeof x === "string" && x !== "",
  );
}

function indexar(aparelho: AparelhoDoArquivo, ordem: number): Indice {
  const nome = [...tokensDoTexto(aparelho.marca), ...tokensDoTexto(aparelho.nome)];
  const atributos = new Set<string>();
  const unidades = new Set<string>();
  const textos = [aparelho.condicao, aparelho.categoria, ...aparelho.variantes.flatMap(camposDaVariante)];
  for (const texto of textos) {
    const toks = tokensDoTexto(texto);
    for (const t of comUnidades(toks)) {
      if (t.unidade) unidades.add(t.texto);
      else if (ehLetras(t.texto)) atributos.add(t.texto);
      // número solto de atributo NÃO entra: "8" da RAM não pode virar "Redmi Note 8"
    }
  }
  return {
    aparelho,
    ordem,
    nome,
    soNomeCompacto: tokensDoTexto(aparelho.nome).join(""),
    marcaENomeCompacto: nome.join(""),
    nomeComJuncoes: new Set([...nome, ...juncoes(nome)]),
    atributos,
    unidades,
  };
}

type Casamento = { ok: false } | { ok: true; aproximado: boolean; sobras: number };

/** Cada token da busca precisa de um par; devolve se casou, se foi por aproximação e o que sobrou do nome. */
function casar(indice: Indice, busca: TokenDaBusca[]): Casamento {
  let aproximado = false;
  let acertosNoNome = 0;

  for (let i = 0; i < busca.length; i++) {
    const t = busca[i]!;

    if (t.unidade) {
      if (indice.unidades.has(t.texto)) continue;
      return { ok: false };
    }

    // 1. idêntico a um token (ou junção) do nome
    if (indice.nomeComJuncoes.has(t.texto)) {
      acertosNoNome++;
      continue;
    }

    if (ehLetras(t.texto)) {
      // 2. duas palavras da busca que formam uma palavra do nome ("pro" "max" → "promax")
      const prox = busca[i + 1];
      if (prox && !prox.unidade && ehLetras(prox.texto) && indice.nomeComJuncoes.has(t.texto + prox.texto)) {
        acertosNoNome += 2;
        i++;
        continue;
      }
      // 3. prefixo de palavra do nome (3+ letras)
      if (t.texto.length >= 3 && indice.nome.some((n) => ehLetras(n) && n.startsWith(t.texto))) {
        acertosNoNome++;
        continue;
      }
      // 4. atributo (condição, categoria, cor...)
      if (indice.atributos.has(t.texto)) continue;
      // 5. uma letra de tolerância, só em palavra de 5+ letras. NUNCA em número.
      if (t.texto.length >= 5) {
        const parecida = [...indice.nomeComJuncoes].some((n) => ehLetras(n) && distancia(t.texto, n) === 1);
        if (parecida) {
          aproximado = true;
          acertosNoNome++;
          continue;
        }
      }
    }

    return { ok: false };
  }

  // Ao menos um token precisa ter casado com marca/nome: "azul" sozinho não é um aparelho.
  if (acertosNoNome === 0) return { ok: false };
  return { ok: true, aproximado, sobras: Math.max(0, indice.nome.length - acertosNoNome) };
}

export interface ConsultaDeAparelhos {
  busca: string;
  categoria?: string | undefined;
  condicao?: string | undefined;
}

export type MotivoDeVazio = "busca_vazia" | "categoria_inexistente" | "condicao_inexistente" | "sem_correspondencia";

export interface ResultadoDaBusca {
  itens: AparelhoDoArquivo[];
  totalEncontrado: number;
  truncado: boolean;
  /** Mais de um MODELO diferente voltou (o mesmo modelo em condições diferentes não é empate). */
  empate: boolean;
  /** Algum item voltou por tolerância de digitação: o agente confirma o modelo antes do preço. */
  aproximado: boolean;
  /** "Nome (condição)" dos que casaram e não vieram em `itens`. */
  outrosModelos: string[];
  motivoVazio: MotivoDeVazio | null;
  categoriasDisponiveis: string[];
  condicoesDisponiveis: string[];
}

function valoresUnicos(aparelhos: AparelhoDoArquivo[], campo: "categoria" | "condicao"): string[] {
  const porNormal = new Map<string, string>();
  for (const a of aparelhos) {
    const n = normalizar(a[campo]);
    if (!porNormal.has(n)) porNormal.set(n, a[campo]);
  }
  return [...porNormal.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([, original]) => original);
}

const rotulo = (a: AparelhoDoArquivo) => `${a.nome} (${a.condicao})`;

/**
 * Procura na lista já validada. Nunca lança.
 *
 * Ordem do resultado: (1) se a busca é IGUAL ao nome de algum aparelho, só esses — vários quando o
 * mesmo modelo existe em mais de uma condição; (2) senão, os que casam, sem aproximação antes dos
 * aproximados, com menos palavras sobrando no nome antes, e a ordem do arquivo no empate.
 */
export function buscarAparelhos(aparelhos: AparelhoDoArquivo[], consulta: ConsultaDeAparelhos): ResultadoDaBusca {
  const categoriasDisponiveis = valoresUnicos(aparelhos, "categoria");
  const condicoesDisponiveis = valoresUnicos(aparelhos, "condicao");
  const vazio = (motivo: MotivoDeVazio): ResultadoDaBusca => ({
    itens: [],
    totalEncontrado: 0,
    truncado: false,
    empate: false,
    aproximado: false,
    outrosModelos: [],
    motivoVazio: motivo,
    categoriasDisponiveis,
    condicoesDisponiveis,
  });

  const tokens = tokensDaBusca(consulta.busca);
  if (tokens.length === 0) return vazio("busca_vazia");
  const busca = comUnidades(tokens);

  let universo = aparelhos;
  if (consulta.categoria !== undefined && consulta.categoria.trim() !== "") {
    const alvo = normalizar(consulta.categoria);
    if (!categoriasDisponiveis.some((c) => normalizar(c) === alvo)) return vazio("categoria_inexistente");
    universo = universo.filter((a) => normalizar(a.categoria) === alvo);
  }
  if (consulta.condicao !== undefined && consulta.condicao.trim() !== "") {
    const alvo = normalizar(consulta.condicao);
    if (!condicoesDisponiveis.some((c) => normalizar(c) === alvo)) return vazio("condicao_inexistente");
    universo = universo.filter((a) => normalizar(a.condicao) === alvo);
  }

  const casados: Array<{ indice: Indice; aproximado: boolean; sobras: number }> = [];
  universo.forEach((aparelho, ordem) => {
    const indice = indexar(aparelho, ordem);
    const r = casar(indice, busca);
    if (r.ok) casados.push({ indice, aproximado: r.aproximado, sobras: r.sobras });
  });
  if (casados.length === 0) return vazio("sem_correspondencia");

  // Exato: a busca (sem palavras vazias) é o nome do modelo, com ou sem a marca.
  const compactaDaBusca = busca.map((t) => t.texto).join("");
  // Casado por aproximação conta como exato quando a busca É o nome a menos de uma letra
  // ("ipone 16" é "iPhone 16"): os números já bateram token a token, então a letra que falta não
  // pode ser dígito.
  const ehNome = (c: { indice: Indice; aproximado: boolean }) =>
    [c.indice.soNomeCompacto, c.indice.marcaENomeCompacto].some((nome) =>
      c.aproximado ? distancia(nome, compactaDaBusca) <= 1 : nome === compactaDaBusca,
    );
  const exatos = casados.filter(ehNome);

  const pool = exatos.length > 0 ? exatos : casados;
  const ordenados = [...pool].sort(
    (x, y) =>
      Number(x.aproximado) - Number(y.aproximado) || x.sobras - y.sobras || x.indice.ordem - y.indice.ordem,
  );

  const escolhidos = ordenados.slice(0, LIMITE_DE_APARELHOS);
  const naoEscolhidos = new Set(escolhidos.map((c) => c.indice.aparelho));
  const demais = casados.filter((c) => !naoEscolhidos.has(c.indice.aparelho));
  const nomesDistintos = new Set(escolhidos.map((c) => c.indice.soNomeCompacto));

  return {
    itens: escolhidos.map((c) => c.indice.aparelho),
    totalEncontrado: pool.length,
    truncado: pool.length > LIMITE_DE_APARELHOS,
    empate: nomesDistintos.size > 1,
    aproximado: escolhidos.some((c) => c.aproximado),
    outrosModelos: demais.slice(0, LIMITE_DE_OUTROS_MODELOS).map((c) => rotulo(c.indice.aparelho)),
    motivoVazio: null,
    categoriasDisponiveis,
    condicoesDisponiveis,
  };
}
