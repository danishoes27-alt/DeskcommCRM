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
| T11 `jev_conferencia` na cadeia before_send (v8) | `463af5ad6` + `2df7c59ed` | ver abaixo | feita |
| T12 queda do Jev, teto e "Jev fora do ar" no DEPOIS | `4b6c90263` | ver abaixo | feita |
| T13 segurar a resposta (regra das 2 tentativas) | `2641ad713` | ver abaixo | feita |
| T14 abrir o caso para a equipe | `320788731` | ver abaixo | feita |
| T15 aviso fixo ao cliente | ver `git log` (`feat(jev): T15 ...`) | ver abaixo | feita |

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

### T12 — queda do Jev, teto e "Jev fora do ar" no DEPOIS

- **Queda (spec 4.2, Opção 2):** com o Jev indisponível (rede, tempo esgotado, 500, 529, 429, chave recusada, sem crédito) o DEPOIS usa só as regras L1 a L6 — achado local segura (faixa alta, sem Jev); sem achado a resposta sai e o veredito diz `conferida_pelo_jev: 0` ("não conferida"). **Disjuntor** da tarefa no `perguntarAoJev`: 3 falhas seguidas abrem por 5 min, 429/529 abrem na hora, e aberto = nenhuma chamada de rede (a conferência local segue). Disjuntor é por loja: a queda de uma não segura outra (teste).
- **Registro da queda:** toda falha que chegou à rede grava UMA linha de erro em `llm_calls` (`jev_depois`, origem `jev_observacao`) — é de onde saem a "Última falha" e o "Jev fora do ar".
- **"Jev fora do ar" na tela:** não existe uma "aba Status" no código; a superfície de status do Jev é o **cartão do Jev** (Provedores). A rota `GET /api/v1/ai/jev` ganhou `fora_do_ar` (falha de conta/fornecedor, de qualquer tarefa, nos últimos 30 min, ainda não superada — derivada de `llm_calls` porque o disjuntor mora no agent-worker e o cartão no Next; `lib/ai/decisao/fora-do-ar.ts`), e o cartão troca "Última falha" por **"Jev fora do ar"** (com espanhol). Defeito nosso (`contrato_invalido`, `resposta_ilegivel`) segue "Última falha".
- **Aviso ao DONO DA PLATAFORMA (D2 = B) — mecanismo existente, sem migração:** a tabela `incidents` (RLS só de administrador da plataforma, tela `/admin/incidents` com abrir/reconhecer/resolver já prontos; `type` é vocabulário aberto e `organization_id` pode ser nulo). `lib/ai/decisao/queda.ts`: chave recusada → `jev_chave_recusada`, conta sem crédito → `jev_sem_credito`, severidade crítica, **um incidente por tipo para a instalação inteira** (a chave é a mesma em todas as lojas; ANTES e DEPOIS falhando juntos atualizam o mesmo incidente com a tarefa, a loja e a contagem, em vez de abrir outro; reconhecido também conta como "já sabe"). Queda que passa sozinha (taxa, sobrecarga, demora) não incomoda o dono. O aviso que já ia ao administrador da loja continua sendo a "Última falha" do cartão e o aviso da Central do clima — as tarefas do turno não abrem aviso próprio na Central (decisão da onda 2, mantida). **Não achei necessidade de parar e perguntar**: o mecanismo serve sem alterar o banco.
- **Teto (D12):** a conferência NUNCA é bloqueada por teto estourado — nenhum arquivo dela consulta o orçamento (teste de varredura), o custo continua somando no teto (`llm_calls`), e `jev_depois` entrou em `PURPOSES_ISENTOS` como a isenção escrita para o dia em que passar por lá. (`jev_antes` fica FORA da lista: o ANTES é pulado com o teto estourado — T22.)
- **Ponto de atenção:** o incidente é fechado por quem resolve na tela do admin; não fecha sozinho quando o Jev volta.
- **Testes:** `queda.test.ts` (17), `fora-do-ar.test.ts`, `conferencia-no-turno-queda.test.ts` (21: cada tipo de queda, disjuntor, isolamento entre lojas, incidente, teto), rota e cartão; `lib/ai` + `lib/agent-engine` + cercas 1675 verdes; typecheck limpo; eslint sem erro (1 aviso antigo de react-hooks em outro arquivo).
- **⚠️ Não verificado contra Postgres de verdade:** o SQL do incidente (e o do gravador da T10) — mesma pendência da imagem `pgvector`.

### T13 — segurar a resposta (regra das 2 tentativas)

- **O que mudou:** `resposta-segurada.ts` (novo: `decidirOVetoDaConferencia`, `MAX_VETOS_DA_CONFERENCIA = 2`, o erro `resposta_segurada` ao modelo) e o `send_message` do `inbound-turn.ts`: veto `jev_conferencia` → 1ª vez devolve o motivo ao modelo (reescrever só com o que está nas fontes); 2ª vez SEGURA DE VEZ (`respostaSegurada`) e todo `send_message` seguinte do turno é recusado ANTES de qualquer conferência/Jev. O cliente não recebe nada da resposta segurada; o veto de cada tentativa já grava `before_send_traces` (faixa, origem, regras, em rótulos) e a atividade na timeline. Tudo só em `decidindo` — em `observando` o gate nunca veta (T11).
- **Decisão minha — diferente dos fail-safes irmãos:** promessa de humano e vocabulário interno SOLTAM o envio na 2ª vez (o pior desfecho deles é cliente sem resposta). Este NÃO solta: o pior desfecho é a resposta errada que sai, então a 2ª reprovação chama uma pessoa (T14 abre o caso, T15 avisa o cliente). Um teste de fonte cobra que o bloco não chama `runBeforeSend` para liberar.
- **A conferência passou a poder decidir:** saiu o `soObserva` da `TAREFA_DA_CONFERENCIA` (ganhou `aoDecidir`/`aoConfirmarDecidir` + espanhol). **Para o "decidindo" não ficar a um clique do primeiro dia, a rota exige o portão de D7 em código:** `PATCH` recusa `decidindo` (422 `jev_tarefa_ainda_observando`) se a tarefa não tem pelo menos 14 dias desde a PRIMEIRA observação em `jev_observacoes` (dias contados da primeira, filtro pela empresa da sessão e pela tarefa; voltar a observar e pausar nunca passam; quem já decide não é barrado de novo). **O outro portão — o corpus em português rotulado (D16) — é humano e continua sendo seu.** Vale também para a `triagem` (que segue `soObserva` até a T18).
- **Testes:** `resposta-segurada.test.ts` (9: decisão pura e fiação de fonte), `route.test.ts` (portão: sem observação, 13×14 dias, desde a primeira, isolamento por empresa e tarefa, idioma), `tarefas.test.ts`, `conferencia-no-turno.test.ts` (decidindo × observando); `lib/ai` + `lib/agent-engine` + rotas + cartão + cercas: 1991 verdes; typecheck e eslint limpos.
- **⚠️ Não executado:** o turno ponta a ponta (1ª reprova e 2ª aprova; as duas reprovam; `observando` nunca segura) é o invariante `tests/invariants/jev-conferencia-no-turno.test.ts`, que precisa do Postgres de teste (imagem `pgvector/pgvector:pg15`, que não está nesta máquina). Fica para a T25, com a sua licença para baixar a imagem.

### T14 — abrir o caso para a equipe (sem migração)

- **O que mudou:** `caso-da-conferencia.ts` (novo: `abrirOCasoDaRespostaSegurada`) e a chamada dele no bloco da 2ª reprovação do `send_message`. Abre o caso pelo `openCase` existente NA EMPRESA DO TURNO (`tenantId` do turno), com o rascunho segurado no resumo, as razões da reprovação no bloqueio e `context_snapshot.origem = 'jev_conferencia'`.
- **Já havia caso aberto** (só pode haver um por conversa): NÃO abre outro; anota na linha do tempo do caso existente, como o AGENTE (`registrarNotaDoAgente`, kind `agent_noted`), que outra resposta ficou segurada. O desfecho (`caso_aberto` / `caso_ja_aberto` / `caso_falhou`) vai ao rastro numa linha própria de `before_send_traces` (`vetoed_gate = jev_conferencia`, `vetoed_code = resposta_segurada`), só em rótulos. O resultado é devolvido para a T15 decidir o aviso.
- **Sem a migração opcional:** a origem do caso é `guardrail_autofallback` (a regra do banco só aceita essa e `agent`). Uma origem própria do Jev não valeu uma migração só pelo rótulo; quem precisar distinguir lê `context_snapshot.origem`. **Nenhuma migração criada.**
- **Decisões minhas:** (1) a senha do cliente sai do rascunho antes de ir ao resumo do caso (a máscara troca por `[SENHA]`; telefone/CPF/e-mail/endereço também saem do resumo); (2) o caso é de tipo `duvida`; (3) a conversa NÃO é passada a humano nesta segunda reprovação (a spec só manda abrir o caso; só a promessa de humano sem caso faz o fail-safe irmão chamar `moverParaHandoffBestEffort`); (4) abre o caso mesmo se a empresa não habilitou `cases_enabled` — a tela de casos pode não estar ligada, mas o caso precisa existir para o aviso e a equipe.
- **Testes:** `caso-da-conferencia.test.ts` (10: empresa certa, origem, razões sem a instrução ao modelo, já-havia-caso sem duplicar, banco que falha, senha fora do resumo, rastro sem rascunho, teto, fiação); suíte do agente verde; typecheck e eslint limpos. **Não executado contra Postgres de verdade** (o invariante "o caso nasce na empresa certa" é da T26).

### T15 — aviso fixo ao cliente

- **O que mudou:** novo motivo `resposta_segurada` em `lib/escalacao/aviso-ao-lead.ts` (pt e es, mesmo mecanismo dos outros avisos de saída de campo); `caso-da-conferencia.ts` ganhou a marca do aviso no caso (`NOTA_DO_AVISO_AO_CLIENTE`), `devoAvisarOCliente` e `marcarOAvisoNoCaso`; o bloco da 2ª reprovação no `inbound-turn.ts` manda o aviso por `avisarLeadDaEscalacao` — a MESMA cadeia de guardrails (anti-ban, janela de resposta, bloqueio de contato, LGPD) — e marca o caso.
- **Texto (PROVISÓRIO, a aprovar):** com a equipe disponível, uma das 3 variantes: **"Vou confirmar essa informação com a equipe e já te respondo."**; as outras duas: "Quero te passar a informação certa, então vou confirmar com a equipe antes de responder." e "Deixa eu confirmar isso com o time para não te passar nada errado." Sem equipe disponível (ou leitura que falhou) NÃO se promete "já": só as 2 variantes sem promessa + um fecho próprio ("Deixei sua pergunta anotada e a equipe responde assim que possível." e duas irmãs). Os fechos gerais da passagem foram evitados de propósito: falam de "atendente" e "conversa na fila", e aqui a IA não passou conversa nenhuma. Espanhol neutro nos mesmos moldes. Sorteio por hash do lead (determinístico por conversa), e o gate de spinning continua desarmado para este aviso, como para os irmãos.
- **A regra:** caso aberto agora = avisa (uma vez por resposta segurada); caso falhou ao abrir = avisa mesmo assim; já havia caso aberto = avisa UMA única vez por conversa (a marca no caso diz se já avisou; leitura da marca que falha vale "já avisou"). Contato bloqueado não recebe (o `stop` da cadeia veta; teste).
- **Decisão minha:** o aviso de código NÃO é conferido pelo Jev nem pelas regras (a chamada de `avisarLeadDaEscalacao` não leva `conferenciaJev`): é texto nosso, fixo e sem fato.
- **Testes:** `tests/unit/aviso-da-resposta-segurada.test.ts` (frase, não fala em atendente/fila, espanhol sem português, cadeia, bloqueado, janela fechada, a regra das duas vezes, fiação), `aviso-ao-lead.test.ts` (o motivo entrou na lista de TODAS as propriedades dos avisos: ≥ 3 redações, não cabe na isenção do spinning, sem português em espanhol), `caso-da-conferencia.test.ts` (marca do aviso).

- **Fechamento do Marco 1 — cercas que a cadeia v8 e as finalidades novas fizeram vermelhar (conserto no mesmo commit):** `lib/ai/guardrails/lista-de-conferencia.ts` ganhou a conferência do Jev (a lista da tela tem de casar com a cadeia, na mesma ordem; texto em linguagem de lojista, com espanhol); `avaliar-resposta-de-teste.ts` declara o gate novo como "não avaliável no teste"; `pontos-de-ia-completude` aceita `jev_depois` e `jev_antes` como chamadas do Jev sem ponto; `conferencia.ts` deixou de espalhar objeto na chamada a `decidirNoPonto` (a cerca de decisão rápida lê a entrada literal).

## MARCO 1 (T01–T15) — DEPOIS completo, tudo em `observando` e desligado

- Nada foi ligado: o interruptor da instalação (`JEV_CONFERENCIA_ENABLED`) nasce desligado; a tarefa `conferencia` nasce desligada e pede o aceite novo; e "decidir" exige duas semanas de observação (portão no PATCH).
- Pronto para uso em `observando` quando houver: chave da TypeSafe colada na credencial `typesafe`, aceite de `resposta` dado pelo administrador na tela, tarefa religada e `JEV_CONFERENCIA_ENABLED=true`.

### Bateria completa do Marco 1 (`pnpm test:unit`, sem caminho)

- Rodapé: **24 arquivos / 59 testes falhando** na primeira rodada. Dos 59, **6 eram meus** (a cadeia v8 e as finalidades novas fizeram vermelhar 4 cercas: lista da tela × cadeia, não-avaliados do botão Testar, completude de purposes, decisão rápida) — **consertados no commit da T15**. Os outros **53 falham IGUAIS no commit-base `93b902658`** (conferido: criei um worktree temporário no commit-base, rodei os 20 arquivos — 35 + 18 testes vermelhos, os mesmos nomes —, e removi o worktree). São o ambiente Windows que você já tinha mapeado: `git`/`bash`/PDF, separador de caminho (`\`) e timeouts de 15 s. Na linha de base você falou em 51 + 3; aqui contei 53.
- Não apareceu nenhuma falha nova depois do conserto: `lib/ai`, `lib/agent-engine`, rotas de IA, telas de IA e as cercas do Jev: **2048 testes verdes**.
- `pnpm typecheck` limpo; ESLint sem erro nos arquivos tocados (avisos antigos de outros arquivos).
- **Não rodei `pnpm test:db`** (precisa da imagem `pgvector/pgvector:pg15`, que não está nesta máquina — veja "O que preciso de você").

## MARCO 2 (T16–T22) — ANTES

### Prova contra Postgres de verdade (licença concedida; imagem `pgvector/pgvector:pg15` baixada)

- `pnpm test:db` funciona nesta máquina (Docker Desktop). Novo invariante **`tests/invariants/jev-conferencia-no-turno.test.ts`** (7 casos, o turno REAL com Postgres, modelo e Jev dublês, canal dublê): 2 reprovações = rascunho não sai, 1 caso na empresa/conversa certas (`guardrail_autofallback`), 3 linhas de rastro, 2 linhas de custo `jev_depois` com preço, 1 observação, aviso fixo ao cliente; 1ª reprova e 2ª passa = sai a 2ª sem caso; `observando` nunca segura (e o trace diz `faria: segurar`); tarefa/instalação desligadas = Jev não chamado; caso já aberto = nenhum caso novo e aviso uma só vez por conversa; Jev 401 = linha de erro + incidente da plataforma (um só para duas lojas, atualizado); isolamento entre duas empresas. **Isso prova o SQL de T10, T12 e T14 e o isolamento de T26 (parte do turno).** Passou de primeira.

### T16 — categorias por empresa num lugar só

- `lib/ai/decisao/categorias.ts` + schema em `config.ts` (`settings.jev.categorias`, sem migração): padrão Conserto, Venda (com boleto e parcelamento), Impressão, Outro; `outro` sempre por último, ordem gravada preservada, lista ruim vale o padrão sem derrubar o resto da configuração. A triagem antiga (`lib/ai/triagem/`) ficou como está (legado, desligada). Testes: `categorias.test.ts` (8).

### T17 — tarefa `triagem`: perguntas, `state` e cortes

- `lib/ai/decisao/triagem.ts`: UMA chamada, três perguntas (`categoria` e `destino` em escolha, `urgente` sim/não), opções em ordem fixa (`outro` por último; `atender` primeiro), `state` = só o texto digitado, MASCARADO e depois cortado em 2.000 caracteres, modelo `jev-1.13.0`. Cortes do ANTES: alta ≥ 0,80/0,70 (age), média 0,70–0,80/0,60–0,70 (só registra), baixa (ignora); `urgente` marca a partir de 0,80 e nunca muda o destino; `pedir_dado` só vale na 1ª mensagem. Usa a variante `{ tarefa, perguntas }` do `decidirNoPonto` criada na T09 (a guarda de chave não foi enfraquecida). Resposta ilegível, categoria fora da lista ou destino inventado derrubam o veredito inteiro. Testes: `triagem.test.ts` (29).

### T18 — ponto de chamada no turno e gravação do resultado [DESENHO fechado]

- `triagem-no-turno.ts` (`triarOTurno`) + 1 chamada no `inbound-turn.ts`, **depois** das saídas antecipadas e **depois** dos avisos de código de pedido de atendente e de opt-out (que encerram o turno antes): o opt-out vem sempre antes. Não faz nada em prévia, em turno que não é `inbound_turn`, com contato bloqueado, sem o interruptor da instalação, com a tarefa desligada ou sem texto digitado (áudio, figurinha, marcador). Lê o texto da PRÓPRIA mensagem (`textoDigitadoDaMensagem`): nunca transcrição, descrição de foto ou texto de documento. `primeiraMensagem` = não há inbound anterior do cliente na conversa.
- **Gravação (`observacao-da-triagem.ts`), num comando só:** UMA linha em `llm_calls` (`jev_antes`, com preço), UMA em `jev_observacoes` com `rotulo_jev` = o `destino`, `rotulo_atual` VAZIO (sem par: não há mecanismo de hoje) e a probabilidade/confiança do destino, e `messages.metadata.triagem_jev` com categoria, destino (e o `efetivo`), urgente e faixas — chave PRÓPRIA, separada da `triagem` do legado. **Um rótulo por linha bastou; nenhuma migração.** A triagem antiga (`lib/ai/triagem/`) ficou marcada como legado no turno e não foi alterada.
- Invariante de turno **`tests/invariants/jev-triagem-no-turno.test.ts`** (contra Postgres real): texto exato e três perguntas ao Jev, mascaramento, `pedir_dado` só na 1ª, nada sai com tarefa/instalação desligada, contato bloqueado, áudio ou marcador; opt-out e pedido de atendente vêm antes (o Jev nem é perguntado); legado intocado; isolamento entre empresas.

### T19, T20, T21 — dica no prompt, aviso na Central, marca do `urgente` (um commit só: compartilham o ponto de chamada)

- **T19:** `dica-da-triagem.ts`. Só em `decidindo` com confiança ALTA: "Dica da triagem: categoria: conserto; destino: atender." ou "…peça primeiro o dado que falta…", numa linha, no sufixo por-lead do prompt. Em `observando`, confiança média/baixa, `equipe`, `pedir_dado` fora da 1ª mensagem ou Jev fora do ar: nada é acrescentado — **o prompt fica exatamente como hoje** (teste de banco compara). A tarefa `triagem` saiu de `soObserva` e ganhou `aoDecidir` (com espanhol); a rota exige as duas semanas de observação antes de decidir.
- **T20:** `aviso-da-triagem.ts`. Certeza ALTA de `equipe` (e `decidindo`) abre UM aviso em `agent_inbox_items` (`kind = other`, título fixo como chave, `ref = conversation`), no idioma da organização e sem repetir o texto do cliente. **Não abre caso, não passa a conversa, não muda de dono; a IA segue atendendo.** Um aviso ABERTO por conversa (resolvido, uma nova certeza abre outro). Mudança mínima em `lib/ai/inbox-destino.ts`: `other` agora aceita `conversation` como referência (para o botão "Abrir conversa"). Sem migração. `aviso-de-escalacao.ts` NÃO foi tocado.
- **T21:** o "cartão da Central" é o **cartão da conversa na lista da inbox** (`ConversationListItem`). A marca "Urgente" (`lib/inbox/urgente-do-jev.ts`) mora em `conversations.metadata.jev_urgente` — jsonb que a lista já carrega, sem migração. Só em `decidindo`; só marca (destino, status, dono e ordem da fila intactos); acompanha a mensagem mais recente (a seguinte, tranquila, tira a marca). Corte 0,80 em `CORTES_DO_ANTES.urgente`.
- Testes: `dica-da-triagem.test.ts` (12), invariante de turno estendido (14 no total, contra Postgres real: dica presente × prompt intacto, aviso único e sem caso, marca e desmarca, isolamento).

### T22 — queda do Jev e teto no ANTES

- **Queda (spec 4.1, Opção 1):** `perguntarATriagem` ganhou o disjuntor da tarefa (3 falhas seguidas abrem 5 min; 429/529 abrem na hora; por loja). Com o Jev fora do ar o ANTES é **pulado** e a IA atende sem dica (nunca atrapalha o atendimento). Toda falha que chegou à rede grava UMA linha de erro `jev_antes` em Execuções — o "Jev fora do ar" do cartão (T12) a lê, de qualquer tarefa. Chave recusada ou conta sem crédito avisa o **dono da plataforma** pelo MESMO incidente da conferência (`incidents`, um por tipo para a instalação inteira): ANTES e DEPOIS falhando juntos **atualizam** o incidente aberto, sem duplicar (testado com duas lojas e com as duas tarefas). Falha que passa sozinha (500, 429, 529) não incomoda o dono.
- **Teto (D12):** `teto.ts` (`tetoEstouradoParaOAntes`) usa a MESMA regra pura `decidirOrcamento` (modo bloquear + carência vencida + aviso dado no mês + chave de emergência) numa leitura SEM efeito colateral (não abre aviso nem registra bloqueio — isso é da IA principal), com falha aberta. Teto estourado em "bloquear" pula **só o ANTES** (`jev_antes` NÃO está na lista de isentos); o DEPOIS não consulta o teto (`jev_depois` isento; teste de fonte nos dois sentidos).
- Testes: `teto.test.ts` (13), `triagem.test.ts` (com o disjuntor), invariante de turno contra Postgres real (19 casos no arquivo: 401 → ANTES pulado, linha de erro e incidente; 402 em duas lojas → um incidente com `ocorrencias: 2`; 500 sem incidente; 429 abre o disjuntor e a outra loja não é afetada; teto estourado pula o ANTES e teto folgado não).

### Fechamento do Marco 2 — baterias completas

- **`pnpm test:db` (todos os invariantes, Postgres real):** 344 arquivos / 2800 testes; falharam 4 testes em 3 arquivos, e TODOS eram meus: a chamada da triagem lia `liveJob()` ao montar os argumentos, e na PRÉVIA (que não tem job) isso lança `preview_operational_job_forbidden`. Consertado (`tipoDoJob` e `jobId` não leem o job na prévia) e os 3 arquivos mais os 2 invariantes do Jev passaram juntos (41 testes). Os demais 341 arquivos passaram.
- **`pnpm test:unit` (sem caminho):** 53 falhas; **2 eram minhas** (`painel-de-seguranca`: a lista de conferências sem escolha foi de 10 para 11, e o texto da conferência do Jev agora diz "Neste painel ela não tem chave" em vez de "não é uma chave deste agente", que contradizia o "Isto não se desliga." do painel; `jev-nunca-cala-bloqueia-nem-responde`: a cerca proíbe `lib/ai/decisao/` de escrever em mensagem — o metadado da triagem em `messages.metadata` passou a ser gravado por `triagem-no-turno.ts`, no agent-engine, e o módulo do Jev só monta o conteúdo). Corrigidas e verdes. As outras 51 são as mesmas do commit-base (ambiente Windows).
- Os três SQLs que ficaram sem prova no Marco 1 (T10, T12, T14) agora têm prova contra Postgres de verdade (invariante `jev-conferencia-no-turno`).

## MARCO 3 (T23–T26) — reais e fechamento

### T23 — cotação do dólar na configuração da plataforma
- Chave `COTACAO_USD_BRL` em `platform_config` (sem migração), no catálogo da instalação (grupo IA, número, editável) e em `lib/env.ts` como piso. Leitor: `lib/ai/cotacao.ts` (`cotacaoDoDolar`, faixa 0,5 a 50; vazio ou inválido = `null` = telas em dólar).
- Gravação só pela ação `salvarConfiguracaoDaInstalacao` (`requirePlatformAdmin`); aceita "5,42", grava "5.42", recusa o resto; a auditoria `platform.config_changed` leva o valor (só desta chave, que não é segredo). O admin da loja não chega: teste prova que nada é gravado nem auditado.
- **VALOR INICIAL (provisório, para você conferir):** R$ 5,4212 por US$ 1 = PTAX de venda de 30/10/2026 (sexta, último dia útil antes de 01/11, que é domingo), obtida em notícias que citam o Banco Central (piranot.com.br, boca.com.br, dgabc.com.br). O mercado à vista fechou perto de R$ 5,44. Não consegui abrir o site do Banco Central; confira lá. Está em `.env.example` (`COTACAO_USD_BRL=5.4212`); o painel de Credenciais (grupo IA) troca sem reiniciar. Atualização manual, mensal.

### T24 — telas em reais
- `BudgetCard` e a tela de uso mostram "R$ X (cotação R$ Y)" quando há cotação, com a frase dizendo que o provedor cobra em dólar; sem cotação, ficam como antes (US$).
- O campo do teto mensal passa a ser em reais quando há cotação. A tela manda `monthly_limit_brl_cents`; **o servidor converte** (a tela não decide o câmbio), grava em dólar e audita o digitado e `cotacao_usd_brl_usada`. O campo só é reenviado se a pessoa o mudou (senão o teto "mudaria sozinho" depois de atualizar o dólar). Sem cotação configurada, o servidor recusa o campo em reais (422).
- Testes: `lib/ai/cotacao*.test.*`, `tests/unit/api-orcamento-em-reais.test.ts`, ES no dicionário.

### T25 — invariantes de turno fechados
- Novo `tests/invariants/jev-nenhuma-chamada-sem-guarda.test.ts` (Postgres real, turno de verdade, as duas tarefas no mesmo turno): controle com todas as guardas chama o Jev (1 do ANTES e 1 do DEPOIS) e o `state` traz só o permitido (ANTES: texto sem nome, telefone nem id; DEPOIS: só `resposta_da_ia` e `evidencias`); depois tira UMA guarda por vez (mestre, sem aceite, aceite só de mensagem, tarefa desligada x2, sem chave, interruptor da instalação x2, contato bloqueado) e confere o zero da(s) tarefa(s) protegida(s); a prévia não chama nem toca o banco.
- **Achado real, consertado:** com contato bloqueado o DEPOIS ainda chamava o Jev (o ANTES já não). O teste reprovou antes da correção. `conferirOTurno` ganhou `contatoBloqueado` e o ponto de chamada no turno o repassa. O opt-out já vetava o envio; agora também não gasta chamada nem manda o rascunho de quem pediu para parar.

### T26 — isolamento entre empresas
- `tests/invariants/jev-isolamento-entre-empresas.test.ts` (Postgres real, turno de verdade): duas empresas **ao mesmo tempo** (`Promise.all`), com chave, aceite e estado diferentes (A: resposta, triagem observando, conferência decidindo, resposta vetada duas vezes; B: só mensagem, triagem decidindo, conferência desligada). Prova, pelas LINHAS: cada pedido ao Jev leva a chave do lado que o fez e `buscarChave` só é perguntado pela empresa do turno (itens 1 e 6); toda linha de `llm_calls` e de `jev_observacoes` aponta para mensagem/conversa da mesma empresa (2); o caso nasce só em A, na conversa dela, e o cliente de A não recebe o rascunho ruim (3); o gasto (`fn_gasto_de_ia_do_mes`) cobre as linhas da própria empresa (4).
- `lib/ai/decisao/isolamento-da-chave.test.ts`: `chaveDasTarefas` lê a LINHA da empresa pedida (duas linhas com o MESMO valor de chave, como em D2 = B), todo filtro leva `organization_id`, empresa sem credencial não herda a de outra (item 1).
- `lib/agent-engine/agent/evidencias-isolamento-entre-empresas.test.ts`: evidência registrada em nome de outra empresa é recusada, e dois turnos intercalados não se contaminam (item 5).
- Varredura de RLS (`rls-completude-varredura` + `jev-observacoes`): verde, sem exceção nova (item 7).
- **O que NÃO foi feito:** o e2e em Playwright com o dublê HTTP (`scripts/duble-jev-e2e.mjs`) não foi estendido nem rodado nesta máquina (precisa de Supabase local, servidor e navegador). O equivalente que roda aqui é o invariante acima, com o turno real e duas empresas concorrentes; falta só a prova pela tela com duas empresas.

### Fechamento do Marco 3 — baterias completas
- `pnpm test:db` (tudo, Postgres real): 346 arquivos, 2817 testes passaram, nenhuma falha.
- `pnpm test:unit` (sem caminho): 51 falhas em 19 arquivos, as mesmas do commit-base (ambiente Windows: bash ausente, PDF, scripts de git/release); nenhuma é do Jev, de cotação, de orçamento ou do painel.
- `pnpm typecheck` e `pnpm lint`: sem erro (lint só com os avisos de sempre).

## Pendências e coisas que só o dono pode fornecer

| O quê | Quando faz falta | Tarefas |
|---|---|---|
| Crédito em dólar na TypeSafe e a chave da plataforma (D2 = B), colada na credencial `typesafe` de cada empresa | só para ligar de verdade em `observando` | nenhuma de código |
| Cotação do dólar inicial (pesquisada na T23, marcada como valor inicial) | telas em reais | T23, T24 |
| Texto jurídico final do aceite e revisão do advogado | quando chegar; não bloqueia | T01 (provisório) |
| Texto final do aviso ao cliente ("Vou confirmar essa informação com a equipe…") | antes de publicar o Marco 1 | T15 (usa o texto provisório do plano) |
| Corpus em português rotulado (200 mensagens, 100 rascunhos) | para sair de `observando` | portão operacional |
| Aceite do administrador da loja piloto | para a conferência ser consultada | T01/T02 |
