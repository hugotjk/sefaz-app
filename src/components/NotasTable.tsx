"use client";

import { useState } from "react";
import { NotaModal } from "@/components/NotaModal";

interface NotaLinha {
  chaveAcesso: string;
  numero: string | null;
  dataEmissao: string | null;
  tipoOperacao: string | null;
  valorTotal: string;
  emitenteNome: string | null;
  emitenteCnpj: string | null;
  destinatarioNome: string;
  status: string;
  qtdEventos: number;
}

function formatarMoeda(valor: any) {
  const n = Number(valor ?? 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarData(data: string | null) {
  if (!data) return "-";
  return new Date(data).toLocaleDateString("pt-BR");
}

function badgeClasse(status: string) {
  if (status === "CANCELADA") return "badge badge-cancelada";
  if (status === "DENEGADA") return "badge badge-denegada";
  return "badge badge-autorizada";
}

export function NotasTable({ notas }: { notas: NotaLinha[] }) {
  const [chaveAberta, setChaveAberta] = useState<string | null>(null);

  return (
    <>
      <table className="notes-table">
        <thead>
          <tr>
            <th>Ver Nota</th>
            <th>Número</th>
            <th>Emissão</th>
            <th>Tipo</th>
            <th>Valor</th>
            <th>Empresa (Emit.)</th>
            <th>Empresa (Receb.)</th>
            <th>Status</th>
            <th>Eventos</th>
          </tr>
        </thead>
        <tbody>
          {notas.map((nota, i) => (
            <tr key={nota.chaveAcesso} style={{ background: i % 2 === 0 ? "transparent" : "var(--panel-2)" }}>
              <td>
                <button
                  onClick={() => setChaveAberta(nota.chaveAcesso)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent)",
                    cursor: "pointer",
                    fontSize: 16,
                  }}
                  title="Ver nota"
                >
                  📄
                </button>
              </td>
              <td>
                <button
                  onClick={() => setChaveAberta(nota.chaveAcesso)}
                  style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer" }}
                >
                  {nota.numero || "-"}
                </button>
              </td>
              <td>{formatarData(nota.dataEmissao)}</td>
              <td>{nota.tipoOperacao || "-"}</td>
              <td>{formatarMoeda(nota.valorTotal)}</td>
              <td>{nota.emitenteNome || nota.emitenteCnpj}</td>
              <td>{nota.destinatarioNome}</td>
              <td><span className={badgeClasse(nota.status)}>{nota.status}</span></td>
              <td>{nota.qtdEventos > 0 ? `${nota.qtdEventos} evento(s)` : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {chaveAberta && <NotaModal chave={chaveAberta} onClose={() => setChaveAberta(null)} />}
    </>
  );
}
