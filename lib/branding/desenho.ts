/**
 * O DESENHO da marca do produto — símbolo e logotipo — como geometria pura.
 *
 * Mora aqui, e não num `.svg` em `public/`, por duas razões que a doutrina de
 * marca própria já paga:
 *
 *  1. `public/` é servido a todo mundo, sempre. Um arquivo fixo ali seria a
 *     marca do PRODUTO na instalação de um revendedor que configurou a dele —
 *     é exatamente o vazamento que `tests/unit/branding.test.ts` vigia. Como
 *     geometria, o desenho só aparece onde um componente decide que a marca em
 *     vigor é a padrão (`marcaEhADoProduto`, em `lib/branding.ts`).
 *  2. O favicon (`app/icon.tsx`) é gerado em runtime pelo `ImageResponse`, que
 *     aceita SVG inline mas não lê arquivo do disco. Um único desenho alimenta
 *     a tela e o ícone — dois arquivos divergiriam na primeira revisão da marca.
 *
 * As cores NÃO estão aqui de propósito: quem desenha escolhe (a tela lê os
 * tokens do tema; o favicon lê a régua do produto). A fonte deste arquivo são
 * os SVGs em `docs/brand/`; ao trocar a arte, regenere os dois lados a partir
 * deles.
 */

/**
 * O símbolo do Celuzap (r4): um celular com um "C" em balão de conversa. Fonte:
 * `docs/assets/logo-celuzap.svg`, gerado por `scripts/gerar-logo-celuzap.cjs` —
 * ao mexer na arte, regenere os dois a partir do script.
 *
 * Camadas, de baixo para cima. `papel` diz que cor a camada leva: o contorno e o
 * entalhe seguem o tema (azul-marinho no claro, azul-acinzentado no escuro, para
 * não sumir no fundo), o anel e a letra são sempre brancos, a tela é o degradê.
 */
export type CamadaDoSimbolo = {
  readonly papel: "contorno" | "anel" | "tela" | "entalhe-anel" | "entalhe" | "letra";
  readonly forma: "rect" | "path";
  readonly attrs: Readonly<Record<string, string | number>>;
};

const LETRA_C =
  "M600.7 433.0 A118 118 0 1 0 600.7 591.0 L562.0 556.2 A66 66 0 1 1 562.0 467.8 Z M408 566 L397 645 L478 622 Z";

export const SIMBOLO = {
  viewBox: "300 162 424 698",
  degrade: { id: "celuzap-tela", de: "#00C853", meio: "#0F9D58", ate: "#0A6E57" },
  camadas: [
    { papel: "contorno", forma: "rect", attrs: { x: 308, y: 170, width: 408, height: 682, rx: 66 } },
    { papel: "anel", forma: "rect", attrs: { x: 326, y: 188, width: 372, height: 646, rx: 50 } },
    { papel: "tela", forma: "rect", attrs: { x: 348, y: 212, width: 328, height: 600, rx: 34 } },
    { papel: "entalhe-anel", forma: "path", attrs: { d: "M402 188 H622 V214 Q622 252 584 252 H440 Q402 252 402 214 Z" } },
    { papel: "entalhe", forma: "path", attrs: { d: "M418 188 H606 V212 Q606 236 582 236 H442 Q418 236 418 212 Z" } },
    { papel: "letra", forma: "path", attrs: { d: LETRA_C, "fill-rule": "evenodd" } },
  ] as readonly CamadaDoSimbolo[],
} as const;

/** Símbolo + nome. O nome é texto (a tela já resolveu `nome`), não caminhos. */
export const LOGOTIPO = {
  viewBox: "296 156 1190 710",
  proporcao: 1190 / 710,
  texto: { x: 760, y: 560, tamanho: 230, larguraMaxima: 700 },
} as const;

/**
 * As cores da marca do produto, por tema — os mesmos graus da régua
 * (`regua-do-produto.ts`): sálvia 600/400 para o símbolo, neutro 900/0 para
 * o nome e neutro 600/300 para o "CRM". Copiadas dos SVGs de `docs/brand/`.
 */
export const CORES_DA_MARCA = {
  claro: { simbolo: "#0b7d46", nome: "#0c112a", sufixo: "#4a4f6e" },
  escuro: { simbolo: "#4db074", nome: "#e8e9f3", sufixo: "#9a9cb8" },
} as const;
