# Spec 14 — Jev antes e depois da IA

> **Status:** rascunho para aprovação (fase 2 de 4: spec). Nada aqui foi implementado, ligado, comprado ou enviado a algum fornecedor.
> **Base de código:** tag `celuzap-1.69.0-r2` (commit `7d976ea83`). **Branch de trabalho:** `celuzap-jev`.
> **Data:** 31/10/2026. **Fonte externa:** documentação oficial da TypeSafe, consultada em 31/10/2026 (Anexo A).

Como ler as marcas:

- **[CÓDIGO]** li no repositório; vem com `arquivo:linha`.
- **[OFICIAL]** li na documentação da TypeSafe (Anexo A).
- **[INFERIDO]** é dedução minha; precisa de medição antes de virar promessa.
- **[NÃO CONFIRMADO]** não achei na fonte oficial; vira pergunta ao fornecedor ou teste.

Todo custo está em reais (R$). O código guarda e mostra dólar; a conversão proposta está na seção 7.

---

## 0. Resumo para decidir

1. **O Jev já existe no código, de dois jeitos, e os dois nascem desligados.**
   - A *triagem* (`lib/ai/triagem/`) classifica a mensagem em 4 categorias (conserto, financeiro, venda, outro) mais "urgente", mas **só grava o resultado** em `messages.metadata.triagem`. Nada lê esse registro hoje. Usa a chave global do AI Gateway.
   - O *Jev do sistema* (`lib/ai/decisao/`) tem 6 tarefas (clima, manipulação, roteador, pedido de humano, pedido de parar, follow-up), chave **por empresa**, interruptor e aceite LGPD por empresa, disjuntor e custo gravado por chamada.
2. **Já existe o lugar certo para o "depois da IA":** a cadeia `before_send` (11 conferências, versão 7 travada por teste). O Jev entra ali como uma conferência nova (versão 8). Hoje, quando uma conferência veta, o texto volta para o modelo reescrever e o cliente não recebe nada; só dois casos têm saída automática.
3. **A regra "a IA nunca inventa preço" hoje depende quase só do texto de instruções.** A conferência de preço só funciona se a empresa tiver tabela de preços cadastrada, e a conferência semântica de promessa vem desligada por padrão.
4. **O Jev é fraco em conta, contagem, datas e em ler texto "hostil"** [OFICIAL]. Por isso a proposta é **regra local primeiro** (valores, senha, documento) e **Jev só para o que regra não alcança** (frases de garantia, prazo e aprovação com palavras variadas). O Jev só pode deixar a decisão **mais rígida**, nunca liberar o que a regra local segurou.
5. **Dinheiro é pouco; o trabalho é grande.** Uso do Jev custa frações de centavo por mensagem (seção 7). O custo real está em ~24 tarefas de código, na coleta de "evidências" do turno e no jurídico.
6. **A trava de teto mensal não alcança o Jev** [CÓDIGO]. O custo dele **já entra** na soma do mês, mas nenhuma chamada dele passa pela trava. Não existe teto definido pela plataforma por cliente.
7. **A tela "Plano e pagamento" não cobra nada** [CÓDIGO]: é um aviso "Em breve — Fase 2". Não há integração de pagamento no código. A criação de empresa depois de um pagamento confirmado é manual hoje.
8. **Jurídico:** a TypeSafe está nos EUA, **não treina** com o que você envia, mas **não informa prazo de retenção**, e "retenção zero" só existe para clientes enterprise, sob pedido [OFICIAL]. Não há SLA e o contrato diz que a saída "pode ser inexata" [OFICIAL]. Antes de qualquer dado real: perguntas por escrito à TypeSafe e revisão do contrato com a loja.
9. **Recomendação:** **(b)** fazer o Bloco D com a r2 agora, com controles de compensação nas primeiras semanas, e lançar o Jev como r3 logo depois, começando em modo **observando** (mede, não age). Justificativa na seção 9.
10. **Há 16 decisões suas** na seção 10, cada uma com a minha recomendação.

---

## 1. Objetivo e o que NÃO entra

### Objetivo

Dar ao atendimento duas camadas rápidas e baratas de proteção, **sem trocar** as regras que já existem:

- **ANTES da IA (triagem):** ler a mensagem do cliente e decidir (a) a **categoria** — Conserto, Venda, Impressão ou Outro — e (b) o **destino**: *atender* (a IA responde como hoje), *pedir dado que falta* ou *mandar para a equipe*.
- **DEPOIS da IA (conferência):** antes de enviar a resposta que a IA montou, conferir se ela traz preço, prazo ou garantia sem fonte consultada, repete senha de dispositivo, promete aprovação da financeira, repete conteúdo de documento, ou diz qualquer coisa que a regra "a IA nunca inventa" proíbe. Se reprovar, **a resposta fica segurada e abre-se um caso para a equipe**.

Isto complementa a regra do projeto: a IA nunca inventa preço, prazo, estoque ou garantia.

### O que NÃO entra

- O Jev **não escreve** texto para o cliente. Isso é sempre da IA principal. [OFICIAL: o modelo "não foi treinado para gerar texto".]
- O Jev **não bloqueia contato** e **não passa a conversa sozinho**. Quem bloqueia por pedido de parar é só a regra de hoje (`lib/opt-out/deteccao.ts`), como já está em `lib/ai/decisao/tarefas.ts:249-274`.
- O Jev **não substitui** nenhuma conferência existente da cadeia `before_send`. Ele **soma** (família "soma" de `tarefas.ts`).
- Nada de áudio, imagem ou PDF vai ao Jev. Ele só lê texto [OFICIAL]. Senha e documento são conferidos **localmente**.
- **Fora desta spec:** cobrança real, criação automática de empresa depois do pagamento, e teto mensal definido pela plataforma por cliente. Aparecem como dependências na seção 8 e nas decisões 13 e 14.
- **Proibido pelo contrato da TypeSafe:** usar as respostas do Jev para treinar um modelo nosso que o imite ("model distillation") [OFICIAL: contrato principal, cláusula 2.3(b)]. Os registros de concordância (`jev_observacoes`) servem para **medir**, nunca para treinar.
- Fora da primeira entrega: mensagens de follow-up por modelo fixo, disparo em massa e prospecção (não passam pelo `send_message` da IA), e o texto fixo do aviso de escalação.
- **Nenhuma ação em produção:** esta spec não liga nada, não cria conta e não aplica migração.

---

## 2. Fluxo de dados, antes e depois

### Como é hoje [CÓDIGO]

```
mensagem do cliente chega
  → webhook grava a mensagem e enfileira o job "inbound_turn"
  → o turno corre as saídas antecipadas (conversa com humano, contato bloqueado,
    conversa não elegível / canal em modo de teste, janela anti-ban, agente pausado
    ou assistido, horário de funcionamento)
  → [triagem do Jev: só se JEV_TRIAGEM_ENABLED=true, e só GRAVA]   inbound-turn.ts:2123-2144
  → IA principal monta a resposta (consulta base de conhecimento e catálogo)
  → ferramenta send_message → cadeia before_send (11 conferências) → envio
        veto → o texto volta ao MODELO como erro de ensino; o cliente não recebe nada
```

### Como fica (proposta)

```
mensagem do cliente chega
  → … mesmas saídas antecipadas (o Jev nunca roda onde a IA não vai atuar) …
  → JEV ANTES  (tarefa "triagem")
        1 chamada, 3 perguntas, só o texto digitado, máscara de dados, teto 1,5 s
        grava: llm_calls (custo) + jev_observacoes (concordância) + messages.metadata
        modo "decidindo": entrega ao prompt da IA uma dica curta
                          ("categoria: conserto; destino: atender")
        "mandar para a equipe" (confiança alta): abre aviso na Central, NÃO passa a conversa
  → IA principal monta a resposta
        o turno passa a guardar as EVIDÊNCIAS consultadas (trechos da base e do catálogo)
  → send_message
        1) conferência LOCAL (valores, prazo, garantia, aprovação, senha, documento)
        2) JEV DEPOIS  (tarefa "conferencia"): 1 chamada com o rascunho + evidências
        3) nova conferência `jev_conferencia` na cadeia before_send (versão 8)
        → passou: envia
        → reprovou: 1ª vez devolve ao modelo para reescrever só com o que está nas evidências;
          2ª vez SEGURA a resposta, abre caso para a equipe e (se aprovado) avisa o cliente
          com um texto fixo de código
```

Em palavras simples: **antes**, o Jev ajuda a IA a entender o que o cliente quer; **depois**, ele é um fiscal que olha a resposta pronta antes de ela sair.

---

## 3. Perguntas, resposta tipada e cortes de confiança

### 3.1 Formato da chamada e da resposta [CÓDIGO + OFICIAL]

O sistema já fala direto com a API da TypeSafe (`lib/ai/decisao/cliente.ts:242-333`): `POST https://api.typesafe.ai/v1/systemone`, cabeçalho `Authorization: Bearer <chave da empresa>`, corpo `{ model, state, questions }`. As três formas de pergunta [OFICIAL, confere com o código]:

| Tipo | Pergunta | Resposta |
|---|---|---|
| `noul` | sim ou não | `noul`: probabilidade de "sim", de 0 a 1 |
| `choice` | 1 de 1 a 255 opções | `choice`, `probabilities` por opção, `confidence` (0 a 1) |
| `score` | nota em 1 a 10 níveis ordenados | `score`, `probabilities`, `confidence`, `legend` |

Todas as perguntas de uma chamada rodam juntas, e a resposta traz `usage.input_tokens` (cobrado) e `output_tokens` (hoje grátis) [OFICIAL]. O validador de resposta do código está em `cliente.ts:163-183`. Resposta fora do formato vira `resposta_ilegivel` e o caminho de hoje assume.

Observação: a triagem antiga usa o pacote `ai` (`experimental_evaluate`) e chama o tipo sim/não de `boolean`; a API direta chama de `noul`. Esta spec usa a API direta (a que tem chave por empresa, disjuntor e custo por empresa).

### 3.2 JEV ANTES — uma chamada, três perguntas

`state` = **só o texto que o cliente digitou** (até 2.000 caracteres), depois da máscara da seção 6.

| Pergunta | Tipo | Opções | Para quê |
|---|---|---|---|
| `categoria` | choice | `conserto`, `venda`, `impressao`, `outro` (nesta ordem; `outro` por último) | rótulo e dica para a IA |
| `destino` | choice | `atender`, `pedir_dado`, `equipe` | o que fazer com a mensagem |
| `urgente` | noul | tom de pressa ou insatisfação forte | só registro e prioridade |

Notas de desenho:

- O Jev tende a escolher a **primeira opção** quando está em dúvida [OFICIAL: página de limitações]. Por isso `outro` fica por último e a ordem das opções entra no teste.
- `pedir_dado` só é confiável na **primeira mensagem** da conversa: o Jev vê uma mensagem sozinha e não sabe o que o cliente já contou antes. Proposta: perguntar `pedir_dado` só quando a conversa não tem mensagem anterior do cliente (decisão 4). Alternativa é mandar as últimas mensagens, o que exige um aceite mais largo (alcance "conversa", `config.ts:48`).
- As categorias saem de **uma lista única por empresa**, com este padrão de quatro. A categoria `financeiro` da triagem antiga (`jev.ts:41-48`) deixa de ser categoria; boleto e parcelamento ficam descritos dentro de `venda` (decisão 3).
- Se a empresa já tem **roteador de intenção** configurado, o Jev roteador (`lib/ai/decisao/roteador.ts`) continua escolhendo *qual agente atende*. A triagem não escolhe agente; só rotula e dá dica.

**Cortes de confiança (ANTES).** Usa a mesma régua do código de hoje como piso (`jev.ts:78-80`: probabilidade ≥ 0,70 e confiança ≥ 0,60) e acrescenta uma faixa alta.

| Faixa | Regra (opção escolhida) | O que acontece |
|---|---|---|
| **Alta** | probabilidade ≥ 0,80 **e** confiança ≥ 0,70 | Vale. `atender`: dica ao prompt com a categoria. `pedir_dado`: dica "peça primeiro: …". `equipe`: abre **aviso na Central** (não passa a conversa). |
| **Média** | probabilidade 0,70 a 0,80 **ou** confiança 0,60 a 0,70 | Só **registra** (categoria e destino ficam no registro). A IA decide como hoje. |
| **Baixa** | abaixo de 0,70 ou de 0,60 | Ignora. A IA principal decide, com motivo em código (`baixa_confianca`, `baixa_probabilidade`), como já faz `jev.ts:263-266`. |

Isso respeita a regra do dono do produto de 24/09/2026, registrada em `jev.ts:51-56`: **dúvida do Jev vai para a IA principal, nunca direto para o humano**. A exceção proposta é só quando o Jev tem confiança **alta** de que o destino é a equipe, e mesmo assim só abre aviso (decisão 5).

### 3.3 JEV DEPOIS — conferência da resposta

Duas camadas, **nesta ordem**.

**Camada 1 — conferência local (sem Jev, sem custo, sem enviar nada para fora).** Regras exatas, rápidas e imunes a texto "hostil":

| Código | O que confere | Como |
|---|---|---|
| L1 valores | todo valor em R$ do rascunho aparece nas evidências | lê os números do rascunho e procura nas evidências, aceitando múltiplos inteiros de um preço unitário (ex.: 5 folhas × R$ 2 = R$ 10). Reaproveita a tabela de preços da empresa quando existir (gate `promise`, `before-send.ts:362`). |
| L2 prazo e garantia | expressões como "em N dias", "hoje", "amanhã", "garantia de N meses" estão nas evidências | lista de padrões; sem evidência correspondente, marca |
| L3 aprovação | "aprovado", "sem consulta", "sem análise", "100%", "garantido" sobre crédito, boleto ou financiamento | lista de padrões; sempre marca |
| L4 senha | o rascunho repete a senha, PIN ou padrão que o cliente digitou antes | guarda só na memória do turno, nunca grava; compara com o rascunho |
| L5 documento | o rascunho copia trecho do texto extraído de um documento que o cliente enviou | sequência de 8 ou mais palavras iguais |

Um achado local é **sempre** faixa alta: segura, mesmo que o Jev esteja fora do ar.

**Camada 2 — Jev.** `state` = `{ resposta_da_ia, evidencias }`. Não vai a mensagem do cliente, nem nome, nem telefone. Perguntas (todas `noul`, resposta = probabilidade de **haver problema**):

| Pergunta | Texto da pergunta (resumo) |
|---|---|
| `sem_fonte` | "A resposta afirma, como fato, preço, prazo ou garantia que NÃO aparece nas evidências?" |
| `promete_aprovacao` | "A resposta promete ou dá como certa a aprovação de crédito, financiamento ou boleto?" |
| `inventa_dado` | "A resposta afirma algum fato sobre produto, serviço, estoque, loja ou regra que não está nas evidências?" |

O Jev **só aperta**: se a camada local achou problema, o Jev não pode liberar. Se o texto do cliente tentar "convencer" o verificador (ele não trata texto como hostil por padrão [OFICIAL]), a regra local continua mandando.

**Cortes de confiança (DEPOIS).** A resposta errada que sai custa mais do que uma resposta segurada, então a régua é mais baixa.

| Faixa | Regra (maior probabilidade de problema entre as perguntas) | O que acontece |
|---|---|---|
| **Alta** | achado local, **ou** Jev ≥ 0,80 | **Segura.** 1ª vez: devolve ao modelo o motivo, para reescrever só com o que está nas evidências. 2ª vez: segura de vez, **abre caso** para a equipe e (decisão 6) avisa o cliente com texto fixo. |
| **Média** | Jev entre 0,50 e 0,80 | **Libera e registra como "dúvida"** para revisão no cartão do Jev. Em fase de medição, é o que alimenta o ajuste do corte. |
| **Baixa** | Jev abaixo de 0,50 | Libera. |

Na primeira fase (tarefa em `observando`), **nenhuma faixa age**: o Jev só registra o que faria.

### 3.4 O que o cliente vê enquanto a resposta está segurada

- Hoje, quando um veto não tem saída automática, o motivo volta ao modelo (`inbound-turn.ts:3361-3376`) e **o cliente não recebe nada dessa tentativa**. Se o modelo não conseguir reescrever, o cliente fica sem resposta. Em WhatsApp isso parece abandono.
- Proposta: um **aviso fixo de código**, uma vez por resposta segurada, no mesmo molde de `avisarLeadDaEscalacao` (`lib/agent-engine/agent/aviso-de-escalacao.ts:115`), por exemplo "Vou confirmar essa informação com a equipe e já te respondo". Passa pelo mesmo anti-ban, janela e bloqueio de contato. É a decisão 6.
- O caso abre pelo sistema existente (`openCase`, `lib/agent-engine/agent/human-cases.ts:168`). **Só pode haver um caso aberto por conversa.** Se já houver um, a resposta fica segurada, o fato é registrado no rastro (`before_send_traces`) e a equipe vê o caso existente; risco anotado na seção 8.

---

## 4. Quando o Jev cai, demora ou erra

O que já existe e será reaproveitado [CÓDIGO]: teto de 1,5 s por chamada (`cliente.ts:159`); disjuntor por empresa e tarefa (`lib/ai/decisao/disjuntor.ts`); nunca lança, devolve resultado com motivo (`cliente.ts:242`); erros que pedem ação (chave recusada, sem crédito) abrem linha em Execuções e aviso na Central (`lib/ai/decisao/pool.ts`). Limites de taxa e códigos 402/403 **não** estão documentados pela TypeSafe [OFICIAL: página de erros lista 400, 401, 413, 415, 422, 429 e 529].

### 4.1 ANTES

| | Opção 1 — segue sem triagem | Opção 2 — segue em modo prudente |
|---|---|---|
| O que faz | Se o Jev falha ou demora, a IA responde como hoje; o registro diz "sem triagem". | Se falha, a IA responde, mas com uma instrução extra: "não informe preço nem prazo; diga que a equipe confirma". |
| Prós | Nunca atrapalha o atendimento. Simples. É o desenho que o código já usa (`jev.ts:25-27`). | Mais seguro durante queda. |
| Contras | Na queda, perde o aviso de "equipe" e a categoria. | Atendimento pior em toda queda; mais código; a queda é frequente em fornecedor novo sem SLA. |

**Recomendo a Opção 1.** O "antes" só ajuda; quem protege é o "depois" e as regras que já existem.

### 4.2 DEPOIS

| | Opção 1 — libera se o Jev falhar | Opção 2 — segura só se houver sinal de risco |
|---|---|---|
| O que faz | Jev fora do ar: a resposta sai como hoje, e o registro diz "não conferida". As regras locais continuam valendo. | Jev fora do ar: roda só a camada local. Se achar algo (valor sem fonte, aprovação prometida, senha, documento), segura e abre caso; se não achar, libera. |
| Prós | O atendimento nunca para por causa do fornecedor. | Protege o que mais importa mesmo na queda, sem parar o resto. |
| Contras | Na queda, uma invenção sem número (ex.: "tem garantia de fábrica") passa. | Mais lógica; um falso positivo local vira caso para a equipe. |

Descartada: "segura tudo se o Jev falhar". A TypeSafe não dá garantia de disponibilidade nem de saída sem erro [OFICIAL: contrato principal, cláusula 9.3], então uma queda deixaria todos os clientes sem resposta e inundaria a equipe de casos.

**Recomendo a Opção 2**, e **só em modo `decidindo`**. Em `observando`, nunca segura.

### 4.3 Quando o Jev "responde errado"

- **Falso positivo** (segura resposta boa): custo é tempo da equipe. Mitigação: duas semanas em `observando`, revisão por amostra, corte ajustável por empresa, interruptor de emergência.
- **Falso negativo** (deixa passar invenção): por isso a camada local é primeira e o Jev só aperta.
- **Português:** a documentação não diz que o português é suportado nem mede acurácia [NÃO CONFIRMADO]. Fonte secundária diz que o inglês é o idioma principal. **Não passa para `decidindo` sem teste com mensagens reais em português.**
- **Limites conhecidos do modelo** [OFICIAL: página "jev-1.13 jaggedness"]: lê "ao pé da letra"; "não é calculadora" e não conta de forma confiável; trata datas como texto; acerta menos com negação dupla; perde precisão quando o texto tem muito detalhe irrelevante; tende à primeira opção; não trata texto como hostil. Cada um já tem contramedida na seção 3.
- **Versão:** o código fixa `jev-1.13.0` (`cliente.ts:71`). A `1.14.0` existe desde 14/10/2026 e o apelido `jev-latest` já aponta para ela [OFICIAL]. Manter fixa evita mudar o comportamento sem aviso (a própria TypeSafe recomenda fixar quando há corte ajustado). Subir de versão exige nova linha de preço (`pricing.ts:96` casa pelo id exato; versão sem preço grava custo vazio) e nova medição. É a decisão 8.

---

## 5. Liga e desliga por empresa, e modo teste

### 5.1 Interruptores

Reaproveita `organizations.settings.jev` [CÓDIGO: `lib/ai/decisao/config.ts:77-111`]:

- **Interruptor mestre** `ligado` + **aceite do administrador** (LGPD). Ligado sem aceite vale como desligado (`config.ts:109-111`).
- **Por tarefa**, três estados: `desligada`, `observando`, `decidindo` (`config.ts:34`). Ilegível vale `desligada`.
- Duas tarefas novas: `triagem` e `conferencia`. Os cartões, a rota e o "usada em" da chave derivam da lista `TAREFAS_DO_JEV` (`tarefas.ts:309-316`), então a tela quase não muda.
- **Novo alcance de consentimento: `resposta`** (rascunho da IA + trechos consultados), entre `mensagem` e `conversa` (`config.ts:48`). O aceite atual cobre só "cada mensagem do cliente, sozinha". Como a conferência manda outro tipo de dado, **exige novo aceite do administrador** e a tarefa `conferencia` nasce `desligada`, não `observando` (regra do item 5 de `tarefas.ts:20-23`: tarefa que pede mais que o aceite nunca começa sozinha).
- **Atenção com a `triagem`:** ela usa o alcance `mensagem`, que o aceite atual já cobre. Pela regra do código, tarefa nova nesse alcance **começa `observando` sozinha** em toda empresa que já tem o Jev ligado com aceite (`tarefas.ts:20-23`). Ou seja, publicar a r3 poderia passar a mandar mensagens à TypeSafe sem novo clique. Por isso existem os interruptores da instalação abaixo, com padrão desligado.
- Quem liga: administrador da empresa (`app/api/v1/ai/jev/route.ts:594-668`); gerente só lê (`:304-306`).
- **Interruptores da instalação**, novos, com padrão desligado, um por tarefa nova: `JEV_TRIAGEM_DO_SISTEMA_ENABLED` e `JEV_CONFERENCIA_ENABLED`. Sem eles, publicar a r3 não liga nada (regra do projeto: variável nova com padrão que não quebra `.env` antigo). A triagem antiga mantém `JEV_TRIAGEM_ENABLED` (`lib/env.ts:512`) e fica como legado.
- **Chave:** a empresa precisa ter credencial `typesafe` ativa e validada (`lib/ai/decisao/ponto.ts:123-134`). Sem credencial nada sai da máquina e a IA segue como hoje.

### 5.2 Modo teste

"Modo teste" tem três sentidos no código, e o Jev respeita os três:

1. **Canal em modo de teste** (`channel_sessions.metadata.ai_gate = allowlist`, só números de teste: `lib/ai/elegibilidade/gate.ts:12-36`). O Jev roda **depois** das saídas antecipadas, ou seja, **só onde a IA atuaria**. Em canal de teste, só chega ao Jev conversa de número de teste.
2. **Prévia de teste (sandbox)** (`preview.ts:27`). A triagem atual já pula (`inbound-turn.ts:2134`: `!preview`). Regra proposta: **sem chamada externa e sem caso real**. A tela de teste pode mostrar "o que o Jev faria" usando só a camada local.
3. **Modo assistido** (rascunhos que uma pessoa aprova). O veredito aparece **no cartão do rascunho** como aviso; não segura, porque uma pessoa já revisa.

E o estado **`observando`** é o "modo teste do Jev": ele pergunta e grava, mas **não muda nada** para o cliente.

---

## 6. Dados enviados à TypeSafe, LGPD e contrato

### 6.1 O que vai e o que fica

| | ANTES | DEPOIS |
|---|---|---|
| Vai | só o **texto digitado** pelo cliente (corpo ou legenda), até 2.000 caracteres, já mascarado | o **rascunho da IA** e as **evidências** (trechos da base de conhecimento e linhas do catálogo usados no turno), já mascarados |
| Não vai | nome, telefone, id, empresa, transcrição de áudio, descrição de foto, texto de documento (`aplicar.ts:28-34`) | mensagem do cliente, nome, telefone, id, empresa, qualquer texto de documento |
| Sempre vai junto | o texto das perguntas e critérios (escrito pela loja, não pelo cliente) | idem |

Máscara (`lib/sentry/scrub.ts:76-106`): hoje tira e-mail, CPF e telefone. **Não tira senha de dispositivo, nem nome.** Proposta: uma máscara nova, `mascararSegredos`, que troca por `[SENHA]` o que vem depois de "senha", "PIN", "padrão" e "código de desbloqueio", e troca o primeiro nome do contato por `[NOME]` no rascunho.

**Senha de dispositivo:** nunca vai à TypeSafe e nunca é gravada. A conferência L4 guarda o valor só na memória do turno. A decisão da loja sobre *coletar senha pelo chat ou só na loja* (pendente do dono) muda a frequência desse caso, não o desenho.

**Documentos/PDF:** nunca vão. A conferência L5 compara o rascunho com o texto extraído **dentro do nosso servidor**.

### 6.2 Como a TypeSafe trata o que recebe [OFICIAL]

- Os dados ficam nos **EUA**.
- A política diz que **não treina nem ajusta modelos** com o que você envia.
- **Prazo de retenção: não informado** ("pelo tempo razoavelmente necessário"). O acordo de tratamento de dados também não dá número de dias, não tem cláusula de exclusão a pedido e **não cita a LGPD**; para transferência internacional cita as cláusulas-padrão europeias.
- Aviso de incidente: em até 72 horas (acordo de tratamento de dados, cláusula 5.2).
- **Retenção zero (ZDR):** só para clientes *enterprise*, sob pedido por formulário de suporte. O código atual marca `zeroDataRetention` na triagem antiga, mas essa opção é do AI Gateway, não da API direta [INFERIDO]; a página do modelo no Gateway não confirma ZDR [OFICIAL].
- Lista de operadores subcontratados: fica fora do texto, em uma página própria da TypeSafe.
- Contrato: créditos **pré-pagos em dólar**, que vencem em 12 meses e não são reembolsados; sem garantia de disponibilidade; a saída "pode ser inexata"; o cliente responde por ter os consentimentos necessários para o que envia.

### 6.3 O que isso exige (a validar com advogado)

- **Contrato do Celuzap com a loja:** cláusula nomeando a TypeSafe como operador subcontratado, localizada nos EUA, para as finalidades "classificar a mensagem" e "conferir a resposta"; que não treina com os dados; que o prazo de retenção depende de resposta da TypeSafe; e que o recurso **não garante** ausência de erro.
- **Aviso de privacidade da loja** para os clientes finais: mencionar a transferência internacional.
- **LGPD, transferência internacional** (art. 33): a base precisa estar escolhida e documentada. O acordo da TypeSafe usa cláusulas europeias; se isso basta para o Brasil, **não verifiquei** — é pergunta para o advogado.
- **Aceite do administrador** dentro do sistema (já existe: `config.ts:90-98`, com `versao`). O novo alcance `resposta` pede novo aceite.
- **Perguntas por escrito à TypeSafe** (via o formulário de suporte), antes de qualquer dado real: prazo de retenção da entrada e da saída; ZDR e seu preço; região de processamento; exclusão a pedido; subcontratados; limites de taxa; política de descontinuação de versões; acurácia em português.
- **Até as respostas chegarem: só dados de teste.**

---

## 7. Custo, em reais, e o teto de cada cliente

### 7.1 Quanto custa uma chamada

Preço oficial: **entrada é cobrada por token, saída é grátis** (hoje) [OFICIAL]. O preço publicado é em dólar: US$ 0,042 por milhão de tokens de entrada. Isso dá **R$ 0,00023 por mil tokens** com a cotação de exemplo abaixo.

> A cotação usada nas contas é **R$ 5,50 por dólar, só como exemplo**; não é a cotação de hoje. Os tamanhos de tokens abaixo são **estimativas minhas [INFERIDO]**; o número real vem de `usage.input_tokens`, que o sistema já grava por chamada.

| Chamada | Tokens de entrada (estimativa) | Custo por chamada |
|---|---|---|
| ANTES | ~400 | ~R$ 0,00009 |
| DEPOIS (evidência normal) | ~2.500 | ~R$ 0,0006 |
| DEPOIS (evidência grande) | ~10.000 | ~R$ 0,0023 |

Por mês, supondo uma triagem e uma conferência por mensagem respondida:

| Mensagens respondidas por mês | Evidência normal | Evidência grande |
|---|---|---|
| 5.000 | ~R$ 3,35 | ~R$ 12 |
| 30.000 | ~R$ 20 | ~R$ 72 |

O que **não** está nessas contas: valor mínimo de compra de créditos, impostos e taxa de cartão internacional [NÃO CONFIRMADO: a página de preços da TypeSafe não existe e a documentação não fala de cobrança]. Créditos vencem em 12 meses e não voltam [OFICIAL].

### 7.2 Como o custo é registrado hoje [CÓDIGO]

- Cada chamada de IA grava uma linha em `llm_calls`, por empresa, modelo e finalidade (`baseline.sql:6483-6498`). O custo é guardado em **centavos de dólar, com fração** (`pricing.ts`, `roteador.ts:285-308`).
- O Jev entra na tabela de preços com id exato `jev-1.13.0` (`pricing.ts:96`). Id sem preço grava custo vazio, que **a soma do mês conta como zero**: ao subir de versão sem atualizar essa linha, o custo some do teto em silêncio. A spec exige um teste que reprove esse caso.
- A soma do mês (`fn_gasto_de_ia_do_mes`, migração 0159, linhas 96-107) soma **toda** linha de `llm_calls` da empresa, sem filtrar fornecedor. O Jev **já entra** na soma.

### 7.3 Como entra no teto de cada cliente

- Cada tarefa nova grava uma linha por chamada com finalidade própria (`jev_triagem`, `jev_conferencia`), como o roteador faz hoje. Zero mudança de banco para o registro.
- **Hoje o Jev nunca é barrado pela trava** (nenhum arquivo de `lib/ai/decisao/` consulta o orçamento). Proposta:
  - **ANTES:** pula a chamada quando o teto da empresa já estourou em modo "bloquear" (economiza e a IA segue como hoje).
  - **DEPOIS:** **isento do bloqueio**, como as camadas de segurança que já são isentas (`jailbreak_detect` e `promise_semantic`, `lib/agent-engine/edge/llm/orcamento.ts:50-54`). O custo soma, mas a conferência não desliga por teto. Na prática, com o teto estourado a IA principal já fica bloqueada e não há rascunho para conferir.
- O teto hoje é do **próprio cliente**, que pode desligar (`ai_budgets.enforcement_mode` nasce `off`, migração 0159:189). **Não existe teto definido pela plataforma por cliente**; a especificação de cobrança do revendedor prevê `teto_ia_usd_cents`, mas isso não existe no código. É outra spec (decisão 14).

### 7.4 Conversão para reais (a proposta)

- **Fonte de verdade continua em dólar**, porque é a moeda do fornecedor e das tabelas de preço.
- **Exibição em reais:** uma configuração da plataforma `cotacao_usd_brl` (com valor inicial vindo de uma variável de ambiente) usada em `formatCentsUSD` (`app/app/ai/usage/_client.tsx:94`) e `BudgetCard.tsx:66-72`. As telas passam a dizer "R$ X (cotação R$ Y)".
- O campo do teto mensal também entra em reais, convertido com a cotação do dia e **gravando a cotação usada na auditoria**, para o teto não "mudar sozinho".
- Atualização da cotação: manual, mensal, pelo administrador da plataforma (decisão 11).

### 7.5 Chave: quem paga a conta da TypeSafe

O código foi escrito para **cada empresa ter a própria chave** do Jev (`ponto.ts:78-98`, `credencial.ts`), de propósito: "uma instalação não paga a conta de outra". Para uma loja não técnica isso significa abrir conta na TypeSafe, aceitar o contrato e comprar créditos em dólar. Duas saídas:

- **A. Chave da própria loja (como o código faz hoje).** Custo zero para você; atrito alto para a loja; cada loja assina o contrato da TypeSafe.
- **B. Chave única da plataforma.** Você tem uma conta; o custo por loja sai de `llm_calls` e é repassado. Para o piloto funciona **sem mudar código**, colando a mesma chave na credencial `typesafe` de cada empresa (tela de Credenciais). Para muitas lojas, vale criar "credencial da plataforma" com busca própria. Contras: um segredo repetido em várias linhas; rodízio de chave exige atualizar todas; o administrador da loja pode apagar a credencial (isso desliga o Jev).

**Recomendo B para o piloto** (decisão 2).

---

## 8. Tamanho da mudança, riscos e testes

### 8.1 Arquivos novos

| Arquivo | Para quê |
|---|---|
| `lib/ai/decisao/triagem.ts` (+ teste) | tarefa `triagem`: perguntas, cortes, gravação |
| `lib/ai/decisao/conferencia.ts` (+ teste) | tarefa `conferencia`: perguntas, montagem do `state`, cortes |
| `lib/agent-engine/guardrails/conferencia-local.ts` (+ teste) | L1 a L5 |
| `lib/agent-engine/guardrails/mascarar-segredos.ts` (+ teste) | máscara de senha e nome |
| `lib/agent-engine/agent/evidencias-do-turno.ts` (+ teste) | guarda as evidências consultadas no turno |
| `tests/invariants/jev-conferencia-no-turno.test.ts`, `jev-triagem-no-turno.test.ts`, `jev-isolamento-entre-empresas.test.ts` | invariantes |
| 1 migração (opcional) | estender o CHECK de `agent_cases.source`; sem ela, usa `guardrail_autofallback` (`baseline.sql:7581`) |

### 8.2 Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `lib/ai/decisao/tarefas.ts`, `config.ts` (+ testes) | 2 tarefas, alcance `resposta` |
| `lib/agent-engine/guardrails/before-send.ts` | conferência `jev_conferencia`; `BEFORE_SEND_CHAIN_VERSION` de 7 para 8 (`:819`) |
| `tests/unit/before-send-chain-shape.test.ts` | novo formato da cadeia (esse teste existe justamente para forçar a revisão) |
| `lib/agent-engine/agent/inbound-turn.ts` (4.921 linhas) | 2 pontos: triagem (`:2123-2144`) e `send_message` (`:3284`) com segurar e abrir caso |
| `lib/agent-engine/agent/human-cases.ts` | tipo de `source` |
| `lib/agent-engine/agent/aviso-de-escalacao.ts` | novo motivo de aviso (se aprovado) |
| `lib/ai/triagem/*` | marcar como legado (desligado) |
| `lib/env.ts`, `.env.example` | `JEV_TRIAGEM_DO_SISTEMA_ENABLED`, `JEV_CONFERENCIA_ENABLED`, cotação inicial |
| `lib/agent-engine/edge/llm/pricing.ts` | só se subir a versão |
| `app/app/ai/usage/_client.tsx`, `BudgetCard.tsx`, `lib/i18n/dicionario.ts` | reais e textos em espanhol (os testes de i18n cobram) |
| `app/api/v1/ai/jev/route.ts`, `app/app/ai/providers/_components/CartaoDoJev.tsx` | novo alcance e textos das tarefas |

### 8.3 Tarefas (estimativa para o plano)

Cerca de **24 tarefas pequenas** em 7 grupos: base de configuração (3), triagem (5), evidências do turno (2), conferência local (3), conferência com Jev e cadeia (4), segurar, caso e aviso (3), custo em reais e telas (2), testes de isolamento e dublê (2). O plano (fase 3) refina isto.

Dependências fora do código: respostas da TypeSafe, revisão jurídica, aceite do administrador, corpus de teste em português.

### 8.4 Riscos

1. **`inbound-turn.ts` é grande e cheio de invariantes.** Mitigação: mudança mínima nos dois pontos, lógica nos módulos novos, teste de cadeia.
2. **Evidências incompletas = falso positivo.** O turno hoje só guarda citações da base de conhecimento (`inbound-turn.ts:2694, 2987`); resultados do catálogo não ficam num lugar único. Se a evidência faltar, uma resposta correta é segurada. É o maior risco técnico, e é por isso que há fase `observando`.
3. **Conta derivada** (5 folhas × preço) dar falso alarme em L1. Mitigação: aceitar múltiplos e somas simples.
4. **Trava de uma resposta por vez:** `runBeforeSend` segura um bloqueio por número durante a conferência (`before-send.ts:1118`), e a conferência semântica atual já chama modelo aí dentro (`:1196`). Para o Jev, **chamar antes de pegar o bloqueio** e passar o veredito já pronto.
5. **Um caso aberto por conversa** (`human-cases.ts:184-226`): se já houver um, a resposta segurada fica sem caso novo. Mitigação: registrar no rastro e mostrar o caso existente.
6. **Português não medido** (seção 4.3).
7. **Fornecedor jovem:** versão 1.14 já saiu; sem SLA; sem política de descontinuação [OFICIAL]. A página do modelo no AI Gateway mostra outra função do pacote `ai` (`experimental_decide`) que a versão instalada (7.0.116, `experimental_evaluate`) não tem; **atualizar o pacote `ai` pode quebrar a triagem antiga**.
8. **Cobrança sem teto** do Jev: hoje não há bloqueio; o custo é pequeno, mas o desenho de teto precisa da decisão 14.
9. **Cliente mudo:** segurar sem avisar parece abandono (decisão 6).
10. **Proibição de "distillation"** no contrato da TypeSafe: nada de treinar modelo nosso com saídas do Jev.

### 8.5 Plano de teste

- **Unidade:** perguntas e cortes; mapeamento de cada código de erro para motivo (`cliente.ts:208-223`); máscara; L1 a L5. Nunca contra o Jev real no CI; usar `fetchImpl` simulado como em `lib/ai/decisao/cliente.test.ts`.
- **Cadeia:** `before-send-chain-shape.test.ts` com a versão 8; teste de que o Jev **só aperta** (achado local nunca vira "passou").
- **Invariantes de turno:** sem chamada sem interruptor mestre, aceite, tarefa ligada e chave; sem chamada quando o contato está bloqueado; sem chamada em prévia de teste; opt-out sempre antes de tudo; nenhum campo proibido no `state`.
- **Isolamento entre empresas:**
  1. a chave da empresa A nunca é usada para a empresa B (`chaveDasTarefas` filtra por `organization_id`, `ponto.ts:123-132`);
  2. toda linha de `llm_calls` e `jev_observacoes` carrega a empresa certa;
  3. o caso é aberto na empresa certa;
  4. o custo soma no teto da empresa certa;
  5. as evidências do turno vêm só da base da empresa do turno;
  6. e2e com o dublê (`scripts/duble-jev-e2e.mjs`, `tests/e2e/helpers/jev.ts`) com duas empresas ao mesmo tempo, com credenciais, aceites e estados diferentes;
  7. varredura de RLS existente (`tests/invariants/rls-completude-varredura.test.ts`) sem exceção nova.
- **Corpus em português (portão para `decidindo`):** pelo menos 200 mensagens reais anonimizadas para a triagem e 100 rascunhos para a conferência, incluindo casos ruins conhecidos (preço inventado, prazo, garantia, aprovação, senha, documento), rotulados por quem conhece a loja. Mede acerto, falso alarme e ordem das opções.
- **Revisão e auditoria:** o auditor do projeto roda antes de qualquer publicação.

---

## 9. Recomendação: segurar o Bloco D ou fazer com a r2?

**Recomendo (b): fazer o Bloco D com a r2 agora e lançar o Jev como r3 logo depois.**

Por quê:

1. **O Jev é rede de segurança, não condição de funcionamento.** A r2 já tem 11 conferências antes do envio, bloqueio de contato, promessa de humano sem caso, vazamento de vocabulário interno e o texto de instruções da loja que manda confirmar preço de seminovo e peça com a vendedora.
2. **Ele ainda não pode entrar com dado real.** Faltam respostas da TypeSafe (retenção, região, exclusão), revisão jurídica do contrato com a loja, novo aceite do administrador e teste em português. Isso leva tempo mesmo que o código estivesse pronto.
3. **Mexe no coração do atendimento** (`inbound-turn.ts`, cadeia `before_send`, casos). Misturar essa mudança com a primeira ida ao ar aumenta o risco dos dois.
4. **O "antes" tem pouco valor imediato:** hoje ninguém lê a categoria. O valor está no "depois".
5. **Entrar em `observando` precisa de tráfego real.** Os primeiros dias do piloto geram o corpus de que a medição depende.

Controles de compensação para as primeiras semanas do Bloco D (sem código novo):

- manter o agente em **modo assistido** nos assuntos de preço e financiamento, ou **revisão por amostra** diária das conversas;
- cadastrar a **tabela de preços** da loja, para o gate determinístico de promessa funcionar;
- ligar a camada semântica de promessa (`PROMISE_SEMANTIC_ENABLED`), que vem desligada (`.env.example:328`), depois de medir custo e acerto;
- limitar a IA a citar preço só do catálogo e orientar "a vendedora confirma" para o resto.

**Quando eu mudaria para (a):** se a loja não aceitar nenhuma chance de resposta com preço, prazo ou aprovação errados na primeira semana, **nem com revisão por amostra**. Aí o Bloco D espera a r3 (semanas, não dias), e só entra em `decidindo` depois do corpus em português. Essa é uma escolha de apetite a risco do negócio e não posso decidir por você.

**Ordem dentro da r3:** primeiro **DEPOIS + conferência local** em `observando`; depois o **ANTES**.

---

## 10. Decisões que dependem de você

| # | Pergunta | Minha recomendação |
|---|---|---|
| 1 | Fazer o Bloco D com a r2 agora e o Jev como r3 **(b)**, ou segurar o Bloco D até o Jev entrar **(a)**? | **(b)**, com os controles da seção 9. |
| 2 | Quem tem a conta da TypeSafe: uma **conta da plataforma** (você paga em dólar e repassa) ou **uma por loja** (como o código faz hoje)? | Conta da plataforma no piloto, colando a chave na credencial `typesafe` de cada empresa; "credencial da plataforma" nativa só depois. |
| 3 | Categorias: as **quatro** (Conserto, Venda, Impressão, Outro), com boleto e parcelamento dentro de Venda; ou manter cinco com Financeiro; ou lista livre por empresa? | Quatro, definidas num lugar só por empresa, com este padrão. |
| 4 | O destino "pedir dado que falta" fica só para a **primeira mensagem** da conversa (o Jev vê uma mensagem isolada), ou mando as últimas mensagens (exige aceite mais largo)? | Só primeira mensagem. |
| 5 | Quando o Jev tem confiança **alta** de que o cliente precisa da equipe: **só abre aviso na Central** ou **abre caso e passa a conversa**? (A regra de 24/09/2026 diz que dúvida vai para a IA; isto é certeza.) | Só aviso na Central na primeira versão. |
| 6 | Enquanto a resposta está segurada, o cliente recebe um **aviso fixo** ("vou confirmar com a equipe") ou **fica em silêncio**? | Aviso fixo, uma vez por resposta segurada. |
| 7 | Os cortes (alta 0,80, média 0,50 a 0,80 no depois; 0,70/0,60 e 0,80/0,70 no antes) e **duas semanas em `observando`** antes de agir? | Sim aos dois. |
| 8 | Versão do modelo: manter a **1.13.0** fixa ou subir para a **1.14.0** (já é a `latest`)? | Manter 1.13.0 e medir a 1.14 em paralelo depois. |
| 9 | Aprovar o **novo consentimento "resposta"** (rascunho + trechos consultados, sem a mensagem do cliente), com novo aceite do administrador e texto jurídico? | Sim; a tarefa nasce desligada. |
| 10 | Quem manda as **perguntas à TypeSafe** (retenção, ZDR, região, exclusão, limites, português) e quem faz a **revisão jurídica** do contrato com a loja? Até lá, só dados de teste. | Você pede, no formulário de suporte, antes de qualquer dado real. Advogado revisa a cláusula. |
| 11 | **Cotação do dólar**: onde fica, valor inicial e quem atualiza? Telas em R$ com a cotação visível. | Configuração da plataforma, atualização mensal manual. |
| 12 | O Jev **conta no teto** mensal, mas a conferência do "depois" **nunca é bloqueada** por teto estourado e a triagem é pulada? | Sim. |
| 13 | Cada pergunta ao Jev gravada com finalidade própria no mesmo registro de custos, sem migração, ok? | Sim. |
| 14 | O **teto mensal definido pela plataforma por cliente** (campo só seu, tela de administração, auditoria) entra agora ou vira outra spec? | Outra spec, antes de vender para várias lojas. |
| 15 | **Ordem de entrega** na r3: primeiro o "depois" (com conferência local) e depois o "antes"? | Sim. |
| 16 | Autoriza usar conversas reais **anonimizadas** da loja piloto como corpus de teste em português, rotuladas por quem conhece o negócio? | Sim, é o portão para sair de `observando`. |

---

## Anexo A — O que a documentação oficial da TypeSafe diz (consultada em 31/10/2026)

| Tema | O que está lá |
|---|---|
| Chamada | `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer`, corpo `model`, `state` (texto, objeto ou lista) e `questions` (mínimo 1). Fonte: `docs.typesafe.ai/api.md` |
| Perguntas | `noul` (sim/não), `choice` (1 a 255 opções), `score` (1 a 10 níveis), `box` (imagem). Fonte: idem |
| Resposta | `answers`, `usage.input_tokens` (cobrado), `usage.output_tokens` (hoje grátis); `choice` e `score` trazem `confidence` e `probabilities`. Fonte: idem |
| Erros | 400, 401, 413 (corpo maior que 32 MiB), 415, 422, 429, 529. **402 e 403 não aparecem.** Fonte: `docs.typesafe.ai/api/errors.md` |
| Limites de taxa | **Sem números publicados.** Mesma página |
| Modelos | `jev-1.13.0`; `jev-1.14.0` "disponível a partir de 14/10/2026"; `jev-latest` e `jev-preview` apontam para a 1.14.0. Recomenda fixar a versão quando há corte ajustado. Fonte: `docs.typesafe.ai/models.md` |
| Preço | US$ 0,042 por milhão de tokens de entrada; saída grátis. Mesma página |
| Contexto | 64 mil tokens por pedido e 32 mil por pergunta; só texto. Mesma página |
| Limitações | literal; não conta; datas como texto; perde precisão com muito detalhe irrelevante; tende à primeira opção; não trata texto como hostil. Fonte: `docs.typesafe.ai/model-jaggedness/jev-1.13.md` |
| Chave | criada no console da TypeSafe. Fonte: `docs.typesafe.ai/introduction/quickstart.md` |
| Política de privacidade | não treina com o que você envia; hospedagem nos EUA; sem prazo de retenção. Fonte: `typesafe.ai/legal/privacy-policy` |
| Acordo de tratamento de dados | cláusulas-padrão europeias para transferência; aviso de incidente em 72 horas; subcontratados em página própria; sem prazo de retenção, sem cláusula de exclusão, sem LGPD. Fonte: `typesafe.ai/legal/data-processing` |
| Contrato principal | créditos pré-pagos em dólar, vencem em 12 meses, sem reembolso; atraso de 30 dias permite suspensão; sem garantia de disponibilidade; "saída pode ser inexata"; proibido treinar modelo que imite as saídas. Fonte: `typesafe.ai/legal/mca` |
| Retenção zero | "oferecida para clientes enterprise", por formulário de suporte. Fonte: `docs.typesafe.ai/legal.md` |
| AI Gateway | modelo `typesafe-ai/jev`, US$ 0,042 por milhão de tokens, contexto de 32 mil, ZDR não confirmado. Fonte: página do modelo no catálogo do AI Gateway |

**Não confirmado:** limites de taxa; códigos 402 e 403; latência (a TypeSafe publica 70 a 500 ms em material de divulgação; o código registra p50 de 361 ms e p95 de cerca de 561 ms medidos do Brasil, em `cliente.ts:154-158`, sem que eu tenha reproduzido); suporte e acurácia em **português**; prazo de retenção; região de processamento além dos EUA; política de descontinuação de versões; valor mínimo de créditos e forma de pagamento; página de preços (`typesafe.ai/pricing` não existe).

---

## Anexo B — Leitura do código (fase 1)

Marcas: ✔ conferido por mim no código; ◐ relatado pela leitura de apoio e não reconferido linha a linha.

### 1. Telas "Uso e orçamento" e "Plano e pagamento"

- ✔ Menu "Uso e orçamento": `lib/navigation/catalogo.ts:661-668`. Dados vêm da tabela `llm_calls` por empresa (`app/api/v1/ai/usage/route.ts:95-102`) ◐; custo em dólar (`app/app/ai/usage/_client.tsx:94`, `BudgetCard.tsx:66-72`) ◐. **Mostra, não cobra.**
- ✔ A tela de cobrança (`app/app/settings/billing/page.tsx`) chama-se **"Billing"** e a descrição do menu é "Plano e cobrança." (`catalogo.ts:974`). O texto "Plano e pagamento" não existe no código. A tela é só "Em breve — Fase 2" (`page.tsx:35-37`); só administrador entra (`:21-22`). Não mede nem cobra.

### 2. Consumo e teto por empresa

- ✔ Existe o teto: tabela `ai_budgets` (`monthly_limit_cents`, em centavos de dólar), modo `enforcement_mode` que nasce `off` (`supabase/migrations/20260814210000_0159_o_teto_que_vincula.sql:189`). Soma do mês: `fn_gasto_de_ia_do_mes` (`:96-107`).
- ◐ Quem edita: administrador da empresa (`app/api/v1/ai/budget/route.ts:99-104`). Bloqueia só em modo "bloquear", depois de carência de 72 horas e de um aviso no mês (`orcamento.ts:211-271`). Piso de US$ 1 (`:35`). Isentos de bloqueio: `connection_test`, `jailbreak_detect`, `promise_semantic` (`:50-54`).
- ✔ **O Jev não passa pela trava** (nenhum arquivo de `lib/ai/decisao/` consulta o orçamento). ◐ Também não passam: clima, embeddings, transcrição de áudio, leitura de imagem e preparo da base (e os quatro últimos nem gravam custo).
- ◐ **Não existe tela nem API da plataforma para definir o teto de uma empresa.** Configurar um teto mensal por cliente exigiria: um campo que só a plataforma escreve e que a decisão respeite acima da escolha do cliente, tela em `/admin` com auditoria, e fechar os fluxos sem trava.

### 3. Origem da chave de IA

- ✔ Chave **por empresa**: tabela `ai_provider_credentials`, cifrada com uma única chave de instalação (`AI_CRED_AES_KEY`, `lib/env.ts:151`) ◐ (`baseline.sql:1205-1222`); só administrador grava ◐.
- ✔ Chave **global da instalação** existe para os provedores comuns (`lib/env.ts:231-247`) ◐. Ordem para o motor principal: credencial da empresa, depois chave da instalação (só anthropic, openai e openrouter), depois erro ◐ (`credentials.ts:338-390`).
- ✔ **Jev do sistema: só a credencial `typesafe` da empresa; nunca chave global** (`lib/ai/decisao/ponto.ts:105-147`, `credencial.ts:12-30`). **Triagem antiga: chave global do AI Gateway** (`lib/ai/triagem/aplicar.ts:220`, `jev.ts:228-234`).
- ◐ **Empresa nova nasce sem credencial.** Só usa a chave da plataforma se a variável do provedor existir; sem nenhuma, os jobs falham e a publicação do agente fica bloqueada.

### 4. Criação de empresa

- ✔ Caminhos: cadastro público (a empresa nasce na confirmação do e-mail, `lib/auth/provision.ts:86-148` ◐); painel da plataforma (`app/api/v1/admin/tenants/route.ts:195` chama `fn_create_tenant_with_owner`); API externa `POST /api/v1/tenants/provision` (existe; só liga com segredo de 32 caracteres ou mais) ◐; script `scripts/bootstrap-owner.ts` ◐.
- ◐ Nasce junto: dono administrador, funil "Pedidos", padrão de IA, tipos de agendamento. **Não nasce:** chave de IA, canal de WhatsApp, agente, configuração de anti-banimento.
- ✔ **Não há integração de pagamento** (busca por Stripe, Mercado Pago, Pagar.me, Hotmart, Kiwify, `subscription_status` e `trial_ends_at` em `app`, `lib`, `workers`, `scripts` e `supabase/migrations` não encontrou nada). Existe só um desenho aprovado, sem código (`docs/adr/0004-cobranca-do-revendedor.md`) ◐.
- **Depois de um pagamento confirmado, hoje é tudo manual** ◐: detectar o pagamento (não há webhook), criar a empresa, dar acesso ao dono, pôr a chave de IA, conectar o WhatsApp, criar e publicar o agente, completar o onboarding, e suspender por inadimplência (o desenho diz que a suspensão atual só troca o status e não corta a IA — não verifiquei).

### 5. Jev ANTES hoje

- ✔ Triagem: `lib/ai/triagem/jev.ts` (categorias `:41-48`, perguntas `:93-112`, cortes `:78-80`, tempo `:81`, só texto digitado `aplicar.ts:28-34`), ligada no turno em `inbound-turn.ts:2123-2144`, depois das saídas antecipadas e **antes** da IA principal; **só grava** em `messages.metadata.triagem` (`aplicar.ts:270-279`). Ninguém lê o registro.
- ✔ **Desligada por padrão:** `JEV_TRIAGEM_ENABLED=false` (`lib/env.ts:512`, `.env.example:428`). Para ligar exige ainda `AI_GATEWAY_PLANO_CONFIRMADO`, `JEV_PLANO_CONFIRMADO` (`pro` ou `so_dado_de_teste`), `AI_GATEWAY_API_KEY`, e o interruptor mestre e aceite da empresa (`aplicar.ts:194-235`).
- ✔ Jev do sistema: 6 tarefas (`tarefas.ts:309-316`), ligado por empresa via `PATCH /api/v1/ai/jev` (administrador, aceite LGPD obrigatório, `route.ts:594-668`); tarefa nova nasce `observando` (`tarefas.ts:20-23`). O roteador roda dentro de `resolve-turn-agent.ts:211,369-373`.
- **Para as quatro categorias:** trocar a lista de `jev.ts:41-48` por Conserto, Venda, Impressão, Outro, em um só lugar (hoje há `financeiro` e falta `impressao`).

### 6. Jev DEPOIS

- ✔ **O ponto existe:** cadeia `before_send`, `runBeforeSend` (`lib/agent-engine/guardrails/before-send.ts:1101`), 11 conferências em ordem fixa (`:839-851`), versão 7 (`:819`). Chamada pelo `send_message` em `inbound-turn.ts:3284`, e também no envio de modelo aprovado (`:2904`) e na pergunta do roteiro (`:4322`).
- ✔ Veto: desfaz tudo, grava rastro em `before_send_traces` e atividade na linha do tempo (`before-send.ts:1264-1309`). O motivo volta ao modelo como erro de ensino. Só duas saídas automáticas: promessa de humano sem caso (2ª vez abre caso e libera, `inbound-turn.ts:3285-3326`) e vazamento de vocabulário (2ª vez libera, `:3328-3360`). Nos demais vetos o modelo recebe o motivo e pode reescrever; se não conseguir, **o cliente fica sem resposta** nesse turno (`:3361-3376`).
- ✔ Sistema de casos: `openCase` (`human-cases.ts:168-228`), um caso aberto por conversa, origem restrita a `agent` e `guardrail_autofallback` por regra do banco (`baseline.sql:7581`). Aviso ao cliente de que uma pessoa assumirá: `avisarLeadDaEscalacao` (`aviso-de-escalacao.ts:115`).
- ✔ Hoje a conferência semântica de promessa vem **desligada** (`.env.example:328`, `camadas-da-org.ts:117`) e a de preço só age com tabela de preços da empresa.

### 7. Custo de IA

- ✔ Uma linha por chamada em `llm_calls`, por empresa, modelo e finalidade; custo fracionário (`roteador.ts:285-308`); preço do Jev em `pricing.ts:90-96`. ◐ Três tabelas de preço coexistem (`pricing.ts`, `ai_pricing`, `ai_models`).
- ✔ O Jev entra na soma do teto (`fn_gasto_de_ia_do_mes` soma tudo), mas nunca é barrado. O custo do Jev novo entraria **sem mudar o banco**, com uma linha por chamada e finalidade própria. A triagem antiga não grava custo nenhum (nenhuma ocorrência de `llm_calls` em `lib/ai/triagem/`).
- Telas em dólar; conversão para reais na seção 7.4.
