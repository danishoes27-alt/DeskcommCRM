# Roteiro do Bloco D — da versão 1.69.0 do upstream à r2 e ao número real da Grau Cell

**Estado:** só roteiro. **Nada daqui foi executado.** Escrito em 31/10/2026, lendo o código da branch `celuzap-1.69.0-r2` (imagens publicadas a partir do commit `7d976ea83`) e comparando com a tag upstream `v1.69.0`.
**Regra de ouro:** uma etapa por vez. Cada etapa termina com uma palavra que você responde. Só passe para a seguinte depois de responder e de eu confirmar.

---

## Como usar

1. Abra o Claude Code e diga: **"vamos para a etapa N"**. Ele mostra só aquela etapa.
2. Cada etapa diz **quem executa**:
   - **Você, no navegador** — clica nas telas do EasyPanel, do Supabase, do painel da VPS ou do próprio Celuzap.
   - **Você, colando um prompt no Claude Code** — para qualquer verificação técnica. Você cola o bloco, o Claude Code faz e devolve o resultado.
3. **Nunca cole senha, chave ou token no chat.** Chaves vão direto do campo onde aparecem para o campo onde entram.
4. Onde o nome de um botão ou menu não foi confirmado, aparece **[confirmar na tela]**: leia o que está na tela e, se for diferente, me diga o nome que você vê.
5. Marcas de evidência: **[LIDO]** = li no código ou no arquivo citado; **[INFERIDO]** = conclusão minha, não provada; **[NÃO PROVADO]** = ainda ninguém verificou.

## Fatos de partida

| Item | Valor | Origem |
|---|---|---|
| Servidor | VPS KVM 2, EasyPanel, projeto `celuzap`, serviço compose `stack` com 6 contêineres: `app`, `worker`, `scheduler`, `redis`, `srh`, `waha` (compartilhado) | informado e confirmado por você |
| `APP_IMAGE` hoje | `ghcr.io/melgarafael/deskcommcrm:stable` | informado e confirmado por você |
| `WORKER_IMAGE` hoje | `ghcr.io/melgarafael/deskcomm-worker:1.69.0` | informado e confirmado por você |
| `SCHEDULER_IMAGE` hoje | `ghcr.io/melgarafael/deskcomm-scheduler:stable` | informado e confirmado por você |
| WAHA compartilhado | `devlikeapro/waha:latest-2026.7.2` (padrão do compose, sem variável) | informado e confirmado por você |
| Imagens da r2 | `ghcr.io/danishoes27-alt/<imagem>:celuzap-1.69.0-r2`, públicas, sem `stable` nem `latest`; digests em `12-imagens-r2.md` | **[LIDO]** no registro |
| Banco | Supabase `sa-east-1`, nível do schema = v1.69.0, migração 9001 **não** aplicada | informado e confirmado por você |
| Tabela de controle de migrações | `supabase_migrations.schema_migrations` **não existe** neste banco | informado e confirmado por você |
| Empresas existentes | `Celuzap` (a empresa da plataforma) e uma empresa de teste. A Grau Cell ainda não existe | informado e confirmado por você |
| Versão que a VPS mostra hoje no health | `1.69.0` | **[LIDO]** no health público em 30/10/2026 |

## Quadro das etapas

| # | O que faz | Quem executa | Risco |
|---|---|---|---|
| 0 | Avisos e pré-requisitos | você, só leitura | nenhum |
| 1 | Backups e anotação dos valores para voltar | você + Claude Code | nenhum |
| 2 | Prova de que o app antigo aguenta a migração 9001 | só leitura | nenhum |
| 3 | Aplicar a migração 9001 no Supabase | você, no navegador | **médio** |
| 4 | Trocar as 3 imagens no EasyPanel | você, no navegador | **alto** |
| 5 | Conferir a troca (e 5B, opcional: assinatura do WAHA compartilhado) | você + Claude Code | baixo |
| 6 | Como voltar atrás (ler antes da etapa 4) | você, só leitura | — |
| 7 | Criar a empresa Grau Cell e os funis | você, no navegador | baixo |
| 8 | Criar o WAHA da Grau Cell e cadastrá-lo | você, no navegador | médio |
| 9 | Parear o número por QR | você + a pessoa com o celular | médio |
| 10 | Proteção de envio (anti-banimento) | você, no navegador | **obrigatória** |
| 11 | Modo teste: só o seu número recebe resposta da IA | você, no navegador | baixo |
| 12 | Chave de IA em produção | você, no navegador | baixo |
| 13 | Teste com 2 servidores de WhatsApp | você, no navegador | médio |
| 14 | Critério para ligar o número real e plano de volta | decisão sua | — |

---

## Etapa 0 — Avisos e pré-requisitos

**Objetivo:** que você saiba o que NÃO fazer antes de começar.
**Quem executa:** você, só lendo.

1. **Não clique em Deploy (Implantar) no `stack` antes da Etapa 4.** O `app` e o `scheduler` estão em `:stable`, uma etiqueta que o upstream pode mover para uma versão nova. Se o `pull_policy` do compose estiver em `always` (é o padrão do arquivo, `APP_PULL_POLICY` e as outras duas), qualquer Deploy baixa de novo o `:stable` e o `app` pode subir numa versão diferente do `worker` (que está fixo em `1.69.0`). Isso é **[LIDO]** no YAML do plano de deploy; o valor real das 3 variáveis `*_PULL_POLICY` no seu painel é **[NÃO PROVADO]** e a Etapa 1 pede para você olhar.
2. **O arquivo `.env.local` do seu computador aponta para o banco de PRODUÇÃO.** Não rode o app local, nem testes, nem scripts do projeto com esse arquivo: o app local escreve no banco real. Qualquer comando do Claude Code que use o `.env.local` deve ser só leitura, como os prompts deste roteiro.
3. **Horário de baixo movimento.** Faça as Etapas 3 a 5 num horário em que ninguém da Grau Cell esteja usando o Celuzap (por exemplo, de manhã cedo num dia útil). Na Etapa 4 o `app`, o `worker` e o `scheduler` são recriados; espere alguns minutos com o Celuzap fora do ar (estimativa, não medida).
4. **O outro projeto do EasyPanel (o site que já roda na mesma VPS) nunca pode ser afetado.** Não abra a página dele, não clique em Cleanup/Prune, não atualize o próprio EasyPanel. Qualquer sinal estranho nele: pare tudo e volte ao estado anterior (Etapa 6).
5. Tenha à mão: o acesso ao EasyPanel, ao painel do Supabase, ao painel do provedor da VPS e um gerenciador de senhas (para guardar uma chave que aparece uma única vez na Etapa 8).

**Responda:** `entendi`.

---

## Etapa 1 — Backups e valores para voltar atrás

**Objetivo:** ter como desfazer tudo antes de mexer em qualquer coisa.

### 1A — Foto (snapshot) da VPS
**Quem executa:** você, no navegador.
1. Entre no painel do provedor da VPS e abra a sua VPS.
2. Procure a área de **snapshots** ou **backups** da VPS **[confirmar na tela]**.
3. Crie um snapshot novo. Muitos provedores guardam só um snapshot por vez e **apagam o anterior** ao criar o novo **[confirmar na tela]**: leia o aviso antes de confirmar.
4. Espere o estado ficar como concluído.

**Deu certo se:** a lista mostra um snapshot com a data e a hora de hoje.
**Se não apareceu:** me diga exatamente o que a tela mostra (cole o texto). Sem snapshot, não passe para a Etapa 3.
**Responda:** `feito` (e a data e hora que o snapshot mostra).

### 1B — Backup do banco (duas camadas)
**Quem executa:** você, no navegador e depois colando um prompt no Claude Code.

**Camada 1 — no Supabase.** Entre no painel do Supabase, abra o projeto do Celuzap e procure **Database → Backups** **[confirmar na tela]**. Anote se existe backup automático recente e se o seu plano permite baixá-lo **[confirmar na tela]**. Se o painel diz que o plano não tem backup, a camada 2 é obrigatória.

**Camada 2 — um arquivo seu, testado.** Cole este prompt no Claude Code:

```text
Faça um backup do banco de produção do Celuzap e prove que o arquivo funciona. No banco de produção, SOMENTE LEITURA: nenhum comando que escreva, apague ou altere nada nele.

Regras:
- A conexão está na variável SUPABASE_DB_URL do arquivo .env.local do projeto. Leia o valor dentro do próprio comando. NÃO imprima a URL, o usuário nem a senha em lugar nenhum, nem em mensagem de erro.
- Use o Docker com a imagem postgres:17 (o banco é PostgreSQL 17) para rodar o pg_dump em formato custom (-Fc), com os schemas public e auth.
- Salve o arquivo em %USERPROFILE%\celuzap-backups\ com o nome celuzap-AAAAMMDD-HHMM.dump (data e hora de agora), FORA da pasta do projeto e fora do git.
- Teste o arquivo: suba um PostgreSQL 17 descartável no Docker, restaure o dump nele e compare a contagem de linhas das tabelas organizations, channel_sessions, contacts e messages com a contagem do banco de produção (SELECT count(*), só leitura). Depois apague esse PostgreSQL descartável e os arquivos temporários.
- No fim, me diga só: caminho do arquivo, tamanho, data e hora, e a tabela de contagens (produção x restaurado). Se qualquer contagem for diferente, diga isso em destaque.
- Se algum passo falhar, mostre o erro exato (sem a URL do banco) e pare.
```

**Deu certo se:** o Claude Code devolve o caminho, o tamanho e uma tabela em que as contagens de produção e de restauração são iguais.
**Se não apareceu:** cole o erro que ele mostrou (ele não mostra a URL do banco). Sem backup testado, não passe para a Etapa 3.
**Responda:** `feito` ou cole o erro.

### 1C — Guardar o que está no EasyPanel
**Quem executa:** você, no navegador.
1. No EasyPanel, abra o projeto `celuzap` e o serviço `stack`.
2. Na aba **Environment** (Ambiente, se o painel estiver em português), selecione todo o texto e copie. Cole num arquivo de texto novo e salve em `%USERPROFILE%\celuzap-backups\easypanel-env-AAAAMMDD.txt`.
3. Na aba **Source**, copie todo o YAML e salve em `%USERPROFILE%\celuzap-backups\easypanel-compose-AAAAMMDD.yml`.
4. Esses arquivos ficam **fora do projeto e fora do git**, e **ninguém os abre** (nem eu). O Environment tem segredos.
5. Confira que o número de linhas do arquivo do Environment bate com o que está na tela (antes eram 49 variáveis).

**Deu certo se:** os dois arquivos existem e o número de linhas bate.
**Responda:** `feito`.

### 1D — Anotar os valores para voltar atrás
**Quem executa:** você, no navegador.

Estes são os valores de hoje, que a Etapa 6 usa para voltar. **Não são segredo.**

| Variável | Valor de hoje |
|---|---|
| `APP_IMAGE` | `ghcr.io/melgarafael/deskcommcrm:stable` |
| `WORKER_IMAGE` | `ghcr.io/melgarafael/deskcomm-worker:1.69.0` |
| `SCHEDULER_IMAGE` | `ghcr.io/melgarafael/deskcomm-scheduler:stable` |

1. Na aba **Environment**, confira que essas 3 linhas estão exatamente assim.
2. Veja também os valores de `APP_PULL_POLICY`, `WORKER_PULL_POLICY` e `SCHEDULER_PULL_POLICY` (podem não existir; se não existirem, vale o padrão `always`).

**Responda:** `iguais` (e o valor das 3 `*_PULL_POLICY`, ou `não existem`) **ou** cole as 3 linhas que a tela mostra.

### 1E — Fixar o que `:stable` significa hoje (prompt)
**Quem executa:** você, colando um prompt no Claude Code.

A etiqueta `:stable` pode andar. Este prompt registra para qual versão ela aponta agora, para você voltar exatamente ao mesmo ponto se precisar:

```text
Consulte, SOMENTE LEITURA e sem login (token anônimo do registro ghcr.io, o mesmo método usado em 12-imagens-r2.md), as imagens ghcr.io/melgarafael/deskcommcrm, ghcr.io/melgarafael/deskcomm-worker e ghcr.io/melgarafael/deskcomm-scheduler. Para cada uma, diga: (1) o digest da etiqueta stable; (2) se a etiqueta 1.69.0 existe e qual o digest dela; (3) se stable e 1.69.0 são o mesmo digest. Não baixe nem rode nenhuma imagem. Não use o remote git "origin" para nada. Mostre uma tabela e, se algo der erro, o erro exato.
```

**Deu certo se:** a tabela mostra, para as 3 imagens, se `stable` e `1.69.0` são o mesmo digest.
**Se não apareceu:** cole o erro. Se `1.69.0` não existir para o `app` ou para o `scheduler`, a volta atrás dessas duas tem de ser pelo digest que o prompt mostrou (a Etapa 6 explica).
**Responda:** `feito` e cole a tabela.

---

## Etapa 2 — Prova de que o app antigo aguenta a migração 9001

**Objetivo:** decidir se a migração pode ser aplicada **antes** de trocar as imagens.
**Quem executa:** só leitura (eu li o código; você só lê a conclusão).

A 9001 acrescenta duas colunas em `channel_sessions` (`waha_base_url` e `waha_api_key_encrypted`) e um gatilho de proteção (`trg_channel_sessions_guard_waha`). A pergunta: o app e o worker da v1.69.0, que não conhecem essas colunas, quebram com elas presentes (vazias) e com o gatilho?

**Conclusão: não quebram. A ordem fica: migração (Etapa 3), depois troca das imagens (Etapa 4).** Nenhuma inversão é necessária.

Evidências:

1. **[LIDO]** A migração é só aditiva: `add column if not exists` de duas colunas sem `NOT NULL` e sem `DEFAULT`, e um gatilho. Nada de `drop`, nada que reescreva linha (arquivo da migração, linhas 31 a 33 e cabeçalho).
2. **[LIDO]** O gatilho só recusa quando quem escreve é `anon` ou `authenticated` **e** muda uma das duas colunas (a função `fn_guard_channel_sessions_waha`). Todo o resto passa sem notar.
3. **[LIDO]** `git grep` na tag `v1.69.0`: **zero** leituras de `channel_sessions` com `select("*")` (nem multi-linha, nem em SQL cru, nem `channel_sessions.*`), e **zero** funções SQL que devolvem a linha inteira da tabela. Logo nada do app antigo lê as duas colunas novas, e nada as devolve ao navegador.
4. **[LIDO]** Os pontos de `INSERT` e de `UPDATE` em `channel_sessions` da `v1.69.0` montam objetos com colunas nomeadas: abri `lib/channels/connect.ts`, `lib/waha/ingest.ts`, `app/api/v1/channel-sessions/[id]/route.ts` (os dois pontos), `.../reconnect/route.ts` e `app/api/v1/voice/sessions/pair/route.ts`; nenhum grava uma linha inteira lida antes. **[INFERIDO]** em `lib/channels/reactivate.ts` o objeto vem do chamador (a função diz que o chamador decide "status, credencial, número"), e eu não abri cada chamador. Logo nenhuma escrita do app antigo deve tocar nas duas colunas, e o gatilho não deve recusar nada.
5. **[LIDO]** O `INSERT` do canal por QR é feito dentro de uma função de banco (`fn_reserve_channel_connection`) que não preenche as colunas novas; elas ficam vazias.
6. **[LIDO]** Os 3 gatilhos que já existem em `channel_sessions` (auditoria de status, `updated_at`, revisão de resposta) não dependem das colunas novas.
7. **[LIDO]** A r2 também tolera o contrário (imagem nova sobre banco sem a migração): coluna ausente vira "sem cadastro próprio" (correção do commit 12). Por isso um atraso na Etapa 3 não derruba o WhatsApp, mas **não** é a ordem recomendada.
8. **[INFERIDO]** O bloqueio de tabela: `add column` sem valor padrão só mexe no catálogo e `create trigger` pede um bloqueio curto. Com `lock_timeout` de 3 segundos a migração falha limpa em vez de esperar. Medi isso só num banco de teste local (ciclo aplicar e desfazer, 21 testes de banco), não na produção.
9. **[NÃO PROVADO]** O comportamento do cache de esquema da API do Supabase logo depois da migração. A Etapa 3 traz o comando para forçar a recarga se for preciso.

**Responda:** `entendi`.

---

## Etapa 3 — Aplicar a migração 9001

**Objetivo:** criar as duas colunas e o gatilho no banco de produção.
**Quem executa:** você, no navegador (Supabase), com uma conferência por prompt.
**Pré-requisito:** Etapa 1 inteira respondida com `feito`.

> **Conferência da tabela de migrações NÃO existe aqui.** Como a tabela `supabase_migrations.schema_migrations` não existe neste banco, a conferência é feita **pelo que a migração cria**: as duas colunas e o gatilho.

### 3A — Conferir ANTES (tudo deve estar ausente)
1. No painel do Supabase, abra o projeto e vá em **SQL Editor** **[confirmar na tela]** → nova consulta.
2. Cole e execute (é só leitura):

```sql
select
  (select count(*)
     from information_schema.columns
    where table_schema = 'public'
      and table_name = 'channel_sessions'
      and column_name in ('waha_base_url', 'waha_api_key_encrypted')) as colunas_da_9001,
  (select count(*)
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'channel_sessions'
      and t.tgname = 'trg_channel_sessions_guard_waha'
      and not t.tgisinternal) as gatilho_da_9001,
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'fn_guard_channel_sessions_waha') as funcao_do_gatilho;
```

**Deu certo se:** o resultado é uma linha com `0`, `0` e `0`.
**Se não apareceu:** se aparecer qualquer número diferente de zero, **pare**: a migração já foi aplicada (total ou parcialmente). Cole o resultado e não faça a 3C.
**Responda:** `zeros` ou cole o resultado.

### 3B — Provar que o texto é o da r2 (prompt)
**Quem executa:** você, colando um prompt no Claude Code.

```text
SOMENTE LEITURA. No repositório do projeto, calcule o SHA-256 do arquivo supabase/migrations/20261030120000_9001_celuzap_waha_por_canal.sql como ele está na tag refs/tags/celuzap-1.69.0-r2 (use git show refs/tags/celuzap-1.69.0-r2:supabase/migrations/20261030120000_9001_celuzap_waha_por_canal.sql, sem converter fim de linha). Compare com este valor: bcc9a9169c40d5742bfa5a6dac0c7add8fb663fe97751522fc6e0c0f4271dfe3. Diga só "IGUAL" ou "DIFERENTE" e os dois valores. Não use o remote git "origin". Não altere nada.
```

**Deu certo se:** o Claude Code responde `IGUAL`.
**Se não apareceu:** se responder `DIFERENTE`, **pare** e cole a resposta; o texto da 3C não pode ser usado.
**Responda:** `igual` ou cole a resposta.

### 3C — Aplicar
1. No **SQL Editor** do Supabase, abra uma consulta nova.
2. Cole o bloco abaixo **inteiro** (as linhas `begin`, `set local` e `commit` são o invólucro; o miolo é o arquivo da migração, sem alteração) e execute.
3. O Supabase pode mostrar um aviso de "operação destrutiva" por causa do `drop trigger if exists` (ele só remove um gatilho que ainda não existe). Leia o aviso e confirme **[confirmar na tela]**.

```sql
begin;
set local lock_timeout = '3s';

-- ═══ WAHA por empresa: endereço e chave do WAHA de cada canal (9001) ═══
--
-- Até aqui o app falava com UM WAHA por instalação: o endereço e a chave vinham de
-- variável de ambiente global, e nenhuma coluna dizia "este canal mora naquele WAHA".
-- Para cada empresa ter o seu contêiner WAHA, o canal precisa carregar o próprio
-- endereço e a própria chave. São duas colunas, e só.
--
--   waha_base_url           endereço interno do WAHA da empresa (ex.: http://waha-acme:3000).
--                           NULL = o canal usa o WAHA global da instalação (modo compartilhado),
--                           exatamente como antes: quem só atualiza a imagem não muda nada.
--   waha_api_key_encrypted  chave de API desse WAHA, cifrada por `fn_encrypt_oauth` (a mesma cifra
--                           de `zernio_token_encrypted` e dos tokens de calendário). Só o
--                           service_role decifra. NULL = sem chave própria.
--
-- Aditiva por construção, para a imagem anterior continuar rodando sobre o banco já migrado:
--   * `add column if not exists`: nada de drop de coluna, nada de NOT NULL, nada de DEFAULT, nada que
--     reescreva linha (as linhas existentes ficam com as duas colunas NULL);
--   * nenhuma constraint nova e nenhum índice: o formato do endereço e a coerência "endereço e chave
--     andam juntos" são validados pelo app (resolvedor de canal);
--   * UM gatilho de guarda (no fim do arquivo): recusa que `anon`/`authenticated` escrevam nas duas
--     colunas. Quem não mexe nelas — inclusive a imagem anterior — não percebe nada.
--
-- Numeração 9001: escolha do Celuzap. O projeto de origem também usa a faixa 90xx (a partir da 9016
-- no main dele), então a colisão não é impossível por construção: confira com
-- `pnpm checar:colisao-de-migration` contra o main do projeto de origem a cada atualização. O que
-- o Supabase CLI registra é o timestamp do nome, não o NNNN.
--
-- Desfazer (só se NENHUM canal usar WAHA próprio): arquivo `9001-desfazer.sql` do registro de
-- execução, que recusa rodar se houver endereço ou chave gravados e também remove o gatilho.

alter table public.channel_sessions
  add column if not exists waha_base_url text,
  add column if not exists waha_api_key_encrypted bytea;

comment on column public.channel_sessions.waha_base_url is
  'Endereço interno do WAHA DESTE canal (http/https). NULL = usa o WAHA global da instalação (modo compartilhado). Só o operador da plataforma escreve (um gatilho recusa anon e authenticated); nunca vai ao navegador do lojista.';
comment on column public.channel_sessions.waha_api_key_encrypted is
  'Chave de API do WAHA deste canal, cifrada por public.fn_encrypt_oauth (pgp_sym AES-256). NUNCA em claro: só service_role decifra (fn_decrypt_oauth). NULL = sem chave própria. Nunca vai ao navegador.';

-- ─── Quem escreve nas duas colunas ──────────────────────────────────────────────────────────────
-- A policy de escrita de `channel_sessions` deixa o ADMIN da empresa atualizar a linha do próprio canal
-- pelo PostgREST, com o JWT dele. Sem esta guarda, ele poderia apontar `waha_base_url` para um servidor
-- seu (o app mandaria a chave de API até lá e leria a resposta). Então as duas colunas só mudam por quem
-- NÃO é `anon` nem `authenticated`: service_role (a tela do operador e a conexão do número) e o dono do
-- banco (migrations, funções SECURITY DEFINER). Quem não mexe nessas colunas não nota diferença nenhuma.
create or replace function public.fn_guard_channel_sessions_waha() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.waha_base_url is not null or new.waha_api_key_encrypted is not null then
        raise exception 'waha_por_canal: o endereço e a chave do WAHA de um canal só mudam pelo operador da plataforma'
          using errcode = '42501';
      end if;
    elsif new.waha_base_url is distinct from old.waha_base_url
       or new.waha_api_key_encrypted is distinct from old.waha_api_key_encrypted then
      raise exception 'waha_por_canal: o endereço e a chave do WAHA de um canal só mudam pelo operador da plataforma'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$fn$;

-- Função exclusiva de trigger: nenhuma sessão deve chamá-la como RPC.
revoke execute on function public.fn_guard_channel_sessions_waha()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_channel_sessions_guard_waha on public.channel_sessions;
create trigger trg_channel_sessions_guard_waha
  before insert or update on public.channel_sessions
  for each row execute function public.fn_guard_channel_sessions_waha();

commit;
```

**Deu certo se:** aparece algo como "Success. No rows returned".
**Se não apareceu:**
- Erro com `lock timeout`/`canceling statement due to lock timeout`: nada foi aplicado (a transação foi desfeita). Espere um minuto e tente de novo.
- Qualquer outro erro: nada foi aplicado. Cole o erro exato.
**Responda:** `feito` ou cole o erro.

### 3D — Conferir DEPOIS (tudo deve estar presente)
1. Rode **de novo** a consulta da 3A. **Deu certo se:** o resultado é `2`, `1` e `1`.
2. Rode esta, também só leitura (confirma que nenhum dado foi tocado):

```sql
select count(*) as canais_com_servidor_proprio
from public.channel_sessions
where waha_base_url is not null
   or waha_api_key_encrypted is not null;
```

**Deu certo se:** o resultado é `0`.
**Se não apareceu:** se a primeira consulta ainda der `0, 0, 0`, a 3C não foi aplicada: repita a 3C. Se der outra combinação, **pare** e cole o resultado.
**Se mais tarde a Etapa 8 acusar "coluna inexistente":** é o cache de esquema da API. Rode `notify pgrst, 'reload schema';` no SQL Editor e tente de novo.
**Responda:** `2-1-1 e zero` ou cole o resultado.

### 3E — Desfazer a 9001 (quase nunca)
**Quando usar:** quase nunca. A imagem antiga ignora as duas colunas, então o jeito normal de voltar atrás é devolver as 3 imagens (Etapa 6) e **deixar as colunas no banco, sem efeito**. Use este bloco só se eu pedir.
**Segurança embutida:** o bloco **recusa rodar** se achar qualquer canal com endereço ou chave gravados; nesse caso nada é desfeito. **[LIDO]** o endereço e a chave só são copiados para o **canal** quando o número é conectado (Etapa 9); o cadastro da Etapa 8 fica na empresa, não no canal. Então este bloco só funciona **antes da Etapa 9** (ou depois de você mover esses canais para o servidor compartilhado).
**Nunca rode isto sem backup (Etapa 1B).** Esta é a prova de que ele foi testado: aplicar, recusar com dado, desfazer, desfazer de novo e aplicar de novo num banco de teste, tudo passou (21 casos de banco da r2 + o ciclo).

```sql
-- ═══ DESFAZER a migration 9001 (WAHA por empresa) ═══
--
-- Remove de public.channel_sessions o gatilho de guarda e as duas colunas que a 9001 acrescentou:
--   waha_base_url  e  waha_api_key_encrypted.
--
-- ⚠️ DESTRUTIVO se algum canal já usa WAHA próprio: apagar a coluna leva embora o endereço e a
-- chave cifrada. Por isso o bloco abaixo RECUSA rodar se achar qualquer valor gravado — nesse caso
-- mova primeiro os canais para o WAHA global (ou aceite perder o cadastro e apague os valores à mão,
-- sabendo o que está fazendo).
--
-- Quando precisa: quase nunca. A imagem anterior ignora as duas colunas, então o rollback normal é
-- voltar as 3 imagens (app, worker e scheduler) e deixar as colunas no banco, sem efeito.
--
-- NÃO aplicar em banco real sem backup e sem a conferência pedida no roteiro de produção.
-- Uso:   colar no SQL Editor do Supabase (ou, no terminal: psql -v ON_ERROR_STOP=1 -f 9001-desfazer.sql)
-- Reaplicável: se as colunas já não existem, não faz nada (e não falha).
--
-- Neste banco NÃO existe a tabela supabase_migrations.schema_migrations: não há registro de migration
-- para apagar. A conferência de "antes" e "depois" é feita pelas colunas e pelo gatilho, não por essa tabela.

begin;
set local lock_timeout = '3s';

do $guarda$
declare
  colunas text;
  em_uso  integer := 0;
begin
  select string_agg(quote_ident(column_name) || ' is not null', ' or ')
    into colunas
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'channel_sessions'
     and column_name in ('waha_base_url', 'waha_api_key_encrypted');

  if colunas is not null then
    execute 'select count(*) from public.channel_sessions where ' || colunas into em_uso;
  end if;

  if em_uso > 0 then
    raise exception '9001-desfazer: % canal(is) ja usam WAHA proprio (endereco ou chave gravados); nada foi desfeito', em_uso;
  end if;
end
$guarda$;

-- O gatilho de guarda sai primeiro (ele só olha as duas colunas, que vão embora logo em seguida).
drop trigger if exists trg_channel_sessions_guard_waha on public.channel_sessions;
drop function if exists public.fn_guard_channel_sessions_waha();

alter table public.channel_sessions drop column if exists waha_api_key_encrypted;
alter table public.channel_sessions drop column if exists waha_base_url;

commit;
```

---

## Etapa 4 — Trocar as 3 imagens no EasyPanel ⚠️ PASSO ARRISCADO

**Objetivo:** colocar a r2 no ar.
**Quem executa:** você, no navegador (EasyPanel). Eu guio e peço confirmação antes de cada clique que muda algo.
**Pré-requisitos:** Etapas 1 e 3 respondidas. O WAHA compartilhado, o `redis` e o `srh` **ficam como estão**.

**Variáveis de ambiente que a r2 exige (só os nomes) [LIDO em `lib/env.ts`, `.env.example` e nos arquivos compose]:**

| Nome | Precisa de mudança agora? |
|---|---|
| Qualquer variável **nova obrigatória** | **Não existe nenhuma.** A r2 sobe com o mesmo Environment de hoje. |
| `WAHA_API_BASE_URL` e `WAHA_API_KEY` | **Manter as duas.** Na r2 passam a ser opcionais, mas **vão juntas**: uma sem a outra derruba o boot em produção. Além disso, a imagem 1.69.0 as exige (rollback). |
| `WAHA_WEBHOOK_BASE_URL` | **Manter.** É a base do app que o WAHA chama. Sem ela, conectar um número em servidor próprio é recusado (`webhook_base_url_missing`). Entra em uso nas Etapas 8 e 9. |
| `WAHA_HMAC_SECRET` | **Manter** (já existe no `app` e no `worker`; 16 caracteres ou mais). |
| `WAHA_WEBHOOK_GLOBAL_ENABLED` | **Não criar agora.** Opcional. Ausente = a rota global do WAHA compartilhado continua ligada, como hoje. Só o valor `false` a desliga (ela passaria a responder 404). Só use `false` quando nenhum canal usar o WAHA compartilhado. |
| `WHATSAPP_HOOK_HMAC_KEY` | **Não é variável do app.** É variável do **contêiner WAHA** no YAML da aba Source. Para o WAHA compartilhado, entra na Etapa 5B (opcional). **Não entra no WAHA da Grau Cell** (a Etapa 8 explica). |
| `AI_GATEWAY_PLANO_CONFIRMADO`, `JEV_TRIAGEM_ENABLED`, `JEV_PLANO_CONFIRMADO` | Novas e opcionais. **Deixe vazias.** Vazia significa "desligado". |

### 4A — Anotar a hora
Anote a hora de agora. Se algo der errado, a Etapa 6 usa esse horário para olhar os logs.

### 4B — Editar as 3 linhas
1. No EasyPanel, projeto `celuzap` → serviço `stack` → aba **Environment**.
2. Ache as 3 linhas que começam com `APP_IMAGE=`, `WORKER_IMAGE=` e `SCHEDULER_IMAGE=`. **Apague só essas 3** (mais nenhuma).
3. No lugar delas, cole estas 3, **juntas** (nunca versões misturadas):

```text
APP_IMAGE=ghcr.io/danishoes27-alt/deskcommcrm:celuzap-1.69.0-r2
WORKER_IMAGE=ghcr.io/danishoes27-alt/deskcomm-worker:celuzap-1.69.0-r2
SCHEDULER_IMAGE=ghcr.io/danishoes27-alt/deskcomm-scheduler:celuzap-1.69.0-r2
```

4. Clique em **Save** (Salvar). **Não** clique em Deploy ainda.

**Responda:** `salvei` (e, se o painel mostrar algum aviso, cole o texto).

### 4C — Implantar
1. Só depois da minha confirmação, clique em **Deploy** (Implantar) **[confirmar na tela]**.
2. Acompanhe o log da implantação até o fim.

**Deu certo se:** o log termina em `Success`, o `app` aparece como *Healthy*, e o `worker` e o `scheduler` aparecem rodando.
**Se não apareceu:**

| O que acontece | O que fazer |
|---|---|
| O Deploy falha ao baixar a imagem | Os contêineres antigos continuam no ar. Confira o nome da etiqueta (exatamente como acima) e tente de novo. |
| O `app` não fica *Healthy* | **Volte atrás agora** (Etapa 6). |
| O `worker` reinicia sem parar | Leia o log; se não for óbvio, volte atrás (Etapa 6). |
| Qualquer sinal estranho no outro projeto da VPS | Pare tudo e volte atrás (Etapa 6). |

**Responda:** `deploy ok` ou cole o erro.

---

## Etapa 5 — Conferir a troca

**Objetivo:** provar que a r2 está de pé.

### 5A — A versão no health
**Quem executa:** você, no navegador.
1. Abra uma aba nova, digite o endereço do Celuzap (o mesmo que você usa para entrar) e acrescente no fim:

```text
/api/v1/health
```

2. Leia a resposta (é uma página de texto).

**Deu certo se:** aparece `"status":"healthy"` e `"version":"7d976ea"` (o código curto do commit da r2). **[LIDO]** O `/api/v1/health` devolve `APP_VERSION`, e a configuração da imagem do app já traz `APP_VERSION=7d976ea`.
**Se aparecer `"version":"1.69.0"`:** a imagem **não** trocou. Olhe, nesta ordem: (a) na aba **Environment**, se as 3 linhas salvas são as da Etapa 4B; (b) se o log do Deploy da 4C mostra o download das imagens `danishoes27-alt`; (c) se você clicou em Deploy depois de salvar. Se tudo isso estiver certo e a versão continuar `1.69.0`, cole aqui o log do Deploy.
**Se aparecer outra versão qualquer:** pare e cole a resposta inteira do health.
**Se `status` não for `healthy`:** o health diz qual verificação falhou (`supabase`, `redis` ou `waha`); cole a resposta.
**Responda:** `7d976ea` ou cole a resposta.

### 5B — Os logs
**Quem executa:** você, no navegador.
1. No EasyPanel, abra o log do serviço `app` e depois o do `worker` **[confirmar na tela]**.
2. Procure, em cada um, as palavras `waha_base_url`, `waha_api_key_encrypted`, `42703` e `does not exist`.

**Deu certo se:** nenhuma dessas palavras aparece. **[LIDO]** o `worker` da r2 só avisa por canal por minuto quando **não** há servidor global; aqui há, então esse aviso não deve aparecer.
**Se apareceu:** cole as linhas (sem segredos). Um erro de coluna significa que a Etapa 3 não valeu; refaça a 3A e a 3D.
**Responda:** `sem erro` ou cole as linhas.

### 5C — Verificação por prompt (opcional)
```text
SOMENTE LEITURA. Faça um GET na rota pública /api/v1/health do endereço público do Celuzap (está no registro de deploy da VPS). Diga o valor de data.version, o de data.status e o status de cada item de data.checks. Compare data.version com 7d976ea e diga IGUAL ou DIFERENTE. Não envie nada ao servidor além do GET. Não use o remote git "origin".
```

### 5D — Opcional: arrumar a assinatura do WAHA compartilhado
**Faça esta etapa só se alguém for receber mensagens pelo WAHA compartilhado.** Para a Grau Cell ela **não** é necessária.

**O problema [LIDO]:** o YAML do plano de deploy passa o segredo ao WAHA compartilhado com o nome `WHATSAPP_HOOK_HMAC`. O WAHA **ignora** esse nome (o certo é com `_KEY`), então o contêiner manda os eventos **sem assinatura**. Como o banco está com "Exigir assinatura nas entregas do canal" ligado desde o deploy inicial, o app recusa esses eventos (401). O YAML que está de fato no seu painel é **[NÃO PROVADO]**: abra a aba **Source** e veja a linha do serviço `waha`.
**A correção, se a linha estiver com o nome antigo:** trocar por

```text
WHATSAPP_HOOK_HMAC_KEY: ${WAHA_HMAC_SECRET}
```

**Cuidado:** depois da troca o contêiner passa a **assinar** tudo. O app só aceita se `WAHA_HMAC_SECRET` (no Environment do `app` e do `worker`) tiver 16 caracteres ou mais e for **exatamente o mesmo** valor que o compose usa. Confira os dois lados antes do Deploy (você me diz só `bate` ou `não bate`; eu não vejo o valor). Antes de editar, salve o YAML atual num arquivo local (Etapa 1C). Depois: Save → Deploy, e confira que **só o `waha`** foi recriado. O WAHA compartilhado vai reiniciar as sessões dele sozinho (`WHATSAPP_RESTART_ALL_SESSIONS=True`).

---

## Etapa 6 — Como voltar atrás (leia antes da Etapa 4)

**Objetivo:** saber desfazer. Use só se algo falhar.

### 6A — Voltar as 3 imagens
1. Se a Grau Cell já estiver com a IA aberta ao público (Etapa 14), **pause a IA primeiro**: Conexões → o canal → **Configurar acesso da IA** → **Pausar respostas da IA**.
2. No EasyPanel, aba **Environment**, apague as 3 linhas `APP_IMAGE=`, `WORKER_IMAGE=` e `SCHEDULER_IMAGE=` e cole os valores que você anotou na Etapa 1D (estes são os de hoje):

```text
APP_IMAGE=ghcr.io/melgarafael/deskcommcrm:stable
WORKER_IMAGE=ghcr.io/melgarafael/deskcomm-worker:1.69.0
SCHEDULER_IMAGE=ghcr.io/melgarafael/deskcomm-scheduler:stable
```

3. **Save** e depois **Deploy** (Implantar). **As três imagens voltam juntas.** Outra alternativa de volta: as 3 imagens da r1 (`ghcr.io/danishoes27-alt/<imagem>:celuzap-1.69.0-r1`).
4. **Cuidado com o `:stable`.** Se `*_PULL_POLICY` for `always`, o Deploy baixa o `:stable` de novo, e ele pode ter andado para uma versão mais nova que a que rodava (o health mostrará outra versão que não `1.69.0`). Nesse caso use a etiqueta `:1.69.0` (ou o digest da Etapa 1E) no `app` e no `scheduler`, mantendo o `worker` em `1.69.0`. Se a Etapa 1E mostrou que `1.69.0` não existe para essas duas imagens, use o digest no formato `ghcr.io/melgarafael/deskcommcrm@sha256:<digest da 1E>`.
5. Confirme com o health (Etapa 5A): a versão deve voltar a ser `1.69.0`.

### 6B — O que isso exige no banco
- **Nada.** As duas colunas e o gatilho da 9001 ficam no banco, sem efeito, e a imagem antiga as ignora (Etapa 2).
- **Antes da Etapa 9 (nenhum canal com servidor próprio):** a volta é limpa. O cadastro da Etapa 8 fica na empresa e a imagem antiga o ignora.
- **Depois da Etapa 9 (a Grau Cell com o número pareado no servidor dela):** a imagem antiga **só fala com o servidor global**. O canal da Grau Cell, cuja sessão mora no WAHA dela, para de atender até a r2 voltar. **Nenhum dado se perde.** Por isso o primeiro número em servidor próprio só deve ser conectado com a r2 estável.
- **Não rode a 3E** (desfazer a 9001) depois da Etapa 9: ela recusa rodar enquanto houver endereço ou chave gravados, e não precisa rodar.

---

## Etapa 7 — Criar a Grau Cell e os funis

**Objetivo:** ter a empresa e os dois funis prontos.
**Pré-requisito:** Etapa 5 respondida (r2 no ar).
**O que a r2 faz e não faz [LIDO]:** cada empresa nova nasce com o funil padrão **"Pedidos"** (8 etapas de loja online: Carrinho abandonado, Aguardando pagamento, Pago, Em separação, Enviado, Entregue, Pós-venda, Cancelado), criado por um gatilho do banco. **A r2 NÃO troca esse funil padrão** (nenhum dos 13 commits mexe nisso; a troca foi decidida, mas **não está implementada**). Os funis Conserto e Venda não existem no código: são criados pela interface. Não precisa de SQL, a não ser no plano B da 7B.

### 7A — Criar a empresa
**Pergunta (responda antes de continuar):** qual é o e-mail da pessoa que será a responsável (administradora) da Grau Cell?

1. Abra o Celuzap, entre como administrador da plataforma e acrescente no fim do endereço:

```text
/admin/tenants
```

2. Clique em **Novo tenant** → o formulário **Nova organização**.
3. Preencha: **Nome de exibição** = `Grau Cell`. Deixe o **slug** como a tela gerar. **Razão social** e **CNPJ** são opcionais (deixe em branco se não tiver certeza). **Plano**: deixe o que a tela já mostra. **E-mail do responsável**: o e-mail da sua resposta.
4. Clique em **Criar organização**.

**Deu certo se:** aparece **Organização criada** e a frase "Você já é administrador de Grau Cell". Se o responsável não for você, aparece um **Link do convite**, ou "Convite enviado por e-mail" (hoje o e-mail da VPS está vazio, então o provável é o link).
**Se não apareceu:** "Este slug já está em uso" → mude o slug; qualquer outro erro: cole o texto.
**Responda:** `feito` (e, se apareceu um link do convite, **não cole o link no chat**: envie-o direto à pessoa).

### 7B — Criar os funis
**Pergunta (responda antes de continuar):** no funil **Conserto**, a etapa final "Entregue" conta como venda ganha e "Não aprovou" como perdida? E no funil **Venda**, "Vendido" é a ganha e "Perdido" a perdida? Responda `certo` ou diga o que é diferente.

(O sistema exige exatamente **uma** etapa de ganho e **uma** de perda por funil.)

1. Troque para a empresa Grau Cell: no seletor do topo (**Organização** / **Selecionar org** **[confirmar na tela]**).
2. Menu **Funis** (`/app/kanban`). Clique em **Novo funil**. Em **Nome do novo funil** escreva `Conserto` e clique em **Criar funil**. **[LIDO]** O funil nasce com 4 etapas: Novo, Em andamento, Ganho, Perdido.
3. Abra **Etapas do funil** (menu **Organização**, ou `/app/settings/tenant/pipelines`) e ajuste o funil `Conserto` até ficar exatamente assim, nesta ordem:
   1. Pediu orçamento
   2. Aguardando aprovação
   3. Em conserto
   4. Aguardando peça
   5. Pronto para retirar
   6. Entregue (a etapa de ganho)
   7. Não aprovou (a etapa de perda)
4. A tela deixa **renomear** (clique no nome), **criar** (campo **Nome da nova etapa**), **reordenar** e **arquivar**. Os controles de reordenar e de mover a marca de ganho/perda **[confirmar na tela]**. **[LIDO]** Ao marcar outra etapa como ganha ou perdida, a marca **muda de lugar** (a tela avisa "Marcar esta desmarca «…»").
5. Repita para o funil `Venda`, com estas 6 etapas, nesta ordem:
   1. Novo contato
   2. Interessado
   3. Orçamento enviado
   4. Aguardando pagamento
   5. Vendido (a etapa de ganho)
   6. Perdido (a etapa de perda)
6. **O funil "Pedidos"** (de loja online) continua existindo e é o padrão. Se a Grau Cell não vende online, deixe-o **arquivado** e marque um dos dois novos como padrão **[confirmar na tela: onde se muda o funil padrão e se arquivar um funil é permitido]**. Enquanto o padrão for "Pedidos", todo contato novo sem funil escolhido cai nele.

**Deu certo se:** em **Funis**, os dois quadros mostram as colunas na ordem pedida, cada um com uma coluna de ganho e uma de perda.
**Se não apareceu / a tela não deixa reordenar ou mover a marca:** cole este prompt no Claude Code para ele **escrever** (sem executar) um SQL para você revisar:

```text
NÃO EXECUTE NADA. Gere, só como texto para eu revisar, um SQL para o banco do Celuzap que crie, para a organização cujo display_name é "Grau Cell", dois funis: Conserto (etapas: Pediu orçamento, Aguardando aprovação, Em conserto, Aguardando peça, Pronto para retirar, Entregue [ganho], Não aprovou [perda]) e Venda (etapas: Novo contato, Interessado, Orçamento enviado, Aguardando pagamento, Vendido [ganho], Perdido [perda]). Leia o schema real das tabelas crm_pipelines e crm_stages em supabase/baseline.sql e respeite as regras (uma etapa de ganho e uma de perda por funil, índices únicos de slug, posições). Use a organização pelo display_name, nunca por id digitado. Faça tudo numa transação. Se precisar consultar o banco para achar o id, use apenas SELECT. Não imprima segredos.
```

**Responda:** `feito` ou cole o erro.

---

## Etapa 8 — Criar o WAHA da Grau Cell e cadastrá-lo

**Objetivo:** dar à Grau Cell o próprio servidor de WhatsApp (WAHA), isolado do compartilhado.
**Pré-requisito:** Etapa 7 concluída. **Memória:** o contêiner usa de 380 a 410 MiB ao subir; o limite é 768 MB. **[LIDO]** na leitura de 30/10/2026 a VPS tinha cerca de 5,9 GB de memória livre.

> **Divergência com o plano anterior (avisando, como combinado).** O plano dizia para colocar `WHATSAPP_HOOK_HMAC_KEY` no WAHA da Grau Cell. **O código da r2 diz o contrário [LIDO em `lib/channels/waha-webhook.ts` e no kit da tela do operador]:** o contêiner de uma empresa fica **genérico** — só chave de API e volume — e o app diz à própria sessão, ao conectar o número, para onde mandar os eventos e com qual segredo assinar (um segredo aleatório por canal). Colocar `WHATSAPP_HOOK_URL` ou variável de assinatura no contêiner **atrapalha**. Por isso este roteiro **não** põe `WHATSAPP_HOOK_HMAC_KEY` nesse serviço. `WHATSAPP_HOOK_HMAC_KEY` só serve ao WAHA compartilhado (Etapa 5D).

### 8A — Gerar a chave (tela do operador)
**Quem executa:** você, no navegador.
1. Em `/admin/tenants`, abra a empresa **Grau Cell** e a aba **WhatsApp**.
2. A tela mostra **Falta cadastrar** (e, para o lojista, "Estamos preparando o seu WhatsApp"). Se mostrar o aviso "A URL pública do aviso de mensagens não está configurada neste servidor", pare e me avise (falta `WAHA_WEBHOOK_BASE_URL`).
3. Na seção **Criar o servidor desta empresa**, clique em **Gerar chave nova**.
4. A tela mostra uma única vez: **Chave (cole no cadastro acima)**, **Valor da variável de acesso no serviço** (um texto que começa com `sha512:`) e um quadro "kit" com os valores do serviço.
5. **Copie a Chave e guarde no gerenciador de senhas agora.** Ela **não volta a aparecer**. Não cole no chat.
6. **Não saia desta tela** até terminar a 8B (o valor `sha512:` também some).

**Responda:** `chave guardada`.

### 8B — Criar o serviço no EasyPanel
**Quem executa:** você, no navegador.
1. No EasyPanel, abra o projeto `celuzap` (**nunca** o outro projeto) e crie um novo serviço do tipo **App** com o nome `waha-grau-cell` **[confirmar na tela: o botão de criar serviço e o nome do tipo]**.
2. Em **Source** (origem), escolha imagem Docker e escreva exatamente:

```text
devlikeapro/waha:noweb-2026.10.1
```

3. Na aba **Environment**, cole estas 3 linhas:

```text
WHATSAPP_DEFAULT_ENGINE=NOWEB
WAHA_DASHBOARD_ENABLED=false
WHATSAPP_RESTART_ALL_SESSIONS=True
```

4. Na linha seguinte, digite `WAHA_API_KEY=` e, logo depois do sinal de igual, **cole** (Ctrl+V) o **Valor da variável de acesso no serviço** que a tela do operador mostrou (o texto que começa com `sha512:`). Sem espaço entre o `=` e o valor.
5. **Volumes** (aba de montagens, **[confirmar na tela]**): dois volumes gerenciados, um montado em `/app/.sessions` e outro em `/app/.media`. É isso que evita pedir o QR de novo a cada atualização.
6. **Memória:** limite de **768 MB** **[confirmar na tela]**.
7. **Sem exposição pública:** nenhum domínio e nenhuma porta publicada.
8. Salve e implante **só esse serviço** (o botão de Deploy dele, não o do `stack`).

**Deu certo se:** o serviço aparece rodando e saudável, sem domínio e sem porta pública.
**Se não apareceu:** cole o log do serviço (ele não mostra a chave).
**Responda:** `serviço no ar` e o **nome interno** que a página do serviço mostra para ele (algo como `celuzap_waha-grau-cell`).

### 8C — O app alcança o WAHA?
**Quem executa:** você, no navegador.
1. Volte à aba **WhatsApp** da Grau Cell (se a tela de chave sumiu, tudo bem: você já guardou a chave).
2. Em **Endereço do WhatsApp desta empresa**, escreva o endereço interno do serviço (porta 3000). O mais provável é:

```text
http://celuzap_waha-grau-cell:3000
```

(se o nome interno que a página do serviço mostrou for outro, use esse nome, sempre `http://`, sem usuário nem senha e sem nada depois da porta).
3. Em **Chave de acesso**, **cole a chave** que você guardou no gerenciador de senhas.
4. Clique em **Testar conexão**.

**Deu certo se:** aparece **Conexão funcionando.** com a **Versão** do WAHA.
**Se não apareceu:** (a) confira o nome interno do serviço; (b) confira se o serviço está rodando; (c) cole a mensagem da tela. Se o app não alcançar o serviço por nenhum nome, vá ao **plano B** (8F).
**Responda:** `conexão ok` ou cole a mensagem.

### 8D — O WAHA alcança o app? (o caminho de volta)
**Por que:** o app chama o WAHA (testado na 8C). Mas o WAHA da Grau Cell também precisa chamar o app para entregar as mensagens recebidas, no endereço da variável `WAHA_WEBHOOK_BASE_URL`. No plano de deploy esse valor é `http://app:3000`, um nome que só existe dentro da rede do `stack`. Um serviço criado à parte pode não enxergar esse nome. **[NÃO PROVADO]** — por isso este teste.

**Pergunta (responda antes de continuar):** qual é o valor de `WAHA_WEBHOOK_BASE_URL` na aba **Environment** do `stack`? (É um endereço, não é segredo.)

- **Se for um endereço `https://...` público:** o caminho de volta funciona por qualquer contêiner. Pule para a 8E.
- **Se for `http://app:3000`:** faça este teste. No EasyPanel, abra o **Console** do serviço `waha-grau-cell` **[confirmar na tela]** e rode:

```text
node -e "fetch('http://app:3000/api/v1/health').then(r=>console.log('HTTP',r.status)).catch(e=>console.log('ERRO',e.message))"
```

**Deu certo se:** aparece `HTTP 200`.
**Se não apareceu (`ERRO ...` ou outro código):** o serviço separado não enxerga o `app`. Duas saídas: (1) o **plano B** (8F), que coloca o WAHA dentro do `stack`, onde `app` existe; ou (2) me chame para escolher outro endereço de retorno. **Não conecte o número real enquanto isso falhar:** o QR funcionaria, mas as mensagens recebidas não chegariam.
**Responda:** `volta ok` ou cole o resultado.

### 8E — Salvar o cadastro
1. Na aba **WhatsApp** da Grau Cell, clique em **Salvar cadastro**.
2. **Não clique** em "Salvar e atualizar os canais que já usam este servidor" (ainda não há canal; esse botão serve para mover canais).

**Deu certo se:** aparece **Cadastro salvo.** e o estado muda de **Falta cadastrar** para **Cadastrado**. A chave passa a aparecer só como "cadastrada" e nunca volta a ser mostrada.
**Responda:** `cadastrado`.

### 8F — Plano B: colocar o WAHA dentro do `stack`
Use só se a 8C ou a 8D falharem. **Guarde antes** o YAML atual (Etapa 1C).
1. Apague (ou pare) o serviço separado `waha-grau-cell` **só depois** de a nova versão funcionar; apagar um serviço ou volume é destrutivo e exige o seu OK explícito.
2. Na aba **Environment** do `stack`, acrescente uma variável nova. Digite `WAHA_GRAU_CELL_API_KEY=` e, logo depois do igual, cole o **Valor da variável de acesso no serviço** (o texto `sha512:...` da tela do operador; gere uma chave nova se a tela antiga já fechou).
3. Na aba **Source**, dentro de `services:`, acrescente este bloco (mesma indentação do serviço `waha`):

```yaml
  waha-grau-cell:
    mem_limit: 768m
    image: devlikeapro/waha:noweb-2026.10.1
    restart: unless-stopped
    environment:
      WAHA_API_KEY: ${WAHA_GRAU_CELL_API_KEY}
      WHATSAPP_DEFAULT_ENGINE: NOWEB
      WAHA_DASHBOARD_ENABLED: "false"
      WHATSAPP_RESTART_ALL_SESSIONS: "True"
    volumes:
      - waha-grau-cell-sessions:/app/.sessions
      - waha-grau-cell-media:/app/.media
    logging: *default-logging
    networks: [internal]
```

4. No fim do arquivo, no bloco `volumes:`, acrescente (mesma indentação das linhas `waha-data:` e `waha-media:`):

```yaml
  waha-grau-cell-sessions:
  waha-grau-cell-media:
```

5. Save → Deploy. Confira que **só** o `waha-grau-cell` foi criado e que `app`, `worker` e `scheduler` **não reiniciaram**.
6. Na tela do operador, o endereço passa a ser:

```text
http://waha-grau-cell:3000
```

Refaça a 8C. A 8D passa a valer sozinha: o serviço está na mesma rede interna do `app`.

---

## Etapa 9 — Parear o número da Grau Cell por QR

**Objetivo:** ligar o aparelho ao servidor da Grau Cell. **A IA ainda não responde ninguém.**
**Quem executa:** você, no navegador, com a **pessoa que está com o celular da Grau Cell** ao lado.
**Pré-requisito:** Etapa 8 em `Cadastrado` e o teste da 8D com `HTTP 200` (ou a 8F feita).

**Por que a IA não responde (ainda) [LIDO]:** o canal criado por **Conectar novo WhatsApp** nasce **fechado**: a função de banco `fn_reserve_channel_connection` grava `ai_gate = allowlist`, `ai_gate_mode = pre_go_live` e a lista de números de teste **vazia**. Na tela, o canal mostra "Nenhum número autorizado — a IA não responde ninguém neste canal." As mensagens dos clientes **chegam** à caixa de entrada, e a sua equipe pode respondê-las à mão.

**Cuidado:** não responda clientes de verdade por este canal antes da Etapa 10. As mensagens digitadas por pessoa **não passam** pelo ritmo de envio nem entram na contagem do dia (lacuna conhecida, Etapa 14).

1. Entre na empresa **Grau Cell** (seletor de organização) e abra o menu **Conexões** (`/app/connections`).
2. Clique em **Conectar novo WhatsApp**. O QR aparece.
3. No celular da Grau Cell: WhatsApp → Configurações → **Dispositivos conectados** → **Conectar um dispositivo** **[confirmar na tela: o nome varia entre celulares]** → aponte para o QR.
4. Espere o estado virar **Conectado**.

**Deu certo se:** o canal aparece **Conectado** e mostra um número de telefone.
**Se não apareceu:**
- A tela diz que está preparando o WhatsApp: a Etapa 8E não ficou salva. Refaça.
- O QR não aparece ou dá erro de conexão: volte à 8C (Testar conexão).
- O QR expira antes de escanear: use **Reconectar** para gerar outro.

### O nono dígito
O WhatsApp devolve o número de celular brasileiro **sem** o 9 extra (12 dígitos), e o resto do Celuzap guarda **com** o 9 (13). Os 3 pontos conhecidos e o que a r2 faz com cada um **[LIDO]**:

| Ponto | O defeito no upstream | Na r2 |
|---|---|---|
| `lib/channels/numero-observado.ts:51` | gravava o número cru, sem o 9 | `numeroObservadoDaSessao` grava a forma canônica (com o 9, só dígitos) — commit 5 |
| `app/api/v1/channel-sessions/[id]/route.ts:218` | comparava com `!==`: o mesmo aparelho em duas grafias virava "número mudou", reescrito a cada leitura | compara com `samePhone` e, antes de gravar, procura todas as grafias do número (com e sem 9) — commit 5 |
| `supabase/baseline.sql:2133` | a trava `channel_sessions_phone_per_org_unique` compara **texto exato** | o banco **não mudou**; o único código que escreve o número do canal (a rota acima) só grava a forma canônica e consulta todas as grafias antes, então a trava volta a valer para a mesma grafia |

**Conclusão [LIDO + INFERIDO]:** nenhum dos 3 pontos deve afetar o número da Grau Cell na r2: é uma empresa nova, sem canal anterior em outra grafia, e só um código escreve esse número. O que **[NÃO PROVADO]** é o comportamento com o aparelho real da Grau Cell (a prova foi automática e num pareamento anterior). Confira agora:

**Responda:** o número que a tela mostra tem **13 dígitos** (código do país 55, DDD e 9 dígitos, ou seja, com o 9 depois do DDD)? Responda `13`, `12` (se aparecer sem o 9, **pare** e me avise) ou cole o erro. Não cole o número inteiro no chat: diga só quantos dígitos tem.

---

## Etapa 10 — Proteção de envio (obrigatória antes do número real)

**Objetivo:** gravar a idade do número e o ritmo de envio, para o WhatsApp não banir o número.
**Quem executa:** você, no navegador.

**Por que é obrigatória [LIDO]:** sem esta etapa o número não tem linha de configuração (`channel_knobs`) e o sistema o trata como **recém-criado, com idade 0**: o teto é de **20 envios por dia** (a escada é 20, 50, 100, 200 e sem teto aos 0, 4, 8, 15 e 31 dias de uso).

**Pergunta (responda antes de continuar):** desde quando o número da Grau Cell é usado no WhatsApp (mês e ano, mesmo aproximado)?

1. Em **Conexões**, no cartão do canal da Grau Cell, clique em **Proteção de envio**.
2. Em **Este número é usado desde**, escolha uma data. Use a **data real** de quando o número começou a ser usado (a tela diz que ela conta a idade do **número**, não da conexão).
3. **Não ligue** a opção **Este número já está aquecido — pular o aquecimento** a menos que você tenha decidido isso. Declarar a idade pela data é o jeito recomendado de dizer que o número é antigo.
4. Ajuste a **janela de resposta** da IA para **7 às 23**. O padrão do sistema é 7 às 22, mas a loja quer responder um pouco mais tarde. Isto vale só para as respostas da IA a quem escreveu:
   1. Na mesma ficha, desça até o campo **Janela de resposta (horário local)**. Ele fica abaixo da data e do interruptor de aquecimento e tem duas caixas de número, com o texto "h até" entre elas e "h" depois da segunda. Se ninguém mexeu antes, as caixas estão vazias e mostram o padrão (7 e 22) como sugestão.
   2. Na **primeira caixa** (antes do "h até"), digite **7**. Na **segunda caixa** (depois do "h até"), digite **23**. A linha deve ficar "7 h até 23 h".
   3. **Não mexa** no campo logo abaixo, **Janela de disparo (horário local)**: ele vale para disparos em massa, prospecção e retomada de conversa parada, e fica como está.
   4. **[LIDO]** A hora final não entra na janela: com 23, a IA responde até as 22h59, e uma mensagem que chegar às 23h30 espera e só é respondida a partir das 7h da manhã seguinte (para responder até 23h59, a hora final seria 24).
5. Deixe os demais campos (ritmo, atraso humano, fuso) com o padrão seguro do sistema. **[LIDO]** Padrões: 1,2 s entre envios mais até 0,8 s de variação, domingos permitidos, horário de Brasília.
6. Clique em **Salvar proteção**. Aparece **Proteção de envio atualizada.**
7. Abra a ficha de novo e leia o texto abaixo da data.

**Deu certo se:** a ficha mostra a data salva e uma destas frases: "Número com N dia(s) de uso — já formado. Vale só o teto diário abaixo." (número de 31 dias ou mais) ou "Hoje o aquecimento libera X envio(s) — o número tem N dia(s) de uso." (número novo).
**Deu certo (janela de resposta) se:** na ficha aberta de novo, as duas caixas de **Janela de resposta (horário local)** mostram **7** e **23** já escritos (e não mais o padrão como sugestão), e a **Janela de disparo** continua como estava. Se a tela recusar com "Janela de resposta inválida", confira que a primeira caixa tem 7 e a segunda tem 23.
**Se não apareceu:** se a ficha continuar sem data, o salvamento não valeu: cole a mensagem de erro.

**O que a r2 faz com um número antigo [LIDO] — leia antes de decidir:**
- Um número com **31 dias ou mais** (ou marcado como já aquecido) tem **teto de aquecimento sem limite**. No turno normal do agente (responder o cliente), no follow-up e no aviso de escalação, o limite diário do CRM entra como **vazio** (`crmDailyLimit: null`); pelo código que li, o campo **Teto diário de mensagens** da ficha só é usado nas respostas aprovadas por pessoa e na entrega de convite de reunião. Resultado: para um número antigo, **não há teto diário de envios para as respostas da IA**; só o ritmo entre mensagens e a janela de horário protegem. Isso já era assim no upstream. É uma **decisão sua** antes da Etapa 14: aceitar, ou pedir uma correção. (Campanhas têm o ritmo próprio delas, que eu não revisei aqui.)
- **Responda:** `salvei` (e se aparece "já formado" ou o teto de hoje).

---

## Etapa 11 — Modo teste: só o seu número recebe resposta da IA

**Objetivo:** cadastrar o número que pode conversar com a IA durante os testes.
**Quem executa:** você, no navegador.
**O que já vale [LIDO]:** o canal nasceu fechado (Etapa 9). O "modo teste" é esse estado: a IA só responde a números cadastrados numa lista; qualquer outro recebe silêncio da IA (a mensagem chega à caixa de entrada).

**Pergunta (responda antes de continuar):** qual é o número do celular que você vai usar para testar (com DDD)? Esse celular tem de ser **diferente** do celular da Grau Cell que foi pareado.

1. Em **Conexões**, no cartão do canal, clique em **Configurar acesso da IA**. Abre o painel **Acesso da IA no WhatsApp**.
2. Escolha **IA em modo de teste**.
3. Em **Números autorizados para teste**, escreva **um telefone por linha, com o `+` e o código do país**: `+55`, o DDD e o número do seu celular, tudo junto. A tela recusa número sem o `+` e o código.
4. Clique em **Ativar modo de teste** (ou **Salvar lista de teste**, se já estiver ativo).

**Deu certo se:** o cartão mostra **IA em modo de teste** e **1 número de teste autorizado**.
**Se não apareceu:** aparece "Use um telefone com DDI, por exemplo +5511999998888": ajuste o formato. Se "Lista vazia no modo de teste bloqueia todas as respostas automáticas", você esqueceu de salvar o número.
**Sobre o nono dígito [LIDO]:** a comparação do número de teste com o do contato considera as duas grafias (com e sem o 9), então você não precisa cadastrar o mesmo número duas vezes.
**Atenção:** "Liberar atendimento ao público" **não** pode ser clicado agora. Ele é o passo final da Etapa 14.
**Responda:** `modo teste ligado` ou cole o erro.

---

## Etapa 12 — Chave de IA em produção

**Objetivo:** a IA poder responder.
**Quem executa:** você, no navegador.

**A VPS deve estar sem chave de IA** (**[LIDO]** no plano de deploy: `AI_GATEWAY_API_KEY`, `ANTHROPIC_API_KEY` e `OPENAI_API_KEY` ficaram vazias de propósito; o estado real do seu painel **[NÃO PROVADO]**). Sem chave, só há resposta humana.

**Onde cadastrar [LIDO]:** a chave da IA principal (a que conversa com os clientes) é cadastrada **por empresa, pela tela**, e fica cifrada no banco (a cifra usa `AI_CRED_AES_KEY`, que já existe). Não precisa mexer em variável de ambiente.

**Nomes das variáveis de ambiente relacionadas (só os nomes; deixe-as vazias):** `AI_GATEWAY_API_KEY` e `AI_GATEWAY_PLANO_CONFIRMADO` (juntas ligam o AI Gateway da Vercel), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`. **Por que ficam vazias:** preencher `ANTHROPIC_API_KEY` liga o worker de sentimento (legado) direto na Anthropic e ele passaria a processar a fila acumulada de eventos de teste; e `AI_GATEWAY_API_KEY` sozinha não liga nada sem `AI_GATEWAY_PLANO_CONFIRMADO` (trava central).

**Pergunta (responda antes de continuar):** a Grau Cell já tem um **agente publicado e ligado ao canal** (menu **Agente de IA** → **Agentes**)? Responda `sim` ou `não`.

- **Se `não`: pare aqui.** Sem agente publicado e vinculado ao canal, a IA não responde nem no teste ([LIDO] no painel de acesso: "O agente precisa estar publicado e vinculado a este canal"). Criar o agente (instruções, base de conhecimento, funil) é um trabalho próprio e **não faz parte deste roteiro**; precisa de um roteiro separado.
- **Se `sim`:**

1. Na empresa Grau Cell, menu **Agente de IA** → **Credenciais** (`/app/ai/credentials`).
2. Clique em **Adicionar credencial**. Escolha o **Provedor**, dê um **Nome** (opcional, por exemplo "Chave da Grau Cell"), e **cole a chave** no campo **Chave** (direto do site do provedor, nunca no chat). Clique em **Salvar e validar**.
3. Abra **Agente de IA** → **Provedores** (`/app/ai/providers`) e confira que a mensagem "Você ainda não cadastrou a chave da sua IA principal" **sumiu**.

**Deu certo se:** a credencial aparece como **Validada** com a lista de modelos, e a tela de Provedores não pede mais a chave.
**Se não apareceu:** "Falha na validação" → confira a chave e o provedor; cole a mensagem (sem a chave).

**Como confirmar que o assistente responde:**
- **Sem WhatsApp:** abra o agente, o painel de teste (**Executar teste**; ele avisa "Modo teste consome créditos do provider" e "Nenhuma mensagem é enviada via WhatsApp"), escreva uma mensagem e leia a resposta.
- **Com WhatsApp:** do celular de teste (o número da Etapa 11), mande uma mensagem ao número da Grau Cell. A resposta da IA deve chegar. Depois mande uma mensagem de **outro** número qualquer: **não** deve haver resposta da IA (a mensagem aparece na caixa de entrada).

**Responda:** `ia responde` ou cole o que a tela mostrou.

---

## Etapa 13 — Teste com 2 servidores de WhatsApp (isolamento entre empresas)

**Objetivo:** provar que o WAHA de uma empresa não mexe no da outra. Este é o teste que ficou pendente na entrega da r2: o ambiente de teste local não tinha o banco necessário.
**Quem executa:** você, no navegador.
**Regra de ouro:** **não derrube, reinicie nem apague o WAHA da Grau Cell para "simular uma queda".** A queda é simulada num **segundo servidor temporário**, numa empresa temporária.

**Critério de aprovação [LIDO no plano da r2, tarefa 18, camada 3]:**
1. os dois servidores chegam a pedir o QR, e o QR aparece em cada empresa;
2. o evento de um servidor só atualiza o canal da própria empresa;
3. derrubar o servidor B marca **só** o canal B como parado (o da Grau Cell continua **Conectado**);
4. reiniciar o servidor A (Grau Cell) **não pede QR de novo** (graças ao volume).

### 13A — Empresa temporária e servidor temporário
1. Repita a **Etapa 7A** para uma empresa chamada `Teste de isolamento` (e-mail do responsável: o seu). **Não crie funis.**
2. Repita as **Etapas 8A a 8E** para ela, com o serviço `waha-teste` (imagem, variáveis e volumes iguais; **uma chave nova**; endereço `http://celuzap_waha-teste:3000`, ou o nome interno que a página do serviço mostrar). Se a 8F foi necessária para a Grau Cell, use o mesmo plano B aqui (`waha-teste`).
3. Entre na empresa `Teste de isolamento`, **Conexões** → **Conectar novo WhatsApp**. O QR aparece. **Não escaneie.**

**Critério 1:** o QR aparece nas duas empresas (na Grau Cell, abra **Conexões** e confira que o canal continua **Conectado**; para ver o QR da Grau Cell você teria de reconectar, então a prova dela já é o pareamento da Etapa 9).

### 13B — Isolamento
1. Abra `/admin/tenants`, a empresa `Teste de isolamento`, aba **WhatsApp**, seção **Canais desta empresa**. O canal dela deve aparecer; o da Grau Cell não.
2. Faça o mesmo na Grau Cell: só o canal dela deve aparecer.
3. Cole este SELECT no SQL Editor do Supabase (só leitura) para ver tudo de uma vez:

```sql
select o.display_name as empresa,
       cs.status,
       (cs.waha_base_url is not null) as tem_servidor_proprio,
       (cs.waha_api_key_encrypted is not null) as tem_chave_cifrada
from public.channel_sessions cs
join public.organizations o on o.id = cs.organization_id
where cs.archived_at is null
order by o.display_name, cs.created_at;
```

**Critério 2 deu certo se:** cada empresa tem seu canal com `tem_servidor_proprio = true`, nenhuma mistura.

### 13C — Derrubar o servidor temporário
1. No EasyPanel, **pare** o serviço `waha-teste` (parar é reversível) **[confirmar na tela]**.
2. Espere alguns minutos (o vigia do app confere os canais de tempos em tempos; a frequência exata não foi medida) e olhe **Conexões** das duas empresas e o SELECT da 13B.

**Critério 3 deu certo se:** o canal de `Teste de isolamento` aparece como parado/caído (e a Central ou o banner avisa) **e o canal da Grau Cell continua `WORKING` / Conectado**.

### 13D — Reiniciar o servidor da Grau Cell
1. No EasyPanel, reinicie o serviço `waha-grau-cell` (**Restart**/reiniciar **[confirmar na tela]**). **Só agora, com a IA ainda em modo teste e antes de abrir ao público.**
2. Espere a sessão voltar.

**Critério 4 deu certo se:** o canal volta a **Conectado** **sem pedir QR**. (No teste local, a sessão voltou em cerca de 11 segundos; na VPS o tempo real é **[NÃO PROVADO]**.)

### 13E — Limpeza
1. Suspenda a empresa `Teste de isolamento` em `/admin/tenants` **[confirmar na tela: botão de suspender]**.
2. Pare o serviço `waha-teste`. **Apagar** o serviço ou o volume é destrutivo: só com o seu OK explícito.

**Responda:** `4 critérios ok` ou diga qual falhou e cole o que a tela mostrou.

---

## Etapa 14 — Critério para ligar o número real e plano de volta

**Objetivo:** decidir se o número da Grau Cell pode receber resposta da IA de qualquer cliente.
**Regra:** só com o seu **"sim" explícito**. Todos os itens abaixo precisam estar marcados.

### Checklist (todos obrigatórios)
- [ ] Etapas 1 a 13 respondidas.
- [ ] O health mostra `7d976ea` e `healthy`, e os logs do `app` e do `worker` ficaram sem erro de coluna (Etapa 5).
- [ ] Backup do banco testado e foto da VPS existem (Etapa 1) e você sabe voltar (Etapa 6).
- [ ] O número tem 13 dígitos na tela (Etapa 9).
- [ ] **Proteção de envio** salva com a data real e você leu o que ela faz com um número antigo (Etapa 10).
- [ ] O modo teste respondeu **só** ao número autorizado (Etapa 12).
- [ ] Credencial de IA validada e agente publicado e ligado ao canal (Etapa 12).
- [ ] O teste dos 2 servidores passou nos 4 critérios (Etapa 13).
- [ ] Você leu a lista abaixo e decidiu, item a item, **aceitar** ou **corrigir antes**.

### Lacunas conhecidas (decisões suas antes de ligar) [LIDO]
1. **Mensagens digitadas por pessoa não passam pelo ritmo de envio nem contam no teto do dia.** Quem usa o Celuzap para escrever muito pode ser banido mesmo com a IA contida.
2. **Para número antigo, não há teto diário nas respostas da IA** (Etapa 10). O campo "Teto diário" não vale no turno normal do agente.
3. **Sem a Etapa 10, o teto é de 20 envios por dia indefinidamente** (a idade não anda sozinha).
4. **Não há limite por contato por dia.**
5. O caminho de envio por token/MCP não tem janela de horário.
6. **Mensagem digitada por pessoa durante uma queda não é reenviada sozinha** (as de IA e de automação são).
7. **Não existe "Desconectar" nem "Trocar número"**, só **Excluir** (que também desconecta o aparelho).
8. **Sem alerta por e-mail ou push na queda** enquanto o e-mail e o push não estiverem configurados na VPS (banner e Central funcionam).
9. **As abas da API oficial estão escondidas**; não há como criar o primeiro canal oficial pela interface.
10. O cadastro do servidor da empresa é legível por membros da empresa (só o endereço interno e a chave **cifrada**), e o `/api/v1/health` público mostra contagens de canais com servidor próprio.
11. O funil padrão "Pedidos" de loja online **não** foi trocado pela r2 (Etapa 7).
12. Não existe ainda o roteiro para criar o agente da Grau Cell (Etapa 12).

### Ligar
1. Em **Conexões**, no canal da Grau Cell: **Configurar acesso da IA** → **Liberar atendimento ao público**.
2. A tela pergunta **"Liberar a IA para o público?"** e avisa que a lista de teste deixará de limitar as respostas. Só se você decidiu: **Confirmar liberação**. Se tiver dúvida: **Continuar em teste** ou **Manter IA pausada**.
3. Fique de olho na primeira hora: Central de alertas, caixa de entrada e o banner de conexão.

### Plano de volta, na ordem (do mais leve ao mais pesado)
1. **Pausar a IA, na hora:** Conexões → **Configurar acesso da IA** → **Pausar respostas da IA**. As mensagens continuam chegando e a equipe responde à mão. É reversível e é a primeira ação diante de qualquer sinal estranho.
2. **No celular da Grau Cell:** WhatsApp → Configurações → **Dispositivos conectados** → desconectar o aparelho vinculado (derruba a sessão).
3. **Parar o serviço `waha-grau-cell`** no EasyPanel (reversível). **Não apague o volume.**
4. **Voltar as 3 imagens** (Etapa 6), só se o defeito estiver no app. Lembre: depois disso o canal da Grau Cell fica sem atendimento até a r2 voltar.
5. **Excluir o canal** em Conexões, como último recurso (também desconecta o aparelho).

**Responda:** `sim, ligar` ou `ainda não` (e, no segundo caso, quais itens faltam).
