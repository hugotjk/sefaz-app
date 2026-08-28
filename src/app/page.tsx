import Link from "next/link";
import { prisma } from "@/lib/db";

function formatarMoeda(valor: any) {
  const n = Number(valor ?? 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarData(data: Date | null) {
  if (!data) return "-";
  return new Date(data).toLocaleDateString("pt-BR");
}

function badgeClasse(status: string) {
  if (status === "CANCELADA") return "badge badge-cancelada";
  if (status === "DENEGADA") return "badge badge-denegada";
  return "badge badge-autorizada";
}

export default async function DashboardPage() {
  const notas = await prisma.note.findMany({
    orderBy: { dataEmissao: "desc" },
    take: 100,
    include: { _count: { select: { eventos: true } } },
  });

  return (
    <div>
      <h1>Notas recebidas</h1>
      <div className="card">
        {notas.length === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>
            Nenhuma nota ainda. Cadastre um certificado na aba "Certificados" para começar a
            sincronizar.
          </p>
        ) : (
          <table className="notes-table">
            <thead>
              <tr>
                <th>Emitente</th>
                <th>Número/Série</th>
                <th>Emissão</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Eventos</th>
              </tr>
            </thead>
            <tbody>
              {notas.map((nota) => (
                <tr key={nota.id}>
                  <td>
                    <Link href={`/nota/${nota.chaveAcesso}`} style={{ color: "inherit", textDecoration: "none" }}>
                      {nota.emitenteNome || nota.emitenteCnpj}
                    </Link>
                  </td>
                  <td>{nota.numero}/{nota.serie}</td>
                  <td>{formatarData(nota.dataEmissao)}</td>
                  <td>{formatarMoeda(nota.valorTotal)}</td>
                  <td><span className={badgeClasse(nota.status)}>{nota.status}</span></td>
                  <td>{nota._count.eventos > 0 ? `${nota._count.eventos} evento(s)` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
