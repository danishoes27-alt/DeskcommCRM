# Progresso 16 — r3: Jev antes e depois da IA

> Memória do trabalho da r3 (T02 em diante). Releia este arquivo ao retomar a sessão.
> Spec: `docs/14-spec-jev.md`. Plano: `docs/15-plano-r3-jev.md`. Branch `celuzap-jev`. **Sem push.**
> Linha de base de testes: 51 falhas antigas por ambiente Windows (bash ausente, PDF, scripts de git) e 3 testes com timeout sob carga (drain-loop, knobs-da-versao, sem-marcador-de-conflito).

## Decisões desta rodada (do dono)

- O texto provisório do aceite da T01 **fica como está**, inclusive a frase de retenção.
- A caixa de aceite do consentimento `resposta` na tela entra na T02 (feito).
- Quando a T06 (máscara) estiver pronta, conferir se a frase do aceite "nome, telefone e e-mail não são enviados" passou a ser verdadeira; se não for, avisar e ajustar o texto.

## Tarefas

| Tarefa | Commit | Testes | Estado |
|---|---|---|---|
| T01 alcance `resposta` | `93b902658` | (rodada anterior) | feita |
| T02 registrar `triagem` e `conferencia` | `7fec303be` | ver abaixo | feita |
| T03 interruptores da instalação | `eb1101fa2` | ver abaixo | feita |
| T04 evidências: base de conhecimento | `e77453be7` | ver abaixo | feita |
| T05 evidências: catálogo e Bling | `9af3c5b34` | ver abaixo | feita |
| T06 máscara de dados pessoais e senha | `a566ddf99` | ver abaixo | feita |
| T07 regras locais L1, L2, L3, L6 | `368174b94` | ver abaixo | feita |
| T08 regras locais L4 (senha) e L5 (documento) | `d393b05db` | ver abaixo | feita |
| T09 tarefa conferencia: perguntas, state e cortes | `bb91188d1` | ver abaixo | feita |
| T10 custo e observação do DEPOIS | `cf0a6ff89` | ver abaixo | feita |
| T11 `jev_conferencia` na cadeia before_send (v8) | `463af5ad6` + correção de tipo no teste | ver abaixo | feita |

### T02 — registrar as tarefas `triagem` e `conferencia`

- **O que mudou:** `lib/ai/decisao/config.ts` (duas chaves novas em `tarefas`, cada uma com `.catch`), `lib/ai/decisao/tarefas.ts` (`TAREFA_DA_TRIAGEM`, `TAREFA_DA_CONFERENCIA`, `tarefaPedeMaisQueOAceite`; `SoObserva.ponto` virou opcional), `app/api/v1/ai/jev/route.ts` (`por_tarefa` ganha `alcance` e `pede_mais_que_o_aceite`; o PATCH recusa ligar tarefa que pede mais do que o aceite cobre, código `jev_tarefa_pede_mais_aceite`), `CartaoDoJev.tsx` (caixa de aceite de `resposta` com o texto provisório inteiro, selo "Aguarda o seu aceite", sem botão Religar enquanto falta o aceite), `lib/i18n/dicionario.ts` (espanhol de tudo), `lib/api/errors.ts`.
- **Decisões minhas:**
  - As duas nascem **`soObserva`** (nenhuma pode "decidir" nesta versão). Quem tira a marca é a tarefa que dá efeito a elas: T11/T13 (conferência) e T18/T19 (triagem). O cartão e a rota recusam `decidindo` até lá, e a saída de `observando` continua dependendo das duas semanas + corpus (D7 e D16).
  - `triagem` é família `novo` (não há mecanismo de hoje para comparar); `conferencia` é família `soma`.
  - A recusa de ligar a conferência sem aceite fica **na rota** (422) e também na tela (sem botão). Pausar sempre pode.
  - A `triagem` usa o alcance `mensagem`, então, pela regra do item 5 do cabeçalho de `tarefas.ts`, **aparece observando** em empresa que já tem o Jev ligado. Nenhuma chamada sai por causa disso: o interruptor da instalação (T03) é quem barra.
- **Atenção para a T17/T18:** `ponto.ts` (`tarefasDasPerguntas`) exige que cada pergunta de uma chamada sem ponto tenha por chave o **id de uma tarefa**. A triagem terá três perguntas (`categoria`, `destino`, `urgente`); a T17 precisa adaptar essa guarda sem enfraquecê-la (a chave da chamada continua passando pela tarefa `triagem`).
- **Testes:** `lib/ai/decisao` + `app/api/v1/ai/jev` + `app/app/ai/providers` + i18n/estruturais: 552 + 230 verdes. `pnpm typecheck` verde. ESLint nos arquivos tocados limpo.

### T03 — interruptores da instalação

- **O que mudou:** `lib/env.ts` e `.env.example` (`JEV_TRIAGEM_DO_SISTEMA_ENABLED`, `JEV_CONFERENCIA_ENABLED`, padrão `false`), `lib/ai/decisao/interruptores.ts` (novo) e `chaveDasTarefas` em `ponto.ts` (a 5ª condição, lida antes de qualquer consulta ao banco).
- **Decisão minha:** a guarda mora em `chaveDasTarefas`, o único caminho até a rede, e não em cada chamador; assim a T11/T17 herdam a regra sem lembrar dela. Os chamadores novos ainda devem checar `interruptorDaInstalacaoLigado` cedo para nem montar o `state` quando desligado.
- **Testes:** `ponto.test.ts` (cada condição ausente = nenhuma chamada, nem banco quando é a instalação) e `interruptores.test.ts`; `lib/ai/decisao` 370 verdes, `.env` sync verde, typecheck e eslint limpos.

### T04 e T05 — evidências do turno

- **O que mudou:** `lib/agent-engine/agent/evidencias-do-turno.ts` (a memória do turno: só em memória, uma instância por turno, recusa registro de outra empresa, deduplica, teto de 200, distingue "consultou e não achou" de "nem consultou"), `evidencias-das-ferramentas.ts` (lê o resultado de `crm_search_products` → origem `catalogo` e de `crm_query_external_data` → origem `bling`; `comEvidenciaDoTurno` envolve a ferramenta sem mudar o resultado), e dois pontos no `inbound-turn.ts` (instância criada junto de `pendingCitations`; `search_knowledge` registra os trechos; o laço que monta as ferramentas MCP envolve as duas de consulta).
- **Decisão minha — "Bling":** não existe ferramenta Bling no código. O dado do ERP chega ao agente pelo conector de banco de dados externo (`crm_query_external_data`), então a origem `bling` é esse conector. Se a loja usar outro caminho para o estoque (outra ferramenta), basta acrescentar o nome em `ORIGEM_DA_FERRAMENTA`.
- **Decisão minha:** ferramenta com `erro`, recusa de escopo ou formato desconhecido NÃO marca consulta feita (a L6 precisa saber "nem procurou"). Resultado vazio com motivo `sem_estoque` vira evidência de quem diz "sem estoque".
- **Nada novo em banco.** As evidências ainda não são lidas por ninguém: quem as consome é a T07/T08 (regras locais) e a T09 (Jev).
- **Testes:** `evidencias-do-turno.test.ts` e `evidencias-das-ferramentas.test.ts` (30 casos, inclusive isolamento entre duas empresas e o wrapper); `lib/agent-engine/agent` 268 verdes; typecheck e eslint limpos.

### T06 — máscara de dados pessoais e senha

- **O que mudou:** `lib/agent-engine/guardrails/mascarar-segredos.ts` (novo): `mascararSegredos(texto, { nomeDoContato })`, `encontrarSenhas` (devolve o valor e a posição, para a L4) e `pedacosDoNome`. Senha → `[SENHA]`; nome do cadastro (primeiro nome e sobrenome, sem distinguir caixa nem acento) e quem se apresenta ("meu nome é Maria Souza") → `[NOME]`; endereço → `[ENDERECO]`; CEP → `[CEP]`; e-mail, CPF, telefone e chave do Jev pelo `scrubMessage` que já existia.
- **Decisões minhas:** apagar de MENOS é o risco, então erra-se para o lado de apagar demais ("a senha é importante" vira "a senha é [SENHA]"). "padrão" sozinho só é senha com dígito ou "em L" (é palavra comum de loja); "senhas" no plural e "esqueci a senha" não mascaram. O `!` de "Mari2024!" fica dentro da senha; o ponto final da frase não. Em erro interno a função devolve um marcador, nunca o texto cru.
- **⚠️ A frase do aceite "nome, telefone e e-mail não são enviados" NÃO é estritamente verdadeira, mesmo com a máscara:** a máscara é por regras de texto (apelido que não está no cadastro, endereço sem "rua" ou telefone por extenso passam) e ainda não está ligada ao DEPOIS (é a T09 que a aplica). Por isso ajustei **só essa frase** do texto provisório (`ACEITE_DE_RESPOSTA.oQueNaoSai`, e o espanhol): agora diz que a mensagem do cliente não é enviada, que o sistema troca por uma marca o nome/telefone/e-mail/CPF/endereço/senha que aparecerem no rascunho, e que isso pode deixar passar algo escrito de um jeito fora do comum. A frase de retenção e o resto do texto ficaram como estavam. Ninguém aceitou ainda (nada ligado), então a versão do aceite continua 2. **Avisar o dono no relatório do Marco 1.**
- **Testes:** `mascarar-segredos.test.ts` (59 casos: tabela de senhas em PT, os que NÃO podem ser mascarados, nomes com acento, partículas, endereço, CEP, idempotência, nada sobra no texto, nunca lança); `textos.test.ts`, cartão e i18n verdes; typecheck e eslint limpos.

### T07 — regras locais L1, L2, L3 e L6

- **O que mudou:** `lib/agent-engine/guardrails/conferencia-local.ts` (novo): `conferirLocalmente({ rascunho, evidencias })` → `{ achados, faixa }` (faixa `alta` com qualquer achado). Cada achado traz regra, código, trecho do rascunho e motivo em português para o MODELO. Funções puras, nunca lançam; reaproveita `extractPromises` (o leitor de R$ do gate de promessa).
- **L1:** valor igual a um consultado, ou múltiplo inteiro (até 1000×) de um preço unitário consultado; soma de itens segura. "Consultado" = R$/reais nas evidências e colunas `preco/valor/total…: N` das linhas do banco externo.
- **L2:** "em N dias/horas", "prazo de…", "hoje/amanhã" só ao lado de verbo de compromisso (fica pronto, entregamos, chega…), "garantia de N meses", "garantia de fábrica/vitalícia"; a evidência precisa ter a MESMA quantidade e unidade.
- **L3:** "aprovado/liberado/sem consulta/sem análise/100%/garantido" em frase de crédito, boleto ou financiamento. **Sem fonte que salve.** Decisão minha: condicionais e negações antes da palavra ("se for aprovado", "depende", "não", "precisa ser") não contam, para não segurar "não posso garantir a aprovação".
- **L6:** "temos / tem / chegou / em estoque" exige trecho consultado que fale do MESMO produto (palavras de identidade em comum com a frase); "não temos / acabou / sem estoque" passa se a fonte diz que não tem OU se o catálogo/Bling foi consultado e o produto nem apareceu; contradição da fonte segura. Pergunta não afirma nada.
- **Falso alarme conhecido (medido em `observando`):** L1 com soma legítima e L6 com produto nomeado diferente nas duas pontas. "Com garantia" sem número nem tipo fica para o Jev.
- **Testes:** `conferencia-local.test.ts` (66 casos positivos e negativos por regra, inclusive "5 folhas × R$ 2 passa" e "2 itens somados = R$ 80 segura"); typecheck e eslint limpos.

### T08 — regras locais L4 (senha) e L5 (documento)

- **O que mudou:** `conferencia-local.ts` ganhou `conferirSenha` e `conferirDocumento` (entram em `conferirLocalmente`); `evidencias-do-turno.ts` ganhou o **cofre** (`guardarSenhaDoCliente`, `guardarDocumentoDoCliente`, leituras que devolvem cópias, tetos de 10 senhas / 5 documentos / 60 mil caracteres, recusa de outra empresa); `segredos-do-cliente-no-turno.ts` (novo) lê as mensagens do contexto do turno e abastece o cofre; `inbound-turn.ts` chama `guardarSegredosDoCliente` logo depois de criar as evidências.
- **Garantias:** o cofre NÃO é evidência (nunca aparece em `todas()`, logo nunca no `state` do Jev); o `trecho` do achado de L4/L5 nunca leva a senha nem o texto do documento (vai para o rastro); a função não escreve em log/console (teste com espiões). A T09 repete a checagem no `state`.
- **L4:** a senha vem de `encontrarSenhas` (a mesma regra da máscara) em texto digitado e áudio transcrito (foto não); comparação sem caixa/acento, palavra inteira, separadores do próprio valor flexíveis; senha com menos de 3 caracteres é ignorada. **L5:** 8 palavras seguidas iguais (sem caixa/acento/pontuação) entre o rascunho e o texto de um documento do cliente (`type = document`, texto com 40+ caracteres).
- **Testes:** `conferencia-local-senha-e-documento.test.ts`, `segredos-do-cliente-no-turno.test.ts` (117 verdes com os vizinhos); typecheck e eslint limpos.
- **Ambiente:** o terminal desta máquina recusa comandos com NUL literal ( ) dentro de here-doc; os arquivos de teste novos saem pela ferramenta de escrita.

### T09 — tarefa `conferencia`: perguntas, `state` e cortes

- **O que mudou:** `lib/ai/decisao/conferencia.ts` (novo): as 3 perguntas `noul` (`sem_fonte`, `promete_aprovacao`, `inventa_dado`; resposta = probabilidade de haver problema), `montarEstadoDaConferencia` (state = só `{ resposta_da_ia, evidencias }`, mascarado, com teto de 4 mil/24 mil caracteres), cortes do DEPOIS (alta ≥ 0,80, média 0,50–0,80, baixa < 0,50), `veredictoDasRespostas`, **`juntarOsAchados`** (o Jev só aperta), `perguntarAoJev` e `conferirOMeuRascunho`. Modelo fixo `jev-1.13.0`.
- **Mudança de apoio em `ponto.ts`:** `EntradaDoPonto` ganhou a variante `{ tarefa, perguntas }` (tarefa sem ponto que faz várias perguntas com nomes próprios); a guarda de `chaveDasTarefas` passa por essa tarefa (id inventado ou tarefa de ponto = sem chave). Isso também deixa a T17 (triagem, 3 perguntas) pronta para usar o mesmo caminho. `mascararSegredos` ganhou `valoresSecretos` (a senha do cofre sai como `[SENHA]` mesmo sem o rótulo).
- **Decisões minhas:** (1) com achado L4/L5 no rascunho o Jev **nem é chamado** (`segredo_no_rascunho`): ele já está segurado, e mandar para fora um rascunho que repete um segredo é o que a regra evita; (2) Jev ausente + achado local = segura; Jev ausente sem achado = passa e fica "não conferida" (`conferidaPeloJev: false`); (3) média do Jev sem achado local = libera e marca `duvida`.
- **Ainda não feito (de propósito):** gravar custo/observação (T10), pôr na cadeia (T11), queda/teto/aviso ao dono (T12). O disjuntor ainda não é consultado aqui.
- **Testes:** `conferencia.test.ts` (39 casos: perguntas, state sem nenhum campo proibido — nome, sobrenome, telefone, e-mail, senha, endereço, documento, mensagem do cliente —, cortes, junção incluindo a propriedade "toda probabilidade do Jev, a faixa final nunca é menor que a local", chamada com `fetchImpl` simulado, interruptor da instalação, aceite só de `mensagem`, 401/429/529/500, resposta ilegível, rede); `lib/ai/decisao` + guardrails + cerca `jev-nunca-cala-bloqueia-nem-responde` 754 verdes; typecheck e eslint limpos.

### T10 — custo e observação do DEPOIS [DESENHO fechado]

- **O que mudou:** `observacao-da-conferencia.ts` (novo): `registrarConferenciaDoJev(pool, …)` grava, num comando só (CTE, no molde de `registrarManipulacaoDoJev`), a observação em `jev_observacoes` e UMA linha em `llm_calls` com finalidade `jev_depois`; `custoDaChamada`; `rotuloDoJev`; `rotuloDasRegrasLocais`. `tarefas.ts` ganhou `CONFERENCIA_DA_RESPOSTA` (`jev_depois`) e `TRIAGEM_DA_MENSAGEM` (`jev_antes`, já para a T18) e `chamadaDoJevSemPonto`; a rota de Execuções passou a usar isso para dar nome e "por quê" a elas (com espanhol).
- **Desenho fechado (o que a spec deixou aberto):** `rotulo_jev` = a pergunta mais provável quando o Jev chega a 0,50, senão `ok`; `rotulo_atual` = a pergunta da família do 1º achado local (preço/prazo/garantia → `sem_fonte`; aprovação → `promete_aprovacao`; disponibilidade → `inventa_dado`), senão `ok`; `probabilidade_jev` = a MAIOR das três (o número que o corte ajusta); só a 1ª chamada da mensagem entra em `jev_observacoes` (a da reescrita cai no `on conflict do nothing`, mas o custo dela entra em `llm_calls`). **Um rótulo por linha bastou: nenhuma migração.** Se a medição precisar das 3 probabilidades por pergunta, vira migração aditiva (seção 5 do plano) — pare e pergunte.
- **Sem veredito do Jev** (queda/ilegível): não grava observação (sem rótulo do Jev não há par); a linha de custo da falha fica para a T12. Senha/documento no rascunho (L4/L5) não têm pergunta do Jev e viram `ok` no rótulo.
- **O teste que reprova "id sem preço":** `observacao-da-conferencia.test.ts` exige preço para `MODELO_DO_JEV` e prova que `jev-latest`/versão nova sem linha dá custo `null`.
- **⚠️ Não verificado contra um Postgres de verdade:** o SQL do gravador foi conferido linha a linha contra o de `manipulacao.ts` (mesmas tabelas/colunas, casts explícitos), mas esta máquina não tem a imagem `pgvector/pgvector:pg15` e eu não baixo imagem sem a sua autorização. Prova-se em `pnpm test:db` (T26). **Preciso da sua licença para baixar essa imagem do Docker Hub (~400 MB) se quiser a prova local.**
- **Testes:** `observacao-da-conferencia.test.ts` (12), `i18n-provedores-e-pontos`, rota de Execuções; `lib/ai/decisao` + `app/api/v1/ai` 680 verdes; typecheck e eslint limpos.

### T11 — conferência `jev_conferencia` na cadeia `before_send` (versão 8)

- **O que mudou:** `before-send.ts`: `BEFORE_SEND_CHAIN_VERSION` 7 → 8; `jevConferenciaGate` entre `agenda_stall` e `disclosure` (depois de todas as conferências locais, antes de o disclosure emendar o corpo); `GateContext.conferenciaJev` / `RunBeforeSendArgs.conferenciaJev` (`ConferenciaJevNoGate`: estado, segurar, motivo, detail); o veredito `pass` do gate passou a poder levar `skipped: 'observando'` e `detail` para o trace. Novo `conferencia-no-turno.ts` (`conferirOTurno`) e dois pontos no `inbound-turn.ts` (chama `conferirOTurno` ANTES de `runBeforeSend` e passa o veredito pronto).
- **Garantias:** (1) **o Jev é chamado fora do lock** — `conferirOTurno` roda antes de a cadeia pedir conexão ao pool (teste: o pool do turno nunca recebe `connect`; teste de fonte: a chamada vem antes de `runBeforeSend`, e a cadeia não importa nada de `lib/ai/decisao` nem faz rede); (2) **`observando` nunca segura** — o gate passa e deixa no trace `faria: segurar|liberar` em rótulos; (3) tarefa desligada, instalação desligada, prévia ou turno que não é `inbound_turn` = `undefined` = gate no-op, nenhuma regra roda e nada sai; (4) o Jev só aperta (T09).
- **Decisões minhas:** a conferência só roda em `inbound_turn` (o `case_reply_turn` responde a ação de um humano e o follow-up é texto de código); o interruptor da instalação vale também para as regras locais ("só roda com todas as condições juntas"); a conferência é calculada na CHAMADA do `send_message` sobre `body` (antes dos ajustes de estilo, que não mudam fatos).
- **Estado efetivo:** a tarefa continua `soObserva` — um `decidindo` gravado vale `observando` no estado efetivo, então o gate nunca veta em produção ainda. **A T13 tira a marca `soObserva` da `conferencia`** quando o "segurar" ganhar a regra das 2 tentativas.
- **Testes:** `tests/unit/before-send-chain-shape.test.ts` (12 gates, versão 8, ordem), `tests/unit/gate-jev-conferencia.test.ts` (gate, trace, cadeia completa, fora do lock), `conferencia-no-turno.test.ts` (16); `lib/agent-engine` + gates + cercas: 914 verdes; typecheck e eslint limpos.

## Pendências e coisas que só o dono pode fornecer

| O quê | Quando faz falta | Tarefas |
|---|---|---|
| Crédito em dólar na TypeSafe e a chave da plataforma (D2 = B), colada na credencial `typesafe` de cada empresa | só para ligar de verdade em `observando` | nenhuma de código |
| Cotação do dólar inicial (pesquisada na T23, marcada como valor inicial) | telas em reais | T23, T24 |
| Texto jurídico final do aceite e revisão do advogado | quando chegar; não bloqueia | T01 (provisório) |
| Texto final do aviso ao cliente ("Vou confirmar essa informação com a equipe…") | antes de publicar o Marco 1 | T15 (usa o texto provisório do plano) |
| Corpus em português rotulado (200 mensagens, 100 rascunhos) | para sair de `observando` | portão operacional |
| Aceite do administrador da loja piloto | para a conferência ser consultada | T01/T02 |
