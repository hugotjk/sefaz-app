"use client";

import { useState } from "react";

interface Item {
  nItem: number; cProd: string; ean: string; xProd: string; qCom: number; vUnCom: string; pICMS: string;
}
interface Analise {
  original: { chave: string; numero: string; serie: string; emitente: { nome: string }; itens: Item[] };
  loja: { cnpj: string; razaoSocial: string; crt: number; serie: number | null; proximoNumero: number };
  contadorPadrao: string;
  infCplModelo: string;
}
interface Gerado { xml: string; chave: string; vNF: string; totalItens: number; serie: number; numero: number }

export default function DevolucaoPage() {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [qtds, setQtds] = useState<Record<number, string>>({});
  const [caso, setCaso] = useState("");
  const [infCpl, setInfCpl] = useState<string | null>(null); // null = automático
  const [contador, setContador] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [gerado, setGerado] = useState<Gerado | null>(null);

  async function analisar(f: File) {
    setArquivo(f); setAnalise(null); setGerado(null); setErro(null); setQtds({}); setCaso(""); setInfCpl(null);
    const fd = new FormData();
    fd.set("acao", "analisar"); fd.set("xml", f);
    const res = await fetch("/api/emissor/devolucao", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) { setErro(data.error ?? "Erro."); return; }
    setAnalise(data);
  }

  const infAuto = analise ? analise.infCplModelo.replace("{CASE}", caso) : "";
  const infFinal = infCpl ?? infAuto;
  const selecao = analise
    ? analise.original.itens
        .map((it) => ({ nItem: it.nItem, qtd: Number(qtds[it.nItem] || 0) }))
        .filter((s) => s.qtd > 0)
    : [];

  async function gerar() {
    if (!arquivo) return;
    setCarregando(true); setErro(null); setGerado(null);
    const fd = new FormData();
    fd.set("acao", "gerar"); fd.set("xml", arquivo);
    fd.set("selecao", JSON.stringify(selecao)); fd.set("infCpl", infFinal); fd.set("contador", contador ? "1" : "0");
    const res = await fetch("/api/emissor/devolucao", { method: "POST", body: fd });
    const data = await res.json();
    setCarregando(false);
    if (!res.ok) { setErro(data.error ?? "Erro."); return; }
    setGerado(data);
  }

  function baixar() {
    if (!gerado) return;
    const url = URL.createObjectURL(new Blob([gerado.xml], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url; a.download = `PREVIA_NFe_${gerado.chave}.xml`; a.click();
    URL.revokeObjectURL(url);
  }

  const pronto = analise && selecao.length > 0 && caso.trim() !== "" && analise.loja.serie != null;

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>XML da nota fiscal original (a que você recebeu)</label>
          <input type="file" accept=".xml" onChange={(e) => e.target.files?.[0] && analisar(e.target.files[0])} />
        </div>
      </div>
      {erro && <p className="status-erro">{erro}</p>}

      {analise && (
        <>
          <div className="card" style={{ marginBottom: 16, fontSize: 14 }}>
            <div><b>Nota original:</b> {analise.original.emitente.nome} — NF {analise.original.numero} (série {analise.original.serie})</div>
            <div><b>Loja emitente da devolução:</b> {analise.loja.razaoSocial} — {analise.loja.crt === 3 ? "Regime normal (CRT 3)" : "Simples (CRT 1)"}</div>
            <div>
              <b>Numeração:</b>{" "}
              {analise.loja.serie == null ? (
                <span className="status-erro">série própria não definida — defina em “Lojas e certificados”</span>
              ) : (
                <>série {analise.loja.serie}, nº {analise.loja.proximoNumero}</>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-dim)", fontSize: 12 }}>
                  <th style={th}>Produto</th><th style={th}>EAN</th><th style={th}>Qtd. na nota</th>
                  <th style={th}>Valor unit.</th><th style={th}>ICMS</th><th style={th}>Devolver</th>
                </tr>
              </thead>
              <tbody>
                {analise.original.itens.map((it) => (
                  <tr key={it.nItem} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>{it.xProd}<div style={{ fontSize: 12, color: "var(--text-dim)" }}>{it.cProd}</div></td>
                    <td style={td}>{it.ean}</td>
                    <td style={td}>{it.qCom}</td>
                    <td style={td}>{Number(it.vUnCom).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={td}>{Number(it.pICMS)}%</td>
                    <td style={td}>
                      <input
                        inputMode="numeric" value={qtds[it.nItem] ?? ""} placeholder="0"
                        onChange={(e) => {
                          const n = Math.min(it.qCom, Number(e.target.value.replace(/\D/g, "") || 0));
                          setQtds({ ...qtds, [it.nItem]: n ? String(n) : "" });
                        }}
                        style={{ width: 70, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 6 }}
                      />
                      <button type="button" className="btn-secundario" style={{ marginLeft: 6, padding: "2px 8px" }}
                        onClick={() => setQtds({ ...qtds, [it.nItem]: String(it.qCom) })}>tudo</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="field">
              <label>Nº do case (processo aberto no site do fornecedor)</label>
              <input value={caso} onChange={(e) => setCaso(e.target.value.replace(/\D/g, ""))} style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6 }} />
            </div>
            <div className="field">
              <label>Informações complementares {infCpl !== null && <a href="#" onClick={(e) => { e.preventDefault(); setInfCpl(null); }}>(voltar ao texto automático)</a>}</label>
              <textarea rows={3} value={infFinal} onChange={(e) => setInfCpl(e.target.value)} style={{ width: "100%", padding: 8, border: "1px solid var(--border)", borderRadius: 6 }} />
            </div>
            <label style={{ fontSize: 14 }}>
              <input type="checkbox" checked={contador} onChange={(e) => setContador(e.target.checked)} /> Autorizar o escritório de contabilidade a baixar o XML (CNPJ {analise.contadorPadrao})
            </label>
          </div>

          <button className="btn" disabled={!pronto || carregando} onClick={gerar}>
            {carregando ? "Gerando..." : "Gerar prévia do XML"}
          </button>
          <span style={{ marginLeft: 12, fontSize: 13, color: "var(--text-dim)" }}>{selecao.length} item(ns) selecionado(s)</span>
        </>
      )}

      {gerado && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ marginTop: 0 }}>
            <b>Prévia gerada</b> — NF série {gerado.serie} nº {gerado.numero}, {gerado.totalItens} item(ns), valor R$ {Number(gerado.vNF).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.
          </p>
          <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
            Chave: {gerado.chave}<br />
            Este XML <b>não está assinado e não foi enviado à SEFAZ</b>; o número da nota não foi consumido.
          </p>
          <button className="btn-secundario" onClick={baixar}>Baixar XML da prévia</button>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 12px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "10px 12px", verticalAlign: "top" };
