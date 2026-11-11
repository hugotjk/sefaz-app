"use client";

import { useEffect, useState } from "react";

interface Emissao {
  id: string; loja: string; ambiente: number; serie: number; numero: number; chave: string; status: string;
  cStat: string | null; xMotivo: string | null; nProt: string | null; vNF: string;
  notaOriginalNumero: string; caso: string; createdAt: string;
}

const COR: Record<string, string> = {
  AUTORIZADA: "#15803d", REJEITADA: "#dc2626", DENEGADA: "#dc2626", INCERTA: "#d97706", ASSINADA: "#d97706",
};

export default function NotasEmitidasPage() {
  const [lista, setLista] = useState<Emissao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    const res = await fetch("/api/emissor/emissoes");
    const data = await res.json();
    setLista(data.emissoes ?? []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  async function acao(id: string, acao: "consultar" | "reenviar") {
    setOcupado(id); setErro(null);
    const res = await fetch(`/api/emissor/emissoes/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao }),
    });
    const data = await res.json();
    if (!res.ok) setErro(data.error ?? "Erro.");
    setOcupado(null);
    await carregar();
  }

  return (
    <div>
      {erro && <p className="status-erro">{erro}</p>}
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-dim)", fontSize: 12 }}>
              <th style={th}>Situação</th><th style={th}>Loja</th><th style={th}>NF</th>
              <th style={th}>Referente à NF</th><th style={th}>Valor</th><th style={th}>Data</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {carregando && <tr><td style={td} colSpan={7}>Carregando...</td></tr>}
            {!carregando && lista.length === 0 && <tr><td style={td} colSpan={7}>Nenhuma nota emitida ainda.</td></tr>}
            {lista.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={td}>
                  <b style={{ color: COR[e.status] ?? "inherit" }}>{e.status === "INCERTA" ? "SEM RESPOSTA" : e.status}</b>
                  {e.ambiente === 2 && <span style={{ marginLeft: 6, fontSize: 11, background: "var(--panel-2)", padding: "1px 6px", borderRadius: 4 }}>HOMOLOGAÇÃO</span>}
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{e.cStat} {e.xMotivo}</div>
                </td>
                <td style={td}>{e.loja}</td>
                <td style={td}>série {e.serie} · nº {e.numero}</td>
                <td style={td}>{e.notaOriginalNumero}<div style={{ fontSize: 12, color: "var(--text-dim)" }}>case {e.caso}</div></td>
                <td style={td}>{Number(e.vNF).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                <td style={td}>{new Date(e.createdAt).toLocaleString("pt-BR")}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <a className="btn-secundario" style={{ marginRight: 6, textDecoration: "none" }} href={`/api/emissor/emissoes/${e.id}?tipo=xml`}>XML</a>
                  {e.status === "AUTORIZADA" && (
                    <a className="btn-secundario" style={{ marginRight: 6, textDecoration: "none" }} href={`/api/emissor/emissoes/${e.id}?tipo=danfe`} target="_blank">DANFE</a>
                  )}
                  {["INCERTA", "ASSINADA", "AUTORIZADA"].includes(e.status) && (
                    <button className="btn-secundario" disabled={ocupado === e.id} onClick={() => acao(e.id, "consultar")}>Consultar</button>
                  )}
                  {["REJEITADA", "INCERTA"].includes(e.status) && (
                    <button className="btn-secundario" style={{ marginLeft: 6 }} disabled={ocupado === e.id} onClick={() => acao(e.id, "reenviar")}>Reenviar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 12px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "10px 12px", verticalAlign: "top" };
