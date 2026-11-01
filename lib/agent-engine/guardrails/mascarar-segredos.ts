/**
 * A MÁSCARA DE DADOS PESSOAIS E DE SENHA — o que se apaga ANTES de um texto sair
 * para o Jev (`docs/14-spec-jev.md`, seção 6.1 e ambiguidade 6).
 *
 * Serve aos dois lados do Jev: o texto que o cliente digitou (ANTES da IA) e o
 * rascunho da resposta com as evidências (DEPOIS). Sobre `scrubMessage`
 * (`lib/sentry/scrub.ts`, que já tira e-mail, CPF, telefone e chave do Jev), esta
 * máscara acrescenta o que a do Sentry não faz:
 *
 *  - **senha de aparelho** → `[SENHA]`: o que vem depois de "senha", "PIN",
 *    "código de desbloqueio" e "padrão de desbloqueio" (e "padrão em L");
 *  - **nome** → `[NOME]`: o primeiro nome do contato E o sobrenome, mais quem o
 *    cliente diz ser ("meu nome é Maria Souza");
 *  - **endereço** → `[ENDERECO]` (rua/avenida + número, com apartamento ou bloco)
 *    e **CEP** → `[CEP]`.
 *
 * ═══ O QUE A MÁSCARA É, E O QUE NÃO É ═══
 *
 * É uma limpeza por REGRAS DE TEXTO. Ela erra para o lado de apagar demais
 * ("a senha é importante" vira "a senha é [SENHA]"): apagar de mais custa um
 * pouco de contexto para o Jev; apagar de menos custa um dado pessoal fora do
 * país. Mas ela NÃO é infalível — um apelido que não está no cadastro, um
 * telefone escrito por extenso ou um endereço sem "rua" passam. O texto do aceite
 * do administrador (`ACEITE_DE_RESPOSTA`) diz isso, e é por isso que a
 * mensagem do cliente nunca vai ao DEPOIS.
 *
 * Funções puras: nunca lançam, não leem rede nem banco, e a mesma entrada dá a
 * mesma saída. Aplicar duas vezes dá o mesmo resultado que aplicar uma.
 */
import { scrubMessage } from "@/lib/sentry/scrub";

export interface OpcoesDaMascara {
  /**
   * O nome do contato, como o cadastro tem ("Maria da Silva Souza"). Cada pedaço
   * vira `[NOME]` onde aparecer — primeiro nome, sobrenome, em qualquer caixa e
   * com ou sem acento. Vazio ou ausente: só o que o cliente diz de si.
   */
  nomeDoContato?: string | null;
  /**
   * Valores que o cliente já entregou como segredo (a senha do aparelho que o cofre
   * do turno guarda). Onde aparecerem — com ou sem o rótulo "senha" na frente —
   * viram `[SENHA]`. Menos de 3 caracteres não vale (apagaria letra solta).
   */
  valoresSecretos?: readonly string[];
}

/** Pedaços de nome que não identificam ninguém e que apagar só estraga a frase. */
const PARTICULAS = new Set(["de", "da", "do", "dos", "das", "e", "di", "du", "van", "von", "la", "le"]);

/** Sem acento e em minúscula, MESMO comprimento do original (caractere a caractere). */
function semAcento(texto: string): string {
  let saida = "";
  for (const ch of texto.normalize("NFC")) {
    const base = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    saida += base.length === ch.length ? base : ch.toLowerCase();
  }
  return saida;
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Cada ocorrência (palavra inteira) de `palavras` em `texto`, ignorando caixa e acento. */
function trocarPalavras(texto: string, palavras: readonly string[], marca: string): string {
  if (palavras.length === 0) return texto;
  const original = texto.normalize("NFC");
  // Caractere raro que muda de tamanho ao perder o acento: melhor casar só pela caixa
  // (sem dobrar acento) do que deixar o nome passar.
  const dobra = semAcento(original).length === original.length;
  const base = dobra ? semAcento(original) : original.toLowerCase();
  const alvo = palavras.map((p) => escapar(dobra ? semAcento(p) : p.toLowerCase())).join("|");
  const re = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${alvo})(?![\p{L}\p{N}])`, "gu");
  if (base.length !== original.length) return original.replace(re, marca);
  let saida = "";
  let ultimo = 0;
  for (const m of base.matchAll(re)) {
    saida += original.slice(ultimo, m.index) + marca;
    ultimo = m.index + m[0].length;
  }
  return saida + original.slice(ultimo);
}

/** Os pedaços do nome do cadastro que valem a pena apagar. */
export function pedacosDoNome(nome: string | null | undefined): string[] {
  if (!nome) return [];
  const vistos = new Set<string>();
  const pedacos: string[] = [];
  for (const p of nome.normalize("NFC").split(/[\s,;]+/)) {
    const limpo = p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    const chave = semAcento(limpo);
    // Uma letra só ("J.") apagaria cada "j" solto da conversa; partícula, a frase.
    if (limpo.length < 2 || PARTICULAS.has(chave) || vistos.has(chave)) continue;
    vistos.add(chave);
    pedacos.push(limpo);
  }
  return pedacos;
}

/* ─────────────────────────────── senha ─────────────────────────────── */

/** Uma ocorrência de senha: onde o VALOR começa e termina, e qual é. */
export interface SenhaEncontrada {
  inicio: number;
  fim: number;
  valor: string;
}

const CONECTOR = String.raw`(?:\s*[:=\-–—]\s*|\s+(?:[eé]|era|seria|fica|ficou|foi|sera|será)\s+|\s+)`;
const CONECTOR_DE_ROTULO = String.raw`(?:\s*[:=\-–—]\s*|\s+(?:[eé]|era|seria|fica|ficou|foi|sera|será)\s+)`;

/**
 * O valor, em ordem de força:
 *  1. entre aspas ("abc 123");
 *  2. dígitos com separador ("1 2 3 4", "12-34-56"), ou um token com algum dígito;
 *  3. "em L" / "em Z": o padrão de desenho em letra;
 *  4. uma palavra solta (frase-senha) — só quando há rótulo (":" "=" "é").
 */
const VALOR_ENTRE_ASPAS = String.raw`["'“‘«][^"'”’»\n]{1,40}["'”’»]`;
// O `!` e o `?` ficam DENTRO do valor: "Mari2024!" é uma senha inteira, e deixar o
// `!` de fora vazaria o último caractere dela. O ponto final não (ver `aparar`).
const VALOR_COM_DIGITO = String.raw`(?:\d(?:[\s.\-–]?\d){2,}|[^\s,;"'“”‘’]*\d[^\s,;"'“”‘’]*)`;
const VALOR_EM_LETRA = String.raw`em\s+[A-Za-z]{1,2}(?![\p{L}])`;
const VALOR_PALAVRA = String.raw`[^\s,;!?"'“”‘’.:]{2,40}`;

const ROTULO_DE_SENHA = String.raw`(?:senha(?:\s+de\s+desbloqueio|\s+da\s+tela|\s+do\s+(?:celular|aparelho|iphone))?|pin|c[oó]digo\s+de\s+desbloqueio|padr[aã]o\s+de\s+(?:desbloqueio|tela)|padr[aã]o\s+d[ao]\s+(?:tela|celular|aparelho)|desenho\s+de\s+desbloqueio)`;
const ROTULO_PADRAO_SOLTO = String.raw`padr[aã]o`;

function regexDaSenha(): RegExp[] {
  // 1) rótulo completo + valor entre aspas / com dígito / "em L" (conector livre)
  const forte = new RegExp(
    String.raw`(?<![\p{L}\p{N}])${ROTULO_DE_SENHA}(?![\p{L}\p{N}])${CONECTOR}(?<v>${VALOR_ENTRE_ASPAS}|${VALOR_COM_DIGITO}|${VALOR_EM_LETRA})`,
    "giu",
  );
  // 2) rótulo completo + palavra solta, só com ":" "=" "é"
  const palavra = new RegExp(
    String.raw`(?<![\p{L}\p{N}])${ROTULO_DE_SENHA}(?![\p{L}\p{N}])${CONECTOR_DE_ROTULO}(?<v>${VALOR_PALAVRA})`,
    "giu",
  );
  // 3) "padrão" sozinho é palavra comum de loja ("fora do padrão"): só com dígito ou "em L"
  const padrao = new RegExp(
    String.raw`(?<![\p{L}\p{N}])${ROTULO_PADRAO_SOLTO}(?![\p{L}\p{N}])${CONECTOR}(?<v>${VALOR_ENTRE_ASPAS}|${VALOR_COM_DIGITO}|${VALOR_EM_LETRA})`,
    "giu",
  );
  return [forte, palavra, padrao];
}

/**
 * Onde há senha no texto. Os trechos que se sobrepõem são unidos. Usado pela
 * máscara E pela L4 (`conferencia-local.ts`), que precisa do valor para saber se
 * o rascunho o repete — e que o guarda só na memória do turno, nunca em log.
 */
export function encontrarSenhas(texto: string): SenhaEncontrada[] {
  const achados: SenhaEncontrada[] = [];
  for (const re of regexDaSenha()) {
    for (const m of texto.matchAll(re)) {
      const bruto = m.groups?.v;
      if (bruto === undefined || m.index === undefined) continue;
      // O ponto final da frase não é da senha ("minha senha é 1234.").
      const valor = bruto.replace(/\.+$/u, "");
      if (valor === "") continue;
      const fim = m.index + m[0].length - (bruto.length - valor.length);
      achados.push({ inicio: fim - valor.length, fim, valor });
    }
  }
  achados.sort((a, b) => a.inicio - b.inicio || b.fim - a.fim);
  const uniao: SenhaEncontrada[] = [];
  for (const a of achados) {
    const ultimo = uniao[uniao.length - 1];
    if (ultimo && a.inicio < ultimo.fim) continue;
    uniao.push(a);
  }
  return uniao;
}

function mascararSenhas(texto: string): string {
  const achados = encontrarSenhas(texto);
  if (achados.length === 0) return texto;
  let saida = "";
  let ultimo = 0;
  for (const a of achados) {
    saida += texto.slice(ultimo, a.inicio) + "[SENHA]";
    ultimo = a.fim;
  }
  return saida + texto.slice(ultimo);
}

/* ─────────────────────── endereço, CEP e quem se apresenta ─────────────────────── */

const TIPO_DE_LOGRADOURO = String.raw`(?:rua|r\.|avenida|av\.?|travessa|tv\.|alameda|al\.|rodovia|estrada|pra[çc]a|largo|beco|via)`;
const COMPLEMENTO = String.raw`(?:\s*[-–,]?\s*(?:apto?|apartamento|ap|bloco|bl|casa|sala|fundos|loja)\.?\s*[\p{L}\p{N}]{1,6})*`;
const ENDERECO = new RegExp(
  String.raw`(?<![\p{L}\p{N}])${TIPO_DE_LOGRADOURO}\s+[^\n\d,;]{2,60}?(?:\s*,\s*|\s+)(?:n[º°o]?\.?\s*)?\d{1,5}(?![\p{L}\p{N}])${COMPLEMENTO}`,
  "giu",
);
const CEP = /(?<![\d-])\d{2}\.?\d{3}-\d{3}(?![\d-])/g;

const APRESENTACAO = /(?<![\p{L}\p{N}])(meu\s+nome(?:\s+completo)?\s+(?:é|eh|e)|me\s+chamo|pode\s+me\s+chamar\s+de|aqui\s+(?:é|eh)\s+(?:o|a)|sou\s+(?:o|a))\s+(\S+(?:\s+\S+){0,4})/giu;

const CAPITALIZADA = /^[\p{Lu}][\p{L}'’-]*$/u;

/** "meu nome é Maria da Silva e quero..." → "meu nome é [NOME] e quero..." */
function mascararQuemSeApresenta(texto: string): string {
  return texto.replace(APRESENTACAO, (_todo, abertura: string, resto: string) => {
    const palavras = resto.split(/\s+/);
    let n = 0;
    while (n < palavras.length) {
      const p = palavras[n]!.replace(/[.,;:!?]+$/u, "");
      const particula = PARTICULAS.has(semAcento(p)) && n > 0 && n < palavras.length - 1;
      if (!CAPITALIZADA.test(p) && !particula) break;
      n += 1;
      if (/[.,;:!?]$/u.test(palavras[n - 1]!)) break;
    }
    // Termina sempre numa palavra de verdade, nunca numa partícula solta.
    while (n > 0 && PARTICULAS.has(semAcento(palavras[n - 1]!.replace(/[.,;:!?]+$/u, "")))) n -= 1;
    if (n === 0) return `${abertura} ${resto}`;
    const pontuacao = /[.,;:!?]+$/u.exec(palavras[n - 1]!)?.[0] ?? "";
    return `${abertura} [NOME]${pontuacao}${palavras.length > n ? " " + palavras.slice(n).join(" ") : ""}`;
  });
}

/* ────────────────────────────── a máscara ────────────────────────────── */

/**
 * Apaga senha, dado pessoal e nome do texto. A ordem importa: a senha primeiro
 * (um PIN de 8 dígitos seria lido como telefone), depois endereço e CEP (o número
 * da casa não pode virar telefone), depois e-mail/CPF/telefone (`scrubMessage`) e
 * por fim os nomes.
 */
export function mascararSegredos(texto: string, opcoes: OpcoesDaMascara = {}): string {
  try {
    let t = mascararSenhas(texto);
    t = t.replace(ENDERECO, "[ENDERECO]").replace(CEP, "[CEP]");
    t = scrubMessage(t);
    t = mascararQuemSeApresenta(t);
    t = trocarPalavras(t, pedacosDoNome(opcoes.nomeDoContato), "[NOME]");
    t = trocarPalavras(
      t,
      (opcoes.valoresSecretos ?? []).map((v) => v.trim()).filter((v) => v.length >= 3),
      "[SENHA]",
    );
    return t;
  } catch {
    // Nunca lança — e, na dúvida, NADA sai: um texto que a máscara não consegue
    // ler não pode seguir inteiro para fora do país.
    return "[TEXTO NÃO PÔDE SER MASCARADO]";
  }
}
