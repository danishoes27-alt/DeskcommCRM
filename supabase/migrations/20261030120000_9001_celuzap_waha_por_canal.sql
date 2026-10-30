-- ═══ WAHA por empresa: endereço e chave do WAHA de cada canal (9001) ═══
--
-- Até aqui o app falava com UM WAHA por instalação: o endereço e a chave vinham de
-- variável de ambiente global, e nenhuma coluna dizia "este canal mora naquele WAHA".
-- Para cada empresa ter o seu contêiner WAHA, o canal precisa carregar o próprio
-- endereço e a própria chave. São duas colunas, e só.
--
--   waha_base_url           endereço interno do WAHA da empresa (ex.: http://waha-acme:3000).
--                           NULL = o canal usa o WAHA global da instalação (modo compartilhado),
--                           exatamente como antes: quem só atualiza a imagem não muda nada.
--   waha_api_key_encrypted  chave de API desse WAHA, cifrada por `fn_encrypt_oauth` (a mesma cifra
--                           de `zernio_token_encrypted` e dos tokens de calendário). Só o
--                           service_role decifra. NULL = sem chave própria.
--
-- Aditiva por construção, para a imagem anterior continuar rodando sobre o banco já migrado:
--   * `add column if not exists`: nada de drop de coluna, nada de NOT NULL, nada de DEFAULT, nada que
--     reescreva linha (as linhas existentes ficam com as duas colunas NULL);
--   * nenhuma constraint nova e nenhum índice: o formato do endereço e a coerência "endereço e chave
--     andam juntos" são validados pelo app (resolvedor de canal);
--   * UM gatilho de guarda (no fim do arquivo): recusa que `anon`/`authenticated` escrevam nas duas
--     colunas. Quem não mexe nelas — inclusive a imagem anterior — não percebe nada.
--
-- Numeração 9001: escolha do Celuzap. O projeto de origem também usa a faixa 90xx (a partir da 9016
-- no main dele), então a colisão não é impossível por construção: confira com
-- `pnpm checar:colisao-de-migration` contra o main do projeto de origem a cada atualização. O que
-- o Supabase CLI registra é o timestamp do nome, não o NNNN.
--
-- Desfazer (só se NENHUM canal usar WAHA próprio): arquivo `9001-desfazer.sql` do registro de
-- execução, que recusa rodar se houver endereço ou chave gravados e também remove o gatilho.

alter table public.channel_sessions
  add column if not exists waha_base_url text,
  add column if not exists waha_api_key_encrypted bytea;

comment on column public.channel_sessions.waha_base_url is
  'Endereço interno do WAHA DESTE canal (http/https). NULL = usa o WAHA global da instalação (modo compartilhado). Só o operador da plataforma escreve (um gatilho recusa anon e authenticated); nunca vai ao navegador do lojista.';
comment on column public.channel_sessions.waha_api_key_encrypted is
  'Chave de API do WAHA deste canal, cifrada por public.fn_encrypt_oauth (pgp_sym AES-256). NUNCA em claro: só service_role decifra (fn_decrypt_oauth). NULL = sem chave própria. Nunca vai ao navegador.';

-- ─── Quem escreve nas duas colunas ──────────────────────────────────────────────────────────────
-- A policy de escrita de `channel_sessions` deixa o ADMIN da empresa atualizar a linha do próprio canal
-- pelo PostgREST, com o JWT dele. Sem esta guarda, ele poderia apontar `waha_base_url` para um servidor
-- seu (o app mandaria a chave de API até lá e leria a resposta). Então as duas colunas só mudam por quem
-- NÃO é `anon` nem `authenticated`: service_role (a tela do operador e a conexão do número) e o dono do
-- banco (migrations, funções SECURITY DEFINER). Quem não mexe nessas colunas não nota diferença nenhuma.
create or replace function public.fn_guard_channel_sessions_waha() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.waha_base_url is not null or new.waha_api_key_encrypted is not null then
        raise exception 'waha_por_canal: o endereço e a chave do WAHA de um canal só mudam pelo operador da plataforma'
          using errcode = '42501';
      end if;
    elsif new.waha_base_url is distinct from old.waha_base_url
       or new.waha_api_key_encrypted is distinct from old.waha_api_key_encrypted then
      raise exception 'waha_por_canal: o endereço e a chave do WAHA de um canal só mudam pelo operador da plataforma'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$fn$;

-- Função exclusiva de trigger: nenhuma sessão deve chamá-la como RPC.
revoke execute on function public.fn_guard_channel_sessions_waha()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_channel_sessions_guard_waha on public.channel_sessions;
create trigger trg_channel_sessions_guard_waha
  before insert or update on public.channel_sessions
  for each row execute function public.fn_guard_channel_sessions_waha();
