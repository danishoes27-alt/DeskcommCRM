/**
 * As fontes do resolvedor "canal -> WAHA" para o APP: o admin client do Supabase lê a linha do canal e
 * decifra a chave pela RPC (só service_role). O núcleo e a regra moram em
 * `@/lib/channels/waha-endpoint`; o worker usa `fonteViaPg`, lá mesmo.
 *
 * Mora em `lib/waha/` porque a consulta é por `waha_session_name`, que é UNIQUE na instalação
 * (`channel_sessions_waha_session_name_unique`): resolução exata por construção. A varredura
 * `tests/unit/canal-consulta-por-organizacao.test.ts` existe para identificadores de OUTROS provedores,
 * que não são únicos (issue #236), e só olha `lib/channels/`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  colunaDoWahaAusente,
  registroDoWahaNasConfiguracoes,
  type FonteDoWahaDaOrganizacao,
  type FonteDoWahaDoCanal,
  type LinhaDoWahaDoCanal,
} from "@/lib/channels/waha-endpoint";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

/** App (Next): lê pelo nome da sessão e decifra pela RPC do admin client. */
export function fonteViaSupabase(admin: SupabaseClient): FonteDoWahaDoCanal {
  return {
    async porSessionRef(sessionRef) {
      const { data, error } = await admin
        .from("channel_sessions")
        .select("waha_base_url, waha_api_key_encrypted")
        .eq("waha_session_name", sessionRef)
        .maybeSingle();
      // Banco que ainda não recebeu a migration 9001 (a imagem nova subiu antes): o canal não pode ter cadastro próprio,
      // então vale o WAHA global — exatamente o que a imagem anterior faria. Qualquer outro erro continua sendo erro.
      if (colunaDoWahaAusente(error)) return null;
      if (error) throw new Error("consulta_falhou");
      return (data as LinhaDoWahaDoCanal | null) ?? null;
    },
    decifrar: (cifra) => decryptWebhookSecret(admin, cifra),
  };
}

/** App (Next): o cadastro da empresa e, na falta dele, o canal mais recente com endereço próprio. */
export function fonteDaOrganizacaoViaSupabase(admin: SupabaseClient): FonteDoWahaDaOrganizacao {
  return {
    async registroDaEmpresa(organizationId) {
      const { data, error } = await admin.from("organizations").select("settings").eq("id", organizationId).maybeSingle();
      if (error) throw new Error("consulta_falhou");
      return registroDoWahaNasConfiguracoes((data as { settings?: unknown } | null)?.settings);
    },
    async canalMaisRecenteComEndereco(organizationId) {
      const { data, error } = await admin
        .from("channel_sessions")
        .select("waha_base_url, waha_api_key_encrypted")
        .eq("organization_id", organizationId)
        .not("waha_base_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (colunaDoWahaAusente(error)) return null; // banco sem a migration 9001: nenhum canal tem endereço próprio
      if (error) throw new Error("consulta_falhou");
      return (data as LinhaDoWahaDoCanal | null) ?? null;
    },
    decifrar: (cifra) => decryptWebhookSecret(admin, cifra),
  };
}
