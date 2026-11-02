import { SIMBOLO } from "@/lib/branding/desenho";

const COR_FIXA = {
  contorno: "#1a2333",
  anel: "#ffffff",
  "entalhe-anel": "#ffffff",
  entalhe: "#1a2333",
  letra: "#ffffff",
} as const;

/**
 * O símbolo do produto para o `ImageResponse` (favicon e ícones do app): as mesmas
 * camadas de `desenho.ts`, com cor fixa — o ladrilho tem fundo próprio, não segue o tema.
 */
export function SimboloParaImagem({ lado }: { readonly lado: number }) {
  const { degrade } = SIMBOLO;
  return (
    <svg viewBox={SIMBOLO.viewBox} width={lado} height={lado}>
      <defs>
        <linearGradient id={degrade.id} x1="0.85" y1="0.05" x2="0.1" y2="0.95">
          <stop offset="0" stopColor={degrade.de} />
          <stop offset="0.5" stopColor={degrade.meio} />
          <stop offset="1" stopColor={degrade.ate} />
        </linearGradient>
      </defs>
      {SIMBOLO.camadas.map((c, n) => {
        const fill = c.papel === "tela" ? `url(#${degrade.id})` : COR_FIXA[c.papel];
        return c.forma === "rect" ? (
          <rect key={n} fill={fill} {...c.attrs} />
        ) : (
          <path key={n} fill={fill} {...c.attrs} />
        );
      })}
    </svg>
  );
}
