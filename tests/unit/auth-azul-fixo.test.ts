import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REGUA_DO_PRODUTO } from "@/lib/branding/regua-do-produto";

/**
 * AS TELAS ANTES DO LOGIN SÃO AZUIS (r6) — e continuam, qualquer que seja a marca salva.
 *
 * Provado em janela anônima na produção: com `platform_branding.accent_hex` verde salvo, o botão
 * "Entrar" ficava verde e a fachada mostrava o logo enviado (a logo antiga). Este arquivo não olha
 * pixel: olha os tokens e os arquivos, que é onde a decisão mora.
 */
const RAIZ = process.cwd();
const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");
const semComentario = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const VERDE_DE_MARCA = /#0b7d46|#00c853|#0f9d58|#1b5f2c|#20995a|#0a6e57/i;
const CLASSE_VERDE = /\b(?:text|bg|border|ring|fill|from|to)-(?:green|emerald|teal|lime)-\d+/;

/** O bloco `[data-superficie-auth]` do claro e do escuro, como texto. */
function blocos() {
  const css = ler("app/globals.css");
  const claro = css.match(/\n\[data-superficie-auth\]\s*\{([\s\S]*?)\n\}/);
  const escuro = css.match(/\n\[data-theme="dark"\]\s+\[data-superficie-auth\]\s*\{([\s\S]*?)\n\}/);
  return { claro: claro?.[1] ?? "", escuro: escuro?.[1] ?? "" };
}
const valor = (bloco: string, nome: string) =>
  bloco.match(new RegExp(`${nome.replace(/[-]/g, "\-")}:\s*([^;]+);`))?.[1]?.trim();

const ARQUIVOS_DE_AUTH = [
  "app/(public)/layout.tsx",
  "app/(public)/login/page.tsx",
  "app/(public)/login/forgot/page.tsx",
  "app/(public)/login/recovery/page.tsx",
  "app/(public)/login/reset/page.tsx",
  "app/(public)/signup/page.tsx",
  "components/auth/LoginForm.tsx",
  "components/auth/ForgotPasswordForm.tsx",
  "components/auth/SignupForm.tsx",
  "components/auth/ResetPasswordForm.tsx",
  "components/auth/RecoveryForm.tsx",
  "components/auth/MfaForm.tsx",
];

describe("cor de ação fixa nas telas de auth", () => {
  it("o layout de auth marca o wrapper e o bloco existe nos dois temas (guarda de vacuidade)", () => {
    expect(ler("app/(public)/layout.tsx")).toContain("data-superficie-auth");
    const { claro, escuro } = blocos();
    expect(claro).toContain("--color-accent:");
    expect(escuro).toContain("--color-accent:");
  });

  it("os literais do bloco são a rampa do produto (régua) — não um azul à parte", () => {
    const { claro, escuro } = blocos();
    const rampa = REGUA_DO_PRODUTO.rampaDoProduto;
    const graus = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
    graus.forEach((g, i) => expect(valor(claro, `--color-accent-${g}`), `grau ${g}`).toBe(rampa[i]));
    expect(valor(claro, "--color-accent")).toBe(rampa[6]);
    expect(valor(claro, "--primary")).toBe(rampa[6]);
    expect(valor(claro, "--color-accent-hover")).toBe(rampa[7]);
    expect(valor(claro, "--color-accent-soft")).toBe(rampa[1]);
    expect(valor(claro, "--ring")).toBe(rampa[5]);
    expect(valor(escuro, "--color-accent")).toBe(rampa[4]);
    expect(valor(escuro, "--primary")).toBe(rampa[4]);
    expect(valor(escuro, "--color-accent-hover")).toBe(rampa[3]);
    expect(valor(escuro, "--ring")).toBe(rampa[4]);
  });

  it("redeclara os apelidos do shadcn: `--primary` é resolvido em :root e não acompanha o filho", () => {
    const { claro, escuro } = blocos();
    for (const b of [claro, escuro]) {
      expect(b).toContain("--primary:");
      expect(b).toContain("--primary-foreground:");
      expect(b).toContain("--ring:");
    }
  });

  it("nenhum verde de marca no bloco nem nos arquivos de auth", () => {
    const { claro, escuro } = blocos();
    expect(claro + escuro).not.toMatch(VERDE_DE_MARCA);
    for (const f of ARQUIVOS_DE_AUTH) {
      const fonte = semComentario(ler(f));
      expect(fonte, f).not.toMatch(VERDE_DE_MARCA);
      expect(fonte, f).not.toMatch(CLASSE_VERDE);
    }
  });

  it("os links das telas de auth usam a cor de ação, não o cinza nem o texto comum", () => {
    for (const f of ARQUIVOS_DE_AUTH) {
      const fonte = semComentario(ler(f));
      expect(fonte, f).not.toMatch(/text-muted-foreground underline/);
      expect(fonte, f).not.toMatch(/text-foreground underline/);
    }
    expect(ler("app/(public)/login/page.tsx")).toContain("text-primary underline");
  });
});

describe("a logo fixa das telas de auth", () => {
  it("o layout usa só as duas imagens fixas, e não o logo enviado nem a marca verde antiga", () => {
    const fonte = semComentario(ler("app/(public)/layout.tsx"));
    expect(fonte).toContain("/brand/logo-celuzap-auth-claro.svg");
    expect(fonte).toContain("/brand/logo-celuzap-auth-escuro.svg");
    expect(fonte).not.toMatch(/marca\.logoUrl|marca\.logoDarkUrl|LogotipoDoProduto/);
  });

  it("as duas imagens existem, sem verde e sem moldura branca", () => {
    for (const modo of ["claro", "escuro"]) {
      const svg = ler(`public/brand/logo-celuzap-auth-${modo}.svg`);
      expect(svg, modo).not.toMatch(VERDE_DE_MARCA);
      // O <rect> branco dentro de <defs> é a máscara do entalhe, não moldura: só o desenho conta.
      const desenho = svg.replace(/<defs>[\s\S]*?<\/defs>/, "");
      expect(desenho, modo).not.toMatch(/<rect[^>]*fill="#fff(?:fff)?"/i);
      expect(svg, modo).not.toContain("<linearGradient");
      expect(fs.existsSync(path.join(RAIZ, `public/brand/logo-celuzap-auth-${modo}.png`)), modo).toBe(true);
    }
    expect(ler("public/brand/logo-celuzap-auth-escuro.svg")).toContain('fill="#5482fb"');
    expect(ler("public/brand/logo-celuzap-auth-escuro.svg")).toMatch(/fill="#ffffff">Celuzap</);
    expect(ler("public/brand/logo-celuzap-auth-claro.svg")).toContain('fill="#2347b8"');
  });
});
