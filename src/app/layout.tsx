import type { Metadata } from "next";
import "./globals.css";
import { SidebarNav } from "@/components/SidebarNav";

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
            <div className="sidebar-logo" aria-hidden>
              P
            </div>
            <SidebarNav />
          </aside>
          <div className="app-content">
            <main className="app-main">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
