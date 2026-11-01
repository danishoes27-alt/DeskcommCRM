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
| T04 evidências: base de conhecimento | ver `git log` (`feat(jev): T04 ...`) | ver abaixo | feita |
| T05 evidências: catálogo e Bling | ver `git log` (`feat(jev): T05 ...`) | ver abaixo | feita |

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

## Pendências e coisas que só o dono pode fornecer

| O quê | Quando faz falta | Tarefas |
|---|---|---|
| Crédito em dólar na TypeSafe e a chave da plataforma (D2 = B), colada na credencial `typesafe` de cada empresa | só para ligar de verdade em `observando` | nenhuma de código |
| Cotação do dólar inicial (pesquisada na T23, marcada como valor inicial) | telas em reais | T23, T24 |
| Texto jurídico final do aceite e revisão do advogado | quando chegar; não bloqueia | T01 (provisório) |
| Texto final do aviso ao cliente ("Vou confirmar essa informação com a equipe…") | antes de publicar o Marco 1 | T15 (usa o texto provisório do plano) |
| Corpus em português rotulado (200 mensagens, 100 rascunhos) | para sair de `observando` | portão operacional |
| Aceite do administrador da loja piloto | para a conferência ser consultada | T01/T02 |
