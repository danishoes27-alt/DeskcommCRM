-- ═══ Funil "Venda" nasce com a empresa (9002) ═══
--
-- Até aqui o gatilho `trg_seed_default_pipeline_for_org` semeava, em toda empresa nova, o funil
-- "Pedidos" de e-commerce (carrinho abandonado, aguardando pagamento, em separação…). Para uma loja
-- de celular isso é vocabulário de outro negócio. Esta migration troca o CORPO da função: a
-- empresa nova nasce com o funil "Venda" (padrão) e as sete etapas de balcão:
--
--   Novo contato · Já respondi · Escolhendo o aparelho · Vai levar · Combinando o pagamento ·
--   Venda fechada (ganho) · Não comprou (perda)
--
-- Cada etapa leva o `agent_stage_hint` do passo do agente que ela representa (new … lost), a mesma
-- correspondência que o passo "funil" do onboarding grava — o agente já sabe mover o cartão sem
-- ninguém abrir o mapeamento.
--
-- Aditiva e reversível:
--   * só `create or replace function`: nenhuma coluna, constraint, índice ou gatilho novo; o
--     gatilho continua o mesmo e a função mantém o mesmo nome e a mesma assinatura;
--   * NÃO toca em empresa que já existe: o gatilho dispara só em INSERT em `organizations`, então
--     quem já tem "Pedidos" (ou qualquer funil) segue com ele, sem backfill;
--   * reaplicável: `create or replace` não falha na segunda passada (update.sh).
--
-- Desfazer: reaplicar o corpo antigo da função (o do dump, em `supabase/baseline.sql`, bloco
-- `fn_seed_default_pipeline_for_org`: funil "Pedidos", slug `pedidos`, oito etapas de e-commerce).
-- Empresas criadas enquanto esta versão valia ficam com o "Venda", que é um funil comum e pode ser
-- renomeado ou arquivado na tela de Funis — não há dado a migrar de volta.

create or replace function public.fn_seed_default_pipeline_for_org()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pipeline_id uuid;
  v_position numeric := 1000;
  r record;
begin
  insert into public.crm_pipelines (organization_id, name, slug, is_default, position)
  values (new.id, 'Venda', 'venda', true, 1000)
  returning id into v_pipeline_id;

  for r in
    select * from (values
      ('Novo contato',            'novo_contato',        'new',         false, false),
      ('Já respondi',             'ja_respondi',         'contacted',   false, false),
      ('Escolhendo o aparelho',   'escolhendo_aparelho', 'qualifying',  false, false),
      ('Vai levar',               'vai_levar',           'qualified',   false, false),
      ('Combinando o pagamento',  'combinando_pagamento','negotiating', false, false),
      ('Venda fechada',           'venda_fechada',       'won',         true,  false),
      ('Não comprou',             'nao_comprou',         'lost',        false, true)
    ) as t(stage_name, stage_slug, hint, won, lost)
  loop
    insert into public.crm_stages
      (organization_id, pipeline_id, name, slug, position, is_won, is_lost, agent_stage_hint)
    values
      (new.id, v_pipeline_id, r.stage_name, r.stage_slug, v_position, r.won, r.lost, r.hint);
    v_position := v_position + 1000;
  end loop;

  return new;
end$$;
