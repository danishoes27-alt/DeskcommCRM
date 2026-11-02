# Spec do redesign r4 do Celuzap

Base: tag `celuzap-1.69.0-r3` (commit 7ce9e4728). Branch: `celuzap-1.69.0-r4`.
Régua de toda tela nova: **o dono de uma loja de celular entenderia isso sem explicação?**
Estado vazio sempre com texto amigável e ação clara.

## Regras que não mudam
- Sem push, sem `origin`, sem `--force`. Só o remote `fork`, depois do "confirmo".
- Sem mexer em banco de produção, VPS ou EasyPanel.
- Jev, `before_send` e agente: só texto e visual, nunca comportamento.
- Configuração do cliente (marca, cor, prompt) vem do banco (`platform_branding`,
  `organizations.settings.branding`) e fica acima do `.env`. O redesign só troca o
  **padrão de fábrica**; quem já personalizou não perde nada.
- Migração só com aprovação prévia.

## Fontes medidas
- Paleta: `SITE WIPEVIRUS/docs/DESIGN.md` e `site/css/base.css` (navy `#0C112A`,
  painel `#1A1B2E`, campo `#0F1020`, texto `#E8E9F3`, apagado `#9A9CB8`, linha
  `#2B2D49`, borda `#6A6EA6`, ciano `#22D3EE`, violeta `#7C5CFF`, aviso `#F5B84A`).
- Logo: `docs/assets/logo-celuzap.jpeg` (verde #0F9D58 a #00C853, navy #1A2333, branco).

## Achados do código que mudam o escopo (leia antes de aprovar)
1. **Reordenar colunas já existe**: Configurações › Funis tem botões "uma coluna para
   trás/frente" (`app/app/settings/tenant/pipelines/_stages.tsx`, API `PATCH
   /pipelines/[id]/stages/[stageId]` com `depois_de`). O que falta é fazer isso
   direto no quadro (arrastar a coluna). Escopo: arrastar no quadro, sem migração.
2. **Funil padrão na criação da empresa é um gatilho do banco**
   (`fn_seed_default_pipeline_for_org`, semeia "Pedidos" de e-commerce). Trocar por
   "Venda" exige **migração** → PARA e pede aprovação antes de criar o arquivo.
   Até lá, os funis Venda/Conserto/Pedidos entram como pacotes prontos
   (`lib/onboarding/pacotes-de-funil.ts`), sem tocar no banco.
3. `crm_stages.description` existe no schema mas nenhuma tela a lê. A "descrição que
   acompanha a posição" será localizada na tarefa dos funis; se estiver no
   mapeamento do agente (`_mapping.tsx`, por passo), passa a ser por nome/etapa.

## Decisões de design
- **Cor**: superfícies, texto, linhas e estados vêm da paleta do wipevirus (modo
  escuro = os valores dela; modo claro = derivado, contraste ≥ 4.5:1). O **verde do
  Celuzap** é o acento de ação (combina com a logo e com o botão dos e-mails); o
  ciano do wipevirus fica como cor de informação/foco. Tokens continuam só em
  `app/globals.css`.
- **Logo**: SVG vetorizado do símbolo, PNG transparente, favicon, ícones 512/1024,
  em `public/brand/` e `docs/assets/`. Aplicada no login, cabeçalho e favicon
  como **padrão**; logo enviada pelo cliente continua vencendo.
- **Navegação mobile**: barra inferior com 5 destinos: Conversas, Clientes, Funis,
  Agenda, Menu (abre o menu completo).
- **Menu (desktop e mobile)** por tarefa do lojista: Atender · Vender · Meu agente
  (IA) · Resultados · Minha loja. Os `id`s de grupo e os `href`s não mudam
  (só rótulo e agrupamento), para não quebrar link, ⌘K nem teste.
- **Linguagem**: sem jargão (Inbox→Conversas, Pipeline/Funil→Funis de venda,
  Radar→Quem esfriou, Audit Log→Histórico de ações, Webhooks→Avisos para outros
  sistemas, API Tokens→Chaves de acesso...). Espanhol do dicionário atualizado junto.
- **Textos do agente e do login**: português simples, frases curtas. Sem mexer em
  lógica, guardrails ou `before_send`.
- **E-mails**: HTML final em `C:\Dev\segredos\emails-r4` (fora do repo).

## Fora de escopo
Migração (até aprovação), push, publicação da imagem r4, qualquer alteração em produção.

## Critério de pronto
`pnpm typecheck`, `pnpm lint`, testes das áreas tocadas e `pnpm test:db` sem falha
nova contra a linha de base (~51 falhas antigas do Windows em 19 arquivos).
