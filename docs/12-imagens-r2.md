# Imagens da r2 (`celuzap-1.69.0-r2`)

**Conferido em 30/10/2026**, só leitura e sem login, direto no registro (`ghcr.io`). Nada foi baixado, nada foi alterado, nada na VPS, nenhuma migração aplicada.

- **Commit:** `7d976ea838fcaa42427b5e6e75da08082d923398`
- **Tag:** `celuzap-1.69.0-r2` (anotada; aponta para o commit acima)
- **Workflow:** "Publicar imagem Docker (GHCR)" (`.github/workflows/publish-image.yml`)
- **Rodada do build:** #3 — https://github.com/danishoes27-alt/DeskcommCRM/actions/runs/41141363182
- **Disparo:** manual (`workflow_dispatch`) na **branch** `celuzap-1.69.0-r2` (o push da branch e da tag não dispara o workflow sozinho).
- **Duração:** 10 min 4 s.
- **Resultado:** os 16 jobs terminaram; 15 com sucesso, inclusive `imagens-ok` (o app sobe, o worker e o scheduler passam no portão de boot), e `promover-stable` ficou **pulado**, como deve ser fora de tag.
- **Visibilidade:** as quatro imagens são **públicas**. Um token anônimo do registro lista as tags e baixa os manifestos sem credencial nenhuma. A VPS **não precisa de login** para baixar.

## 1. As três imagens que o Celuzap usa

O digest do **índice** identifica a imagem inteira (as duas arquiteturas); fixar por digest é a forma imutável de usar.

| Imagem | Tag | Digest do índice | Visibilidade |
|---|---|---|---|
| `ghcr.io/danishoes27-alt/deskcommcrm:celuzap-1.69.0-r2` (app) | `celuzap-1.69.0-r2` | `sha256:bff73270b36a3c7f323f3818cc4b0c1f444bbea5b25ccd0c788e98e37f7bf62d` | pública |
| `ghcr.io/danishoes27-alt/deskcomm-worker:celuzap-1.69.0-r2` (worker) | `celuzap-1.69.0-r2` | `sha256:f747e7e822a85af05c5b912aebdb377931396e6321402cc16b96c5dfb2f04f4b` | pública |
| `ghcr.io/danishoes27-alt/deskcomm-scheduler:celuzap-1.69.0-r2` (scheduler) | `celuzap-1.69.0-r2` | `sha256:2958b1137cecdecb87bab76445a25046ed9ff4cfbc2ee6a686430bb95e764f3c` | pública |

### Variantes por arquitetura (o que a VPS baixa de fato)

O Docker da VPS escolhe a variante da sua arquitetura a partir do índice. O tamanho é a soma das camadas comprimidas mais a configuração, como o registro guarda (em disco, depois de descompactar, fica maior).

| Imagem | Arquitetura | Digest do manifesto | Tamanho comprimido | Camadas |
|---|---|---|---|---|
| app | linux/amd64 | `sha256:1b40b16eba580f1165bef673506ee1b81c0fae24e4e5d35b0ad1d4453019c96a` | 201,3 MiB | 10 |
| app | linux/arm64 | `sha256:0d3cded0c9ceb843f5e31037835c985c346115c049bd639863c5dc914438af87` | 196,5 MiB | 10 |
| worker | linux/amd64 | `sha256:a33371b0eb3edc1d87188d88bbf89a1cf67d685a6d290392fd8a480f5a3817c5` | 382,3 MiB | 10 |
| worker | linux/arm64 | `sha256:c4b1617e53e36e0e16e4ae09de413848308386c27f89da06ebedb2a575e08692` | 373,8 MiB | 10 |
| scheduler | linux/amd64 | `sha256:93358dda12d30dd751315e78c74bdd4e9f8f28a3c1d75532b916cf7f1bd8f8f2` | 6,1 MiB | 4 |
| scheduler | linux/arm64 | `sha256:2cf67aa4788e8d0d21e252655b954d20f54fac683748006b8b0e0cd4fc92009b` | 6,5 MiB | 4 |
| voz | linux/amd64 | `sha256:808db599083784e87fadce5edfd260765bb3ec881fac6403ca749a7cafdf5946` | 382,2 MiB | 10 |
| voz | linux/arm64 | `sha256:3940983c131d3ac40f50117bd0406bfa2ad7a6cbff70b7aa7e70ded72972a2c4` | 373,8 MiB | 10 |

### Tags auxiliares do processo de montagem

Cada imagem também tem `celuzap-1.69.0-r2-amd64` e `celuzap-1.69.0-r2-arm64`: índices pequenos (manifesto da arquitetura mais um atestado de procedência), por isso o digest **não é igual** ao do manifesto acima. Não são para usar na VPS.

| Imagem | Digest da tag `-amd64` | Digest da tag `-arm64` |
|---|---|---|
| app | `sha256:75bc2cf8aedc0643169c3503444e991cfac56254b5a035604074454732cb371f` | `sha256:1562a21aaf75a87d9d4c5db275fc5311d2f9b3ea29f76434a94c4ba00d8f4236` |
| worker | `sha256:c39576f5f59744c3f16f6392b5135bdac169897d64aa4d86af2a9c44c2ade82f` | `sha256:f12086316f024bb6605109911c92d6843cc90765f21f61b982fd35240dbcb4c3` |
| scheduler | `sha256:1d7db6628f2faf81b9aa3ada33ab1d108727e1a11e709501fe33924c0e7306bc` | `sha256:bb4f0ee1557cccb18b2c3c7b8dba560d76df5b655f09f247f24f10843032496f` |
| voz | `sha256:70acb07b357bc5cdfbca4708d3cd115232d91108c16b587f463f5c144c9bfd55` | `sha256:683df40b8e0280711322599c580a88ca66348e35e1a27e1e8a365ccfb3437b9e` |

## 2. Nenhuma recebeu `stable` nem `latest`

Pergunta ao registro, imagem por imagem, por `stable`, `latest`, `1.69.0` e `1.69`: **todas responderam 404 (não existem)**. Cada imagem tem, além das tags da r2, as da r1 (`celuzap-1.69.0-r1` e variantes) e as do build antigo de 02/10/2026.

## 3. O SHA dentro das imagens

- O rótulo `org.opencontainers.image.revision` de cada manifesto, nas duas arquiteturas das quatro imagens, é `7d976ea838fcaa42427b5e6e75da08082d923398`: as imagens saíram do código certo.
- O rótulo `org.opencontainers.image.version` mostra `celuzap-1.69.0-r2-amd64` / `-arm64` (efeito do sufixo de arquitetura do workflow). É só um rótulo.
- A versão que o `/api/v1/health` informa vem de `process.env.APP_VERSION` (`app/api/v1/health/route.ts`), gravada no build. Na configuração da imagem do app (amd64) está `APP_VERSION=7d976ea`, o SHA curto do commit. Portanto o health deve mostrar `7d976ea`.
- **Isto foi lido da configuração da imagem, não do health rodando.** Ler o `/api/v1/health` de verdade exige subir a imagem; isso não foi feito.

## 4. Quarta imagem (não usada)

`ghcr.io/danishoes27-alt/deskcomm-voice-agent:celuzap-1.69.0-r2`, índice `sha256:cabd20734cd9d5fc26f10e7e5e19c446228957dd4cd0be46518aadc135590561`. É o módulo de voz, que o Celuzap não usa. Também sem `stable` nem `latest`.

## 5. O que esta conferência NÃO fez

- Não baixou nem rodou nenhuma imagem: portanto **não confirmou** o `/api/v1/health` rodando, nem a ausência de arquivos `.env` dentro da imagem. O portão de boot do CI não substitui o teste local.
- Não tocou na VPS, no EasyPanel nem em variável de produção. A migração 9001 não foi aplicada em nenhum banco.

## 6. Para usar depois (só quando for a hora, no roteiro da troca)

Fixar por digest, não pela tag, evita surpresa se alguém republicar a tag:

```text
ghcr.io/danishoes27-alt/deskcommcrm@sha256:bff73270b36a3c7f323f3818cc4b0c1f444bbea5b25ccd0c788e98e37f7bf62d
ghcr.io/danishoes27-alt/deskcomm-worker@sha256:f747e7e822a85af05c5b912aebdb377931396e6321402cc16b96c5dfb2f04f4b
ghcr.io/danishoes27-alt/deskcomm-scheduler@sha256:2958b1137cecdecb87bab76445a25046ed9ff4cfbc2ee6a686430bb95e764f3c
```
