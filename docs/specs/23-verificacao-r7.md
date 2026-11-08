# Verificação da r7 — vermelhos herdados da r6 e leitura do CI

Medido em 2026-11-08, sem enviar nada. Complementa `23-plano-consulta-aparelhos.md`.

## 1. Quais testes vermelhos já eram vermelhos na r6

Método: `git worktree` temporário **fora** do repositório (`C:\Dev\tmp-r6-check`, detached em
`refs/heads/celuzap-1.69.0-r6`, `08c32b5`), `pnpm install --frozen-lockfile` só ali (nenhum
`package.json`/`pnpm-lock.yaml` alterado em nenhum dos lados), e os **mesmos 22 arquivos**, com o mesmo
comando (`pnpm vitest run <arquivos>`) e a mesma máquina, nas duas árvores. Worktree removido depois.

Resultado: **os mesmos 21 arquivos, com a mesma contagem de casos vermelhos, nas duas branches.** Nenhum
arquivo ficou vermelho na r7 e verde na r6 — **não há regressão da r7 nestes 22**. O `branding.test.ts`,
que ficou vermelho na primeira versão da r7 (domínio de loja no código), passa na r7 depois do ajuste 1, e
**não foi alterado** (`git diff refs/heads/celuzap-1.69.0-r6..HEAD -- tests/unit/branding.test.ts` vazio).

| Arquivo | Vermelho na r6 | Vermelho na r7 | Causa |
|---|---|---|---|
| `tests/unit/atualizacao-confere-regras-de-isolamento.test.ts` (2) | sim | sim | **insistiu**: estoura o tempo (a conferência chama shell/`bash`; dois casos passam de 150 s no Windows) |
| `tests/unit/release-chega-na-lp.test.ts` (1) | sim | sim | **insistiu**: estoura o limite de 15 s (script de release via `bash`) |
| `lib/theme.test.tsx` (1) | sim | sim | **insistiu**: o `beforeAll` do jsdom estoura 10 s nesta máquina |
| `tests/unit/branding.test.ts` | não | **não** (após o ajuste 1) | era a r7: `aparelhos.graucell.com` no código; corrigido movendo os hosts para a configuração |
| `tests/unit/catalogo-de-ensaio-espelha-o-vocabulario.test.ts` (1) | sim | sim | Python não instalado (atalho da Microsoft Store, exit 9009) |
| `tests/unit/confianca-do-handoff-nao-e-similaridade.test.ts` (1) | sim | sim | caminhos com `\` do Windows: a varredura não acha `workers/ai-response-worker.ts` |
| `tests/unit/rascunho-superado-nao-e-regravado.test.ts` (1) | sim | sim | idem: caminho `app\app\ai\agents\…` |
| `tests/unit/followups-de-demonstracao-sao-possiveis.test.ts` (1) | sim | sim | idem: `lib\followup\…` |
| `tests/unit/drain-loop-carrega-deps-sob-tsx.test.ts` (1) | sim | sim | estoura 15 s (executa `tsx` num subprocesso) |
| `tests/unit/e2e-parte-4-fala-com-os-servicos-do-runner.test.ts` (2) | sim | sim | `bash` perde as barras do caminho temporário (`C:UsersBERG…`) |
| `tests/unit/e2e-supabase-start-tenta-de-novo.test.ts` (3) | sim | sim | arquivo temporário de um script `bash` não é criado no Windows |
| `tests/unit/executor-proprio-so-roda-o-que-e-nosso.test.ts` (1) | sim | sim | script `bash` sai com 1 no Windows |
| `tests/unit/guarda-da-release-confere-identidade.test.ts` (7) | sim | sim | scripts `bash`/`git` da guarda de release não rodam no Windows |
| `tests/unit/guarda-da-release-reconhece-o-corte.test.ts` (7) | sim | sim | idem |
| `tests/unit/imagens-ok-so-aceita-pulo-declarado.test.ts` (1) | sim | sim | estoura 60 s (script `bash`) |
| `tests/unit/knobs-da-versao-publicada-sao-aplicados.test.ts` (1) | sim | sim | varredura da árvore estoura 15 s; **passa** com `--testTimeout=200000` |
| `tests/unit/telas-sem-dado-de-mentira.test.ts` (1) | sim | sim | idem: estoura 15 s; **passa** com timeout maior |
| `tests/unit/populacao-do-proximo-nnnn.test.ts` (13) | sim | sim | `spawnSync bash ENOENT` |
| `tests/unit/lgpd-pdf-campos-personalizados.test.ts` (1) | sim | sim | `pdfjs-dist`: "Invalid factory url … must include trailing slash" (caminho Windows) |
| `tests/unit/lgpd-pdf-meet.test.ts` (4) | sim | sim | idem |
| `tests/unit/lgpd-pdf-propostas.test.ts` (2) | sim | sim | idem |
| `tests/unit/lgpd-pdf-replies.test.ts` (1) | sim | sim | idem |

Todas as causas são do ambiente Windows desta máquina (sem `bash`/Python no PATH, caminhos com `\`, tempo).
No CI do GitHub (Linux) esses arquivos são exercitados de verdade: é lá que se prova que passam.

## 2. O que o CI faz (`.github/workflows`), sem enviar nada

| Pergunta | Resposta |
|---|---|
| O que dispara o `verify`? | `pull_request` (qualquer) e `push` na `main` — `ci.yml:3-6` (`on: pull_request:` e `push: branches: [main]`). **Push de branch comum, sem PR, não dispara.** Tag não dispara. |
| E o `e2e` e o `build-and-size`? | `e2e.yml:34-38` e `perf.yml:3-8`: `pull_request` e `push` com `branches: [main]` — também só com PR para a `main` (ou push nela). |
| O que publica as imagens? | `publish-image.yml:21-54`: `push` de tag `v*`, `push` na `main`, `pull_request` (constrói e **não** publica, `:173`/`:303` `if: github.event_name != 'pull_request'`) e **`workflow_dispatch`** (`:54`). Registro: **GHCR** (`ghcr.io/<dono>/<imagem>`, `REGISTRY: ghcr.io`, `:57`). |
| Como as r1–r6 foram publicadas? | Pelo `gh run list` do fork (só leitura): sete execuções de "Publicar imagem Docker (GHCR)", todas `workflow_dispatch`, com `headBranch = celuzap-1.69.0-rN`, concluídas com sucesso. Ou seja: **branch no fork + dispatch do workflow nessa branch**. As tags `celuzap-1.69.0-rN` são marcadores; não disparam publicação (não casam `v*`). A tag da imagem sai de `type=ref,event=branch` (`:242`), que dá `celuzap-1.69.0-r7`. |
| Por que o guarda "tag contida na main" não barrou? | `a-tag-veio-da-main` (`:93-170`) sai com zero se o ref **não é tag** (`:149-150`). Dispatch numa **branch** passa. (Dispatch numa **tag** `celuzap-…` seria barrado: a `main` do fork está `diverged` da r6, 81 à frente e 94 atrás.) |
| Enviar só a branch r7 ao fork roda o `verify`? | **Não.** Não dispara nada (nenhum workflow tem `push` em branch que não seja `main`). Também **não publica imagem**. |
| E para o `verify` rodar no fork? | Só abrindo um **pull request** (fork `main` ← r7), o que dispara `ci`, `e2e`, `perf` e a construção sem publicação das imagens. **Atenção:** a `main` do fork divergiu (81/94 commits), então um PR dela pode ter conflito de merge — e PR com conflito não roda `pull_request`. Não foi testado (não criei PR). |
| O que precisa estar configurado no fork? | Medido por API, **só nomes**: Actions habilitadas (`enabled: true`, `allowed_actions: all`); permissão padrão do `GITHUB_TOKEN` = `read`, e os jobs de publicação pedem `packages: write` por conta própria (`publish-image.yml:180`, `:310`, `:530`) — já funcionou nas r1–r6; **0 segredos** e **0 variáveis** de repositório (o `GITHUB_TOKEN` basta; sem `EXECUTOR_PROPRIO`, todos os jobs rodam em `ubuntu-latest`). Não li nem mostrei nenhum valor. |

### O caminho de publicação da r7, em palavras
1. Enviar a branch `celuzap-1.69.0-r7` ao fork (`fork`, nunca `origin`) — **não dispara nada**.
2. Disparar à mão o workflow "Publicar imagem Docker (GHCR)" **na branch** `celuzap-1.69.0-r7` (`workflow_dispatch`) — publica as imagens `celuzap-1.69.0-r7`.
3. (Opcional, para ter o `verify` do CI) abrir um PR **de rascunho** no fork; sujeito à divergência da `main` do fork.
4. A tag `celuzap-1.69.0-r7` é só marcador; criar depois, com o "confirmo".
