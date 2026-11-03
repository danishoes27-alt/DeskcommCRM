# Spec r6: telas antes do login em azul

Base: r5 (`6ae450f3a`). Branch `celuzap-1.69.0-r6`.

## Problema (provado em janela anônima, app.celuzap.com/login)
O botão "Entrar" segue verde e a logo é a antiga, verde, com moldura branca.

## Causa (lida no código e no banco, não suposta)
1. **Cor:** o layout raiz injeta `<style id="marca-instalacao">` com a cor SALVA da instalação
   (`platform_branding.accent_hex`, hoje `#00c853`), que sobrescreve `--color-accent*` em `:root`.
   O app logado muda por outro caminho (cor da empresa), mas as telas de auth não têm empresa e
   herdam a cor da instalação. Os apelidos do shadcn (`--primary`, `--ring`) são resolvidos em
   `:root`, então só trocar `--color-accent` num filho não basta.
2. **Logo:** `app/(public)/layout.tsx` mostra o logo enviado da instalação
   (`platform_branding.logo_path`) quando existe; é a logo antiga.

## Decisão do Berg
As telas de auth usam SEMPRE a cor de ação e a logo fixas do produto, nunca a configuração da
instalação ou da empresa. Configurações › Logo e cores segue valendo dentro do app.

## Solução
- `[data-superficie-auth]` em `app/globals.css` fixa, no wrapper do layout de auth, os tokens de
  ação (rampa, accent, fg, hover, soft, ring e os apelidos `--primary*`/`--ring`), claro e escuro.
  Variável declarada no próprio elemento vence a herdada, qualquer que seja a especificidade.
- Logo fixa no layout de auth: variantes azuis geradas por `scripts/gerar-logo-celuzap.mjs`
  (escuro: símbolo `#5482fb`, "C" e texto brancos, sem moldura; claro: símbolo `#2347b8`, texto
  `#0c112a`), trocadas por `dark:`.
- Links das telas de auth em `text-primary` (claro `#2347b8`, escuro `#5482fb`, ≥ 4,5).
- "Entrar com Google" não muda.

## Fora de escopo
Migration, banco, app logado, menu, Jev, agente, verde semântico (status, WhatsApp).

## Aceite
Teste de cerca: o layout de auth não referencia a cor verde antiga nem a logo antiga, e os
literais do bloco fixo batem com a régua do produto. `pnpm test:db` verde; unit = base (51 em 19).
