"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ABAS = [
  { nome: "Devolução", href: "/emissor-nfe/devolucao", pronto: true },
  { nome: "Notas emitidas", href: "/emissor-nfe/notas", pronto: false },
  { nome: "Lojas e certificados", href: "/emissor-nfe/lojas", pronto: true },
];

export default function EmissorLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  return (
    <div>
      <h1>Emissor de NF-e</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
        {ABAS.map((a) =>
          a.pronto ? (
            <Link
              key={a.href}
              href={a.href}
              style={{
                padding: "8px 14px",
                textDecoration: "none",
                color: pathname.startsWith(a.href) ? "var(--accent)" : "var(--text-dim)",
                borderBottom: pathname.startsWith(a.href) ? "2px solid var(--accent)" : "2px solid transparent",
              }}
            >
              {a.nome}
            </Link>
          ) : (
            <span key={a.href} title="Em breve" style={{ padding: "8px 14px", color: "var(--text-dim)", opacity: 0.45 }}>
              {a.nome}
            </span>
          )
        )}
      </div>
      {children}
    </div>
  );
}
