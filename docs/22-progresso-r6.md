# Progresso r6 (memória do trabalho; reler ao retomar)
Branch `celuzap-1.69.0-r6` a partir de `celuzap-1.69.0-r5` (`6ae450f3a`). Sem push.

## Feito
- Spec e plano (docs 20 e 21). Causa lida no código: estilo da instalação sobrescreve o accent e o layout de auth mostra o logo enviado.

## Também feito
- Cor de ação e logo fixas nas telas de auth (bloco `[data-superficie-auth]` + duas imagens `logo-celuzap-auth-*.svg`); links em azul de ação; teste de cerca `tests/unit/auth-azul-fixo.test.ts`.
- E2E da fachada reescritos para a logo fixa: `marca-logo.spec.ts` (casos 2, 3 e 6; o caso 1 só mede a barra lateral e não mudou) e `logo-moldura-no-tema-escuro.spec.ts` (caso 3). **Não foram rodados** (exigem Supabase local); garantido apenas que compilam (`pnpm typecheck`).
- Fragmentos de release: `redesign-r4.md` (texto corrigido: dizia "verde Celuzap") e `telas-de-entrada-em-azul.md`. O script calcula 1.70.0 para o conjunto; 1.70.1 só sairia se a 1.70.0 fosse cortada antes e este fragmento ficasse sozinho.

## Não visto no navegador
- `/login/mfa` e `/login/recovery`: usam o mesmo layout de auth, mas exigem sessão parcial (primeiro fator verificado), que não existe sem Supabase local. Conferidos só pelo código e pelo teste de cerca.
- O foco dos campos no tema escuro (só o claro foi capturado), e o modo claro do `/login` fora da simulação de marca verde.
- Telas logadas.

## Pendências técnicas
- Rodar os e2e `marca-logo` e `logo-moldura-no-tema-escuro` num ambiente com Supabase local e conferir os asserts novos da fachada.
- O `.env.local` de teste visual contamina a suíte unitária: apagar sempre depois da prova em tela.
