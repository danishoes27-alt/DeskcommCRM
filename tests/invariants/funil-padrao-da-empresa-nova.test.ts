import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * A EMPRESA NOVA NASCE COM O FUNIL "VENDA" (migration 9002).
 *
 * O gatilho `trg_seed_default_pipeline_for_org` semeava o "Pedidos" de e-commerce. Agora semeia
 * "Venda", com as sete etapas de balcão, SEM destinos do agente (a regra do invariante 0156 continua: quem
 * ensina o assistente a percorrer o quadro é o passo "funil" do onboarding).
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`,
  max: 2,
});
const ORG = "ada57e00-0000-4000-8000-000000009002";

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-funil-venda', 'Funil Venda', 'Funil Venda') on conflict (id) do nothing`,
    [ORG],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("o funil que nasce com a empresa", () => {
  it("é um só, chama-se Venda e é o padrão", async () => {
    const { rows } = await pool.query(
      "select name, slug, is_default from crm_pipelines where organization_id = $1",
      [ORG],
    );
    expect(rows).toEqual([{ name: "Venda", slug: "venda", is_default: true }]);
  });

  it("tem as sete etapas de balcão, em ordem, sem destino do agente", async () => {
    const { rows } = await pool.query(
      `select s.name, s.agent_stage_hint as hint, s.is_won, s.is_lost
         from crm_stages s join crm_pipelines p on p.id = s.pipeline_id
        where s.organization_id = $1 order by s.position`,
      [ORG],
    );
    expect(rows.map((r) => r.name)).toEqual([
      "Novo contato",
      "Já respondi",
      "Escolhendo o aparelho",
      "Vai levar",
      "Combinando o pagamento",
      "Venda fechada",
      "Não comprou",
    ]);
    expect(rows.every((r) => r.hint === null)).toBe(true);
    expect(rows.filter((r) => r.is_won).map((r) => r.name)).toEqual(["Venda fechada"]);
    expect(rows.filter((r) => r.is_lost).map((r) => r.name)).toEqual(["Não comprou"]);
  });
});
