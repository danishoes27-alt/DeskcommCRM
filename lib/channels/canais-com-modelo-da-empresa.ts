import type { SupabaseClient } from "@supabase/supabase-js";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "./archived";
import { CHANNEL_PROVIDER_META, CHANNEL_PROVIDER_ZERNIO, transportaMensagem, usaModeloAprovado } from "./capabilities";

/**
 * O que esta empresa tem de verdade em canais que usam modelo aprovado.
 *
 * É o que decide o que a tela mostra: uma empresa que só conecta número por QR não tem o que fazer nas abas do
 * canal oficial nem nos textos de "janela de 24 horas", e uma tela que leva a um formulário sem sentido para ela
 * parece quebrada aos olhos de quem vende. A tela pergunta aqui em vez de nomear o provedor.
 */
export interface CanaisComModeloDaEmpresa {
  /** Tem um canal oficial (com modelos da Meta) ativo. */
  oficial: boolean;
  /** Tem um canal de provedor parceiro ativo. */
  parceiro: boolean;
  /** Algum canal ativo só manda texto livre dentro da janela de 24 horas, ou seja, exige modelo fora dela. */
  exigeModelo: boolean;
}

/** Não conseguir saber NÃO esconde nada: a empresa que já usa o canal não pode perder a aba por um erro de leitura. */
const MOSTRAR_TUDO: CanaisComModeloDaEmpresa = { oficial: true, parceiro: true, exigeModelo: true };

export async function canaisComModeloDaEmpresa(
  db: SupabaseClient,
  organizationId: string,
): Promise<CanaisComModeloDaEmpresa> {
  const base = () => db.from("channel_sessions").select("provider").eq("organization_id", organizationId);

  const { data, error } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null),
    () => base(),
  );
  if (error) return MOSTRAR_TUDO;

  const providers = new Set(((data ?? []) as Array<{ provider: string }>).map((l) => l.provider));
  return {
    oficial: providers.has(CHANNEL_PROVIDER_META),
    parceiro: providers.has(CHANNEL_PROVIDER_ZERNIO),
    // `transportaMensagem` primeiro: a linha de chamada de voz mora na mesma tabela e não está na matriz.
    exigeModelo: [...providers].some((p) => transportaMensagem(p) && usaModeloAprovado(p)),
  };
}
