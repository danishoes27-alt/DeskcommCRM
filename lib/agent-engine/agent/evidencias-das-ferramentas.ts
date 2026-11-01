/**
 * DO RESULTADO DE UMA FERRAMENTA PARA EVIDÊNCIA DO TURNO.
 *
 * As ferramentas de consulta que respondem "quanto custa", "tem" e "quando chega"
 * (`docs/14-spec-jev.md`, seção 8.4 risco 2 e regra L6) devolvem formas diferentes.
 * Aqui cada uma é lida UMA vez, no mesmo formato de `./evidencias-do-turno.ts`:
 *
 *  - `crm_search_products` — o catálogo da loja (origem `catalogo`): nome, código,
 *    preço exato e se está disponível;
 *  - `crm_query_external_data` — o banco de dados externo que a empresa conectou
 *    (origem `bling`: é por ele que o estoque e o preço do ERP chegam ao agente).
 *
 * ═══ DUAS REGRAS QUE NÃO SE NEGOCIAM ═══
 *
 *  1. **Consulta que NÃO aconteceu = nada registrado.** Resultado com `erro`,
 *     `permitido: false` ou formato que não reconhecemos não marca a consulta como
 *     feita: a L6 precisa distinguir "procurei e não achei" de "nem procurei".
 *  2. **Nunca lança.** Quem chama é o wrapper da ferramenta, no meio do turno de um
 *     cliente; uma exceção aqui mataria a resposta por causa de um registro.
 *
 * O texto das evidências é o que a IA leu, só que mais curto: o teto por evidência
 * evita que uma tabela larga encha a memória do turno.
 */
import type { EvidenciaParaRegistrar, EvidenciasDoTurno, OrigemDaEvidencia } from "./evidencias-do-turno";

/** Quanto de texto uma única evidência guarda (uma linha de tabela larga, por exemplo). */
export const TEXTO_DA_EVIDENCIA_NO_MAXIMO = 600;

/** A origem da evidência de cada ferramenta de consulta. Fora desta lista, nada é lido. */
export const ORIGEM_DA_FERRAMENTA: Readonly<Record<string, OrigemDaEvidencia>> = {
  crm_search_products: "catalogo",
  crm_query_external_data: "bling",
};

const registro = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function aparar(texto: string): string {
  return texto.length <= TEXTO_DA_EVIDENCIA_NO_MAXIMO ? texto : `${texto.slice(0, TEXTO_DA_EVIDENCIA_NO_MAXIMO)}…`;
}

function valorEmTexto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

function doCatalogo(resultado: Record<string, unknown>): EvidenciaParaRegistrar[] | null {
  if (!Array.isArray(resultado.produtos)) return null;
  const itens: EvidenciaParaRegistrar[] = [];
  for (const p of resultado.produtos) {
    if (!registro(p)) continue;
    const nome = valorEmTexto(p.nome);
    if (nome === "") continue;
    const partes = [nome];
    if (valorEmTexto(p.codigo) !== "") partes.push(`código ${valorEmTexto(p.codigo)}`);
    if (valorEmTexto(p.preco) !== "") partes.push(`preço ${valorEmTexto(p.preco)}`);
    if (valorEmTexto(p.marca) !== "") partes.push(`marca ${valorEmTexto(p.marca)}`);
    if (typeof p.disponivel === "boolean") partes.push(p.disponivel ? "disponível" : "sem estoque");
    itens.push({ fonte: nome, texto: aparar(partes.join(" — ")) });
  }
  // "Existe no catálogo, mas sem estoque" volta como lista vazia com motivo: é a
  // fonte de quem diz "está sem estoque", e some se não for guardada.
  if (resultado.motivo === "sem_estoque" && typeof resultado.mensagem === "string") {
    itens.push({ fonte: "catálogo (sem estoque)", texto: aparar(resultado.mensagem) });
  }
  return itens;
}

function doBancoExterno(resultado: Record<string, unknown>): EvidenciaParaRegistrar[] | null {
  if (!Array.isArray(resultado.linhas)) return null;
  const tabela = valorEmTexto(resultado.tabela);
  const itens: EvidenciaParaRegistrar[] = [];
  for (const linha of resultado.linhas) {
    if (!registro(linha)) continue;
    const campos = Object.entries(linha)
      .map(([coluna, valor]) => [coluna, valorEmTexto(valor)] as const)
      .filter(([, valor]) => valor !== "")
      .map(([coluna, valor]) => `${coluna}: ${valor}`);
    if (campos.length === 0) continue;
    itens.push({ fonte: tabela === "" ? null : tabela, texto: aparar(campos.join("; ")) });
  }
  return itens;
}

/**
 * Lê o resultado de uma ferramenta e o registra nas evidências do turno. Devolve
 * `true` quando a consulta foi reconhecida como feita (com ou sem resultado).
 * `organizationId` é a empresa em nome de quem a ferramenta rodou — a mesma do
 * turno; diferente dela, o registro é descartado por `EvidenciasDoTurno`.
 */
export function registrarEvidenciaDaFerramenta(
  evidencias: EvidenciasDoTurno,
  ferramenta: string,
  resultado: unknown,
  organizationId: string,
): boolean {
  try {
    const origem = ORIGEM_DA_FERRAMENTA[ferramenta];
    if (origem === undefined || !registro(resultado)) return false;
    if (organizationId !== evidencias.organizationId) return false;
    if (typeof resultado.erro === "string" || typeof resultado.error === "string") return false;
    if (resultado.permitido === false) return false;
    const itens = origem === "catalogo" ? doCatalogo(resultado) : doBancoExterno(resultado);
    if (itens === null) return false;
    evidencias.registrar(origem, itens, organizationId);
    return evidencias.consultou(origem);
  } catch {
    return false;
  }
}

/**
 * Envolve a ferramenta para que o que ela devolve vire evidência do turno, SEM
 * alterar o resultado que segue para o modelo. Ferramenta fora de
 * `ORIGEM_DA_FERRAMENTA`, ou sem `execute`, volta como veio.
 */
export function comEvidenciaDoTurno<T extends { execute?: (...args: never[]) => unknown }>(
  ferramenta: T,
  nome: string,
  evidencias: EvidenciasDoTurno,
  organizationId: string,
): T {
  if (!(nome in ORIGEM_DA_FERRAMENTA) || typeof ferramenta.execute !== "function") return ferramenta;
  const original = ferramenta.execute.bind(ferramenta) as (...args: unknown[]) => unknown;
  return {
    ...ferramenta,
    execute: async (...args: unknown[]) => {
      const resultado = await original(...args);
      registrarEvidenciaDaFerramenta(evidencias, nome, resultado, organizationId);
      return resultado;
    },
  } as T;
}
