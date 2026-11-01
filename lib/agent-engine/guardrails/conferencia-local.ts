/**
 * A CONFERÊNCIA LOCAL DO "DEPOIS" — as regras L1 a L6 (`docs/14-spec-jev.md`,
 * seção 3.3, camada 1, e a regra nova L6).
 *
 * Roda ANTES do Jev, sem custo e sem mandar nada para fora. São checagens exatas e
 * rápidas por padrão de texto, imunes a texto "hostil": o Jev não é calculadora,
 * lê "ao pé da letra" e não trata texto como hostil, então o que uma regra consegue
 * decidir, a regra decide.
 *
 *  - **L1 valores** — todo valor em R$ do rascunho tem de ser igual a um valor
 *    consultado, ou múltiplo inteiro de um preço unitário consultado (5 folhas ×
 *    R$ 2 = R$ 10 passa). **Soma de itens NÃO é aceita**: se a IA somar, o valor
 *    precisa vir de uma fonte, ou a resposta é segurada.
 *  - **L2 prazo e garantia** — "em N dias", "hoje", "amanhã", "garantia de N
 *    meses" sem evidência correspondente.
 *  - **L3 aprovação** — "aprovado", "sem consulta", "sem análise", "100%",
 *    "garantido" sobre crédito, boleto ou financiamento. Sem fonte que o salve: o
 *    atendimento nunca pode dar aprovação como certa.
 *  - **L6 disponibilidade** — "tem", "não tem" ou "chegou" sem trecho consultado
 *    (catálogo, Bling ou base) que sustente a afirmação, sobre aquele produto.
 *
 *  - **L4 senha** — o rascunho repete a senha, PIN ou padrão que o cliente digitou
 *    (o cofre do turno, `evidencias-do-turno.ts`: só em memória, nunca gravada nem
 *    enviada a ninguém).
 *  - **L5 documento** — o rascunho copia 8 ou mais palavras seguidas do texto
 *    extraído de um documento que o cliente enviou (comparado DENTRO do nosso
 *    servidor: documento nunca vai ao Jev).
 *
 * O `trecho` de um achado de L4 e de L5 NUNCA leva a senha nem o texto do
 * documento: o achado vai para o rastro (`before_send_traces`), e o rastro não
 * pode virar o lugar onde o segredo passou a morar.
 *
 * ═══ AS DUAS PROMESSAS DESTE ARQUIVO ═══
 *
 *  1. **Achado local é faixa ALTA, sempre.** Segura mesmo com o Jev fora do ar, e
 *     o Jev só pode apertar (`juntarOsAchados`, T09): nenhum veredito dele
 *     transforma um achado em "passou".
 *  2. **O motivo vai ao MODELO, não ao cliente**, em português instrutivo: diz o
 *     que foi segurado e o que fazer (consultar a fonte, ou dizer que a equipe
 *     confirma). Nunca leva dado pessoal além do trecho do próprio rascunho.
 *
 * Funções puras: nunca lançam, não leem rede nem banco. O falso alarme (resposta
 * certa segurada por evidência incompleta) é o custo conhecido, medido na fase
 * `observando` — é por isso que ela existe.
 */
import type { Evidencia, EvidenciasDoTurno, OrigemDaEvidencia } from "../agent/evidencias-do-turno";
import { extractPromises } from "./promise/engine";

export type RegraLocal = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";

export type CodigoDoAchado =
  | "valor_sem_fonte"
  | "prazo_sem_fonte"
  | "garantia_sem_fonte"
  | "aprovacao_prometida"
  | "disponibilidade_sem_fonte"
  | "senha_repetida"
  | "documento_copiado";

export interface AchadoLocal {
  regra: RegraLocal;
  codigo: CodigoDoAchado;
  /** O pedaço do rascunho que disparou a regra — para o rastro e para a revisão. */
  trecho: string;
  /** Instrução ao modelo: o que foi segurado e o que fazer. */
  motivo: string;
}

export interface ResultadoDaConferenciaLocal {
  achados: AchadoLocal[];
  /** `alta` quando há qualquer achado; `null` quando nada foi achado. */
  faixa: "alta" | null;
}

/** O que a conferência local lê do turno: o rascunho e o que a IA consultou. */
export interface EntradaDaConferenciaLocal {
  rascunho: string;
  evidencias: Pick<EvidenciasDoTurno, "todas" | "consultou"> &
    Partial<Pick<EvidenciasDoTurno, "senhasDoCliente" | "documentosDoCliente">>;
}

/* ───────────────────────────── utilidades ───────────────────────────── */

/** Minúsculo e sem acento, MESMO comprimento (caractere a caractere). */
function dobrar(texto: string): string {
  let saida = "";
  for (const ch of texto.normalize("NFC")) {
    const base = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    saida += base.length === ch.length ? base : ch.toLowerCase();
  }
  return saida;
}

/** Frases do rascunho: o ponto final, a exclamação, a interrogação e a quebra de linha separam. */
function frases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?])\s+|\n+|;/u)
    .map((f) => f.trim())
    .filter((f) => f !== "");
}

function recorte(frase: string, de: number, ate: number, folga = 18): string {
  const ini = Math.max(0, de - folga);
  const fim = Math.min(frase.length, ate + folga);
  return `${ini > 0 ? "…" : ""}${frase.slice(ini, fim).trim()}${fim < frase.length ? "…" : ""}`;
}

const PALAVRAS_DE_NUMERO: Readonly<Record<string, number>> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, sessenta: 60, noventa: 90,
};

function numeroDe(token: string): number | null {
  const t = dobrar(token);
  if (/^\d+$/u.test(t)) return Number(t);
  return PALAVRAS_DE_NUMERO[t] ?? null;
}

type Unidade = "minuto" | "hora" | "dia" | "semana" | "mes" | "ano";

function unidadeDe(palavra: string): Unidade {
  const p = dobrar(palavra);
  if (p.startsWith("minut")) return "minuto";
  if (p.startsWith("hora")) return "hora";
  if (p.startsWith("dia")) return "dia";
  if (p.startsWith("seman")) return "semana";
  if (p.startsWith("mes")) return "mes";
  return "ano";
}

interface Quantidade {
  n: number;
  unidade: Unidade;
  inicio: number;
  fim: number;
}

const NUM = String.raw`(?:\d{1,3}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|sessenta|noventa)`;
const UNIDADE = String.raw`(dias?|horas?|minutos?|semanas?|mes(?:es)?|m[eê]s|anos?)`;
const RE_QUANTIDADE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${NUM})(?:\s*(?:a|à|ou|e|-|–)\s*(${NUM}))?\s*${UNIDADE}(?:\s+[uú]teis)?(?![\p{L}])`,
  "giu",
);

/** "em 2 a 3 dias úteis" → 2 e 3, unidade dia. */
function quantidades(texto: string): Quantidade[] {
  const saida: Quantidade[] = [];
  for (const m of texto.matchAll(RE_QUANTIDADE)) {
    const unidade = unidadeDe(m[3]!);
    const inicio = m.index!;
    const fim = inicio + m[0].length;
    for (const g of [m[1], m[2]]) {
      const n = g === undefined ? null : numeroDe(g);
      if (n !== null) saida.push({ n, unidade, inicio, fim });
    }
  }
  return saida;
}

/** Todas as evidências juntas, dobradas — o que a IA tinha na mão. */
function textoDasEvidencias(evidencias: readonly Evidencia[]): string {
  return evidencias.map((e) => `${e.fonte ?? ""} ${e.texto}`).join("\n");
}

/* ───────────────────────── L1 — valores em R$ ───────────────────────── */

/** "Preço", "valor" e irmãos: a coluna de uma linha de banco que carrega dinheiro sem "R$". */
const RE_COLUNA_DE_DINHEIRO = /(?:pre[cç]o|valor|price|total|custo|venda)[\w ]{0,12}[:=]\s*(\d+(?:[.,]\d+)?)/giu;

function paraCentavos(bruto: string): number | null {
  const limpo = bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Os valores (em centavos) que a IA consultou: "R$ 39,90", "89 reais" e a coluna `preco: 89.9`. */
export function valoresConsultados(evidencias: readonly Evidencia[]): number[] {
  const valores = new Set<number>();
  for (const e of evidencias) {
    const texto = `${e.fonte ?? ""} ${e.texto}`;
    for (const p of extractPromises(texto)) if (p.kind === "price" && p.value > 0) valores.add(p.value);
    for (const m of texto.matchAll(RE_COLUNA_DE_DINHEIRO)) {
      const c = paraCentavos(m[1]!);
      if (c !== null && c > 0) valores.add(c);
    }
  }
  return [...valores];
}

function formatarReais(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Teto do multiplicador: "100 unidades" é compra; 5.000× um preço unitário é coincidência. */
const MULTIPLICADOR_NO_MAXIMO = 1000;

function valorTemFonte(cents: number, consultados: readonly number[]): boolean {
  return consultados.some((c) => c === cents || (cents % c === 0 && cents / c <= MULTIPLICADOR_NO_MAXIMO));
}

export function conferirValores(entrada: EntradaDaConferenciaLocal): AchadoLocal[] {
  const consultados = valoresConsultados(entrada.evidencias.todas());
  const achados: AchadoLocal[] = [];
  for (const frase of frases(entrada.rascunho)) {
    for (const p of extractPromises(frase)) {
      if (p.kind !== "price" || p.moeda !== undefined || p.value <= 0) continue;
      if (valorTemFonte(p.value, consultados)) continue;
      achados.push({
        regra: "L1",
        codigo: "valor_sem_fonte",
        trecho: recorte(frase, 0, frase.length, 0),
        motivo:
          `o valor ${formatarReais(p.value)} não aparece nas fontes que você consultou neste turno ` +
          "(nem é um múltiplo inteiro de um preço unitário consultado). Não cite preço, nem some itens " +
          "por conta própria: consulte o catálogo, ou diga que a equipe confirma o valor.",
      });
    }
  }
  return achados;
}

/* ──────────────────────── L2 — prazo e garantia ──────────────────────── */

const PRECEDE_PRAZO = /(?:\bem(?:\s+at[eé])?|\bat[eé]|prazo\s+(?:de|é\s+de|e\s+de)|leva(?:mos)?|demora(?:mos)?|pront[oa]s?\s+em|entrega(?:mos)?\s+em|chega\s+em)\s*$/iu;

const RE_HOJE = /(?<![\p{L}\p{N}])(ainda\s+hoje|hoje\s+mesmo|hoje|amanh[ãa]|depois\s+de\s+amanh[ãa]|no\s+mesmo\s+dia|na\s+hora)(?![\p{L}])/giu;
const VERBO_DE_COMPROMISSO = /(?:fic[ao]|pront[oa]s?|entreg|cheg|envi|despach|retir|busc|resolv|conserto|consert|dispon|libera|conclu|finaliz|termin)/iu;

/** Evidência que sustenta cada marca de tempo. */
const SUSTENTA_HOJE: Readonly<Record<string, RegExp>> = {
  hoje: /\b(hoje|mesmo dia|na hora|imediat)/u,
  amanha: /\b(amanha|24\s*horas|1 dia|um dia|dia seguinte)/u,
  depois: /\b(depois de amanha|48\s*horas|2 dias|dois dias)/u,
};

function chaveDoTempo(achado: string): keyof typeof SUSTENTA_HOJE {
  const t = dobrar(achado);
  if (t.includes("depois de amanha")) return "depois";
  if (t.includes("amanha")) return "amanha";
  return "hoje";
}

const RE_GARANTIA_NUMERICA = new RegExp(
  String.raw`(?:garantia\s+(?:de\s+|total\s+de\s+|estendida\s+de\s+)?(${NUM})\s*${UNIDADE})|(?:(${NUM})\s*${UNIDADE}\s+de\s+garantia)`,
  "giu",
);
const RE_GARANTIA_QUALITATIVA = /garantia\s+(?:vital[ií]cia|de\s+f[aá]brica|total|estendida|eterna|para\s+sempre|de\s+por\s+vida)/giu;

export function conferirPrazoEGarantia(entrada: EntradaDaConferenciaLocal): AchadoLocal[] {
  const evidencias = entrada.evidencias.todas();
  const doEvidencias = dobrar(textoDasEvidencias(evidencias));
  const quantEvidencias = quantidades(textoDasEvidencias(evidencias));
  const tem = (n: number, u: Unidade) => quantEvidencias.some((q) => q.n === n && q.unidade === u);
  const achados: AchadoLocal[] = [];

  for (const frase of frases(entrada.rascunho)) {
    const dobrada = dobrar(frase);
    const falaDeGarantia = dobrada.includes("garantia");

    // garantia de N meses / N meses de garantia
    for (const m of frase.matchAll(RE_GARANTIA_NUMERICA)) {
      const n = numeroDe(m[1] ?? m[3] ?? "");
      const unidade = unidadeDe(m[2] ?? m[4] ?? "");
      if (n === null || tem(n, unidade)) continue;
      achados.push({
        regra: "L2",
        codigo: "garantia_sem_fonte",
        trecho: recorte(frase, m.index!, m.index! + m[0].length),
        motivo:
          `a garantia de ${n} ${unidade === "mes" ? "mês(es)" : `${unidade}(s)`} não aparece nas fontes que você consultou. ` +
          "Não prometa garantia que você não leu: consulte a política da loja, ou diga que a equipe confirma.",
      });
    }
    for (const m of frase.matchAll(RE_GARANTIA_QUALITATIVA)) {
      const termo = dobrar(m[0]).replace(/^garantia\s+/, "").split(" ")[0]!;
      if (doEvidencias.includes(`garantia ${termo}`) || doEvidencias.includes(termo)) continue;
      achados.push({
        regra: "L2",
        codigo: "garantia_sem_fonte",
        trecho: recorte(frase, m.index!, m.index! + m[0].length),
        motivo:
          `"${m[0]}" não aparece nas fontes que você consultou. Não prometa esse tipo de garantia sem ler a política da loja: ` +
          "consulte, ou diga que a equipe confirma.",
      });
    }

    // prazo: "em N dias", "prazo de N horas" — a garantia tem o caminho dela, acima
    if (!falaDeGarantia) {
      for (const q of quantidades(frase)) {
        if (q.unidade === "mes" || q.unidade === "ano") continue;
        if (!PRECEDE_PRAZO.test(frase.slice(Math.max(0, q.inicio - 28), q.inicio))) continue;
        if (tem(q.n, q.unidade)) continue;
        achados.push({
          regra: "L2",
          codigo: "prazo_sem_fonte",
          trecho: recorte(frase, q.inicio, q.fim),
          motivo:
            `o prazo "${frase.slice(q.inicio, q.fim)}" não aparece nas fontes que você consultou. ` +
            "Não prometa prazo: consulte a base de conhecimento, ou diga que a equipe confirma quando fica pronto.",
        });
      }

      // "hoje" / "amanhã" ao lado de um verbo de compromisso (fica pronto, entregamos, chega…)
      for (const m of frase.matchAll(RE_HOJE)) {
        const vizinhanca = frase.slice(Math.max(0, m.index! - 45), m.index! + m[0].length + 45);
        if (!VERBO_DE_COMPROMISSO.test(vizinhanca)) continue;
        if (SUSTENTA_HOJE[chaveDoTempo(m[0])]!.test(doEvidencias)) continue;
        achados.push({
          regra: "L2",
          codigo: "prazo_sem_fonte",
          trecho: recorte(frase, m.index!, m.index! + m[0].length, 30),
          motivo:
            `"${m[0]}" promete um prazo que não aparece nas fontes que você consultou. ` +
            "Não prometa prazo: consulte a base de conhecimento, ou diga que a equipe confirma.",
        });
      }
    }
  }
  return achados;
}

/* ─────────────────────── L3 — aprovação prometida ─────────────────────── */

const CONTEXTO_DE_CREDITO = /(?:cr[eé]dito|boleto|financiament|parcelament|credi[aá]rio|carn[eê]|limite|score|spc|serasa|nome\s+sujo|negativad|financeira|aprova[cç][aã]o)/iu;
const PROMESSA_DE_APROVACAO =
  /(?<![\p{L}\p{N}])(aprovad[oa]s?|aprovamos|aprovou|liberad[oa]s?|liberamos|sem\s+(?:consulta|an[aá]lise|checagem|consultar)|100\s*%|garantid[oa]s?|garantimos|garantia\s+de\s+aprova[cç][aã]o)(?![\p{L}])/giu;
/** Antes da palavra, estas condicionais tiram a promessa ("só depois de aprovado", "se for aprovado"). */
const CONDICIONAL_ANTES = /(?:\bn[aã]o\b|\bnem\b|\bainda\b|\bse\b|\bcaso\b|\bquando\b|\bdepois\b|\bantes\b|\bsujeit[oa]\b|\bdepende\b|\bprecisa(?:\s+ser)?\b|\bpara\s+ser\b|\bpode\s+ser\b|\bser[aá]\b|\bfor\b|\bassim\s+que\b)[^.!?]{0,30}$/iu;

export function conferirAprovacao(entrada: EntradaDaConferenciaLocal): AchadoLocal[] {
  const achados: AchadoLocal[] = [];
  for (const frase of frases(entrada.rascunho)) {
    if (!CONTEXTO_DE_CREDITO.test(frase)) continue;
    for (const m of frase.matchAll(PROMESSA_DE_APROVACAO)) {
      const antes = frase.slice(Math.max(0, m.index! - 40), m.index!);
      if (CONDICIONAL_ANTES.test(antes)) continue;
      // "100%" só é promessa colado a uma palavra de aprovação/garantia/crédito na MESMA frase.
      achados.push({
        regra: "L3",
        codigo: "aprovacao_prometida",
        trecho: recorte(frase, m.index!, m.index! + m[0].length, 30),
        motivo:
          `"${m[0]}" dá como certa a aprovação de crédito, boleto ou financiamento. Nunca prometa aprovação: ` +
          "ela depende da análise da financeira. Diga que a equipe confirma as condições.",
      });
      break;
    }
  }
  return achados;
}

/* ─────────────────────── L6 — disponibilidade ─────────────────────── */

const RE_TEM = /(?<![\p{L}\p{N}])(?:temos|tenho|tem|h[aá]|existe[m]?|dispon[ií]ve(?:l|is)|em\s+estoque|no\s+estoque|pronta\s+entrega|chegou|chegaram|j[aá]\s+chegou)(?![\p{L}])/iu;
const RE_NAO_TEM =
  /(?<![\p{L}\p{N}])(?:n[aã]o\s+(?:temos|tenho|tem|h[aá]|existe)|sem\s+estoque|fora\s+de\s+estoque|indispon[ií]ve(?:l|is)|acabou|acabaram|esgotou|esgotad[oa]s?|zerou)(?![\p{L}])/iu;
const NEGATIVIDADE_NA_EVIDENCIA = /(?:sem estoque|indisponivel|esgotad|estoque:\s*0|quantidade:\s*0|fora de estoque|nao encontrei|nao ha nada)/u;
/** O que NÃO identifica o produto: a própria afirmação e palavras de ligação. */
const SEM_IDENTIDADE = new Set(
  (
    "temos tenho tinha tinhamos disponivel disponiveis estoque pronta entrega chegou chegaram acabou acabaram esgotou esgotado esgotada " +
    "esgotados esgotadas zerou nao sim aqui agora para porem mas tambem ainda ja muito mais loja nosso nossa nossos nossas voce voces " +
    "produto produtos item itens modelo modelos opcao opcoes pode podemos posso quer queria gostaria sobre desse dessa esse essa isso " +
    "esta estao estamos tem uma uns umas com sem por pelo pela dos das"
  ).split(" "),
);

function tokensDoProduto(frase: string): string[] {
  return [...new Set(dobrar(frase).match(/[a-z0-9]{4,}/gu) ?? [])].filter((t) => !SEM_IDENTIDADE.has(t));
}

const ORIGENS_DE_DISPONIBILIDADE: readonly OrigemDaEvidencia[] = ["catalogo", "bling", "base_de_conhecimento"];

export function conferirDisponibilidade(entrada: EntradaDaConferenciaLocal): AchadoLocal[] {
  const evidencias = entrada.evidencias.todas();
  const consultouEstoque = ORIGENS_DE_DISPONIBILIDADE.some((o) => entrada.evidencias.consultou(o));
  const achados: AchadoLocal[] = [];

  for (const frase of frases(entrada.rascunho)) {
    // Pergunta ("vocês querem o modelo que tem 128GB?") não afirma nada.
    if (frase.endsWith("?")) continue;
    const negativa = RE_NAO_TEM.exec(frase);
    const positiva = negativa === null ? RE_TEM.exec(frase) : null;
    const claim = negativa ?? positiva;
    if (claim === null) continue;

    const tokens = tokensDoProduto(frase);
    const sobre = evidencias.filter((e) => {
      const alvo = dobrar(`${e.fonte ?? ""} ${e.texto}`);
      return tokens.length === 0 ? true : tokens.some((t) => alvo.includes(t));
    });
    const sobreDobradas = sobre.map((e) => dobrar(`${e.fonte ?? ""} ${e.texto}`));
    const negativoNaFonte = sobreDobradas.some((t) => NEGATIVIDADE_NA_EVIDENCIA.test(t));
    const positivoNaFonte = sobreDobradas.some((t) => !NEGATIVIDADE_NA_EVIDENCIA.test(t));

    let sustentada: boolean;
    if (positiva !== null) {
      sustentada = positivoNaFonte;
    } else {
      // "Não temos": a fonte diz que não, ou a busca foi feita e o produto nem apareceu.
      // Se a fonte diz que TEM, a afirmação a contradiz.
      sustentada = negativoNaFonte || (consultouEstoque && !positivoNaFonte);
    }
    if (sustentada) continue;

    achados.push({
      regra: "L6",
      codigo: "disponibilidade_sem_fonte",
      trecho: recorte(frase, claim.index, claim.index + claim[0].length, 30),
      motivo:
        (negativa === null
          ? "você afirmou que a loja tem, ou que chegou, um produto sem nenhuma fonte consultada que mostre isso. "
          : "você afirmou que a loja não tem um produto sem nenhuma fonte consultada que mostre isso. ") +
        "Não diga se tem, se não tem ou se chegou sem consultar o catálogo; se a busca não foi conclusiva, " +
        "diga que a equipe confirma a disponibilidade.",
    });
  }
  return achados;
}

/* ───────────────────── L4 — senha de aparelho repetida ───────────────────── */

function escaparRegex(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** O valor da senha como padrão: sem caixa nem acento, palavra inteira, separadores do próprio valor flexíveis. */
function padraoDaSenha(valor: string): RegExp | null {
  const v = dobrar(valor).trim();
  if (v.length < 3) return null;
  const miolo = v
    .split(/[\s.\-–]+/u)
    .filter((x) => x !== "")
    .map(escaparRegex)
    .join(String.raw`[\s.\-–]?`);
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${miolo}(?![\p{L}\p{N}])`, "u");
}

export function conferirSenha(entrada: EntradaDaConferenciaLocal): AchadoLocal[] {
  const senhas = entrada.evidencias.senhasDoCliente?.() ?? [];
  if (senhas.length === 0) return [];
  const padroes = senhas.flatMap((s) => {
    const p = padraoDaSenha(s);
    return p === null ? [] : [p];
  });
  const achados: AchadoLocal[] = [];
  for (const frase of frases(entrada.rascunho)) {
    const dobrada = dobrar(frase);
    if (!padroes.some((p) => p.test(dobrada))) continue;
    achados.push({
      regra: "L4",
      codigo: "senha_repetida",
      // Nunca a frase: ela traz a senha. O rastro guarda só que a regra disparou.
      trecho: "[trecho com a senha do aparelho]",
      motivo:
        "a resposta repete a senha, o PIN ou o padrão do aparelho que o cliente informou. Nunca repita esse dado na " +
        "conversa: diga só que recebeu o que era preciso para o atendimento.",
    });
  }
  return achados;
}

/* ───────────────────── L5 — trecho de documento copiado ───────────────────── */

/** Quantas palavras seguidas iguais fazem uma cópia (spec 14, seção 3.3). */
export const PALAVRAS_SEGUIDAS_DE_COPIA = 8;

function palavrasDe(texto: string): string[] {
  return dobrar(texto).match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function conferirDocumento(entrada: EntradaDaConferenciaLocal): AchadoLocal[] {
  const documentos = entrada.evidencias.documentosDoCliente?.() ?? [];
  if (documentos.length === 0) return [];
  const conhecidas = new Set<string>();
  for (const doc of documentos) {
    const palavras = palavrasDe(doc);
    for (let i = 0; i + PALAVRAS_SEGUIDAS_DE_COPIA <= palavras.length; i++) {
      conhecidas.add(palavras.slice(i, i + PALAVRAS_SEGUIDAS_DE_COPIA).join(" "));
    }
  }
  if (conhecidas.size === 0) return [];
  const palavras = palavrasDe(entrada.rascunho);
  for (let i = 0; i + PALAVRAS_SEGUIDAS_DE_COPIA <= palavras.length; i++) {
    if (!conhecidas.has(palavras.slice(i, i + PALAVRAS_SEGUIDAS_DE_COPIA).join(" "))) continue;
    return [
      {
        regra: "L5",
        codigo: "documento_copiado",
        // Nunca o texto: é conteúdo do documento do cliente.
        trecho: "[trecho copiado de um documento do cliente]",
        motivo:
          `a resposta copia ${PALAVRAS_SEGUIDAS_DE_COPIA} palavras seguidas ou mais de um documento que o cliente enviou. ` +
          "Não reproduza o conteúdo do documento: diga com as suas palavras o que é preciso, ou que a equipe analisa o documento.",
      },
    ];
  }
  return [];
}

/* ───────────────────────────── a conferência ───────────────────────────── */

/**
 * Todas as regras locais sobre o rascunho. O resultado é o piso do veredito: com
 * qualquer achado a faixa é `alta`, e nada que venha depois (o Jev, a faixa média)
 * a rebaixa.
 */
export function conferirLocalmente(entrada: EntradaDaConferenciaLocal): ResultadoDaConferenciaLocal {
  try {
    const achados = [
      ...conferirValores(entrada),
      ...conferirPrazoEGarantia(entrada),
      ...conferirAprovacao(entrada),
      ...conferirDisponibilidade(entrada),
      ...conferirSenha(entrada),
      ...conferirDocumento(entrada),
    ];
    return { achados, faixa: achados.length > 0 ? "alta" : null };
  } catch {
    // Nunca lança — e uma regra que quebrou NÃO é "tudo certo" nem "tudo errado":
    // quem chama recebe nenhum achado, e o Jev (se estiver de pé) ainda confere.
    return { achados: [], faixa: null };
  }
}
