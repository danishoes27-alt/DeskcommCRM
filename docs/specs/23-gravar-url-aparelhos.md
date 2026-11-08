# Gravar a configuração dos aparelhos (url + hosts) — SQL preparado (NÃO EXECUTADO)

Decisões D7 (2026-11-07) e D11 (2026-11-08): a configuração é gravada por **um UPDATE único** em
`organizations.settings`, numa **única chave**, `aparelhos`, que leva `url` e `hosts` juntos. Sem rota, sem tela,
sem migration. **Nada abaixo foi executado.** Só roda depois do "confirmo" por escrito do dono do produto.

- **Organização:** Grau Cell — `990feca9-5b39-4d29-a8de-f8cd5b77fe0d`.
- **O que muda:** UMA chave nova, `settings.aparelhos`, com
  `{"url": "https://aparelhos.graucell.com/aparelhos.json", "hosts": ["aparelhos.graucell.com"]}`.
  As demais chaves de `settings` (`routing`, `branding`, `campanhas`…) não são tocadas.
- **Por que `hosts` vai junto:** a ferramenta só lê se o host da URL estiver em `hosts` **da mesma organização**.
  Sem `hosts` (ou com a lista vazia) ela responde `nao_configurado` e não faz chamada de rede. O domínio da loja
  mora aqui, no banco, e **não no código** (o Celuzap é multicliente).
- **Sem migration:** é dado, não schema. A r6 ignora a chave (o `jsonb` guarda chaves desconhecidas).
- **Por que `jsonb_set` e não `=`:** `jsonb_set` mexe numa chave só. `set settings = '{...}'` trocaria o objeto
  inteiro e apagaria o resto.
- **Trava no próprio UPDATE:** `and not (settings ? 'aparelhos')`. Rodar duas vezes não sobrescreve nada; a
  segunda devolve 0 linhas. (Para trocar uma configuração que já existe, use DESFAZER e depois GRAVAR.)

## Regra de marca (por que este arquivo passa em `tests/unit/branding.test.ts`)

O teste varre só `app/`, `components/`, `hooks/`, `lib/` e `workers/` (`RAIZES_VARRIDAS`, linha 354 do teste).
`docs/` não é varrido, então o domínio da loja pode aparecer aqui, que é onde ele deve morar junto com o
SQL. O teste **não foi alterado** (`git diff` do arquivo vazio) e passa. Se um dia a régua passar a varrer
`docs/`, a solução sem mexer no teste é trocar, neste arquivo, o domínio por um marcador (`<host-da-loja>`) e
guardar os valores reais fora do repositório, em `C:\Dev\segredos`.

## Quem executa

1. **Eu**, pelo caminho que já foi autorizado para a migration 9002 (cliente `psql` numa imagem Docker, lendo a
   URL do banco de `C:\Dev\segredos\db-url.txt` sem imprimi-la), **somente depois do seu "confirmo"**.
2. **Você**, no **Supabase › SQL Editor** do projeto de produção: cole um bloco por vez e clique em Run.

## 1) ANTES — só leitura (copie o resultado)

```sql
select id,
       settings ? 'aparelhos'                                  as ja_tem_aparelhos,
       settings -> 'aparelhos'                                 as valor_antes,
       (select count(*) from jsonb_object_keys(settings))      as qtd_de_chaves,
       (select string_agg(k, ', ' order by k) from jsonb_object_keys(settings) as k) as chaves
  from public.organizations
 where id = '990feca9-5b39-4d29-a8de-f8cd5b77fe0d';
```

Esperado: **1 linha**, `ja_tem_aparelhos = false`, `valor_antes` vazio (null). Se vier `true` ou 0 linhas, **pare**.

## 2) GRAVAR — um comando só, url + hosts numa chave

```sql
update public.organizations
   set settings = jsonb_set(
         coalesce(settings, '{}'::jsonb),
         '{aparelhos}',
         jsonb_build_object(
           'url',   'https://aparelhos.graucell.com/aparelhos.json',
           'hosts', jsonb_build_array('aparelhos.graucell.com')
         ),
         true
       )
 where id = '990feca9-5b39-4d29-a8de-f8cd5b77fe0d'
   and not (coalesce(settings, '{}'::jsonb) ? 'aparelhos')
returning id, settings -> 'aparelhos' as valor_gravado;
```

Esperado: **exatamente 1 linha**, `valor_gravado =
{"url": "https://aparelhos.graucell.com/aparelhos.json", "hosts": ["aparelhos.graucell.com"]}`.
Se voltar 0 linhas, nada foi alterado (a chave já existia ou a organização não foi achada).

## 3) DEPOIS — só leitura (compare com o ANTES)

```sql
select id,
       settings ? 'aparelhos'                                  as ja_tem_aparelhos,
       settings -> 'aparelhos'                                 as valor_depois,
       (select count(*) from jsonb_object_keys(settings))      as qtd_de_chaves,
       (select string_agg(k, ', ' order by k) from jsonb_object_keys(settings) as k) as chaves
  from public.organizations
 where id = '990feca9-5b39-4d29-a8de-f8cd5b77fe0d';
```

Esperado: `ja_tem_aparelhos = true`; `valor_depois` com **as duas chaves** (`url` e `hosts`, e `hosts` é uma lista com
um item); `qtd_de_chaves` = a de antes **+ 1**; `chaves` = as de antes **mais `aparelhos`**, nenhuma a menos.
Qualquer diferença além disso: **desfaça** (abaixo) e avise.

## DESFAZER — remove só a chave nova

```sql
update public.organizations
   set settings = settings - 'aparelhos'
 where id = '990feca9-5b39-4d29-a8de-f8cd5b77fe0d'
   and settings ? 'aparelhos'
returning id, (select count(*) from jsonb_object_keys(settings)) as qtd_de_chaves;
```

Esperado: 1 linha, `qtd_de_chaves` igual à do ANTES. O atendimento volta a ser exatamente o de antes; a ferramenta
`crm_search_aparelhos` (que nasce desligada) passa a responder `nao_configurado` se alguém a ligar.

## O que este SQL NÃO faz

- Não liga a capacidade no agente (isso é o painel, em versão nova).
- Não altera o agente, o canal, a lista de teste, nem `JEV_*`/TypeSafe/`COTACAO_USD_BRL`.
- Não mexe em nenhuma outra organização (o `where` é por `id`).
- Não grava segredo: a URL e o host são públicos.
