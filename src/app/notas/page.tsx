import { prisma } from "@/lib/db";
import { NotasTable } from "@/components/NotasTable";
import type { Prisma } from "@prisma/client";

// Não pré-renderizar no build: essa página consulta o banco a cada request.
export const dynamic = "force-dynamic";

type NotaComRelacoes = Prisma.NoteGetPayload<{
  include: {
    _count: { select: { eventos: true } };
    certificate: { select: { razaoSocial: true; cnpj: true } };
  };
}>;

export default async function NotasPage() {
  const notas = await prisma.note.findMany({
    orderBy: { dataEmissao: "desc" },
    take: 200,
    include: {
      _count: { select: { eventos: true } },
      certificate: { select: { razaoSocial: true, cnpj: true } },
    },
  });

  const linhas = notas.map((nota: NotaComRelacoes) => ({
    chaveAcesso: nota.chaveAcesso,
    numero: nota.numero,
    dataEmissao: nota.dataEmissao ? nota.dataEmissao.toISOString() : null,
    tipoOperacao: nota.tipoOperacao,
    valorTotal: nota.valorTotal?.toString() ?? "0",
    emitenteNome: nota.emitenteNome,
    emitenteCnpj: nota.emitenteCnpj,
    destinatarioNome: nota.certificate.razaoSocial || nota.certificate.cnpj,
    status: nota.status,
    qtdEventos: nota._count.eventos,
  }));

  return (
    <div>
      <h1>Notas recebidas</h1>
      <div className="card">
        {linhas.length === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>
            Nenhuma nota ainda. Cadastre um certificado na aba "Certificados" para começar a
            sincronizar.
          </p>
        ) : (
          <NotasTable notas={linhas} />
        )}
      </div>
    </div>
  );
}
