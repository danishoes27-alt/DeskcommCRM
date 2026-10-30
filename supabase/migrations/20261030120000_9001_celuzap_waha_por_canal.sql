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
--   * só `add column if not exists`: nada de drop, nada de NOT NULL, nada de DEFAULT, nada que
--     reescreva linha (as linhas existentes ficam com as duas colunas NULL);
--   * nenhuma constraint nova, nenhum índice, nenhuma função: o formato do endereço e a
--     coerência "endereço e chave andam juntos" são validados pelo app (resolvedor de canal).
--
-- Numeração 9001: escolha do Celuzap. O projeto de origem também usa a faixa 90xx (a partir da 9016
-- no main dele), então a colisão não é impossível por construção: confira com
-- `pnpm checar:colisao-de-migration` contra o main do projeto de origem a cada atualização. O que
-- o Supabase CLI registra é o timestamp do nome, não o NNNN.
--
-- Desfazer (só se NENHUM canal usar WAHA próprio): arquivo `9001-desfazer.sql` do registro de
-- execução, que recusa rodar se houver endereço ou chave gravados.

alter table public.channel_sessions
  add column if not exists waha_base_url text,
  add column if not exists waha_api_key_encrypted bytea;

comment on column public.channel_sessions.waha_base_url is
  'Endereço interno do WAHA DESTE canal (http/https). NULL = usa o WAHA global da instalação (modo compartilhado). Só o operador da plataforma escreve; nunca vai ao navegador do lojista.';
comment on column public.channel_sessions.waha_api_key_encrypted is
  'Chave de API do WAHA deste canal, cifrada por public.fn_encrypt_oauth (pgp_sym AES-256). NUNCA em claro: só service_role decifra (fn_decrypt_oauth). NULL = sem chave própria. Nunca vai ao navegador.';
