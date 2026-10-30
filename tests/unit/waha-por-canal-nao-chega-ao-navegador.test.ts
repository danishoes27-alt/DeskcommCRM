/**
 * O endereço e a chave do WhatsApp de cada empresa NUNCA chegam ao navegador do lojista.
 *
 * O banco já guarda a chave CIFRADA e só o service_role a decifra (ver `tests/invariants/waha-por-canal-colunas-do-canal`),
 * mas o ENDEREÇO é texto e a linha do canal é legível pela própria empresa. O que o protege é que nenhuma rota
 * devolve essas colunas e nenhum código de tela as nomeia. Este arquivo prende as duas pontas:
 *
 *   1. a lista de colunas da rota que devolve os canais ao navegador não tem as colunas sensíveis;
 *   2. nenhuma consulta de tela/rota pede `select("*")` em `channel_sessions` (o `*` traria a coluna nova junto, em
 *      silêncio, no dia em que ela existisse);
 *   3. o código que roda no navegador (hooks, componentes, clientes de página) não cita nenhuma delas.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { CHANNEL_COLUMNS } from "@/app/api/v1/channel-sessions/route";

const SENSIVEIS = ["waha_base_url", "waha_api_key_encrypted", "webhook_secret_encrypted"] as const;

function arquivos(diretorios: string[], filtro: (f: string) => boolean): string[] {
  return execFileSync("git", ["ls-files", ...diretorios], { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && filtro(f));
}

const ler = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

describe("o que a rota de canais devolve ao navegador", () => {
  it("a lista de colunas não tem endereço nem chave do WhatsApp da empresa", () => {
    const colunas = CHANNEL_COLUMNS.split(",").map((c) => c.trim());
    for (const sensivel of SENSIVEIS) expect(colunas, sensivel).not.toContain(sensivel);
  });
});

/** A fonte tem uma consulta a `channel_sessions` que pede todas as colunas (a contagem com `head: true` não conta). */
function pedeTudoDeChannelSessions(fonte: string): boolean {
  for (const m of fonte.matchAll(/from\(\s*["']channel_sessions["']\s*\)([\s\S]*?);/g)) {
    const consulta = m[1] ?? "";
    const pedeTudo = /\.select\(\s*["'`]\*["'`]\s*(,\s*\{([^}]*)\})?\s*\)/.exec(consulta);
    if (pedeTudo && !/head:\s*true/.test(pedeTudo[2] ?? "")) return true;
  }
  return false;
}

describe("nenhuma consulta de tela pede tudo de `channel_sessions`", () => {
  it("CONTROLE: o varredor reconhece o defeito e aceita a contagem e a lista explícita", () => {
    expect(pedeTudoDeChannelSessions('const r = await db.from("channel_sessions").select("*").eq("id", id);')).toBe(true);
    expect(pedeTudoDeChannelSessions("await db\n  .from('channel_sessions')\n  .select('*');")).toBe(true);
    expect(
      pedeTudoDeChannelSessions('await db.from("channel_sessions").select("*", { count: "exact", head: true });'),
    ).toBe(false);
    expect(pedeTudoDeChannelSessions('await db.from("channel_sessions").select("id, status").eq("id", id);')).toBe(false);
    expect(pedeTudoDeChannelSessions('await db.from("contacts").select("*");')).toBe(false);
  });

  it("o varredor realmente lê consultas a `channel_sessions` (um conjunto vazio passaria sempre)", () => {
    const lidas = arquivos(["app", "components", "hooks"], () => true).filter((f) =>
      /from\(\s*["']channel_sessions["']\s*\)/.test(ler(f)),
    );
    expect(lidas.length).toBeGreaterThan(3);
  });

  it('sem `select("*")` na tabela em nenhuma rota, página ou componente', () => {
    const culpados = arquivos(["app", "components", "hooks"], () => true).filter((f) => pedeTudoDeChannelSessions(ler(f)));
    expect(culpados, `\n${culpados.join("\n")}\n`).toEqual([]);
  });
});

describe("o código do navegador não conhece as colunas sensíveis", () => {
  it("hooks, componentes e clientes de página não citam nenhuma delas", () => {
    const citam: string[] = [];
    const doNavegador = arquivos(["hooks", "components", "app"], (f) => {
      if (f.startsWith("hooks/") || f.startsWith("components/")) return true;
      // em app/, só o que roda no navegador: clientes de página e componentes de página
      return /(^|\/)_client\.tsx$|\/_components\//.test(f) || /^app\/.*\/_[a-z-]+\.tsx$/.test(f);
    });
    for (const f of doNavegador) {
      const fonte = ler(f);
      for (const sensivel of SENSIVEIS) if (fonte.includes(sensivel)) citam.push(`${f}: ${sensivel}`);
    }
    expect(citam, `\n${citam.join("\n")}\n`).toEqual([]);
  });
});
