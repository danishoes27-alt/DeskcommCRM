/**
 * O resolvedor "canal -> WAHA" para o APP (rotas, adaptador, webhook): a fonte é o admin client
 * do Supabase. O núcleo e a regra moram em `./waha-endpoint`; o worker usa `fonteViaPg`.
 *
 * Separado do núcleo para o núcleo não puxar `@/lib/supabase/admin` (e, com ele, a validação do
 * ambiente) quando só se quer testar a regra.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { WahaClient } from "@/lib/waha/client";
import { fonteDaOrganizacaoViaSupabase, fonteViaSupabase } from "@/lib/waha/fonte-do-endereco";

import {
  clienteDoWaha,
  resolverEnderecoDoWaha,
  resolverWahaDaOrganizacao,
  WahaDoCanalError,
  type CodigoDeFalhaDoWaha,
  type EnderecoDoWaha,
  type WahaDaOrganizacao,
} from "./waha-endpoint";

/**
 * Com quem este canal fala. `null` = nenhum WAHA configurado para ele (nem o do canal, nem o
 * global). LANÇA `WahaDoCanalError` se o canal TEM cadastro próprio e ele está quebrado.
 */
export async function enderecoDoWahaDaSessao(sessionRef: string): Promise<EnderecoDoWaha | null> {
  return resolverEnderecoDoWaha(fonteViaSupabase(createAdminClient()), sessionRef);
}

/** O cliente HTTP do WAHA deste canal. Mesmas regras de `enderecoDoWahaDaSessao`. */
export async function clienteDoWahaDaSessao(sessionRef: string): Promise<WahaClient | null> {
  const endereco = await enderecoDoWahaDaSessao(sessionRef);
  return endereco ? clienteDoWaha(endereco) : null;
}

/**
 * O WAHA da EMPRESA: o canal novo herda o do canal mais recente que tem endereço próprio; sem
 * nenhum, o global. `null` = a empresa ainda não tem WhatsApp cadastrado. LANÇA `WahaDoCanalError`
 * se o cadastro existente está quebrado.
 */
export async function wahaDaOrganizacao(organizationId: string): Promise<WahaDaOrganizacao | null> {
  return resolverWahaDaOrganizacao(fonteDaOrganizacaoViaSupabase(createAdminClient()), organizationId);
}

/** O desfecho de "achar o WAHA" em forma de dado, para a rota responder sem try/catch espalhado. */
export type WahaParaRota<T> =
  | { ok: true; valor: T }
  | { ok: false; motivo: "nao_configurado" }
  | { ok: false; motivo: "cadastro_quebrado"; code: CodigoDeFalhaDoWaha };

async function paraRota<T>(achar: () => Promise<T | null>): Promise<WahaParaRota<T>> {
  try {
    const valor = await achar();
    return valor === null ? { ok: false, motivo: "nao_configurado" } : { ok: true, valor };
  } catch (err) {
    if (err instanceof WahaDoCanalError) return { ok: false, motivo: "cadastro_quebrado", code: err.code };
    throw err;
  }
}

/** O cliente do WAHA deste canal, para a rota que precisa falar com ele. */
export function wahaDoCanalParaRota(sessionRef: string): Promise<WahaParaRota<{ client: WahaClient; endereco: EnderecoDoWaha }>> {
  return paraRota(async () => {
    const endereco = await enderecoDoWahaDaSessao(sessionRef);
    return endereco ? { client: clienteDoWaha(endereco), endereco } : null;
  });
}

/** O WAHA da empresa (para conectar um número novo), em forma de dado. */
export function wahaDaOrganizacaoParaRota(
  organizationId: string,
): Promise<WahaParaRota<WahaDaOrganizacao & { client: WahaClient }>> {
  return paraRota(async () => {
    const achado = await wahaDaOrganizacao(organizationId);
    return achado ? { ...achado, client: clienteDoWaha(achado.endereco) } : null;
  });
}
