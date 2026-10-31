# Imagens da r1 (`celuzap-1.69.0-r1`)

**Conferido em 30/10/2026**, só leitura e sem login, direto no registro (`ghcr.io`). Nada foi baixado, nada foi alterado, nada na VPS, nenhuma migração aplicada.

- **Commit:** `28aecb66717b705d712e8ced9f8362eaab1c4424`
- **Tag:** `celuzap-1.69.0-r1` (anotada; aponta para o commit acima)
- **Workflow:** "Publicar imagem Docker (GHCR)" (`.github/workflows/publish-image.yml`)
- **Rodada do build:** #2 — https://github.com/danishoes27-alt/DeskcommCRM/actions/runs/41050513971
- **Disparo:** manual (`workflow_dispatch`) na **branch** `celuzap-1.69.0-r1` (o push da branch e da tag não dispara o workflow sozinho).
- **Quando:** 30/10/2026, das 11:46:41 às 11:56:46 (UTC), ou seja, 10 min 5 s.
- **Resultado:** os 16 jobs terminaram; 15 com sucesso, inclusive `imagens-ok` (o app sobe, o worker e o scheduler passam no portão de boot), e `promover-stable` ficou **pulado**, como deve ser fora de tag.
- **Visibilidade:** as quatro imagens são **públicas**. Um token anônimo do registro lista as tags e baixa os manifestos sem credencial nenhuma. A VPS **não precisa de login** para baixar.

A r1 é a versão congelada, anterior à r2 (WAHA por empresa). Os digests da r2 estão em `docs/12-imagens-r2.md`.

## 1. As três imagens que o Celuzap usa

O digest do **índice** identifica a imagem inteira (as duas arquiteturas); fixar por digest é a forma imutável de usar.

| Imagem | Tag | Digest do índice | Visibilidade |
|---|---|---|---|
| `ghcr.io/danishoes27-alt/deskcommcrm:celuzap-1.69.0-r1` (app) | `celuzap-1.69.0-r1` | `sha256:cedb4bc7a9a04f539853edde9bb8d38f28edf709ee0ad4401df79681d4365338` | pública |
| `ghcr.io/danishoes27-alt/deskcomm-worker:celuzap-1.69.0-r1` (worker) | `celuzap-1.69.0-r1` | `sha256:cc68d672243d92ec578e2e8a2d8fae014bb16ee00a4ba2d4441134499d4b654d` | pública |
| `ghcr.io/danishoes27-alt/deskcomm-scheduler:celuzap-1.69.0-r1` (scheduler) | `celuzap-1.69.0-r1` | `sha256:babfc34e978387dacab0e6820f27ef4dd10b607e373dd77f760a1221f0008f43` | pública |

### Variantes por arquitetura (o que a VPS baixa de fato)

O Docker da VPS escolhe a variante da sua arquitetura a partir do índice. O tamanho é a soma das camadas comprimidas mais a configuração, como o registro guarda (em disco, depois de descompactar, fica maior).

| Imagem | Arquitetura | Digest do manifesto | Tamanho comprimido | Camadas |
|---|---|---|---|---|
| app | linux/amd64 | `sha256:9820d19e3cba5974fd7ef4b32ff6a4e765f260264743572bef111d35a0a555c8` | 201,3 MiB | 10 |
| app | linux/arm64 | `sha256:217eed3613bb5ef3499697ad0ebd3539ee5c2d45ec7bc99d17e78ee8fd423d0c` | 196,5 MiB | 10 |
| worker | linux/amd64 | `sha256:c1a43a2d4762df800491cb69f6322dd265551d9e19f97410fef2550ec78e246a` | 382,2 MiB | 10 |
| worker | linux/arm64 | `sha256:cc7d3fc897b590d022d9b6a87ef660556a543568ca55c7b0ade8819abe9543ac` | 373,7 MiB | 10 |
| scheduler | linux/amd64 | `sha256:664cd55f19874e4bee0ab420f8fec503404941fb4ff573f931f4705ec7cab839` | 6,1 MiB | 4 |
| scheduler | linux/arm64 | `sha256:ddcc908284a5a0fb302f91c760709ba6ffc1ea9a870c92f6dab58d5b707a8882` | 6,5 MiB | 4 |
| voz | linux/amd64 | `sha256:6c8750d33d28cb9dbf24490023c53e2e0ada2e356dea79dfbc1c3afd5d5d4df9` | 382,2 MiB | 10 |
| voz | linux/arm64 | `sha256:b1d738b481008034d4fd79a8474f5d15082c13dd82013d59b8aa9c999a46b4c5` | 373,7 MiB | 10 |

### Tags auxiliares do processo de montagem

Cada imagem também tem `celuzap-1.69.0-r1-amd64` e `celuzap-1.69.0-r1-arm64`: índices pequenos (manifesto da arquitetura mais um atestado de procedência), por isso o digest **não é igual** ao do manifesto acima. Não são para usar na VPS.

| Imagem | Digest da tag `-amd64` | Digest da tag `-arm64` |
|---|---|---|
| app | `sha256:5badc108f5a3458dbc173c69855bb05095799957b1954587b1c5bbacd36adbe2` | `sha256:8639ac1ed18333c8d0801c79c8ff20f3461c6a42bfbab1be74e770b8639c006f` |
| worker | `sha256:078cfb17667eb293bf98d2a9499fb1a799025828341030b5f78acb6d22d6a538` | `sha256:8c27e5ce3083c03308bf2a77df5faed48fd6bbdbbd5dd221d8ecaf88d7c58de9` |
| scheduler | `sha256:93aac858184128fc8ed22ba6c8cd9b1001a7b7330f78072d982b17bdcfeebe99` | `sha256:1df2f809736708ef21b1a5c8b34ceda1309911f5da4aceaee016c58a64fc68fb` |
| voz | `sha256:9354ec5f4e38ac0922bd5a6b8bf819d3d3caa93e53a3508a2ab52655f5cdee5f` | `sha256:ea8560b2daee2f39e52ee39dd4acfd2ebc57475b70a646064ddc82ab28747870` |

## 2. Nenhuma recebeu `stable` nem `latest`

Pergunta ao registro, imagem por imagem, por `stable`, `latest`, `1.69.0` e `1.69`. Resposta (HTTP) de cada uma; **404 quer dizer que a tag não existe**:

| Imagem | `stable` | `latest` | `1.69.0` | `1.69` |
|---|---|---|---|---|
| app | 404 | 404 | 404 | 404 |
| worker | 404 | 404 | 404 | 404 |
| scheduler | 404 | 404 | 404 | 404 |
| voz | 404 | 404 | 404 | 404 |

Cada imagem tem, além das tags da r1, as da r2 (publicadas depois) e as do build antigo de 02/10/2026 (`fix-interface-settings-embed-postgrest`).

## 3. O SHA dentro das imagens

- O rótulo `org.opencontainers.image.revision` de cada manifesto, nas duas arquiteturas das quatro imagens, é `28aecb66717b705d712e8ced9f8362eaab1c4424`: as imagens saíram do código certo.
- O rótulo `org.opencontainers.image.version` mostra `celuzap-1.69.0-r1-amd64` / `-arm64` (efeito do sufixo de arquitetura do workflow). É só um rótulo.
- A versão que o `/api/v1/health` informa vem de `process.env.APP_VERSION` (`app/api/v1/health/route.ts`), gravada no build. Na configuração da imagem do app (amd64) está `APP_VERSION=28aecb6`, o SHA curto do commit. Portanto o health deve mostrar `28aecb6`.
- **Isto foi lido da configuração da imagem, não do health rodando.** Ler o `/api/v1/health` de verdade exige subir a imagem; isso não foi feito.

## 4. Quarta imagem (não usada)

`ghcr.io/danishoes27-alt/deskcomm-voice-agent:celuzap-1.69.0-r1`, índice `sha256:e6b8ed5fb28fb41240dc118a2f5af018924ebe07fd389ad5f3cb264ef9c2b69a`. É o módulo de voz, que o Celuzap não usa. Também sem `stable` nem `latest`.

## 5. O que esta conferência NÃO fez

- Não baixou nem rodou nenhuma imagem: portanto **não confirmou** o `/api/v1/health` rodando, nem a ausência de arquivos `.env` dentro da imagem. O portão de boot do CI não substitui o teste local.
- Não tocou na VPS, no EasyPanel nem em variável de produção. Nenhuma migração foi aplicada em nenhum banco.

## 6. Para usar depois (só quando for a hora, no roteiro da troca)

Fixar por digest, não pela tag, evita surpresa se alguém republicar a tag:

```text
ghcr.io/danishoes27-alt/deskcommcrm@sha256:cedb4bc7a9a04f539853edde9bb8d38f28edf709ee0ad4401df79681d4365338
ghcr.io/danishoes27-alt/deskcomm-worker@sha256:cc68d672243d92ec578e2e8a2d8fae014bb16ee00a4ba2d4441134499d4b654d
ghcr.io/danishoes27-alt/deskcomm-scheduler@sha256:babfc34e978387dacab0e6820f27ef4dd10b607e373dd77f760a1221f0008f43
```
