# Roteiros de produção — WAHA por empresa (Bloco D)

**Estado:** só roteiros. **Nada daqui foi executado.** O Bloco D só começa depois do **G4** (o seu "sim" explícito), e cada passo que muda alguma coisa na VPS só acontece depois de eu pedir e você confirmar.
**Escrito em:** 30/10/2026, a partir do plano (`08-plano-waha-por-empresa.md`, tarefas 20 a 22) e **ajustado ao que foi realmente construído** na branch `celuzap-1.69.0-r2`.
**Revisado em:** 31/10/2026. **Correção:** a conferência da migração 9001 deixou de depender da tabela `supabase_migrations.schema_migrations`, que **não existe** neste banco. Agora ela é feita pelas duas colunas e pelo gatilho que a migração cria (Roteiro 21, "Antes", item 3). Os roteiros 20 e 22 foram revisados no mesmo ponto e em outros que a leitura do código mostrou errados.
**Versão passo a passo, uma etapa por vez, com os textos prontos para colar:** `13-roteiro-bloco-d.md`. Este arquivo é o resumo por roteiro; se os dois divergirem, vale o `13-roteiro-bloco-d.md`.
**Ordem de execução:** Roteiro 21, depois 20, depois 22.

Regras que valem para os três roteiros:
- A VPS é compartilhada com o site que já roda nela (outro projeto do EasyPanel, o que existia antes do `celuzap`). **Ele nunca pode ser afetado.** Qualquer sinal estranho nele: parar tudo e voltar ao estado anterior.
- Eu nunca digito senha, chave ou token por você. Você cola direto nos campos.
- Antes de editar qualquer YAML ou variável no EasyPanel, você copia o conteúdo atual para um arquivo local (fora do projeto e do git).
- Todo passo seu é no navegador. Quando precisar de uma verificação técnica, o roteiro do Bloco D traz um prompt pronto para colar no Claude Code.

---

## Roteiro 20 — O WAHA da Grau Cell no EasyPanel

**O que faz:** cria o serviço que fala com o WhatsApp da Grau Cell, no projeto `celuzap` (**nunca** no outro projeto que já existia no EasyPanel). **Só depois do Roteiro 21:** a tela do operador e o botão de gerar chave são da r2. **Pré-requisito:** empresa e funis criados (Etapa 7 do roteiro do Bloco D). Versão passo a passo: Etapa 8 do roteiro do Bloco D.

**1. Gerar a chave (na tela do operador, no navegador; não precisa de terminal).** Em `/admin/tenants`, abra a empresa Grau Cell → aba **WhatsApp** → seção **Criar o servidor desta empresa** → **Gerar chave nova**. A tela mostra **uma única vez**: a **chave** (você guarda no gerenciador de senhas; é o que será colado no cadastro), o **valor da variável de acesso** (um texto que começa com `sha512:`; é o que vai para o EasyPanel) e o kit de criação. Eu não vejo os valores.

**2. Criar o serviço.** Tipo **App**, nome `waha-grau-cell`, imagem **`devlikeapro/waha:noweb-2026.10.1`**. Variáveis:
- `WAHA_API_KEY=` seguido do valor `sha512:...` que a tela mostrou (cole logo depois do sinal de igual)
- `WHATSAPP_DEFAULT_ENGINE=NOWEB`
- `WAHA_DASHBOARD_ENABLED=false`
- `WHATSAPP_RESTART_ALL_SESSIONS=True` (religa a sessão sozinha depois de reiniciar o contêiner, sem pedir QR)

**Não** coloque `WHATSAPP_HOOK_URL`, `WHATSAPP_HOOK_HMAC_KEY` nem qualquer outra variável de assinatura neste serviço. **[LIDO no código]** o contêiner de uma empresa fica genérico (só chave de API e volume): o Celuzap registra o webhook (endereço com o token do canal e segredo de assinatura próprio) **dentro da própria sessão**, quando o número é conectado. `WHATSAPP_HOOK_HMAC_KEY` é só do WAHA **compartilhado** (ver o Roteiro 21).

**3. Volume persistente** para `/app/.sessions` e `/app/.media` (volume gerenciado do EasyPanel, não pasta do contêiner). É isso que evita pedir o QR a cada atualização.

**4. Sem exposição pública:** nenhum domínio, nenhuma porta publicada.

**5. Limite de memória: 768 MB** (o contêiner usa ~380 a 410 MiB ao subir; 512 MB ficava apertado). O limite não reserva RAM.

**6. Conferir os DOIS caminhos de rede:**
- **a) O app alcança o WAHA novo.** Na tela do operador, cole o endereço interno (o mais provável é `http://celuzap_waha-grau-cell:3000`; a página do serviço mostra o nome certo) e a chave, e clique em **Testar conexão**: deve mostrar **Conexão funcionando.** com a versão. (Pelo Console do contêiner `app`, uma chamada ao mesmo endereço sem a chave deve responder 401, e com a chave, 200.)
- **b) O WAHA novo alcança o app.** É o caminho das mensagens recebidas, no endereço da variável `WAHA_WEBHOOK_BASE_URL`. No plano de deploy ela é `http://app:3000`, um nome que só vale dentro da rede do `stack`; um serviço criado à parte **pode não enxergá-lo**. **[NÃO PROVADO]** Teste pelo Console do serviço `waha-grau-cell`: `node -e "fetch('http://app:3000/api/v1/health').then(r=>console.log('HTTP',r.status)).catch(e=>console.log('ERRO',e.message))"` deve mostrar `HTTP 200`. Se `WAHA_WEBHOOK_BASE_URL` for um endereço público `https://...`, este teste não é necessário.

**7. Plano B, se a rede não alcançar:** um bloco `waha-grau-cell:` dentro do compose (`stack`), com a mesma imagem, volumes `waha-grau-cell-sessions` e `-media`, `mem_limit: 768m`, rede `internal`, `restart: unless-stopped`, e o valor `sha512:...` numa variável nova do Environment (por exemplo `WAHA_GRAU_CELL_API_KEY`). O bloco completo está na Etapa 8F do roteiro do Bloco D. Antes de editar, copie o YAML atual para um arquivo local; Save → Deploy; conferir que `app`, `worker` e `scheduler` **não** reiniciaram. Dentro do `stack` o endereço passa a ser `http://waha-grau-cell:3000` e o caminho de volta é o mesmo do `waha` compartilhado.

**Pronto quando:** serviço saudável; "Testar conexão" com **Conexão funcionando.**; caminho de volta com `HTTP 200` (ou plano B); nenhuma porta ou domínio público; limite de 768 MB visível no painel; volume montado. Referência do teste local: reiniciar o contêiner devolveu a sessão a `WORKING` em ~11 s, **sem QR**. Na VPS, repetir o reinício para conferir.
**Como desfazer:** parar o serviço (reversível). **Apagar** o serviço ou o volume é destrutivo e exige o seu OK.

---

## Roteiro 21 — Troca das 3 imagens na VPS ⚠️ PASSO ARRISCADO

**O que faz:** coloca a r2 no ar. Você executa; eu guio **uma etapa por vez** e peço confirmação antes de cada passo que muda alguma coisa. Versão passo a passo: Etapas 1 a 6 do roteiro do Bloco D.

**Não clique em Deploy (Implantar) no `stack` antes da hora.** O `app` e o `scheduler` estão em `:stable`, uma etiqueta que o upstream pode mover. Com `*_PULL_POLICY=always` (o padrão do compose), qualquer Deploy baixa de novo o `:stable`. O `worker` está fixo em `1.69.0`.

### Antes (todos obrigatórios)

1. **Exportar as variáveis do EasyPanel.** Copie a aba **Environment** para `%USERPROFILE%\celuzap-backups\easypanel-env-AAAAMMDD.txt` e a aba **Source** (YAML) para `easypanel-compose-AAAAMMDD.yml`. Fora do projeto e do git; **eu não abro esses arquivos**. Confira que o número de linhas bate com o que está na tela (eram 49 variáveis).
2. **Backup do banco:** `pg_dump` comprimido **e testado**: o arquivo é restaurado num banco descartável e as contagens de linhas conferem com as da produção. O prompt pronto está na Etapa 1B do roteiro do Bloco D. (O método do backup de 02/10 não ficou documentado em nenhum arquivo legível; não dependa dele.) Antes disso, **foto (snapshot) da VPS** no painel do provedor.
3. **Aplicar a migração 9001 ANTES da troca**, e só depois de conferir que ela é **aditiva**:
   - arquivo: `supabase/migrations/20261030120000_9001_celuzap_waha_por_canal.sql`
   - o que ela faz: `add column if not exists` em `channel_sessions` (`waha_base_url` e `waha_api_key_encrypted`) e UM gatilho de guarda (`trg_channel_sessions_guard_waha`, com a função `fn_guard_channel_sessions_waha`) que impede o administrador de uma empresa de gravar essas duas colunas pelo próprio login. Nada de `drop` de coluna, nada de `not null`, nada que reescreva dados. Criar o gatilho pede um bloqueio muito curto na tabela `channel_sessions`: aplique fora de horário de pico e com `lock_timeout` curto
   - quem não mexe nas duas colunas (inclusive a imagem 1.69.0) não percebe o gatilho. **[LIDO]** O código da v1.69.0 não lê `channel_sessions` com `select *` e só grava colunas nomeadas (a prova está na Etapa 2 do roteiro do Bloco D). Por isso a ordem fica: migração primeiro, imagens depois
   - **A conferência NÃO usa a tabela de migrações.** Este banco não tem `supabase_migrations.schema_migrations`; então "a versão consta como aplicada?" não pode ser respondida por ela. A conferência é pelo que a migração cria: **ANTES** de aplicar, as duas colunas e o gatilho devem estar **ausentes**; **DEPOIS**, **presentes**. Consulta exata, só leitura, para o SQL Editor do Supabase:

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

     Resultado esperado **antes**: `0`, `0`, `0`. **Depois**: `2`, `1`, `1`. Qualquer outra combinação antes de aplicar: **pare** (a migração já foi aplicada, total ou parcialmente).
   - aplicar no SQL Editor **dentro de uma transação** (`begin; set local lock_timeout = '3s'; ...; commit;`): se falhar, nada fica pela metade. O texto exato para colar está na Etapa 3C do roteiro do Bloco D, junto com a conferência de que ele é igual ao arquivo da r2
   - a imagem 1.69.0 ignora essas colunas, então o rollback das imagens continua seguro
   - para desfazer (quase nunca preciso): Etapa 3E do roteiro do Bloco D (o texto do desfazer está lá). Ele **recusa rodar** se achar qualquer valor gravado nas colunas. **[LIDO]** o endereço e a chave só são copiados para o canal quando o número é conectado, então o desfazer só funciona antes de o primeiro número ser pareado em servidor próprio. A prova de aplicar e desfazer num banco de teste (aplicar, recusar com dado, desfazer, desfazer de novo, aplicar de novo) passou.

### A troca

Na aba **Environment**, mude **só** `APP_IMAGE`, `WORKER_IMAGE` e `SCHEDULER_IMAGE` para as imagens `ghcr.io/danishoes27-alt/<imagem>:celuzap-1.69.0-r2` (`deskcommcrm`, `deskcomm-worker`, `deskcomm-scheduler`). Valores de hoje, para voltar atrás: `APP_IMAGE=ghcr.io/melgarafael/deskcommcrm:stable`, `WORKER_IMAGE=ghcr.io/melgarafael/deskcomm-worker:1.69.0`, `SCHEDULER_IMAGE=ghcr.io/melgarafael/deskcomm-scheduler:stable`. Mantenha os valores de `*_PULL_POLICY` como estão **[confirmar na aba Environment: o valor real não foi lido]**. As três mudam juntas, nunca versões misturadas.

**Nenhuma variável nova é obrigatória na r2.** **Não tire as variáveis globais do WhatsApp do Environment.** Na r2 elas passam a ser opcionais (`WAHA_API_BASE_URL`, `WAHA_API_KEY`, `WAHA_WEBHOOK_BASE_URL`), mas a imagem 1.69.0 as **exige** em produção e sobe com erro sem elas. As duas primeiras **vão juntas**: uma sem a outra derruba o boot da r2 em produção. Mantenha-as enquanto houver janela de rollback. E lembre: se voltar para a 1.69.0 depois de o primeiro número ser pareado em servidor próprio, esse canal fica sem atendimento (a imagem antiga só fala com o servidor global); por isso a primeira empresa com servidor próprio só deve ser conectada depois de a r2 estar estável.

### ⭐ Correção do nome da variável de assinatura (só se o `waha` compartilhado for receber mensagens)

No YAML da aba **Source**, o serviço `waha` que já existe no compose `stack` tinha, no plano de deploy:

```
WHATSAPP_HOOK_HMAC: ${WAHA_HMAC_SECRET}
```

O nome **sem `_KEY` é ignorado pelo WAHA** (provado no teste da tarefa 1): o contêiner manda os eventos sem assinatura e, com "Exigir assinatura" ligado, nenhuma mensagem entraria. O YAML que está de fato no painel é **[NÃO PROVADO]**: abra a aba Source e confira a linha. Se estiver assim, troque por:

```
WHATSAPP_HOOK_HMAC_KEY: ${WAHA_HMAC_SECRET}
```

**Cuidado com o valor:** ao trocar o nome, o contêiner passa a **assinar** todo evento que envia. O app só aceita se `WAHA_HMAC_SECRET` (no Environment do `app` e do `worker`) tiver **16 ou mais caracteres** e for **exatamente o mesmo** valor que o compose usa. Vazio, curto ou diferente = todo evento do servidor compartilhado é recusado (401) e nenhuma mensagem entra. **Confira os dois lados ANTES do Deploy** (você me diz só "bate" ou "não bate"; eu não vejo o valor) e, no primeiro teste, mande uma mensagem e veja se ela aparece na inbox.

Antes de editar, copie o YAML atual para um arquivo local. Depois: Save → Deploy, e confira que **só o `waha`** foi recriado (`app`, `worker` e `scheduler` não reiniciam, e o outro projeto da VPS nem é tocado). Os arquivos de compose do código já estão com o nome certo na r2. Para os canais com webhook por sessão (o padrão da r2 em servidor próprio) esta variável não é usada; a correção vale só para canais no servidor compartilhado.

### Checklist depois do Deploy

- [ ] o log do Deploy termina em `Success`
- [ ] `app`, `worker` e `scheduler` rodando (o `app` *Healthy*)
- [ ] `/api/v1/health` com `"status":"healthy"` e `"version":"7d976ea"` (o SHA curto da r2; se continuar `1.69.0`, a imagem não trocou)
- [ ] os logs do `app` e do `worker` sem as palavras `waha_base_url`, `waha_api_key_encrypted`, `42703` e `does not exist`
- [ ] a tela de login abre e **o login funciona**
- [ ] `/app` abre no visual escuro
- [ ] o log do `worker` mostra o motor da IA pronto; o `scheduler` com as linhas de cron
- [ ] a Central sem alertas estranhos
- [ ] **o site do outro projeto da VPS continua normal**

### Rollback

Voltar as 3 linhas para os valores de hoje (acima) ou para a imagem r1 (`ghcr.io/danishoes27-alt/<imagem>:celuzap-1.69.0-r1`) e Deploy. As colunas novas ficam no banco, sem efeito. **As três imagens voltam juntas.** Atenção: se `*_PULL_POLICY` for `always`, o Deploy baixa o `:stable` de novo e ele pode ter andado; nesse caso use `:1.69.0` (ou o digest anotado) no `app` e no `scheduler`. O prompt que anota isso está na Etapa 1E do roteiro do Bloco D.

### Se der erro no meio

| Onde | O que fazer |
|---|---|
| A migração falha | Nada mudou (é uma transação): parar e analisar |
| O Deploy falha ao baixar a imagem | Os contêineres antigos continuam no ar: conferir o nome da tag e tentar de novo |
| O `app` não fica *Healthy* | **Rollback imediato** |
| O `worker` reinicia em loop | Ler o log; se não for óbvio, rollback das 3 |
| Algo estranho no outro projeto da VPS | Parar tudo e voltar ao estado anterior |

**Pronto quando:** todos os itens do checklist marcados e você confirma que sabe onde estão as 3 linhas antigas.

---

## Roteiro 22 — Teste com o número real da Grau Cell

**O que faz:** liga o número real, **só para você**, antes de liberar ao público. **Só começa com o seu "sim" explícito** e depois do seu "go" sobre a Grau Cell. Pré-requisito: Roteiros 20 e 21 concluídos. Versão passo a passo: Etapas 9 a 14 do roteiro do Bloco D.

1. **Antes:** hoje a VPS deve estar sem chave de IA, e sem credencial e sem agente só há respostas humanas. As credenciais e o agente entram mais abaixo, depois do modo teste (item 6B).
2. **Cadastrar o WhatsApp da empresa (tela do operador):** `/admin/tenants` → a empresa → aba **WhatsApp**. Preencha o **endereço** (o interno do serviço `waha-grau-cell`) e cole a **chave** direto no campo → **Testar conexão** → **Salvar cadastro**. A chave depois só aparece como "cadastrada". **Antes**, confira que `WAHA_WEBHOOK_BASE_URL` está no Environment do `app`: é a **base do app que o WAHA alcança** (no plano de deploy, o endereço interno `http://app:3000`; um endereço público `https://...` também serve). Sem ela a tela avisa e conectar o número fica bloqueado. Com o endereço interno, faça o teste do caminho de volta do Roteiro 20 (item 6b).
3. **Conectar o número:** entre na empresa, vá em **Conexões** → **Conectar novo WhatsApp**. O QR aparece (o canal nasce herdando o WhatsApp cadastrado no passo 2, e **nasce fechado**: a IA não responde ninguém).
4. **No celular:** WhatsApp → Configurações → **Dispositivos conectados** → **Conectar um dispositivo** **[confirmar na tela: o nome varia entre celulares]** → escanear. O status vira **Conectado**. **Confira o número mostrado: deve ter 13 dígitos (com o nono dígito)**. **[LIDO]** a r2 grava a forma canônica (commit 5); se aparecer com 12, pare.
5. **Proteção de envio (obrigatória antes de qualquer resposta real):** em **Conexões**, no cartão do canal, **Proteção de envio** → **Este número é usado desde** (a data real) → **Janela de resposta (horário local)**: primeira caixa **7**, segunda **23** (a IA responde até 22h59; mensagem recebida às 23h30 espera até 7h). Não mexa na **Janela de disparo (horário local)** → **Salvar proteção**. Sem salvar essa tela, o número é tratado como recém-criado e o teto é de **20 envios por dia**.
6. **Modo teste:** o canal novo nasce em modo teste. No cartão do canal, **Configurar acesso da IA** → **IA em modo de teste** → em **Números autorizados para teste** escreva **só o seu número** (um por linha, com `+` e código do país, por exemplo `+5511999998888`) → **Ativar modo de teste**. O cartão passa a mostrar "1 número de teste autorizado" (antes: "Nenhum número autorizado").
6B. **Chaves, agente e aviso de caso:** cadastrar as credenciais Anthropic e OpenAI (não TypeSafe), criar e publicar o agente com o interruptor de casos ligado e configurar o aviso de caso (Etapas 12A a 12C do roteiro do Bloco D). Aviso de caso: painel nos 3 computadores e WhatsApp para o seu número (um por organização; não pode ser uma conexão da própria empresa). O número que recebe o aviso passa a ser só da equipe e a IA não responde a ele: use outro celular no modo teste, ou faça os testes com WhatsApp antes de salvar o aviso.
7. **Mandar e receber:** do seu número, mande uma mensagem; ela aparece na inbox; responda pela inbox. Com a IA configurada, confira que ela só responde ao número autorizado (de outro número, a mensagem chega à inbox e a IA fica em silêncio).
8. **O celular continua normal:** receber e enviar pelo celular; a mensagem enviada pelo celular aparece no Celuzap como "enviada pelo celular" e **pausa a IA por 60 minutos**.
9. **Teste com 2 servidores** (Etapa 13 do roteiro do Bloco D, que já inclui reiniciar o WAHA da Grau Cell sem pedir QR; local: ~11 s).
10. **Teste de queda:** desligar a internet do celular ou remover o aparelho vinculado. Devem aparecer o **banner** (o botão "Escanear o QR"/"Reconectar" abre o QR do número direto) e o item da Central. Reconectar pelo QR. Digite uma mensagem durante a queda: ela mostra **"Não enviada: WhatsApp desconectado"** (mensagens digitadas por pessoa **não** são reenviadas sozinhas; as de IA e automação são).
11. **Liberar ao público** só depois de tudo acima e do seu "sim" explícito: **Configurar acesso da IA** → **Liberar atendimento ao público** → **Confirmar liberação**.

**Pronto quando:** os passos 1 a 10 passam (no item 9, os 4 critérios da Etapa 13: os dois servidores pedem QR e o QR aparece em cada empresa; o evento de um servidor só atualiza o canal da própria empresa; derrubar o servidor temporário marca só o canal dele como parado; reiniciar o WAHA da Grau Cell não pede QR de novo) e ficam anotados no registro, com capturas de tela e logs **sem expor número nem conteúdo de mensagem de terceiros**.
**Como desfazer, do mais leve ao mais pesado:** (1) **Pausar respostas da IA** no cartão do canal; (2) no celular, desconectar o aparelho vinculado; (3) parar o serviço do WAHA da empresa (reversível; não apagar o volume); (4) como último recurso, **Excluir** o canal em Conexões (isso também desconecta o aparelho). *(Não existe botão "Desconectar" separado nesta versão.)*

**Limitações conhecidas desta versão (para você decidir antes de liberar ao público):**
- mensagens digitadas por pessoa não passam pelo ritmo de envio nem entram na contagem do dia;
- para número com 31 dias de uso ou mais, ou marcado como já aquecido, não há teto diário nas respostas da IA (o campo "Teto diário" não vale no turno normal do agente);
- não há limite por contato por dia, e o caminho de envio por token/MCP não tem janela de horário;
- sem alerta por e-mail/push enquanto o e-mail (Resend/SMTP) e o push (VAPID) não estiverem configurados na VPS;
- sem "Desconectar" nem "Trocar número" (só "Excluir");
- sem reenvio automático de mensagem digitada por pessoa depois de uma queda;
- o funil padrão "Pedidos" (de loja online) não foi trocado pela r2: os funis Conserto (7 colunas) e Venda (7 colunas, com Análise da financeira) são criados pela interface, e você marca o Venda como padrão (Etapa 7 do roteiro do Bloco D). Impressão e Outro não têm funil e caem no Venda.
