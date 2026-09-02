"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Um item do menu lateral. `submenu` é opcional — quando presente, o item
 *  abre um flyout lateral com os subitens ao passar o mouse / focar. */
export interface NavItem {
  nome: string;
  icone: string;
  href: string;
  submenu?: { nome: string; href: string }[];
}

// Estrutura de dados do menu. Nenhum item usa `submenu` ainda, mas o
// componente já sabe renderizar o flyout quando for adicionado.
const ITENS: NavItem[] = [
  { nome: "Notas Fiscais", icone: "📄", href: "/notas" },
  { nome: "Certificados", icone: "🔑", href: "/certificados" },
  { nome: "Relatórios", icone: "📊", href: "/relatorios" },
];

function estaAtivo(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function SidebarNav() {
  const pathname = usePathname() || "";

  return (
    <nav className="sidebar-nav">
      {ITENS.map((item) => {
        const ativo = estaAtivo(pathname, item.href);
        const temSubmenu = !!item.submenu?.length;

        return (
          <div
            key={item.href}
            className={`sidebar-item${temSubmenu ? " tem-submenu" : ""}`}
          >
            <Link
              href={item.href}
              className={`sidebar-link${ativo ? " ativo" : ""}`}
              aria-label={item.nome}
              aria-current={ativo ? "page" : undefined}
            >
              <span className="sidebar-icon" aria-hidden>
                {item.icone}
              </span>
            </Link>

            {/* balão com o nome da tela ao passar o mouse */}
            <span className="sidebar-tooltip" role="tooltip">
              {item.nome}
            </span>

            {temSubmenu && (
              <div className="sidebar-flyout">
                <div className="sidebar-flyout-titulo">{item.nome}</div>
                {item.submenu!.map((sub) => (
                  <Link
                    key={sub.href}
                    href={sub.href}
                    className={estaAtivo(pathname, sub.href) ? "ativo" : ""}
                  >
                    {sub.nome}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
