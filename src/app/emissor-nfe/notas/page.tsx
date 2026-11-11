"use client";

import { useEffect, useState } from "react";

interface Emissao {
  id: string; loja: string; ambiente: number; serie: number; numero: number; chave: string; status: string;
  cStat: string | null; xMotivo: string | null; nProt: string | null; vNF: string;
  notaOriginalNumero: string; caso: string; createdAt: string;
}

const COR: Record<string, string> = {
  AUTORIZADA: "#15803d", CANCELADA: "#6b7280", REJEITADA: "#dc2626", DENEGADA: "#dc2626", INCERTA: "#d97706", ASSINADA: "#d97706",
};

interface Rascunho {
  id: string; loja: string; fornecedor: string; notaOriginalNumero: string; caso: string; itens: number; updatedAt: string;
}

export default function NotasEmitidasPage() {
  const [rascunhos, setRascunhos] = useState<Rascunho[]>([]);
  const [lista, setLista] = useState<Emissao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<Emissao | null>(null);
  const [just, setJust] = useState("");

  async function carregar() {
    const res = await fetch("/api/emissor/emissoes");
    const data = await res.json();
    setLista(data.emissoes ?? []);
    const r = await (await fetch("/api/emissor/rascunhos")).json();
    setRascunhos(r.rascunhos ?? []);
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

  async function excluirRascunho(id: string) {
    if (!window.confirm("Excluir este rascunho? Nenhuma nota foi emitida, então nada fiscal é afetado.")) return;
    await fetch(`/api/emissor/rascunhos/${id}`, { method: "DELETE" });
    await carregar();
  }

  async function cancelar() {
    if (!cancelando) return;
    setOcupado(cancelando.id); setErro(null);
    const res = await fetch(`/api/emissor/emissoes/${cancelando.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "cancelar", justificativa: just }),
    });
    const data = await res.json();
    setOcupado(null);
    if (!res.ok) { setErro(data.error ?? "Erro."); return; }
    setCancelando(null); setJust("");
    await carregar();
  }

  return (
    <div>
      {erro && <p className="status-erro">{erro}</p>}
      {rascunhos.length > 0 && (
        <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>
          <b>Rascunhos (não enviados à SEFAZ)</b>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <tbody>
              {rascunhos.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px" }}>{r.loja}</td>
                  <td style={{ padding: "6px 8px" }}>{r.fornecedor} — NF {r.notaOriginalNumero}</td>
                  <td style={{ padding: "6px 8px" }}>{r.itens} item(ns){r.caso ? ` · case ${r.caso}` : ""}</td>
                  <td style={{ padding: "6px 8px" }}>{new Date(r.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <a href={`/emissor-nfe/devolucao?rascunho=${r.id}`}>Abrir</a>{" · "}
                    <a href="#" onClick={(e) => { e.preventDefault(); excluirRascunho(r.id); }}>Excluir</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-dim)", fontSize: 11 }}>
              <th style={th}>Situação</th><th style={th}>Loja</th><th style={th}>Série-nº</th>
              <th style={th}>Referente à NF</th><th style={th}>Valor</th><th style={th}>Data</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {carregando && <tr><td style={td} colSpan={7}>Carregando...</td></tr>}
            {!carregando && lista.length === 0 && <tr><td style={td} colSpan={7}>Nenhuma nota emitida ainda.</td></tr>}
            {lista.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={td} title={`${e.cStat ?? ""} ${e.xMotivo ?? ""}`}>
                  <b style={{ color: COR[e.status] ?? "inherit" }}>{e.status === "INCERTA" ? "SEM RESPOSTA" : e.status}</b>
                  {e.ambiente === 2 && <span style={{ marginLeft: 4, fontSize: 9, background: "var(--panel-2)", padding: "0 4px", borderRadius: 3 }}>HOMOLOG.</span>}
                  <div style={{ fontSize: 10, color: "var(--text-dim)", maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.cStat} {e.xMotivo}
                  </div>
                </td>
                <td style={{ ...td, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.loja}>{e.loja}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{e.serie}-{e.numero}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{e.notaOriginalNumero}<div style={{ fontSize: 10, color: "var(--text-dim)" }}>case {e.caso}</div></td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{Number(e.vNF).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{new Date(e.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td style={td}>
                  <div className="eb-acoes">
                    {["REJEITADA", "INCERTA"].includes(e.status) && (
                      <button className="eb eb-primario" disabled={ocupado === e.id} onClick={() => acao(e.id, "reenviar")}>Reenviar</button>
                    )}
                    {["INCERTA", "ASSINADA", "AUTORIZADA", "CANCELADA"].includes(e.status) && (
                      <button className="eb" disabled={ocupado === e.id} onClick={() => acao(e.id, "consultar")}>Consultar</button>
                    )}
                    <a className="eb" href={`/api/emissor/emissoes/${e.id}?tipo=xml`}>XML</a>
                    {e.status === "AUTORIZADA" && (
                      <a className="eb" href={`/api/emissor/emissoes/${e.id}?tipo=danfe`} target="_blank">DANFE</a>
                    )}
                    {e.status === "CANCELADA" && (
                      <a className="eb" href={`/api/emissor/emissoes/${e.id}?tipo=cancelamento`}>XML canc.</a>
                    )}
                    {e.status === "AUTORIZADA" && (
                      <button className="eb eb-perigo" disabled={ocupado === e.id}
                        onClick={() => { setCancelando(e); setJust(""); setErro(null); }}>Cancelar</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cancelando && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
          onClick={() => !ocupado && setCancelando(null)}>
          <form className="card" style={{ width: 460, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); if (just.trim().length >= 15 && !ocupado) cancelar(); }}>
            <h3 style={{ marginTop: 0 }}>Cancelar NF {cancelando.numero} (série {cancelando.serie})</h3>
            <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
              O prazo normal de cancelamento é de até 24 horas após a autorização; a SEFAZ decide se ainda é possível.
              O cancelamento não pode ser desfeito.
            </p>
            <div className="field">
              <label>Justificativa (mínimo 15 caracteres)</label>
              <textarea rows={3} value={just} onChange={(e) => setJust(e.target.value)} maxLength={255}
                style={{ width: "100%", padding: 8, border: "1px solid var(--border)", borderRadius: 6 }} />
            </div>
            {erro && <p className="status-erro">{erro}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn-secundario" disabled={!!ocupado} onClick={() => setCancelando(null)}>Voltar</button>
              <button type="submit" className="btn" disabled={!!ocupado || just.trim().length < 15}>
                {ocupado ? "Cancelando..." : "Cancelar a nota"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "5px 8px", verticalAlign: "middle" };
