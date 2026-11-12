"use client";

import { useEffect, useMemo, useState } from "react";

interface Loja {
  cnpj: string;
  razaoSocial: string;
  loja: string | null;
  ie: string | null;
  crt: number;
  municipio: string | null;
  uf: string | null;
  logradouro: string; numero: string; complemento: string | null; bairro: string; cep: string; fone: string | null;
  serie: number | null;
  proximoNumero: number;
  serieAntiga: number | null;
  ultimoNumeroAntigo: number | null;
  certificado: { cor: "verde" | "amarelo" | "vermelho"; texto: string };
}

const COR = { verde: "#15803d", amarelo: "#d97706", vermelho: "#dc2626" } as const;

function fmtCnpj(c: string) {
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export default function LojasEmissorPage() {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [alvo, setAlvo] = useState<Loja | null>(null); // modal de certificado
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [endAlvo, setEndAlvo] = useState<Loja | null>(null); // modal de endereço
  const [end, setEnd] = useState({ logradouro: "", numero: "", complemento: "", bairro: "", cep: "", fone: "" });

  function abrirEndereco(l: Loja) {
    setEnd({ logradouro: l.logradouro ?? "", numero: l.numero ?? "", complemento: l.complemento ?? "", bairro: l.bairro ?? "", cep: l.cep ?? "", fone: l.fone ?? "" });
    setEndAlvo(l); setErro(null);
  }
  async function salvarEndereco() {
    if (!endAlvo) return;
    setEnviando(true); setErro(null);
    const res = await fetch(`/api/emissor/lojas/${endAlvo.cnpj}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(end),
    });
    const data = await res.json();
    setEnviando(false);
    if (!res.ok) { setErro(data.error ?? "Erro ao salvar."); return; }
    setEndAlvo(null);
    await carregar();
  }

  async function carregar() {
    setCarregando(true);
    const res = await fetch("/api/emissor/lojas");
    const data = await res.json();
    setLojas(data.lojas ?? []);
    setCarregando(false);
  }
  useEffect(() => {
    carregar();
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qDig = q.replace(/\D/g, "");
    if (!q) return lojas;
    return lojas.filter(
      (l) =>
        l.razaoSocial.toLowerCase().includes(q) ||
        (l.loja ?? "").toLowerCase().includes(q) ||
        (qDig && l.cnpj.includes(qDig))
    );
  }, [lojas, busca]);

  async function salvarCampo(l: Loja, campo: "serie" | "proximoNumero", valor: string) {
    setMsg(null);
    const res = await fetch(`/api/emissor/lojas/${l.cnpj}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [campo]: valor === "" ? null : Number(valor) }),
    });
    const data = await res.json();
    if (!res.ok) setMsg(data.error ?? "Erro ao salvar.");
    await carregar();
  }

  async function enviarCertificado() {
    if (!alvo || !arquivo || !senha) return;
    setEnviando(true);
    setErro(null);
    const fd = new FormData();
    fd.set("senha", senha);
    fd.set("certificado", arquivo);
    const res = await fetch(`/api/emissor/lojas/${alvo.cnpj}/certificado`, { method: "POST", body: fd });
    const data = await res.json();
    setEnviando(false);
    if (!res.ok) {
      setErro(data.error ?? "Erro ao enviar.");
      return;
    }
    setAlvo(null);
    setArquivo(null);
    setSenha("");
    await carregar();
  }

  const resumo = {
    verde: lojas.filter((l) => l.certificado.cor === "verde").length,
    amarelo: lojas.filter((l) => l.certificado.cor === "amarelo").length,
    vermelho: lojas.filter((l) => l.certificado.cor === "vermelho").length,
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <input
          placeholder="Buscar por CNPJ, razão social ou loja"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ minWidth: 320, height: 30, padding: "0 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 7 }}
        />
        <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
          <Bolinha cor="verde" /> {resumo.verde} válidos · <Bolinha cor="amarelo" /> {resumo.amarelo} a vencer ·{" "}
          <Bolinha cor="vermelho" /> {resumo.vermelho} vencidos/sem certificado
        </span>
      </div>
      {msg && <p className="status-erro">{msg}</p>}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-dim)", fontSize: 11 }}>
              <th style={th}>Certificado</th>
              <th style={th}>Loja</th>
              <th style={th}>CNPJ</th>
              <th style={th}>Regime</th>
              <th style={th}>Série própria</th>
              <th style={th}>Próximo nº</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td style={td} colSpan={7}>Carregando...</td></tr>
            )}
            {!carregando && filtradas.length === 0 && (
              <tr><td style={td} colSpan={7}>Nenhuma loja encontrada.</td></tr>
            )}
            {filtradas.map((l) => (
              <tr key={l.cnpj} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <Bolinha cor={l.certificado.cor} /> {l.certificado.texto}
                </td>
                <td
                  style={{ ...td, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={`${l.razaoSocial} · IE ${l.ie ?? "—"} · ${l.logradouro}, ${l.numero}${l.complemento ? ` ${l.complemento}` : ""} · ${l.bairro} · ${l.municipio}/${l.uf} · CEP ${l.cep}`}
                >
                  <b style={{ fontWeight: 600 }}>{l.loja ?? l.razaoSocial}</b>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {l.razaoSocial} · IE {l.ie ?? "—"} · {l.municipio}/{l.uf}
                  </div>
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtCnpj(l.cnpj)}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{l.crt === 3 ? "Normal (CRT 3)" : "Simples (CRT 1)"}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <CampoNumero valor={l.serie} onSalvar={(v) => salvarCampo(l, "serie", v)} />
                  {l.serieAntiga != null && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-dim)" }}>
                      outro sistema: {l.serieAntiga} (até nº {l.ultimoNumeroAntigo})
                    </span>
                  )}
                </td>
                <td style={td}>
                  <CampoNumero valor={l.proximoNumero} onSalvar={(v) => salvarCampo(l, "proximoNumero", v)} />
                </td>
                <td style={td}>
                  <div className="eb-acoes">
                    <button className="eb" onClick={() => abrirEndereco(l)}>Endereço</button>
                    <button className="eb" onClick={() => { setAlvo(l); setErro(null); }}>
                      {l.certificado.texto === "Sem certificado" ? "Enviar certificado" : "Trocar certificado"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {endAlvo && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
          onClick={() => !enviando && setEndAlvo(null)}
        >
          <form className="card" style={{ width: 460, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); if (!enviando) salvarEndereco(); }}>
            <h3 style={{ marginTop: 0 }}>Endereço — {endAlvo.loja ?? endAlvo.razaoSocial}</h3>
            <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
              Aparece como endereço do emitente no XML e no DANFE. Município ({endAlvo.municipio}/{endAlvo.uf}) não muda por aqui.
            </p>
            {([["logradouro", "Logradouro"], ["numero", "Número"], ["complemento", "Complemento (opcional)"], ["bairro", "Bairro"], ["cep", "CEP"], ["fone", "Telefone (opcional)"]] as const).map(([k, rot]) => (
              <div className="field" key={k} style={{ marginBottom: 10 }}>
                <label>{rot}</label>
                <input value={end[k]} onChange={(e) => setEnd({ ...end, [k]: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6 }} />
              </div>
            ))}
            {erro && <p className="status-erro">{erro}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="eb" disabled={enviando} onClick={() => setEndAlvo(null)}>Cancelar</button>
              <button type="submit" className="eb eb-primario" disabled={enviando}>{enviando ? "Salvando..." : "Salvar endereço"}</button>
            </div>
          </form>
        </div>
      )}

      {alvo && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
          onClick={() => !enviando && setAlvo(null)}
        >
          <div className="card" style={{ width: 420, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Certificado A1 — {alvo.loja ?? alvo.razaoSocial}</h3>
            <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
              CNPJ {fmtCnpj(alvo.cnpj)}. O app confere se o certificado é desta loja antes de salvar.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!enviando && arquivo && senha) enviarCertificado();
              }}
            >
            <div className="field">
              <label>Arquivo .pfx</label>
              <input type="file" accept=".pfx,.p12" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            </div>
            <div className="field">
              <label>Senha do certificado</label>
              <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" />
            </div>
            {erro && <p className="status-erro">{erro}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn-secundario" disabled={enviando} onClick={() => setAlvo(null)}>Cancelar</button>
              <button type="submit" className="btn" disabled={enviando || !arquivo || !senha}>
                {enviando ? "Enviando..." : "Salvar certificado"}
              </button>
            </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "5px 8px", verticalAlign: "middle" };

function Bolinha({ cor }: { cor: "verde" | "amarelo" | "vermelho" }) {
  return (
    <span
      aria-label={cor}
      style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: COR[cor], marginRight: 4 }}
    />
  );
}

function CampoNumero({ valor, onSalvar }: { valor: number | null; onSalvar: (v: string) => void }) {
  const [v, setV] = useState(valor == null ? "" : String(valor));
  useEffect(() => setV(valor == null ? "" : String(valor)), [valor]);
  return (
    <input
      value={v}
      inputMode="numeric"
      placeholder="—"
      onChange={(e) => setV(e.target.value.replace(/\D/g, ""))}
      onBlur={() => v !== (valor == null ? "" : String(valor)) && onSalvar(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={{ width: 60, height: 24, padding: "0 6px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 5 }}
    />
  );
}
