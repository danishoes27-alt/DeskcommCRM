# Plano 23 — Consulta de aparelhos (`crm_search_aparelhos`)

Estado: **EM IMPLEMENTAÇÃO** (r7). Spec: `docs/specs/23-spec-consulta-aparelhos.md`.
Nada abaixo foi executado. Branch de trabalho: `refs/heads/celuzap-1.69.0-r7`, criada de
`refs/heads/celuzap-1.69.0-r6` (`08c32b5`). Remote: só `fork`; **nunca `origin`**; nunca `--force`.

## Decisões de 2026-11-07 que mudam este plano

- **T5 (rota + cartão) foi CANCELADA** (D7): a URL é gravada por um `UPDATE` único, preparado em
  `docs/specs/23-gravar-url-aparelhos.md` e executado só com o "confirmo" por escrito. Não há rota,
  tela, entrada de navegação nem `T-CFG-02`/`P-01`/`P-02`.
- **T0 foi executada**: formato real na spec ("Formato CONFIRMADO"). Fixture de teste = 3 a 4
  aparelhos reais, nunca o arquivo inteiro.
- **T4**: a conta do teto de ferramentas é 14 + 1 = 15 ≤ 27; conferida de novo por teste.
- A v3 do agente está em `docs/specs/23-instrucoes-agente-v3.md`.
- A publicação (push, tag, deploy, nova versão do agente) **não faz parte desta entrega**.

## Ordem de trabalho

`spec → testes primeiro → build incremental → review → auditor → publicação`.
Cada tarefa abaixo é pequena e termina com `pnpm typecheck` verde nos arquivos que tocou.
Cada tarefa de código começa pelo teste que a prova (vermelho) e só então escreve o código
(verde). Um commit por tarefa, na branch r7.

## Tarefas

### T0 — Conferir o formato real do arquivo (leitura, sem código)
- **Faz:** uma leitura única do `aparelhos.json` (somente `GET`, nada gravado em produção) para
  fechar o que a spec declara que **não sabe**: valores reais de `categoria`, `condicao`, `oferta`;
  tipo de `oferta` e de `nfc`; se há campos além dos listados; tamanho em bytes (confirma o teto de
  512 KB com folga).
- **Arquivos:** nenhum. Resultado entra como adendo "Formato confirmado" na spec 23.
- **Por que primeiro:** o schema Zod e os testes de casamento dependem disso.

### T1 — Schema do arquivo e da configuração
- **Testes primeiro:** `T-VAL-01..06`, `T-CFG-01`, `T-CFG-03`.
- **Cria:** `lib/aparelhos/schema.ts` (Zod do arquivo + `idadeEmDias` + checagem de contagem),
  `lib/aparelhos/configuracao.ts` (Zod `.strict()` da configuração, `HOSTS_PERMITIDOS_APARELHOS`,
  `validarUrlDeAparelhos`, `lerConfiguracaoDeAparelhos`), `lib/aparelhos/schema.test.ts`,
  `lib/aparelhos/configuracao.test.ts`.
- **Não toca:** nenhum arquivo existente.

### T2 — Normalização e casamento (função pura)
- **Testes primeiro:** `T-NOR-01..10`, `T-LIM-01..04`.
- **Cria:** `lib/aparelhos/busca.ts` (`normalizar`, `casar`, `ordenar`, `limitar`),
  `lib/aparelhos/busca.test.ts`.
- **Cuidado:** a tabela da spec §4 é o contrato; qualquer caso novo achado vira linha na tabela
  **e** teste.

### T3 — Leitor seguro com cache
- **Testes primeiro:** `T-SEG-01..13`, `T-CAC-01..08`.
- **Cria:** `lib/aparelhos/leitura.ts` (os 10 passos da spec §2; reusa `assertSafeOutboundUrl`,
  `assertDestinoResolvidoSeguro`, `classificarFalhaDeAlcance`), `lib/aparelhos/cache.ts`
  (TTL 300 s, negativo 30 s, `single-flight`, teto de 50), seus dois `.test.ts`.
- **Não toca:** `lib/automation/*` e `lib/net/alcance.ts` (só importa).

### T4 — A ferramenta e o registro
- **Testes primeiro:** `T-RET-01..08`, `T-ISO-01..03`, `T-ARGS-01..03`, `T-REG-01..04`.
- **Cria:** `lib/mcp/tools/aparelhos.ts` (+ `.test.ts`).
- **Altera:** `lib/mcp/tools/index.ts`; `lib/mcp/tools/catalogo/comercio.ts`;
  `lib/agent-engine/agent/tool-breaker.ts`; `lib/agent-engine/agent/preview.ts`;
  `lib/atendimento/fronteira-server.ts`; `lib/agent-engine/agent/evidencias-das-ferramentas.ts`
  (+ seu teste existente `evidencias-das-ferramentas.test.ts`, com o caso novo).
- **Mede:** o agente com os pacotes `vender` + `atender` continua dentro de
  `TETO_TOOLS_POR_AGENTE = 27`; se não couber, **para e pergunta** (a decisão de tirar outra
  capacidade ou de mudar o pacote é sua).
- **Roda:** `tests/unit/catalogo-tools-leigo-friendly.test.ts`,
  `tests/unit/preview-scenario-reads-security.test.ts`, `tests/unit/busca-vazia-nao-e-sucesso.test.ts`
  e os testes de `selecao-por-pacote`.

### T5 — (CANCELADA, D7) Rota e cartão de configuração
- **Testes primeiro:** `T-CFG-02`.
- **Cria:** `app/api/v1/settings/aparelhos/route.ts` (+ `route.test.ts`): `GET` (manager) lê, `PATCH`
  (admin) valida pelo schema da T1, faz merge **só da chave `aparelhos`**, `requireSupportWrite(`
  antes do efeito, `audit({ action: "aparelhos.config_updated" })`, `ok()/fail()`; o
  `POST .../test` (admin) chama o leitor e devolve `gerado_em` + totais.
- **Cria (UI):** o cartão de configuração (campo URL, Salvar, Testar leitura, mensagens em
  português) e sua entrada em `lib/navigation/catalogo.ts` — tela nova precisa de porta (DoD 14).
  Local exato da tela: na construção, a **menor mudança** numa tela de Configurações que já exista;
  se não houver encaixe, uma tela própria no grupo de integrações.
- **Se você escolher a opção A (SQL):** a T5 é descartada e entra a T5-alt abaixo.
- **T5-alt (somente com OK escrito):** `UPDATE ... settings || jsonb_build_object(...)` numa
  transação, com `SELECT settings` antes e depois guardados em `C:\Dev\segredos\backups`, 1 linha
  afetada conferida (`WHERE id = '990feca9-…'`), e nenhuma outra chave diferente no antes/depois.

### T6 — Fragmento de release e documentação viva
- **Cria:** `.changes/consulta-de-aparelhos.md` com `impacto: capacidade_nova`, `secao: adicionado`
  e título/texto em português claro para o operador:

  ```
  ---
  impacto: capacidade_nova
  secao: adicionado
  titulo: O atendente consulta o catálogo de aparelhos publicado pela loja
  ---

  Nova capacidade "Consultar aparelhos e preços da loja": o atendente lê o arquivo de aparelhos
  que a loja publica e responde modelo, cor, preço à vista e parcelas exatamente como estão lá,
  ou diz que o modelo está em falta. Vem desligada: o administrador liga na tela do agente, em
  uma versão nova, e informa o endereço do arquivo em Configurações.
  ```
- **Altera:** `docs/architecture/` se o mapa vivo exigir (DoD 13: peça nova com ≥ 2 arestas — a
  ferramenta liga `settings.aparelhos` → leitor → agente; o teste de mapas diz se falta).
- **Roda:** `pnpm release:conferir`.

### T7 — Verificação completa (antes de pedir review)
Na ordem, sem cortar a saída (a doutrina do `CLAUDE.md` é explícita sobre isso):
1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test:unit > /tmp/vt.log 2>&1; echo exit=$?` e conferir **o rodapé e o `exit`** (não o
   recorte de `tests/unit`), com os controles `Failed Suites` / `Errors` descritos no `CLAUDE.md`.
4. `pnpm cercas`
5. `pnpm lint:channels` e `pnpm lint:role-rank`
6. `pnpm build` (Node 22).
`pnpm test:db` **não** é necessário (nenhuma migration, nenhuma tabela, nenhum schema); a
dispensa é declarada aqui para o auditor conferir que é verdade (`git diff --stat` sem
`supabase/`).

### T8 — Prova pela tela (DoD 12) e par de prova
Ambiente: `next build` + `next start`, banco fresco do `baseline.sql`, `bootstrap-owner`; um
receptor HTTP local servindo um `aparelhos.json` de teste **fora** da allowlist de produção não
serve (a allowlist é constante). Portanto a prova da leitura usa o **teste de integração com
`fetch` simulado** (T3/T4) e a prova **pela tela** acontece na produção, no modo de teste do
canal, depois do deploy (T10): `P-01..P-04` da spec §9. Evidência em
`evidence/consulta-aparelhos/` (versionada).

### T9 — Review e auditoria
Review nos cinco eixos (corretude, legibilidade, arquitetura, segurança, desempenho) e auditoria
independente (ver "O que o auditor confere"). Achados viram commits na própria branch r7.

### T10 — Publicação (ver "Plano de publicação")

## O que o auditor confere

> O agente `auditor-celuzap` **não existe** neste repositório nem na lista de agentes desta sessão
> (procurei em `.claude/agents/` e por nome no repo). Se ele existe no seu ambiente, use esta lista
> como o pedido; se não, o `agent-skills:security-auditor` e o `agent-skills:code-reviewer` cobrem.

1. **Diff só do que a spec diz:** `git diff --stat refs/heads/celuzap-1.69.0-r6..refs/heads/celuzap-1.69.0-r7`
   não toca `supabase/`, `Dockerfile*`, `docker-compose*`, `.env.example`, `lib/env.ts`, nem
   `package.json`/lockfile.
2. **Sem rede fora da regra:** o único `fetch` novo está em `lib/aparelhos/leitura.ts`; precedido
   das duas guardas; `redirect: "manual"`; `AbortSignal.timeout(5000)`; leitura em stream com teto;
   nenhuma URL, host ou cabeçalho vem de argumento do modelo (`grep` por `input.url`).
3. **Allowlist:** constante no código, comparação exata; teste do host parecido.
4. **Isolamento:** `ctx.organizationId` em toda leitura de configuração; chave de cache com org;
   nenhum `organization_id` aceito em argumento.
5. **Honestidade do retorno:** os três retornos exatamente como a spec §5; `erro` nunca com
   `itens`; `nao_listado` nunca com `erro`; cache vencido nunca serve preço; teste `T-RET-02`
   realmente compara com o arquivo e **falha** se alguém "arredondar" um preço (peça para
   sabotar a ferramenta e ver o teste vermelhar).
6. **Registro completo:** os 6 lugares da spec §7; nasce desligada (nenhum `tool_ids` existente).
7. **Rota de configuração:** `requireRole("admin")`, `requireSupportWrite(` antes do efeito
   (`tests/unit/suporte-cobertura-de-efeitos.test.ts`), merge só da chave `aparelhos`, audit,
   sem `console.log`.
8. **Segredos:** nada de chave, token ou senha em código, teste, fragmento ou evidência.
9. **Doutrina:** DoD 1–10, 13, 14, 16 (afirmações de estado que mudaram: o `docs/current-state.md`
   não precisa nem pode ficar desatualizado), 17 (fragmento) e 18 (destino declarado).
10. **O que a auditoria não cobre e deve dizer:** `pnpm test:db` e `test:e2e` não rodam o
    caminho novo; a leitura real do arquivo só é provada em produção.

## Plano de publicação

Tudo abaixo só começa com o seu "aprovado" **por escrito** nesta etapa seguinte. Nada disto foi
feito. O padrão é o das r3–r6.

**Antes**
1. Guardar o texto da **v2** do agente em `C:\Dev\segredos\prompt-v2-grau-cell.txt` (para o
   desfazer) e as 6 linhas atuais das imagens em `C:\Dev\segredos\imagens-antes-da-r7.txt`.
2. Conferir `git status` limpo e a branch r7 em dia com a r6.

**Publicar**
3. Verificar T7 inteira verde. `git push fork refs/heads/celuzap-1.69.0-r7` (só `fork`).
4. Criar a tag `celuzap-1.69.0-r7` no commit final e `git push fork refs/tags/celuzap-1.69.0-r7`.
5. Esperar o CI publicar as três imagens no GHCR (`deskcommcrm`, `deskcomm-worker`,
   `deskcomm-scheduler`) com a tag `celuzap-1.69.0-r7`; conferir que as três existem.
6. EasyPanel › Environment: trocar as 3 imagens para `celuzap-1.69.0-r7` em **todos** os blocos
   duplicados, `*_PULL_POLICY=missing`; **Deploy**; conferir `/api/v1/health` (`healthy`, versão
   nova) e que o domínio responde 307 no login.
7. **A r7 não tem migration.** O deploy não altera dados, e a ferramenta nasce desligada:
   até aqui **o atendimento é idêntico ao da r6**.

**Ligar (depois, com a sua conferência)**
8. Gravar a URL (cartão da T5, ou T5-alt) e usar "Testar leitura": deve mostrar `geradoEm` e os
   totais (34 aparelhos / 93 variantes, segundo você).
9. No painel do agente: nova versão (rascunho) → ligar a capacidade → colar a v3 → **Testar** com
   os três cenários → **Publicar** (passos do §7 da spec).
10. Prova real pelo seu número (`+5562993509792`), que é o único autorizado no modo de teste.

**Como desfazer (voltar para a r6) sem perder a configuração do cliente**
- **Só a IA (mais comum):** criar um rascunho com a **v2** (texto guardado no passo 1) e
  **publicar**. A configuração `settings.aparelhos` fica; é inofensiva.
- **A versão do app:** restaurar as 6 linhas de `imagens-antes-da-r7.txt` no Environment e
  **Deploy**. Como a r7 **não tem migration**, não há nada no banco para desfazer. A r6 ignora a
  chave `settings.aparelhos` (o `jsonb` guarda chaves desconhecidas) e **ignora ferramenta que não
  conhece**: o carregador pula id de ferramenta ausente do catálogo
  (`lib/ai/runtime/tools.ts:427-429`, `if (!def) continue`). Cuidado: se voltar a r6 **mantendo a
  v3 publicada**, o texto da v3 manda usar uma ferramenta que a r6 não tem; o atendente deve cair
  em "vou confirmar com a equipe", mas **a ordem segura é publicar a v2 primeiro e só depois
  voltar a imagem**.
- **Nada** do que o cliente configurou (agente, capacidades, lista de teste, canal) é tocado em
  nenhum dos dois caminhos.

## Riscos e decisões que dependem de você

1. **Como gravar a URL** — recomendo **C** (rota + cartão, mais código, sem SQL); A é o plano B
   (rápido, mas SQL em produção). Define se a T5 existe.
2. **Texto da v2** — preciso dele para fechar a v3: você cola, ou autoriza **só um SELECT** em
   `ai_agent_versions.system_prompt` da versão publicada do agente da Grau Cell.
3. **Cache vencido com falha** — recomendo **nunca servir**; a alternativa é tolerância de 30 min
   com aviso. Pergunta: o que dói mais, mandar um cliente a um atendente quando o site da loja
   falha, ou arriscar dizer um preço de 10 minutos atrás?
4. **Tolerância a erro de digitação** — a spec aceita 1 letra errada em palavras de 5+ letras
   (`ipone`→`iphone`) e marca como "aproximado". Se prefere **zero** tolerância (mais "em falta"
   por engano, nenhum modelo trocado), diga.
5. **Teto de 27 ferramentas** — se o agente da Grau Cell já está perto, a ferramenta nova pode não
   caber; só se sabe na T4. Você decide o que sai.
6. **Vocabulário do arquivo (T0)** — `categoria`/`condicao`/`oferta` e o que mais o arquivo trouxer
   podem pedir ajuste no schema ou na tabela de casamento.
7. **Dependência do site da loja** — se `aparelhos.graucell.com` ficar fora do ar, **todo** cliente
   que perguntar de celular vai para um atendente humano. É o comportamento desejado (não inventar),
   mas vale ter alguém olhando a fila.
8. **Quem atualiza o arquivo** — o `geradoEm` precisa ser regenerado em até 30 dias; se a rotina
   que gera o arquivo parar, a ferramenta passa a responder `desatualizado` sozinha. Quem avisa
   você? (Sugestão futura, fora desta entrega: um monitor no Uptime Kuma lendo `geradoEm`.)
9. **Canal em WAHA/QR** — segue o aviso anterior: a regra do projeto fala em API oficial da Meta
   para produção; nada nesta entrega muda isso.
10. **Push e tag** — esta etapa **não** publicou nada. O push para o `fork` e a tag só ocorrem
    com a sua ordem.
