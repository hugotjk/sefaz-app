import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Notas SEFAZ",
  description: "Painel de notas fiscais recebidas via SEFAZ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="app-shell">
          <header className="app-header">
            <a href="/" className="app-logo">📄 Notas SEFAZ</a>
            <nav>
              <a href="/">Notas</a>
              <a href="/certificados">Certificados</a>
            </nav>
          </header>
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
