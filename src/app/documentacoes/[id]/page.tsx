"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TIPOS_DOC } from "@/lib/lojas-docs";

interface DocItem { id: string; tipo: string; nomeArquivo: string; tamanho: number | null; validade: string | null; enviadoEm: string }
interface Dados {
  loja: { id: string; loja: string; razaoSocial: string | null; razaoCurta: string; cnpj: string; unidade: string; gestor: string | null; rede: string | null; ativa: boolean };
  mesmoCnpj: { id: string; loja: string; ativa: boolean }[];
  cnpjsDaEmpresa: number;
  docs: DocItem[];
}

const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const fmtData = (s: string) => new Date(s).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const fmtTam = (n: number | null) => (n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function estadoValidade(v: string | null) {
  if (!v) return null;
  const dias = (new Date(v).getTime() - Date.now()) / 86400000;
  if (dias < 0) return { txt: "vencido", cor: "var(--red)" };
  if (dias <= 30) return { txt: "vence em breve", cor: "var(--yellow)" };
  return { txt: "em dia", cor: "var(--green)" };
}

export default function LojaDocsPage({ params }: { params: { id: string } }) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [validade, setValidade] = useState("");
  const [todos, setTodos] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/documentacoes/loja/${params.id}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao carregar.");
      setD(j);
    } catch (e: any) {
      setErro(e.message);
    }
  }, [params.id]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function enviar(tipo: string, files: FileList | null) {
    if (!files?.length || !d) return;
    setEnviando(tipo);
    setMsg(null);
    try {
      const fd = new FormData();
      [...files].forEach((f) => fd.append("arquivos", f));
      fd.append("tipo", tipo);
      fd.append("cnpj", d.loja.cnpj);
      fd.append("lojaId", d.loja.id);
      if (tipo === "cert" && validade) fd.append("validade", validade);
      if (tipo === "contrato" && todos) fd.append("todosCnpjs", "1");
      const r = await fetch("/api/documentacoes/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falha no envio.");
      const ruins = j.resultados.filter((x: any) => x.status !== "guardado");
      setMsg(ruins.length ? ruins.map((x: any) => `${x.arquivo}: ${x.detalhe}`).join(" • ") : "Guardado.");
      await carregar();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setEnviando(null);
    }
  }

  async function excluir(doc: DocItem) {
    if (!confirm(`Excluir "${doc.nomeArquivo}"? Isso apaga o arquivo guardado.`)) return;
    const r = await fetch(`/api/documentacoes/arquivo?id=${doc.id}`, { method: "DELETE" });
    if (!r.ok) setMsg("Não foi possível excluir.");
    await carregar();
  }

  if (erro) return <p style={{ color: "var(--red)" }}>{erro}</p>;
  if (!d) return <p style={{ color: "var(--text-dim)" }}>Carregando…</p>;
  const { loja } = d;

  return (
    <div style={{ maxWidth: 1000 }}>
      <p style={{ margin: "0 0 8px" }}><Link href="/documentacoes">← Documentações</Link></p>
      <h1 style={{ marginBottom: 4 }}>{loja.loja}</h1>
      <p style={{ color: "var(--text-dim)", marginTop: 0 }}>
        {loja.razaoSocial ?? "—"} · {loja.cnpj ? fmtCnpj(loja.cnpj) : "sem CNPJ"} · {loja.unidade || "—"} · Gestor {loja.gestor ?? "—"} · {loja.rede ?? "—"}
        {!loja.ativa && " · INATIVA"}
      </p>
      {d.mesmoCnpj.length > 0 && (
        <div className="card" style={{ fontSize: 13, marginBottom: 12 }}>
          Este CNPJ também é usado por: {d.mesmoCnpj.map((o) => (
            <Link key={o.id} href={`/documentacoes/${o.id}`} style={{ marginRight: 8 }}>{o.loja}{o.ativa ? "" : " (inativa)"}</Link>
          ))}. Cartão CNPJ, IE, certificado, alvará e contrato são compartilhados.
        </div>
      )}
      {!loja.cnpj ? (
        <p>Esta loja não tem CNPJ cadastrado; corrija na planilha e importe de novo.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <a className="btn" href={`/api/documentacoes/zip?cnpj=${loja.cnpj}`} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 12px", background: "var(--panel-2)", fontSize: 13 }}>
              Baixar tudo (ZIP)
            </a>
            {msg && <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{msg}</span>}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {TIPOS_DOC.map((t) => {
              const arqs = d.docs.filter((x) => x.tipo === t.id);
              return (
                <div key={t.id} className="card" style={{ padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ minWidth: 190 }}>{t.nome}</strong>
                    <span style={{ fontSize: 12, color: arqs.length ? "var(--green)" : "var(--text-dim)" }}>
                      {arqs.length ? `${arqs.length} arquivo(s)` : t.obrigatorio ? "falta enviar" : "opcional"}
                    </span>
                    <span style={{ flex: 1 }} />
                    {t.id === "cert" && (
                      <label style={{ fontSize: 12 }}>
                        Validade <input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
                      </label>
                    )}
                    {t.id === "contrato" && d.cnpjsDaEmpresa > 1 && (
                      <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}>
                        <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
                        usar para todos os CNPJs da empresa
                      </label>
                    )}
                    <label style={{ cursor: "pointer", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, padding: "5px 12px", background: "var(--panel-2)" }}>
                      {enviando === t.id ? "Enviando…" : "Enviar"}
                      <input type="file" hidden multiple={t.id === "foto"} disabled={!!enviando}
                        onChange={(e) => { enviar(t.id, e.target.files); e.target.value = ""; }} />
                    </label>
                  </div>
                  {arqs.map((a) => {
                    const ev = estadoValidade(a.validade);
                    return (
                      <div key={a.id} style={{ display: "flex", gap: 10, fontSize: 13, padding: "5px 0 0", alignItems: "center", flexWrap: "wrap" }}>
                        <a href={`/api/documentacoes/arquivo?id=${a.id}`}>{a.nomeArquivo}</a>
                        <span style={{ color: "var(--text-dim)" }}>{fmtData(a.enviadoEm)} · {fmtTam(a.tamanho)}</span>
                        {a.validade && ev && <span style={{ color: ev.cor }}>validade {fmtData(a.validade)} ({ev.txt})</span>}
                        <button onClick={() => excluir(a)} style={{ fontSize: 12, marginLeft: "auto" }}>Excluir</button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
