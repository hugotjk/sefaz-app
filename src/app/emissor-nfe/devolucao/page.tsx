"use client";

import { useEffect, useState } from "react";

interface Item {
  nItem: number; cProd: string; ean: string; tamanho?: string; xProd: string; qCom: number; vUnCom: string; pICMS: string;
}
interface Analise {
  original: { chave: string; numero: string; serie: string; emitente: { nome: string }; itens: Item[] };
  loja: { cnpj: string; razaoSocial: string; crt: number; serie: number | null; proximoNumero: number };
  contadorPadrao: string;
  infCplModelo: string;
  producaoLiberada?: boolean;
}
interface Destinatario { cnpj: string; nome: string; ie: string; municipio: string; uf: string }
interface Emissao { id: string; numero: number; serie: number; status: string; cStat: string | null; xMotivo: string | null; ambiente: number }
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
  const [semLoja, setSemLoja] = useState<Destinatario | null>(null);
  const [novoCrt, setNovoCrt] = useState("1");
  const [novaSerie, setNovaSerie] = useState("");
  const [emissao, setEmissao] = useState<Emissao | null>(null);
  const [teste, setTeste] = useState<string | null>(null);
  const [novoCert, setNovoCert] = useState<File | null>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [rascunhoId, setRascunhoId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // abre um rascunho salvo: /emissor-nfe/devolucao?rascunho=ID
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("rascunho");
    if (!id) return;
    (async () => {
      const res = await fetch(`/api/emissor/rascunhos/${id}`);
      const data = await res.json();
      if (!res.ok) { setErro(data.error ?? "Rascunho não encontrado."); return; }
      const r = data.rascunho;
      const f = new File([r.xmlOriginal], "nota-original.xml", { type: "application/xml" });
      await analisar(f);
      const q: Record<number, string> = {};
      for (const s of r.selecao as { nItem: number; qtd: number }[]) q[s.nItem] = String(s.qtd);
      setQtds(q); setCaso(r.caso ?? ""); setInfCpl(r.infCpl ?? null); setContador(!!r.contador);
      setRascunhoId(r.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function analisar(f: File) {
    setArquivo(f); setAnalise(null); setGerado(null); setErro(null); setQtds({}); setCaso(""); setInfCpl(null);
    setSemLoja(null); setEmissao(null); setTeste(null); setAviso(null); setRascunhoId(null);
    const fd = new FormData();
    fd.set("acao", "analisar"); fd.set("xml", f);
    const res = await fetch("/api/emissor/devolucao", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) { setErro(data.error ?? "Erro."); return; }
    if (data.lojaNaoCadastrada) { setSemLoja(data.destinatario); return; }
    setAnalise(data);
  }

  async function cadastrarLoja() {
    if (!arquivo) return;
    setCarregando(true); setErro(null);
    const fd = new FormData();
    fd.set("xml", arquivo); fd.set("crt", novoCrt); fd.set("serie", novaSerie);
    if (novoCert) { fd.set("certificado", novoCert); fd.set("senha", novaSenha); }
    const res = await fetch("/api/emissor/lojas", { method: "POST", body: fd });
    const data = await res.json();
    setCarregando(false);
    if (!res.ok) { setErro(data.error ?? "Erro ao cadastrar."); return; }
    const av = data.aviso as string | undefined;
    setNovoCert(null); setNovaSenha("");
    await analisar(arquivo);
    if (av) setAviso(av);
  }

  async function testarConexao(prod = false) {
    if (!arquivo) return;
    setCarregando(true); setErro(null); setTeste(null);
    const fd = new FormData();
    fd.set("acao", "testar"); fd.set("xml", arquivo); fd.set("ambiente", prod ? "1" : "2");
    const res = await fetch("/api/emissor/devolucao", { method: "POST", body: fd });
    const data = await res.json();
    setCarregando(false);
    if (!res.ok) { setErro(data.error ?? "Erro."); return; }
    setTeste(`SEFAZ (${prod ? "PRODUÇÃO" : "homologação"}): ${data.cStat} — ${data.xMotivo}`);
  }

  async function salvarRascunho(silencioso = false) {
    if (!arquivo || !analise) return;
    const fd = new FormData();
    fd.set("xml", arquivo); fd.set("selecao", JSON.stringify(selecao)); fd.set("caso", caso);
    fd.set("infCpl", infFinal); fd.set("personalizado", infCpl !== null ? "1" : "0");
    fd.set("contador", contador ? "1" : "0");
    if (rascunhoId) fd.set("id", rascunhoId);
    const res = await fetch("/api/emissor/rascunhos", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) { if (!silencioso) setErro(data.error ?? "Erro ao salvar."); return; }
    setRascunhoId(data.id);
    setAviso("Rascunho salvo — aparece em “Notas emitidas”. Nenhum número foi consumido.");
  }

  async function previaDanfe() {
    if (!arquivo) return;
    await salvarRascunho(true);
    setCarregando(true); setErro(null);
    const fd = new FormData();
    fd.set("acao", "previa-danfe"); fd.set("xml", arquivo); fd.set("caso", caso);
    fd.set("selecao", JSON.stringify(selecao)); fd.set("infCpl", infFinal); fd.set("contador", contador ? "1" : "0");
    const res = await fetch("/api/emissor/devolucao", { method: "POST", body: fd });
    setCarregando(false);
    if (!res.ok) { setErro((await res.json()).error ?? "Erro."); return; }
    const url = URL.createObjectURL(await res.blob());
    window.open(url, "_blank");
  }

  async function enviar(prod = false) {
    if (!arquivo || !analise) return;
    if (prod) {
      const valor = analise.original.itens
        .reduce((t, it) => t + Math.round(Number(qtds[it.nItem] || 0) * Number(it.vUnCom) * 100) / 100, 0)
        .toLocaleString("pt-BR", { minimumFractionDigits: 2 });
      const ok = window.confirm(
        `EMITIR NF-e REAL (com valor fiscal)?\n\nLoja: ${analise.loja.razaoSocial}\nSérie ${analise.loja.serie}, nº ${analise.loja.proximoNumero}\nReferente à NF ${analise.original.numero} da ${analise.original.emitente.nome}\n${selecao.length} item(ns), valor aproximado R$ ${valor}\nCase: ${caso}\n\nSó pode ser desfeita por cancelamento (normalmente até 24 h).`
      );
      if (!ok) return;
    }
    setCarregando(true); setErro(null); setEmissao(null);
    const fd = new FormData();
    fd.set("acao", "enviar"); fd.set("xml", arquivo); fd.set("ambiente", prod ? "1" : "2");
    fd.set("selecao", JSON.stringify(selecao)); fd.set("infCpl", infFinal); fd.set("caso", caso);
    fd.set("contador", contador ? "1" : "0");
    if (rascunhoId) fd.set("rascunhoId", rascunhoId);
    const res = await fetch("/api/emissor/devolucao", { method: "POST", body: fd });
    const data = await res.json();
    setCarregando(false);
    if (!res.ok) { setErro(data.error ?? "Erro."); return; }
    setEmissao(data.emissao);
    if (data.emissao?.status === "AUTORIZADA") { setRascunhoId(null); setAviso(null); }
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
    await salvarRascunho(true);
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
      {erro && !analise && <p className="status-erro">{erro}</p>}
      {aviso && !analise && <p style={{ fontSize: 13 }}>{aviso}</p>}

      {semLoja && (
        <div className="card" style={{ marginBottom: 16, fontSize: 14 }}>
          <p style={{ marginTop: 0 }}>
            <b>Loja ainda não cadastrada:</b> {semLoja.nome} — CNPJ {semLoja.cnpj}, IE {semLoja.ie}, {semLoja.municipio}/{semLoja.uf}.
            Os dados de endereço vêm da própria nota. Falta você informar o regime e a série:
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Regime</label>
              <select value={novoCrt} onChange={(e) => setNovoCrt(e.target.value)} style={{ padding: 6 }}>
                <option value="1">Simples Nacional (CRT 1)</option>
                <option value="3">Regime normal (CRT 3)</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Série própria (opcional agora)</label>
              <input value={novaSerie} inputMode="numeric" onChange={(e) => setNovaSerie(e.target.value.replace(/\D/g, ""))} style={{ width: 90, padding: 6 }} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Certificado A1 (.pfx) — opcional agora</label>
              <input type="file" accept=".pfx,.p12" onChange={(e) => setNovoCert(e.target.files?.[0] ?? null)} />
            </div>
            {novoCert && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Senha do certificado</label>
                <input type="password" value={novaSenha} autoComplete="off"
                  onChange={(e) => setNovaSenha(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !carregando && cadastrarLoja()}
                  style={{ width: 160, padding: 6 }} />
              </div>
            )}
            <button className="btn" disabled={carregando} onClick={cadastrarLoja}>Cadastrar esta loja</button>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 0 }}>
            Se não enviar o certificado agora, envie depois em “Lojas e certificados”.
          </p>
        </div>
      )}

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
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-dim)", fontSize: 11 }}>
                  <th style={th}>Produto</th><th style={th}>EAN</th><th style={th}>Tam.</th>
                  <th style={{ ...th, textAlign: "right" }}>Qtd</th>
                  <th style={{ ...th, textAlign: "right" }}>Unit.</th>
                  <th style={{ ...th, textAlign: "right" }}>ICMS</th>
                  <th style={th}>Devolver</th>
                </tr>
              </thead>
              <tbody>
                {analise.original.itens.map((it) => (
                  <tr key={it.nItem} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {it.xProd} <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{it.cProd}</span>
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{it.ean}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 600 }}>{it.tamanho ?? ""}</td>
                    <td style={{ ...td, textAlign: "right" }}>{it.qCom}</td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{Number(it.vUnCom).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={{ ...td, textAlign: "right" }}>{Number(it.pICMS)}%</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <input
                        inputMode="numeric" value={qtds[it.nItem] ?? ""} placeholder="0"
                        onChange={(e) => {
                          const n = Math.min(it.qCom, Number(e.target.value.replace(/\D/g, "") || 0));
                          setQtds({ ...qtds, [it.nItem]: n ? String(n) : "" });
                        }}
                        style={{ width: 52, height: 24, padding: "0 6px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 5 }}
                      />
                      <button type="button" className="eb" style={{ height: 24, padding: "0 8px", fontSize: 11, marginLeft: 4 }}
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

          <div className="eb-grupo">
            <button className="eb" disabled={!pronto || carregando} onClick={gerar}>
              {carregando ? "Gerando..." : "Prévia do XML"}
            </button>
            <button className="eb" disabled={!pronto || carregando} onClick={previaDanfe}>Prévia do DANFE (PDF)</button>
            <button className="eb" disabled={!analise || selecao.length === 0 || carregando} onClick={() => salvarRascunho(false)}>
              Salvar rascunho
            </button>
            <span className="eb-sep" />
            <button className="eb eb-primario" disabled={!pronto || carregando} onClick={() => enviar(false)}>
              {carregando ? "Aguarde..." : "Enviar (homologação)"}
            </button>
            <button className="eb eb-leve" disabled={carregando} onClick={() => testarConexao(false)}>Testar conexão</button>
            {analise.producaoLiberada && (
              <>
                <span className="eb-sep" />
                <button className="eb eb-perigo" disabled={!pronto || carregando} onClick={() => enviar(true)}>
                  Emitir em PRODUÇÃO
                </button>
                <button className="eb eb-leve" disabled={carregando} onClick={() => testarConexao(true)}>Testar (produção)</button>
              </>
            )}
            <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{selecao.length} item(ns)</span>
          </div>
          {teste && <p style={{ fontSize: 13 }}>{teste}</p>}
          {aviso && <p style={{ fontSize: 13 }}>{aviso}</p>}
          {erro && <p className="status-erro" style={{ marginTop: 12 }}>{erro}</p>}
          {emissao && (
            <div className="card" style={{ marginTop: 16 }}>
              <p style={{ marginTop: 0 }} className={emissao.status === "AUTORIZADA" ? "status-ok" : "status-erro"}>
                <b>{emissao.status === "AUTORIZADA" ? "Autorizada" : emissao.status === "REJEITADA" ? "Rejeitada" : emissao.status}</b>
                {" "}{emissao.ambiente === 2 ? "(homologação — sem valor fiscal)" : "(PRODUÇÃO)"} · NF série {emissao.serie} nº {emissao.numero}
              </p>
              <p style={{ fontSize: 14 }}>{emissao.cStat} — {emissao.xMotivo}</p>
              <a href="/emissor-nfe/notas">Ver em “Notas emitidas”</a>
            </div>
          )}
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

const th: React.CSSProperties = { padding: "6px 10px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "3px 10px", verticalAlign: "middle" };
