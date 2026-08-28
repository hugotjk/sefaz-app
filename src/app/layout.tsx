import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Painel da Loja",
  description: "Notas fiscais, certificados e relatórios",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="app-shell-sidebar">
          <aside className="sidebar">
            <div className="sidebar-logo">Painel</div>
            <nav className="sidebar-nav">
              <Link href="/notas" className="sidebar-link">
                <span className="sidebar-icon">📄</span> Notas Fiscais
              </Link>
              <Link href="/certificados" className="sidebar-link">
                <span className="sidebar-icon">🔑</span> Certificados
              </Link>
              <Link href="/relatorios" className="sidebar-link">
                <span className="sidebar-icon">📊</span> Relatórios
              </Link>
            </nav>
          </aside>
          <div className="app-content">
            <main className="app-main">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
