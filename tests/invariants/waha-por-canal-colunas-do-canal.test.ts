/**
 * Migration 9001 (WAHA por empresa): o canal passa a carregar o endereço e a chave do PRÓPRIO WAHA.
 *
 * Quatro coisas se medem aqui, no Postgres descartável que nasce do `supabase/baseline.sql`:
 *
 *  1. A mudança é ADITIVA — duas colunas opcionais, sem default, sem constraint: a imagem anterior
 *     (que não conhece as colunas) continua funcionando sobre o banco já migrado, e quem não
 *     preencheu nada continua no WAHA global.
 *  2. Os dois artefatos (arquivo da migration e apêndice do baseline) são o MESMO comando, e os dois
 *     são reaplicáveis — `update.sh` roda o baseline de novo, e o Supabase CLI roda a migration.
 *  3. ISOLAMENTO: a empresa B não lê o endereço nem a chave da empresa A (RLS por organização).
 *  4. A chave é CIFRADA e só o service_role a decifra: nem o administrador da própria empresa alcança
 *     o valor em claro pelo PostgREST. (O endereço, em texto, é legível pela própria empresa na linha
 *     do canal — por isso as rotas do app não o devolvem ao navegador do lojista; isso é testado em
 *     tests/unit.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

const ARQUIVO_DA_MIGRATION = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261030120000_9001_celuzap_waha_por_canal.sql",
);
const BASELINE = readFileSync(join(process.cwd(), "supabase", "baseline.sql"), "utf8");
const MIGRATION = readFileSync(ARQUIVO_DA_MIGRATION, "utf8");

const ORG_A = "d9001000-0000-4000-8000-00000000000a";
const ORG_B = "d9001000-0000-4000-8000-00000000000b";
const USER_A = "d9001000-1111-4000-8000-00000000000a";
const USER_B = "d9001000-1111-4000-8000-00000000000b";
const SESSAO_A = "d9001000-2222-4000-8000-00000000000a";
const SESSAO_B = "d9001000-2222-4000-8000-00000000000b";
const CHAVE_EM_CLARO = "chave-9001-so-de-teste-do-harness";

/** O código SQL sem comentário de linha e sem espaço sobrando: o que realmente executa. */
function codigoSql(texto: string): string {
  return texto
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** O apêndice da 9001 no baseline: da marca até o fim do arquivo (é o último bloco). */
function apendiceDoBaseline(): string {
  const marca = BASELINE.search(/^-- ---- .* \(migration 9001\) ----/m);
  if (marca < 0) throw new Error("apêndice da migration 9001 não encontrado no baseline");
  return BASELINE.slice(marca);
}

beforeAll(() => {
  // A chave mestra de cifra, sem a qual `fn_encrypt_oauth` levanta (o banco efêmero nasce sem ela).
  // `on conflict do nothing`: a tabela é compartilhada entre os arquivos desta suíte.
  sql(`
    insert into private.app_secrets (name, value)
    values ('nuvemshop_oauth_key', 'chave-de-teste-do-harness-0255-nao-e-segredo')
    on conflict (name) do nothing;

    insert into auth.users (id, email) values
      ('${USER_A}', 'waha9001-a@invariant.test'),
      ('${USER_B}', 'waha9001-b@invariant.test')
    on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'waha9001-a', 'Waha 9001 A', 'Waha 9001 A'),
      ('${ORG_B}', 'waha9001-b', 'Waha 9001 B', 'Waha 9001 B')
    on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${USER_A}', '${ORG_A}', 'admin', now()),
      ('${USER_B}', '${ORG_B}', 'admin', now())
    on conflict do nothing;

    delete from public.channel_sessions where id in ('${SESSAO_A}', '${SESSAO_B}');
    insert into public.channel_sessions
      (id, organization_id, waha_session_name, webhook_secret_encrypted, waha_base_url, waha_api_key_encrypted)
    values
      ('${SESSAO_A}', '${ORG_A}', 'waha9001-a', '\\x00'::bytea, 'http://waha-a:3000',
        public.fn_encrypt_oauth('${CHAVE_EM_CLARO}')),
      ('${SESSAO_B}', '${ORG_B}', 'waha9001-b', '\\x00'::bytea, 'http://waha-b:3000',
        public.fn_encrypt_oauth('${CHAVE_EM_CLARO}-b'));
  `);
});

afterAll(() => {
  sql(`
    delete from public.channel_sessions where id in ('${SESSAO_A}', '${SESSAO_B}');
    delete from public.user_organizations where user_id in ('${USER_A}', '${USER_B}');
    -- Limpeza "se der": um gatilho de organização nova pode ter criado linhas filhas; a org e o usuário
    -- sintéticos são inofensivos se ficarem (ids fixos, e a semeadura acima usa on conflict).
    do $limpa$ begin
      delete from public.organizations where id in ('${ORG_A}', '${ORG_B}');
    exception when others then null; end $limpa$;
    do $limpa$ begin
      delete from auth.users where id in ('${USER_A}', '${USER_B}');
    exception when others then null; end $limpa$;
  `);
});

describe("9001 · as duas colunas chegam ao clone, opcionais e sem default", () => {
  it("existem, com o tipo certo, anuláveis e sem default", () => {
    expect(
      sql(`select column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, 'sem-default')
             from information_schema.columns
            where table_schema = 'public' and table_name = 'channel_sessions'
              and column_name in ('waha_base_url', 'waha_api_key_encrypted')
            order by column_name`),
    ).toBe("waha_api_key_encrypted|bytea|YES|sem-default\nwaha_base_url|text|YES|sem-default");
  });

  it("um canal criado sem as colunas fica com as duas NULL (= usa o WAHA global, como antes)", () => {
    sql(`
      delete from public.channel_sessions where waha_session_name = 'waha9001-sem-colunas';
      insert into public.channel_sessions (organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${ORG_A}', 'waha9001-sem-colunas', '\\x00'::bytea);
    `);
    try {
      expect(
        sql(`select (waha_base_url is null)::text || '|' || (waha_api_key_encrypted is null)::text
               from public.channel_sessions where waha_session_name = 'waha9001-sem-colunas'`),
      ).toBe("true|true");
    } finally {
      sql(`delete from public.channel_sessions where waha_session_name = 'waha9001-sem-colunas'`);
    }
  });

  it("nenhuma constraint nova nas colunas (a coerência endereço+chave é do app)", () => {
    expect(
      sql(`select count(*) from pg_constraint c
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
            where c.conrelid = 'public.channel_sessions'::regclass
              and a.attname in ('waha_base_url', 'waha_api_key_encrypted')`),
    ).toBe("0");
  });
});

describe("9001 · migration e apêndice do baseline são o mesmo comando, e reaplicáveis", () => {
  it("a migration é aditiva: só `add column if not exists` e `comment on column`", () => {
    // Sem os textos entre aspas: o `;` e as palavras dentro de um COMMENT não são comando.
    const codigo = codigoSql(MIGRATION).replace(/'(?:[^']|'')*'/g, "''");
    const comandos = codigo.split(";").map((c) => c.trim()).filter(Boolean);
    expect(comandos.length).toBe(3);
    for (const c of comandos) {
      expect(c).toMatch(/^(alter table public\.channel_sessions add column if not exists |comment on column public\.channel_sessions\.waha_)/);
    }
    for (const proibido of [" drop ", " not null", " default ", " constraint ", "create index", "create function", "create or replace", "create trigger", " update ", " delete ", " insert ", " revoke ", " grant "]) {
      expect(` ${codigo} `, `a migration não pode conter "${proibido.trim()}"`).not.toContain(proibido);
    }
  });

  it("o apêndice do baseline faz exatamente o que a migration faz", () => {
    expect(codigoSql(apendiceDoBaseline())).toBe(codigoSql(MIGRATION));
  });

  it("aplicar a migration e o apêndice de novo, num banco que já os tem, não falha", () => {
    // `sql` roda com ON_ERROR_STOP=1: qualquer erro joga exceção aqui.
    expect(() => sql(MIGRATION)).not.toThrow();
    expect(() => sql(MIGRATION)).not.toThrow();
    expect(() => sql(apendiceDoBaseline())).not.toThrow();
  });
});

describe("9001 · isolamento entre empresas", () => {
  it("a empresa A enxerga o próprio canal com endereço (controle positivo)", () => {
    expect(countAs(USER_A, `select count(*) from public.channel_sessions where id = '${SESSAO_A}' and waha_base_url is not null;`)).toBe(1);
  });

  it("a empresa B NÃO enxerga o canal da empresa A — nem pelo endereço, nem pela chave", () => {
    expect(countAs(USER_B, `select count(*) from public.channel_sessions where id = '${SESSAO_A}';`)).toBe(0);
    expect(countAs(USER_B, `select count(*) from public.channel_sessions where waha_base_url = 'http://waha-a:3000';`)).toBe(0);
    expect(countAs(USER_B, `select count(*) from public.channel_sessions where waha_api_key_encrypted is not null and organization_id = '${ORG_A}';`)).toBe(0);
  });

  it("e a empresa A não enxerga a B (simetria)", () => {
    expect(countAs(USER_A, `select count(*) from public.channel_sessions where id = '${SESSAO_B}';`)).toBe(0);
  });

  it("a empresa B não consegue gravar endereço no canal da empresa A", () => {
    const afetadas = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${USER_B}"}', false);
      with w as (update public.channel_sessions set waha_base_url = 'http://invasor:3000' where id = '${SESSAO_A}' returning 1)
      select count(*) from w;
    `)
      .split("\n")
      .pop();
    expect(afetadas).toBe("0");
    expect(sql(`select waha_base_url from public.channel_sessions where id = '${SESSAO_A}'`)).toBe("http://waha-a:3000");
  });
});

describe("9001 · a chave é cifrada, e só o service_role a decifra", () => {
  it("o que está no banco NÃO é a chave em claro", () => {
    expect(
      sql(`select (position('${CHAVE_EM_CLARO}' in encode(waha_api_key_encrypted, 'escape')) = 0)::text
             from public.channel_sessions where id = '${SESSAO_A}'`),
    ).toBe("true");
  });

  it("service_role decifra e recupera a chave original (controle positivo)", () => {
    expect(
      sql(`set role service_role;
           select public.fn_decrypt_oauth(waha_api_key_encrypted) from public.channel_sessions where id = '${SESSAO_A}';`)
        .split("\n")
        .pop(),
    ).toBe(CHAVE_EM_CLARO);
  });

  it("o administrador da própria empresa (authenticated) é BARRADO ao decifrar", () => {
    let erro: string | null = null;
    try {
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${USER_A}"}', false);
        select public.fn_decrypt_oauth(waha_api_key_encrypted) from public.channel_sessions where id = '${SESSAO_A}';
      `);
    } catch (err) {
      erro = motivoDoErro(err);
    }
    expect(erro, "authenticated decifrou a chave do WAHA — a cifra deixou de proteger").not.toBeNull();
    expect(erro).toContain("permission denied");
  });

  it("anon também é barrado ao decifrar", () => {
    let erro: string | null = null;
    try {
      sql(`set role anon; select public.fn_decrypt_oauth('\\x00'::bytea);`);
    } catch (err) {
      erro = motivoDoErro(err);
    }
    expect(erro).not.toBeNull();
    expect(erro).toContain("permission denied");
  });
});
