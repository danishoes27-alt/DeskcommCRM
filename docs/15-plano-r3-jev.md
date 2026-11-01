# Plano 15 — r3: Jev antes e depois da IA

> **Status:** plano para aprovação (fase 3 de 4: plano). Nada aqui foi implementado, ligado, comprado ou enviado a algum fornecedor.
> **Base:** spec `docs/14-spec-jev.md` (decisões D1 a D16 fechadas em 01/11/2026). **Branch de trabalho:** `celuzap-jev`.
> **Data:** 01/11/2026. Todo custo está em reais (R$).

Este plano quebra a spec em **26 tarefas pequenas**, na ordem em que devem ser feitas. A ordem é a decidida na D15: **primeiro o DEPOIS** (regras locais L1 a L6, depois o Jev do DEPOIS), **depois o ANTES**. A base de configuração (T01 a T03) vem antes dos dois porque os dois a usam.

> **Decisões que moldam este plano (01/11/2026)**
> - **D1 = (b):** o Bloco D vai primeiro, com a r2. O **Marco 1 (T01 a T15) sai depois do Bloco D, em `observando`**. Até o Jev entrar, valem os controles de compensação da seção 9 da spec (modo assistido ou revisão por amostra nos assuntos de preço e financiamento, tabela de preços cadastrada, IA citando preço só do catálogo, conferência semântica ligada só depois de medir).
> - **D2 = B no piloto:** uma conta e uma chave da plataforma, coladas na credencial `typesafe` de cada empresa. Isso muda as tarefas T01, T12, T22, T23, T24 e T26 (notas em cada uma).

---

## 1. Como cada tarefa é feita

Toda tarefa passa pelas mesmas cinco etapas, sem pular nenhuma:

1. **Spec:** a tarefa cita a seção da `docs/14-spec-jev.md` que ela cumpre. Se a spec não bastar, a tarefa para e pergunta antes de decidir sozinha.
2. **Plano:** confirmar arquivos, risco e como medir o "pronto" antes de escrever código. Nas tarefas marcadas **[DESENHO]**, é aqui que se fecha o ponto que a spec deixou em aberto.
3. **Build incremental:** a menor fatia que funciona, um commit pequeno por tarefa. Nenhuma tarefa liga nada em produção.
4. **Test:** primeiro o teste que falha, depois o código (e, em correção de erro, o teste que prova o erro). Nunca contra o Jev real: usar `fetchImpl` simulado e o dublê do e2e.
5. **Review:** revisão nos cinco eixos (correção, leitura, arquitetura, segurança, desempenho). O auditor do projeto roda antes de qualquer publicação.

## 2. Marcas usadas

- **[MIGRAÇÃO]**: exige migração de banco. Nesta r3 **nenhuma é obrigatória**; as opcionais estão na seção 5.
- **[ACEITE]**: exige novo aceite do administrador da empresa (seção 6).
- **[VOCÊ]**: depende de algo que só você pode fornecer (seção 7).
- **[DESENHO]**: a spec deixou um ponto de desenho para fechar na etapa de plano da tarefa.

## 3. Ordem e resumo

| # | Tarefa | Grupo | Depende de | Marcas |
|---|---|---|---|---|
| T01 | Alcance de consentimento `resposta` | Base | — | [ACEITE] |
| T02 | Registrar as tarefas `triagem` e `conferencia` | Base | T01 | |
| T03 | Interruptores da instalação | Base | T02 | |
| T04 | Evidências do turno: base de conhecimento | Evidências | T03 | |
| T05 | Evidências do turno: catálogo e Bling | Evidências | T04 | |
| T06 | Máscara de dados pessoais e senha | Conferência local | — | |
| T07 | Regras locais L1, L2, L3 e L6 | Conferência local | T05, T06 | |
| T08 | Regras locais L4 (senha) e L5 (documento) | Conferência local | T04, T06 | |
| T09 | Tarefa `conferencia`: perguntas, `state` e cortes | Conferência com Jev | T02, T03, T06 a T08 | |
| T10 | Custo e observação do DEPOIS | Conferência com Jev | T09 | [DESENHO] |
| T11 | Conferência `jev_conferencia` na cadeia `before_send` (versão 8) | Conferência com Jev | T09, T10 | |
| T12 | Queda do Jev, teto e "Jev fora do ar" no DEPOIS | Conferência com Jev | T11 | |
| T13 | Segurar a resposta (regra das 2 tentativas) | Segurar, caso e aviso | T11 | |
| T14 | Abrir o caso para a equipe | Segurar, caso e aviso | T13 | [MIGRAÇÃO opcional] |
| T15 | Aviso fixo ao cliente | Segurar, caso e aviso | T14 | |
| T16 | Categorias por empresa, num lugar só | Triagem (ANTES) | T03 | [DESENHO] |
| T17 | Tarefa `triagem`: perguntas, `state` e cortes | Triagem (ANTES) | T06, T16 | |
| T18 | Ponto de chamada no turno e gravação do resultado | Triagem (ANTES) | T17 | [DESENHO] |
| T19 | Dica de uma linha no prompt da IA (nova) | Triagem (ANTES) | T18 | |
| T20 | Aviso na Central quando o destino é equipe (nova) | Triagem (ANTES) | T18 | |
| T21 | Marca do `urgente` no cartão da Central | Triagem (ANTES) | T18 | |
| T22 | Queda do Jev e teto no ANTES | Triagem (ANTES) | T18 | |
| T23 | Cotação do dólar na configuração da plataforma | Custo em reais | — | [VOCÊ] |
| T24 | Telas em reais com a cotação visível | Custo em reais | T23 | |
| T25 | Invariantes de turno do Jev novo | Testes | T13, T18 | |
| T26 | Isolamento entre empresas e e2e com o dublê | Testes | T01 a T25 | |

**Marcos de entrega** (cada marco é publicável sozinho, com os interruptores da instalação desligados):

- **Marco 1 — DEPOIS completo:** T01 a T15. Sai **depois do Bloco D** (D1 = b), em `observando`.
- **Marco 2 — ANTES:** T16 a T22.
- **Marco 3 — Reais e fechamento dos testes:** T23 a T26.

As 26 tarefas são as 24 da seção 8.3 da spec mais 2 novas (T20 e T19). A regra L6 não tem tarefa própria: entra na T07, junto das outras regras locais.

---

## 4. As tarefas

### Grupo A — Base de configuração

#### T01 — Alcance de consentimento `resposta`  [ACEITE]
- **Spec:** seção 5.1 e D9.
- **Arquivos prováveis:** `lib/ai/decisao/config.ts` (+ teste), `app/api/v1/ai/jev/route.ts` (+ teste), `lib/ai/decisao/textos.ts`.
- **Pronto quando:** existe o alcance `resposta` (rascunho da IA + trechos consultados, sem a mensagem do cliente), entre `mensagem` e `conversa`; o aceite do administrador tem versão nova; empresa com aceite só de `mensagem` não habilita tarefa que pede `resposta`; o texto jurídico do aceite parte do cenário B da D2 (a plataforma contrata a TypeSafe e a TypeSafe é operadora subcontratada). A revisão do advogado é pendência e **não bloqueia nada**: a tarefa entra com um texto provisório, marcado como tal, até a versão do advogado chegar.
- **Como testar:** unitários de `config.test.ts` (ordem dos alcances, tarefa que pede `resposta` não roda com aceite de `mensagem`); `route.test.ts` (só administrador liga; gerente só lê).

#### T02 — Registrar as tarefas `triagem` e `conferencia`
- **Spec:** seção 5.1.
- **Arquivos prováveis:** `lib/ai/decisao/tarefas.ts`, `lib/ai/decisao/textos.ts`, `app/app/ai/providers/_components/CartaoDoJev.tsx`, `app/api/v1/ai/jev/route.ts` (+ testes de cada um).
- **Pronto quando:** as duas tarefas aparecem na lista do Jev, com nome e "o que faz" em português; `conferencia` pede o alcance `resposta` e nasce `desligada`; `triagem` usa o alcance `mensagem`; o cartão, a rota e o "usada em" da chave mostram as duas sem mudança de tela além do texto.
- **Como testar:** `tarefas.test.ts`, `CartaoDoJev.test.tsx`, `route.test.ts`; teste de que `conferencia` nunca nasce `observando`.

#### T03 — Interruptores da instalação
- **Spec:** seção 5.1.
- **Arquivos prováveis:** `lib/env.ts`, `.env.example`, `lib/ai/decisao/ponto.ts` (+ teste).
- **Pronto quando:** `JEV_TRIAGEM_DO_SISTEMA_ENABLED` e `JEV_CONFERENCIA_ENABLED` existem com padrão **desligado**; um `.env` antigo continua funcionando sem edição; a tarefa só roda com **todas** as condições juntas (interruptor mestre, aceite, tarefa ligada, credencial `typesafe` ativa e interruptor da instalação). Isso impede que publicar a r3 faça a `triagem` nascer `observando` sozinha em empresa que já tem o aceite antigo.
- **Como testar:** teste do `env` (padrões), `ponto.test.ts` (cada condição ausente = nenhuma chamada).

### Grupo B — Evidências do turno

#### T04 — Evidências do turno: base de conhecimento
- **Spec:** seções 2 e 8.4 (risco 2).
- **Arquivos prováveis:** `lib/agent-engine/agent/evidencias-do-turno.ts` (novo, + teste), `lib/agent-engine/agent/inbound-turn.ts` (onde hoje se guardam as citações da base, perto de `:2694` e `:2987`).
- **Pronto quando:** o turno guarda, só em memória, os trechos da base de conhecimento consultados; as evidências vêm só da base da empresa do turno; nada novo é gravado em banco.
- **Como testar:** unitários do módulo; teste de que duas empresas no mesmo processo não misturam evidências.

#### T05 — Evidências do turno: catálogo e Bling
- **Spec:** seção 8.4 (risco 2) e regra L6.
- **Arquivos prováveis:** `evidencias-do-turno.ts`, as ferramentas de consulta de catálogo e Bling (**localizar na construção** onde elas devolvem produto, preço e estoque).
- **Pronto quando:** o resultado das consultas ao catálogo e ao Bling entra nas mesmas evidências do turno, no mesmo formato; consulta que não aconteceu = evidência vazia (e a L6 saberá disso).
- **Como testar:** unitários com resultados simulados das ferramentas; caso "nenhuma consulta feita".

### Grupo C — Conferência local (L1 a L6)

#### T06 — Máscara de dados pessoais e senha
- **Spec:** seção 6.1 e ambiguidade 6 (seção 11).
- **Arquivos prováveis:** `lib/agent-engine/guardrails/mascarar-segredos.ts` (novo, + teste); reaproveita `lib/sentry/scrub.ts` (e-mail, CPF, telefone).
- **Pronto quando:** `mascararSegredos` troca por `[SENHA]` o que vem depois de "senha", "PIN", "padrão" e "código de desbloqueio"; troca por `[NOME]` o primeiro nome do contato e mascara também sobrenome, telefone, CPF, e-mail e endereço; serve ao texto do ANTES e ao rascunho do DEPOIS.
- **Como testar:** tabela de casos em português (maiúsculas, acentos, "senha: 1234", "padrão em L", CPF com e sem pontos, endereço com número), mais casos que **não** podem ser mascarados (palavra "senhas" numa frase sobre política da loja).

#### T07 — Regras locais L1, L2, L3 e L6
- **Spec:** seção 3.3 (camada 1), ambiguidades 8 (L1) e a regra nova L6.
- **Arquivos prováveis:** `lib/agent-engine/guardrails/conferencia-local.ts` (novo, + teste); reaproveita a tabela de preços da empresa (gate `promise`, `before-send.ts:362`).
- **Pronto quando:**
  - **L1 valores:** segura valor em R$ que não seja igual a um valor consultado nem múltiplo inteiro de um preço unitário consultado; soma de itens é segurada, a menos que o valor venha de fonte.
  - **L2 prazo e garantia:** "em N dias", "hoje", "amanhã", "garantia de N meses" sem evidência correspondente são segurados.
  - **L3 aprovação:** "aprovado", "sem consulta", "sem análise", "100%", "garantido" sobre crédito, boleto ou financiamento são sempre segurados.
  - **L6 disponibilidade:** afirmar que um produto tem, não tem ou "chegou", sem trecho consultado (Bling ou base) que sustente, é segurado.
  - Todo achado local é **faixa alta**: segura mesmo com o Jev fora do ar. Tudo é checagem por padrão de texto, sem Jev.
- **Como testar:** tabela de casos positivos e negativos por regra ("5 folhas × R$ 2 = R$ 10" passa; "2 itens somados = R$ 80" é segurado sem fonte; L6 com e sem trecho consultado); teste de que o resultado local nunca vira "passou" depois.

#### T08 — Regras locais L4 (senha) e L5 (documento)
- **Spec:** seção 3.3 e 6.1.
- **Arquivos prováveis:** `conferencia-local.ts` (+ teste); memória do turno em `evidencias-do-turno.ts`.
- **Pronto quando:** **L4** guarda a senha digitada pelo cliente só na memória do turno (nunca grava, nunca envia a ninguém) e segura rascunho que a repete; **L5** segura rascunho que copia 8 ou mais palavras seguidas do texto extraído de um documento do cliente.
- **Como testar:** unitários; teste de que a senha não aparece em log, banco nem `state` de nenhuma chamada.

### Grupo D — Conferência com Jev e cadeia

#### T09 — Tarefa `conferencia`: perguntas, `state` e cortes
- **Spec:** seção 3.3 (camada 2), D7, D8.
- **Arquivos prováveis:** `lib/ai/decisao/conferencia.ts` (novo, + teste); usa `lib/ai/decisao/cliente.ts`.
- **Pronto quando:** três perguntas sim/não (`sem_fonte`, `promete_aprovacao`, `inventa_dado`; resposta = probabilidade de haver problema); `state` = `{ resposta_da_ia, evidencias }` já mascarado, **sem** mensagem do cliente, nome, telefone, id, empresa ou texto de documento; modelo fixo `jev-1.13.0`; cortes do DEPOIS (alta a partir de 0,80; média de 0,50 a 0,80; baixa abaixo de 0,50); uma função única junta o achado local e o do Jev, e o Jev **só aperta**.
- **Como testar:** `fetchImpl` simulado; teste de que achado local nunca vira "passou"; teste de que nenhum campo proibido entra no `state`; mapeamento de cada erro da API para um motivo.

#### T10 — Custo e observação do DEPOIS  [DESENHO]
- **Spec:** seções 7.2, 7.3 (D13) e 8.1; ambiguidade 10 (seção 11).
- **Arquivos prováveis:** `conferencia.ts`, `lib/agent-engine/edge/llm/pricing.ts` (só confere a linha de `jev-1.13.0`), gravador de observação em `lib/ai/decisao/`.
- **Pronto quando:** cada chamada grava **uma linha** em `llm_calls` com finalidade `jev_depois` (a segunda chamada da reescrita grava a sua); uma observação em `jev_observacoes` por (empresa, `conferencia`, mensagem de entrada); existe teste que reprova o caso "id de modelo sem preço", que gravaria custo vazio e some do teto em silêncio.
- **[DESENHO]** A tabela `jev_observacoes` guarda **um rótulo por linha** e é única por (empresa, tarefa, mensagem). A etapa de plano desta tarefa fecha: qual valor vai em `rotulo_jev` (proposta: o nome da pergunta mais provável quando passa de 0,50, senão `ok`), qual vai em `rotulo_atual` (proposta: o veredito das regras locais, no mesmo vocabulário) e o que fazer na 2ª chamada da reescrita (proposta: só a 1ª entra em `jev_observacoes`; as duas entram em `llm_calls`). Se um rótulo por linha não bastar, vira migração aditiva (seção 5).
- **Como testar:** unitários do gravador; `on conflict do nothing` na repetição do job; teste de isolamento (linha com a empresa certa).

#### T11 — Conferência `jev_conferencia` na cadeia `before_send` (versão 8)
- **Spec:** seções 2, 3.3, 8.2 e 8.4 (risco 4).
- **Arquivos prováveis:** `lib/agent-engine/guardrails/before-send.ts` (`BEFORE_SEND_CHAIN_VERSION` de 7 para 8, perto de `:819`; ordem das conferências, perto de `:839`), `tests/unit/before-send-chain-shape.test.ts`.
- **Pronto quando:** a conferência nova entra **depois** das locais; o Jev é chamado **antes** de pegar o bloqueio por número (perto de `:1118`) e o veredito já pronto é passado à conferência; em `observando` nunca segura, só registra o que faria; tarefa desligada não faz nada.
- **Como testar:** `before-send-chain-shape.test.ts` com a versão 8 (esse teste existe para forçar a revisão); teste de que o Jev só aperta; teste de que a chamada externa acontece fora do bloqueio.

#### T12 — Queda do Jev, teto e "Jev fora do ar" no DEPOIS
- **Spec:** seções 4.2 e 7.3; D12; ambiguidade 1 (seção 11).
- **Arquivos prováveis:** `conferencia.ts`, `lib/ai/decisao/disjuntor.ts` (reaproveita), `lib/ai/decisao/textos.ts` (já existe `jev_provedor_indisponivel`), `app/app/ai/providers/_components/CartaoDoJev.tsx` e `app/api/v1/ai/jev/route.ts` (aba Status; **localizar na construção** o lugar exato do texto "Jev fora do ar"). **Aviso ao dono da plataforma (D2 = B):** usar um mecanismo de aviso que já exista; **localizar na construção** qual. Nesta leitura (01/11/2026) não achei um aviso de plataforma pronto: o aviso da Central (`agent_inbox_items`, usado em `lib/ai/decisao/aviso.ts`) é por empresa, e a área de administração da plataforma fica em `app/app/admin`. Se nenhum mecanismo servir sem migração, a tarefa para e pergunta antes de decidir.
- **Pronto quando:** com o Jev indisponível (chave recusada, sem crédito, tempo esgotado, erro do servidor), o DEPOIS usa só as regras L1 a L6 com a regra das 2 tentativas; se nenhuma regra segurar, a resposta sai e fica registrada como "não conferida"; **a conferência nunca é bloqueada por teto estourado** (ela continua contando no teto); a aba Status mostra "Jev fora do ar"; **chave recusada ou conta sem crédito gera um aviso visível ao dono da plataforma** (D2 = B), além do aviso que já vai ao administrador da loja.
- **Como testar:** dublê do e2e com falha de rede, tempo esgotado e erro do servidor; teto estourado não bloqueia o DEPOIS; chave recusada e conta sem crédito geram o aviso ao dono da plataforma (e não só ao administrador da loja).

### Grupo E — Segurar, caso e aviso

#### T13 — Segurar a resposta (regra das 2 tentativas)
- **Spec:** seção 3.3 e 3.4.
- **Arquivos prováveis:** `lib/agent-engine/agent/inbound-turn.ts` (`send_message`, perto de `:3284`; saída automática perto de `:3361`), `before-send.ts`, `tests/invariants/jev-conferencia-no-turno.test.ts` (novo).
- **Pronto quando:** na 1ª reprovação o motivo volta ao modelo para reescrever só com o que está nas evidências; na 2ª a resposta fica segurada de vez; tudo só em `decidindo`; o rastro vai para `before_send_traces`; o cliente não recebe a resposta segurada.
- **Como testar:** invariante de turno com o dublê (1ª reprova e 2ª aprova; as duas reprovam; `observando` nunca segura).

#### T14 — Abrir o caso para a equipe  [MIGRAÇÃO opcional]
- **Spec:** seção 3.4 e 8.1; ambiguidade 4 (seção 11).
- **Arquivos prováveis:** `lib/agent-engine/agent/human-cases.ts` (`openCase`, perto de `:168`), `inbound-turn.ts`; migração opcional para a origem do caso.
- **Pronto quando:** a 2ª reprovação abre um caso na empresa certa; se a conversa **já tem caso aberto**, não abre caso novo e registra no rastro; sem a migração opcional, a origem é `guardrail_autofallback`.
- **Como testar:** unitários de `openCase`; invariante "o caso nasce na empresa do turno"; caso já aberto não duplica.

#### T15 — Aviso fixo ao cliente
- **Spec:** seção 3.4 e D6; ambiguidade 4 (seção 11).
- **Arquivos prováveis:** `lib/agent-engine/agent/aviso-de-escalacao.ts` (novo motivo; `avisarLeadDaEscalacao`, perto de `:115`), `lib/i18n/dicionario.ts` (texto em espanhol).
- **Pronto quando:** a resposta segurada manda um aviso fixo de código ("Vou confirmar essa informação com a equipe e já te respondo", texto final a aprovar), **uma vez por resposta segurada**; quando já havia caso aberto, o aviso sai **uma única vez por conversa**; passa pelo anti-ban, pela janela de envio e pelo bloqueio de contato.
- **Como testar:** unitários; contato bloqueado não recebe; duas respostas seguradas na mesma conversa com caso aberto geram um aviso só.

### Grupo F — Triagem (ANTES)

#### T16 — Categorias por empresa, num lugar só  [DESENHO]
- **Spec:** seção 3.2 e D3.
- **Arquivos prováveis:** hoje a lista está em `lib/ai/triagem/jev.ts` (perto de `:41`); o lugar novo é **a definir na etapa de plano** (a proposta é a configuração do Jev da empresa, em `organizations.settings.jev`, sem migração).
- **Pronto quando:** existe uma lista única por empresa, com o padrão **Conserto, Venda, Impressão, Outro** (`outro` por último); boleto e parcelamento estão descritos dentro de Venda; `financeiro` deixa de ser categoria; a triagem antiga continua como está (legado, desligada).
- **Como testar:** unitários da leitura da lista; ordem das opções fixa; empresa sem configuração usa o padrão.

#### T17 — Tarefa `triagem`: perguntas, `state` e cortes
- **Spec:** seção 3.2; D4, D7 e o corte do `urgente`.
- **Arquivos prováveis:** `lib/ai/decisao/triagem.ts` (novo, + teste).
- **Pronto quando:** uma chamada com três perguntas (`categoria`, `destino`, `urgente`); `state` = só o texto que o cliente digitou (até 2.000 caracteres), já mascarado; `pedir_dado` só vale na **primeira mensagem** da conversa; cortes do ANTES (piso 0,70/0,60; alta 0,80/0,70; média só registra; baixa ignora); `urgente` com corte 0,80; modelo fixo `jev-1.13.0`.
- **Como testar:** `fetchImpl` simulado; ordem das opções; `pedir_dado` ignorado fora da 1ª mensagem; nenhum campo proibido no `state`.

#### T18 — Ponto de chamada no turno e gravação do resultado  [DESENHO]
- **Spec:** seções 2, 5.2 e 7.3.
- **Arquivos prováveis:** `lib/agent-engine/agent/inbound-turn.ts` (perto de `:2123`), `lib/ai/triagem/*` (marcar como legado), gravador de observação.
- **Pronto quando:** a chamada acontece **depois** das saídas antecipadas, só no turno de mensagem recebida, nunca em prévia de teste (sem chamada externa) e nunca com contato bloqueado; cada chamada grava **uma linha** em `llm_calls` com finalidade `jev_antes`; o resultado vai para `messages.metadata` e para `jev_observacoes`.
- **[DESENHO]** Como na T10, a tabela tem um rótulo por linha. Proposta para a triagem: `rotulo_jev` = o `destino` (a pergunta que age); `categoria` e `urgente` ficam em `messages.metadata`; `rotulo_atual` fica vazio, porque não há "mecanismo de hoje" para comparar (a concordância aparece como "sem par"). A etapa de plano confirma ou muda isso.
- **Como testar:** `tests/invariants/jev-triagem-no-turno.test.ts` (novo): sem chamada sem os cinco requisitos da T03, sem chamada em prévia, sem chamada com contato bloqueado, opt-out sempre antes.

#### T19 — Dica de uma linha no prompt da IA  (nova)
- **Spec:** seções 2 e 3.2; ambiguidade 3 (seção 11).
- **Arquivos prováveis:** `inbound-turn.ts` (no mesmo ponto em que o prompt é montado; **localizar na construção**), módulo pequeno para formar a dica.
- **Pronto quando:** em `decidindo` e com confiança alta, o prompt recebe **uma linha curta** ("categoria: conserto; destino: atender" ou "peça primeiro: …"); em `observando`, com confiança média ou baixa, ou na queda do Jev, o prompt fica exatamente como hoje.
- **Como testar:** comparação do prompt com e sem dica; teste de que `observando` não altera o prompt.

#### T20 — Aviso na Central quando o destino é equipe  (nova)
- **Spec:** seção 3.2, D5 e ambiguidade 2 (seção 11).
- **Arquivos prováveis:** mecanismo de avisos que a Central já tem (`agent_inbox_items`, no molde de `lib/ai/decisao/aviso.ts`: tipo `other` e título fixo como chave, **sem migração**) (+ teste). O `aviso-de-escalacao.ts` **não muda**: continua sendo só o aviso ao cliente.
- **Pronto quando:** com confiança **alta** de que o destino é `equipe`, abre um aviso na Central; **não abre caso e não passa a conversa**; o aviso não se repete para a mesma conversa.
- **Como testar:** unitários; teste de que nenhum caso é aberto e a conversa não muda de dono.

#### T21 — Marca do `urgente` no cartão da Central
- **Spec:** seção 3.2 e ambiguidade 5 (seção 11).
- **Arquivos prováveis:** `triagem.ts` e o cartão da conversa na Central (**localizar na construção**).
- **Pronto quando:** `urgente` com probabilidade a partir de 0,80 marca o cartão na Central; **não muda o destino** da mensagem; o corte pode ser ajustado durante a observação.
- **Como testar:** unitários; `urgente` alto com destino `atender` continua `atender`.

#### T22 — Queda do Jev e teto no ANTES
- **Spec:** seções 4.1 e 7.3; D12; ambiguidade 1 (seção 11).
- **Arquivos prováveis:** `triagem.ts`, `lib/ai/decisao/disjuntor.ts`, o mesmo lugar da aba Status e o mesmo mecanismo de aviso ao dono da plataforma da T12.
- **Pronto quando:** com o Jev indisponível, o ANTES é **pulado** e a IA atende sem dica; com o teto mensal estourado em modo "bloquear", o ANTES é pulado (só ele); a aba Status mostra "Jev fora do ar"; chave recusada ou conta sem crédito gera o mesmo aviso ao dono da plataforma da T12 (D2 = B), sem duplicar o aviso quando o ANTES e o DEPOIS falham juntos.
- **Como testar:** dublê com falhas; teto estourado pula o ANTES e **não** pula o DEPOIS.

### Grupo G — Custo em reais e telas

#### T23 — Cotação do dólar na configuração da plataforma  [VOCÊ]
- **Spec:** seção 7.4 e D11.
- **Arquivos prováveis:** `platform_config` (a chave é o nome da variável de ambiente, por exemplo `COTACAO_USD_BRL`; **sem migração**), `app/actions/admin/salvarConfiguracaoDaInstalacao.ts`, `lib/env.ts`.
- **Pronto quando:** a cotação fica numa configuração da plataforma, com valor inicial **pesquisado na construção** e atualização manual mensal pelo administrador da plataforma, com auditoria; sem valor, as telas mostram o dólar como hoje.
- **Como testar:** unitários da leitura e da gravação; teste de que o administrador da loja não altera a cotação.
- **Nota (D2 = B):** o custo em R$ de cada loja é a base do repasse da conta da plataforma, então a cotação precisa ser a mesma em todas as telas. O repasse em si (cobrança) não é tarefa da r3.

#### T24 — Telas em reais com a cotação visível
- **Spec:** seção 7.4 e D11.
- **Arquivos prováveis:** `app/app/ai/usage/_client.tsx` (perto de `:94`), `BudgetCard.tsx` (perto de `:66`), `lib/i18n/dicionario.ts` (espanhol).
- **Pronto quando:** as telas mostram "R$ X (cotação R$ Y)"; o campo do teto mensal aceita reais, converte pela cotação do dia e **grava a cotação usada** na auditoria; a fonte de verdade continua em dólar.
- **Como testar:** testes de tela (jsdom) e os testes de i18n; teto em reais convertido corretamente.
- **Nota (D2 = B):** o custo em R$ por loja que a tela de uso mostra é a base do repasse da conta da plataforma; o valor mostrado a cada loja é só o dela.

### Grupo H — Testes de fechamento

#### T25 — Invariantes de turno do Jev novo
- **Spec:** seção 8.5.
- **Arquivos prováveis:** `tests/invariants/jev-conferencia-no-turno.test.ts` e `tests/invariants/jev-triagem-no-turno.test.ts` (criados aos poucos em T13 e T18; aqui se fecha a lista).
- **Pronto quando:** não há chamada sem interruptor mestre, aceite, tarefa ligada, chave e interruptor da instalação; não há chamada com contato bloqueado nem em prévia de teste; o opt-out vem sempre antes de tudo; nenhum campo proibido entra no `state`.
- **Como testar:** os próprios testes de invariante; vê-los reprovar quando uma guarda é retirada.

#### T26 — Isolamento entre empresas e e2e com o dublê
- **Spec:** seção 8.5 (itens 1 a 7).
- **Arquivos prováveis:** `tests/invariants/jev-isolamento-entre-empresas.test.ts` (novo), `scripts/duble-jev-e2e.mjs`, `tests/e2e/helpers/jev.ts`, varredura de RLS existente (`tests/invariants/rls-completude-varredura.test.ts`).
- **Pronto quando:** a credencial da empresa A nunca é usada para a B (a checagem olha a **linha** da credencial, isto é, o identificador da credencial e o `organization_id`, e não o valor da chave, porque em D2 = B o valor é o mesmo em todas as empresas); toda linha de `llm_calls` e `jev_observacoes` carrega a empresa certa; o caso nasce na empresa certa; o custo soma no teto da empresa certa; as evidências vêm só da base da empresa do turno; o e2e com duas empresas ao mesmo tempo (credenciais, aceites e estados diferentes) passa; a varredura de RLS passa sem exceção nova.
- **Como testar:** o próprio e2e com o dublê. Fecha a r3 com o auditor do projeto.

---

## 5. O que exige migração de banco

**Nenhuma migração é obrigatória na r3.**

- A tabela `jev_observacoes` **já existe** (migração 0421, `baseline.sql`, e o dump do banco de produção de 31/10/2026). O vocabulário de `tarefa` é aberto, então as tarefas `triagem` e `conferencia` cabem sem migração.
- A cotação do dólar usa `platform_config`, que já guarda chave e valor (T23): sem migração.
- O aviso na Central usa `agent_inbox_items` com tipo `other` e título fixo como chave (T20): sem migração.

**Opcionais** (só se a etapa de plano da tarefa mostrar que vale a pena):

| Onde | Tarefa | Para quê | Sem ela |
|---|---|---|---|
| Regra de origem do caso (`agent_cases.source`) | T14 | uma origem própria do Jev | usa `guardrail_autofallback` |
| `jev_observacoes`, colunas aditivas | T10 e T18 | guardar mais de um rótulo por linha | um rótulo por linha, como definido nas duas tarefas |

Qualquer migração nova entra em `supabase/migrations/` com o `MANIFEST.md` e o apêndice do `baseline.sql`, é aditiva e idempotente, e **só é aplicada no banco de produção com backup antes e autorização explícita sua**.

## 6. O que exige novo aceite do administrador

- **T01:** o alcance `resposta` pede um aceite novo, com versão nova e texto jurídico. Empresa que só aceitou o alcance `mensagem` não habilita a `conferencia`.
- **T02:** a `conferencia` nasce **desligada** (nunca `observando` sozinha), porque pede mais do que o aceite atual cobre.
- **T03:** a `triagem` usa o alcance `mensagem`, que o aceite atual já cobre; por isso o interruptor da instalação, desligado por padrão, impede que ela passe a mandar mensagens à TypeSafe sem um clique novo.

## 7. O que depende de você fornecer

| O quê | Quando faz falta | Tarefas |
|---|---|---|
| **Crédito em dólar na TypeSafe** e a **chave**: uma conta e uma chave da plataforma (D2 = B), coladas na credencial `typesafe` de cada empresa | só para ligar de verdade em `observando`, depois do Marco 1 | nenhuma de código; bloqueia o uso real |
| **Cotação do dólar**: valor inicial e atualização mensal | para as telas em reais | T23, T24 |
| **Texto jurídico do aceite** (parte do cenário B) e a pendência do advogado (cláusula de contrato e aviso de privacidade, LGPD), que **não bloqueia nada** | o texto provisório basta para a T01; a versão do advogado entra quando chegar | T01 |
| **Texto final do aviso ao cliente** ("Vou confirmar essa informação com a equipe…") | antes de publicar o Marco 1 | T15 |
| **Corpus em português rotulado** (D16): 200 mensagens e 100 rascunhos, rotulados por você ou por quem você indicar | para sair de `observando` | nenhuma de código; é o portão da seção 8 |
| **Aceite do administrador** da loja piloto | para a `conferencia` começar a ser consultada | T01 |

## 8. Portões

- **Publicar:** o auditor do projeto roda antes de qualquer publicação; os interruptores da instalação nascem desligados; nenhum marco liga nada sozinho.
- **Sair de `observando`** (cada tarefa do Jev, separadamente): exige **as duas condições juntas**: duas semanas em `observando` **e** corpus em português de pelo menos 200 mensagens e 100 rascunhos rotulados (D7 e D16). Só depois disso uma tarefa pode ir para `decidindo`.
- **Modelo:** fica fixo em `jev-1.13.0` (D8). A 1.14.0 é medida em paralelo, depois, e entra por decisão nova.

## 9. Fora da r3

- **Teto mensal definido pela plataforma por cliente** (D14): vira outra spec, antes de vender para várias lojas.
- Cobrança real e criação automática de empresa depois do pagamento.
- Mensagens de follow-up por modelo fixo, disparo em massa e prospecção.
- Áudio, imagem e PDF no Jev (ele só lê texto).
- Treinar modelo próprio com as saídas do Jev (proibido pelo contrato da TypeSafe).
