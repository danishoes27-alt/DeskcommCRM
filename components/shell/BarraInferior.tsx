"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/hooks/i18n/useT";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { sidebarGroups } from "@/lib/navigation/registry";
import { cn } from "@/lib/utils";
import { CalendarBlank, ChatsCircle, Kanban, List, Users } from "@/lib/ui/icons";

/**
 * A barra de baixo do celular (r4): os quatro lugares que o lojista abre o dia
 * inteiro, mais o "Menu" que abre o resto. No computador não existe — lá o menu
 * lateral já está sempre à mostra.
 *
 * Os destinos saem do MESMO cálculo do menu (`sidebarGroups`): quem não pode ver
 * uma tela, ou não ligou o recurso, não a vê aqui também. O "Menu" não navega; ele
 * pede à gaveta do cabeçalho que abra, por um evento da janela.
 */
export const EVENTO_ABRIR_MENU = "celuzap:abrir-menu";

const DESTINOS = [
  { href: "/app/inbox", Icone: ChatsCircle },
  { href: "/app/contacts", Icone: Users },
  { href: "/app/kanban", Icone: Kanban },
  { href: "/app/agenda", Icone: CalendarBlank },
] as const;

export function BarraInferior() {
  const t = useT();
  const rotulos: Record<(typeof DESTINOS)[number]["href"], string> = {
    "/app/inbox": t("Conversas"),
    "/app/contacts": t("Clientes"),
    "/app/kanban": t("Funis de venda"),
    "/app/agenda": t("Agenda"),
  };
  const pathname = usePathname();
  const { user, activeOrg } = useAuth();
  const visiveis = new Set(
    sidebarGroups(
      user.is_platform_admin && !user.support,
      activeOrg?.role ?? null,
      activeOrg?.interface_settings,
      activeOrg?.modulos_ligados ?? [],
      activeOrg?.capacidades_ligadas ?? [],
    ).flatMap((g) => g.items.map((i) => i.href)),
  );
  const itens = DESTINOS.filter((d) => visiveis.has(d.href));

  const base =
    "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium leading-tight";
  return (
    <nav
      aria-label={t("Atalhos")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      data-testid="barra-inferior"
    >
      <ul className="flex">
        {itens.map(({ href, Icone }) => {
          const ativo = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex flex-1">
              <Link
                href={href}
                aria-current={ativo ? "page" : undefined}
                className={cn(base, ativo ? "text-accent" : "text-text-muted")}
              >
                <Icone size={24} weight={ativo ? "fill" : "regular"} aria-hidden />
                <span className="truncate">{rotulos[href]}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex flex-1">
          <button
            type="button"
            className={cn(base, "text-text-muted")}
            onClick={() => window.dispatchEvent(new Event(EVENTO_ABRIR_MENU))}
          >
            <List size={24} aria-hidden />
            <span>{t("Menu")}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
