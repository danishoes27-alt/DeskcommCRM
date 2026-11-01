/**
 * "JEV FORA DO AR" — o que o cartão do Jev mostra quando ele parou de responder
 * (r3, `docs/14-spec-jev.md`, seções 4.1 e 4.2: "a aba Status mostra 'Jev fora do ar'").
 *
 * É a falha que o Jev ainda não superou, de QUALQUER tarefa, dos últimos
 * `JANELA_DA_QUEDA_MS` e de um motivo que é da CONTA ou do FORNECEDOR: a chave recusada, o
 * crédito esgotado, o limite de taxa, a sobrecarga ou a demora. `contrato_invalido` e
 * `resposta_ilegivel` são defeito nosso e seguem como "Última falha".
 *
 * O disjuntor mora em memória do agent-worker, e o cartão é servido pelo Next — outro
 * processo. Por isso a queda é derivada das linhas de erro em `llm_calls`: a mesma prova,
 * que sobrevive a reinício e que a tela de Execuções já mostra. Fica num módulo próprio
 * porque um arquivo de rota do Next só pode exportar os verbos HTTP.
 */
export const JANELA_DA_QUEDA_MS = 30 * 60 * 1000;

export const MOTIVOS_DE_QUEDA: ReadonlySet<string> = new Set([
  "jev_credencial_invalida",
  "jev_sem_credito",
  "jev_limite_de_taxa",
  "jev_provedor_sobrecarregado",
  "jev_provedor_indisponivel",
]);

export function foraDoAr(
  falha: { motivo: string | null; em: string } | null,
  agora: number = Date.now(),
): { desde: string; motivo: string } | null {
  if (falha === null || falha.motivo === null || !MOTIVOS_DE_QUEDA.has(falha.motivo)) return null;
  const idade = agora - Date.parse(falha.em);
  return idade <= JANELA_DA_QUEDA_MS ? { desde: falha.em, motivo: falha.motivo } : null;
}
