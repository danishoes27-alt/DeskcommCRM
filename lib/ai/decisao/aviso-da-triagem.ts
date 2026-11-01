/**
 * O AVISO NA CENTRAL QUANDO A TRIAGEM DIZ "EQUIPE" — certeza ALTA, e só um aviso
 * (`docs/14-spec-jev.md`, seção 3.2, D5 e ambiguidade 2; T20).
 *
 * Com confiança ALTA de que o destino é `equipe`, a Central ganha um aviso para alguém da
 * equipe olhar a conversa. **Não abre caso, não passa a conversa, não muda de dono**: a IA
 * segue atendendo e o aviso é só um aviso. `aviso-de-escalacao.ts` continua sendo apenas o
 * aviso AO CLIENTE e não é tocado.
 *
 * Mecanismo que a Central já tem, sem migração (`agent_inbox_items`): `kind = 'other'`, o
 * TÍTULO FIXO como chave (o mesmo desenho de `./aviso.ts`) e a referência à conversa
 * (`ref_kind = 'conversation'`), que leva o botão "Abrir conversa" (`lib/ai/inbox-destino.ts`).
 * Um aviso ABERTO por conversa: o segundo "equipe" da mesma conversa, enquanto o primeiro
 * está aberto, não abre outro. Resolvido o aviso, uma nova certeza abre um novo.
 *
 * O texto não repete o que o cliente escreveu: a Central é lida pela organização inteira, e a
 * conversa só por quem a enxerga. Sai no idioma da organização. Nunca lança.
 */
import type pg from "pg";

import { IDIOMAS, normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";

export const AVISO_DA_EQUIPE = {
  titulo: "O Jev acha que esta conversa precisa da equipe",
  corpo:
    "O Jev leu a mensagem do cliente e tem certeza de que ela precisa de uma pessoa da equipe. A IA continua atendendo e o Jev não passou a conversa: abra a conversa e decida se alguém assume.",
} as const;

/** O título em todo idioma visível: a busca do aviso aberto casa qualquer um. */
export const TITULOS_DO_AVISO_DA_EQUIPE = [...new Set(IDIOMAS.map((i) => traduzir(AVISO_DA_EQUIPE.titulo, i)))];

export type DesfechoDoAvisoDaEquipe = "aberto" | "ja_havia" | "falhou";

export async function avisarQueEPraEquipe(
  pool: pg.Pool,
  a: { organizationId: string; conversationId: string },
): Promise<DesfechoDoAvisoDaEquipe> {
  try {
    const { rows: org } = await pool.query<{ locale: string | null }>(
      "select locale from public.organizations where id = $1",
      [a.organizationId],
    );
    const idioma = normalizarIdioma(org[0]?.locale);
    const { rowCount } = await pool.query(
      `insert into public.agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
       select $1::uuid, 'other', 'warn', $2::text, $3::text, 'conversation', $4::uuid
        where not exists (
          select 1 from public.agent_inbox_items i
           where i.organization_id = $1::uuid and i.kind = 'other' and i.status = 'open'
             and i.ref_kind = 'conversation' and i.ref_id = $4::uuid and i.title = any($5::text[])
        )`,
      [
        a.organizationId,
        traduzir(AVISO_DA_EQUIPE.titulo, idioma),
        traduzir(AVISO_DA_EQUIPE.corpo, idioma),
        a.conversationId,
        TITULOS_DO_AVISO_DA_EQUIPE,
      ],
    );
    return (rowCount ?? 0) > 0 ? "aberto" : "ja_havia";
  } catch (erro) {
    logger.warn("aviso da triagem na Central não foi gravado", {
      organization_id: a.organizationId,
      erro: erro instanceof Error ? erro.message.slice(0, 200) : typeof erro,
    });
    return "falhou";
  }
}
