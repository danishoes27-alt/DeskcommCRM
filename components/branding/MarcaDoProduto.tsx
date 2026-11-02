import { LOGOTIPO, SIMBOLO, type CamadaDoSimbolo } from "@/lib/branding/desenho";
import { cn } from "@/lib/utils";

/**
 * A marca do PRODUTO desenhada em SVG inline — o que a tela mostra quando
 * ninguém configurou marca própria (`marcaEhADoProduto`, em `lib/branding.ts`).
 *
 * Inline, e não `<img src="/algo.svg">`, por três motivos:
 *  - as cores seguem o TEMA: sálvia mais clara e nome em creme no escuro, como
 *    a régua do produto já define — um arquivo estático teria uma cor só;
 *  - nada em `public/`: um `.svg` fixo ali seria servido na instalação de um
 *    revendedor que configurou a marca dele (ver `lib/branding/desenho.ts`);
 *  - a barra lateral já usa `<img>` para o logo CONFIGURADO, e o e2e
 *    `marca-logo.spec.ts` mede "barra sem `<img>`" como "sem logo do
 *    revendedor". Um `<img>` do produto ali faria a spec medir a coisa errada.
 *
 * O texto alternativo é o `nome` que a tela já resolveu — nunca uma string
 * fixa, para que a catraca de marca (`tests/unit/branding.test.ts`) continue
 * contando ZERO ocorrências fora de `lib/branding.ts`.
 */

type Props = {
  readonly nome: string;
  readonly className?: string;
  /** `true` quando o texto ao lado já nomeia a marca — evita ler duas vezes. */
  readonly decorativo?: boolean;
};

const SIMBOLO_CLARO_ESCURO = "fill-[#0b7d46] dark:fill-[#4db074]";
const NOME_CLARO_ESCURO = "fill-[#0c112a] dark:fill-[#e8e9f3]";
const SUFIXO_CLARO_ESCURO = "fill-[#4a4f6e] dark:fill-[#9a9cb8]";

// As classes acima repetem os hexes de `CORES_DA_MARCA` porque o Tailwind só
// gera utilitário para valor LITERAL no fonte. Quem impede os dois de divergirem
// é `tests/unit/marca-do-produto.test.tsx`, que compara as classes à paleta —
// e não uma asserção em runtime: um throw aqui derrubaria a casca inteira.
export const CLASSES_DE_COR = {
  simbolo: SIMBOLO_CLARO_ESCURO,
  nome: NOME_CLARO_ESCURO,
  sufixo: SUFIXO_CLARO_ESCURO,
} as const;

function acessibilidade(nome: string, decorativo: boolean) {
  return decorativo
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": nome } as const);
}

const CLASSE_DA_CAMADA: Record<CamadaDoSimbolo["papel"], string> = {
  contorno: "fill-[#1a2333] dark:fill-[#5f7099]",
  anel: "fill-white",
  tela: "",
  "entalhe-anel": "fill-white",
  entalhe: "fill-[#1a2333] dark:fill-[#5f7099]",
  letra: "fill-white",
};

function Camadas() {
  const { degrade } = SIMBOLO;
  return (
    <>
      <defs>
        <linearGradient id={degrade.id} x1="0.85" y1="0.05" x2="0.1" y2="0.95">
          <stop offset="0" stopColor={degrade.de} />
          <stop offset="0.5" stopColor={degrade.meio} />
          <stop offset="1" stopColor={degrade.ate} />
        </linearGradient>
      </defs>
      {SIMBOLO.camadas.map((c, n) => {
        const props = {
          className: CLASSE_DA_CAMADA[c.papel] || undefined,
          fill: c.papel === "tela" ? `url(#${degrade.id})` : undefined,
          ...c.attrs,
        };
        return c.forma === "rect" ? <rect key={n} {...props} /> : <path key={n} {...props} />;
      })}
    </>
  );
}

/** O símbolo sozinho — para a barra recolhida, avatar e cantos apertados. */
export function SimboloDoProduto({ nome, className, decorativo = false }: Props) {
  return (
    <svg
      viewBox={SIMBOLO.viewBox}
      className={cn("shrink-0", className)}
      {...acessibilidade(nome, decorativo)}
    >
      <Camadas />
    </svg>
  );
}

/** Símbolo + nome — para a barra aberta e a fachada de entrada. */
export function LogotipoDoProduto({ nome, className, decorativo = false }: Props) {
  const { texto } = LOGOTIPO;
  return (
    <svg
      viewBox={LOGOTIPO.viewBox}
      className={cn("shrink-0", className)}
      {...acessibilidade(nome, decorativo)}
    >
      <Camadas />
      <text
        x={texto.x}
        y={texto.y}
        fontSize={texto.tamanho}
        fontWeight={700}
        fontFamily="'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif"
        textLength={nome.length * 0.58 * texto.tamanho > texto.larguraMaxima ? texto.larguraMaxima : undefined}
        lengthAdjust="spacingAndGlyphs"
        className={NOME_CLARO_ESCURO}
      >
        {nome}
      </text>
    </svg>
  );
}
