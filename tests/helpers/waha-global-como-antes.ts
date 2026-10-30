/**
 * "UM WAHA POR INSTALAÇÃO" — o comportamento de antes, para os testes que não são sobre ele.
 *
 * O app agora pergunta a `lib/channels/waha-endpoint-app` com qual WAHA cada canal fala (o do canal, ou
 * o global). Muitos testes antigos só querem um transporte de mentira no caminho — o corpo deles é
 * sobre arquivar, enviar, pareamento, mídia — e já modelam o transporte por `getWahaClient()`
 * (`@/lib/waha/client`) ou pelas variáveis `WAHA_API_*`. Estes substitutos devolvem, para QUALQUER
 * canal, exatamente isso: o cliente que `getWahaClient()` entregar e o endereço do ambiente.
 *
 * Uso, no topo do arquivo de teste:
 *   vi.mock("@/lib/channels/waha-endpoint-app", () => import("@/tests/helpers/waha-global-como-antes"));
 *
 * Quem testa a ESCOLHA do WAHA por canal não usa isto: `lib/channels/waha-endpoint.test.ts` e
 * `tests/unit/waha-por-canal-nas-rotas.test.ts`.
 */
import { enderecoDoAmbiente, type EnderecoDoWaha } from "@/lib/channels/waha-endpoint";
import { getWahaClient, type WahaClient } from "@/lib/waha/client";

const ENDERECO_DE_TESTE: EnderecoDoWaha = { baseUrl: "http://waha.teste:3000", apiKey: "chave-de-teste", origem: "ambiente" };

// Sempre devolve um endereço: os testes que chegam aqui (mídia, por exemplo) simulam a camada de baixo
// (`fetchWahaMedia`) e não configuram o ambiente. Quem testa "sem WAHA" usa `clienteDoWahaDaSessao`.
export async function enderecoDoWahaDaSessao(_sessionRef: string): Promise<EnderecoDoWaha | null> {
  return enderecoDoAmbiente() ?? ENDERECO_DE_TESTE;
}

export async function clienteDoWahaDaSessao(_sessionRef: string): Promise<WahaClient | null> {
  return getWahaClient();
}

export async function wahaDaOrganizacao(_organizationId: string) {
  const client = getWahaClient();
  return client ? { endereco: enderecoDoAmbiente() ?? ENDERECO_DE_TESTE, colunas: null } : null;
}

export async function wahaDoCanalParaRota(_sessionRef: string) {
  const client = getWahaClient();
  if (!client) return { ok: false as const, motivo: "nao_configurado" as const };
  return { ok: true as const, valor: { client, endereco: enderecoDoAmbiente() ?? ENDERECO_DE_TESTE } };
}

export async function wahaDaOrganizacaoParaRota(_organizationId: string) {
  const client = getWahaClient();
  if (!client) return { ok: false as const, motivo: "nao_configurado" as const };
  return { ok: true as const, valor: { client, endereco: enderecoDoAmbiente() ?? ENDERECO_DE_TESTE, colunas: null } };
}
