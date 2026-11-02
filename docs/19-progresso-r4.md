# Progresso r4 (memória do trabalho; reler ao retomar)

Branch celuzap-1.69.0-r4 a partir de celuzap-1.69.0-r3 (7ce9e4728). Sem push; só o remote fork, e só com o "confirmo" do Berg.

## Feito
- Paleta do wipevirus (navy) + verde Celuzap, claro e escuro (globals.css; régua do produto regenerada).
- Logo Celuzap: SVG, PNGs, ícones e favicon em public/brand e docs/assets; gerador em scripts/gerar-logo-celuzap.mjs.
- Menu por tarefa (Atender, Vender, Meu agente, Conectar, Resultados, Minha loja) com nomes sem jargão e espanhol; campo aka acha o nome antigo no atalho de busca; mensagens do produto citam os nomes novos.
- Barra inferior no celular; arrastar colunas no quadro; pacotes de funil Venda, Conserto e Pedidos de celular.
- Textos do login e do onboarding do atendente em português simples.
- Migration 9002: empresa nova nasce com o funil Venda (sem destinos do agente, invariante 0156).
- E-mails novos em C:\Dev\segredos\emails-r4 (fora do repo).

## Medido
- test:db e test:db:update verdes. Suíte unitária: 53 falhas em 21 arquivos (base r3: 51 em 19); os 2 a mais passam isolados.

## Não conferido
- Menu, barra inferior e quadro em tela (exigem sessão logada; sem Supabase local). Só o login foi visto.
- A descrição de coluna "por posição" não existe no código; as explicações já são por passo.

## Pendente de aprovação
Push ao fork e publicação da imagem r4.
