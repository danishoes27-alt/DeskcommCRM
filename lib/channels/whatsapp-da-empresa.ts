import { wahaDaOrganizacaoParaRota } from "./waha-endpoint-app";

/**
 * A empresa tem WhatsApp pronto para conectar número (o dela, cadastrado pelo operador, ou o global do modo
 * compartilhado)? Resposta de sim/não para quem só precisa dizer isso na tela (o checklist de boas-vindas); erro de
 * leitura é "não" — a tela fala em "preparando", não em defeito.
 *
 * Mora num arquivo de nome neutro para as telas poderem perguntar sem nomear o provedor.
 */
export async function empresaTemWhatsappPronto(organizationId: string): Promise<boolean> {
  return wahaDaOrganizacaoParaRota(organizationId)
    .then((r) => r.ok)
    .catch(() => false);
}
