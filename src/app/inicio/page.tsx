import Link from "next/link";
import { prisma } from "@/lib/db";
import { TAMANHO_MINIMO_XML_COMPLETO } from "@/lib/nota-xml-status";

export const dynamic = "force-dynamic";

async function contar(fn: () => Promise<number>): Promise<number | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export default async function InicioPage() {
  const [aguardandoXml, certVencendo, lojasAtivas] = await Promise.all([
    contar(async () => {
      const r = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "Note" WHERE length("xmlCompleto") <= ${TAMANHO_MINIMO_XML_COMPLETO}`;
      return Number(r[0].n);
    }),
    contar(() =>
      prisma.certificate.count({ where: { validUntil: { lte: new Date(Date.now() + 30 * 86400000) } } })
    ),
    contar(() => prisma.lojaCadastro.count({ where: { ativa: true } })),
  ]);

  const cartoes: { href: string; titulo: string; numero: number | null; texto: string; tom?: "warn" | "ok" }[] = [
    { href: "/notas", titulo: "Notas Faturadas", numero: aguardandoXml, texto: "notas ainda sem o XML completo", tom: "warn" },
    { href: "/relatorios", titulo: "Relatórios", numero: null, texto: "Conferência de MKP, prazos, produtos e itens" },
    { href: "/documentacoes", titulo: "Documentações", numero: lojasAtivas, texto: "lojas ativas cadastradas" },
    { href: "/certificados", titulo: "Certificados", numero: certVencendo, texto: "vencidos ou vencendo em 30 dias", tom: "warn" },
  ];

  return (
    <div>
      <h1 style={{ marginBottom: 6 }}>Início</h1>
      <p style={{ color: "var(--text-dim)", marginTop: 0, marginBottom: 20 }}>Os assuntos do app e o que merece atenção.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
        {cartoes.map((c) => (
          <Link key={c.href} href={c.href} className="card" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>{c.titulo}</h2>
            {c.numero != null ? (
              <>
                <span style={{ display: "block", fontSize: 30, fontWeight: 600, lineHeight: 1.15, margin: "8px 0 2px", fontVariantNumeric: "tabular-nums", color: c.tom === "warn" && c.numero > 0 ? "var(--yellow)" : "var(--text)" }}>
                  {c.numero}
                </span>
                <span style={{ color: "var(--text-dim)", fontSize: 13 }}>{c.texto}</span>
              </>
            ) : (
              <span style={{ color: "var(--text-dim)", fontSize: 13 }}>{c.texto}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
