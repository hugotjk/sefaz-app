"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TIPOS_DOC } from "@/lib/lojas-docs";

interface Loja {
  id: string;
  loja: string;
  razaoSocial: string | null;
  razaoCurta: string;
  cnpj: string;
  raiz: string;
  unidade: string;
  gestor: string | null;
  rede: string | null;
  ativa: boolean;
  origem: string;
}
interface Doc {
  escopo: "EMPRESA" | "CNPJ" | "LOJA";
  chave: string;
  tipo: string;
  validade: string | null;
}
interface ResultadoImport {
  origem: string;
  lidas: number;
  importadas: number;
  novas: number;
  atualizadas: number;
  ignoradasNrn: number;
  semCnpj: number;
  cnpjRepetido: { cnpj: string; lojas: string[] }[];
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

const TD: React.CSSProperties = { whiteSpace: "nowrap", padding: "8px 10px", fontSize: 13, borderBottom: "1px solid var(--border)" };
const TH: React.CSSProperties = {
  whiteSpace: "nowrap", padding: "8px 10px", fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".05em",
  color: "var(--text-dim)", textAlign: "left", borderBottom: "1px solid var(--border)", fontWeight: 500,
};
const CORTA = (w: number): React.CSSProperties => ({ ...TD, maxWidth: w, overflow: "hidden", textOverflow: "ellipsis" });

type EstadoDoc = "ok" | "falta" | "vence" | "vencido";
const chipEstilo: Record<EstadoDoc, React.CSSProperties> = {
  ok: { background: "rgba(21,128,61,.12)", color: "var(--green)", border: "1px solid transparent" },
  falta: { background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)" },
  vence: { background: "rgba(180,83,9,.14)", color: "var(--yellow)", border: "1px solid transparent" },
  vencido: { background: "rgba(220,38,38,.12)", color: "var(--red)", border: "1px solid transparent" },
};

function PendenteLinha({ p, lojas, onAtribuir, onDescartar }: {
  p: { key: string; nome: string; tamanho: number };
  lojas: Loja[];
  onAtribuir: (key: string, lojaId: string, tipo: string) => void;
  onDescartar: (key: string) => void;
}) {
  const [lojaTxt, setLojaTxt] = useState("");
  const [tipo, setTipo] = useState("");
  const q = norm(lojaTxt);
  const loja = q ? lojas.find((l) => l.cnpj && l.ativa && norm(`${l.loja} ${fmtCnpj(l.cnpj)}`) === q) : undefined;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", fontSize: 13, flexWrap: "wrap" }}>
      <span style={{ minWidth: 260 }}>{p.nome}</span>
      <input list="lojas-dl" value={lojaTxt} onChange={(e) => setLojaTxt(e.target.value)} placeholder="Loja (digite e escolha)" style={{ minWidth: 260, padding: "5px 8px" }} />
      <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ padding: "5px 8px" }}>
        <option value="">Tipo…</option>
        {TIPOS_DOC.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
      </select>
      <button disabled={!loja || !tipo} onClick={() => loja && onAtribuir(p.key, loja.id, tipo)}>Guardar</button>
      <button onClick={() => onDescartar(p.key)}>Excluir</button>
      <datalist id="lojas-dl">
        {lojas.filter((l) => l.cnpj && l.ativa).map((l) => <option key={l.id} value={`${l.loja} ${fmtCnpj(l.cnpj)}`} />)}
      </datalist>
    </div>
  );
}

export default function DocumentacoesPage() {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [gestor, setGestor] = useState("");
  const [rede, setRede] = useState("");
  const [ocultarInativas, setOcultarInativas] = useState(true);
  const [soFaltando, setSoFaltando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImport | null>(null);
  const [erroImport, setErroImport] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resEnvio, setResEnvio] = useState<{ arquivo: string; status: string; detalhe: string }[] | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [pendentes, setPendentes] = useState<{ key: string; nome: string; tamanho: number }[]>([]);
  const [erroPend, setErroPend] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch("/api/documentacoes/lojas");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar.");
      setLojas(json.lojas);
      setDocs(json.docs);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, []);
  const carregarPendentes = useCallback(async () => {
    try {
      const r = await fetch("/api/documentacoes/pendentes");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao carregar a fila.");
      setPendentes(j.pendentes);
      setErroPend(null);
    } catch (e: any) {
      setErroPend(e.message);
    }
  }, []);
  useEffect(() => {
    carregar();
    carregarPendentes();
  }, [carregar, carregarPendentes]);

  async function enviarArquivos(files: FileList | File[]) {
    const lista = [...files];
    if (!lista.length) return;
    setEnviando(true);
    setResEnvio(null);
    try {
      const resultados: { arquivo: string; status: string; detalhe: string }[] = [];
      for (let i = 0; i < lista.length; i += 3) {
        const fd = new FormData();
        lista.slice(i, i + 3).forEach((f) => fd.append("arquivos", f));
        const r = await fetch("/api/documentacoes/upload", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Falha no envio.");
        resultados.push(...j.resultados);
      }
      setResEnvio(resultados);
      await Promise.all([carregar(), carregarPendentes()]);
    } catch (e: any) {
      setResEnvio([{ arquivo: "", status: "erro", detalhe: e.message }]);
    } finally {
      setEnviando(false);
    }
  }

  async function atribuir(key: string, lojaId: string, tipo: string) {
    const l = lojas.find((x) => x.id === lojaId);
    if (!l || !tipo) return;
    const r = await fetch("/api/documentacoes/pendentes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, tipo, cnpj: l.cnpj, lojaId: l.id }),
    });
    const j = await r.json();
    if (!r.ok) setErroPend(j.error || "Erro ao guardar.");
    await Promise.all([carregar(), carregarPendentes()]);
  }
  async function descartar(key: string) {
    if (!confirm("Excluir este arquivo da fila?")) return;
    await fetch(`/api/documentacoes/pendentes?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    await carregarPendentes();
  }

  async function importar(arquivo: File) {
    setImportando(true);
    setErroImport(null);
    setResultado(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", arquivo);
      const res = await fetch("/api/documentacoes/importar", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Falha na importação.");
      setResultado(json);
      await carregar();
    } catch (e: any) {
      setErroImport(e.message);
    } finally {
      setImportando(false);
    }
  }

  const docsIndex = useMemo(() => {
    const m = new Map<string, Doc[]>();
    for (const d of docs) m.set(`${d.escopo}|${d.chave}`, [...(m.get(`${d.escopo}|${d.chave}`) ?? []), d]);
    return m;
  }, [docs]);

  function estado(l: Loja, tipoId: string): EstadoDoc {
    const t = TIPOS_DOC.find((x) => x.id === tipoId)!;
    const chave = t.escopo === "EMPRESA" ? l.raiz : t.escopo === "CNPJ" ? l.cnpj : l.id;
    const achados = (chave ? docsIndex.get(`${t.escopo}|${chave}`) : undefined)?.filter((d) => d.tipo === tipoId) ?? [];
    if (!achados.length) return "falta";
    const validades = achados.map((d) => d.validade).filter(Boolean) as string[];
    if (validades.length) {
      const maior = Math.max(...validades.map((v) => new Date(v).getTime()));
      const dias = (maior - Date.now()) / 86400000;
      if (dias < 0) return "vencido";
      if (dias <= 30) return "vence";
    }
    return "ok";
  }
  const faltam = (l: Loja) => TIPOS_DOC.filter((t) => t.obrigatorio && estado(l, t.id) === "falta").length;

  const gestores = useMemo(() => [...new Set(lojas.map((l) => l.gestor).filter(Boolean) as string[])].sort(), [lojas]);
  const redes = useMemo(() => [...new Set(lojas.map((l) => l.rede).filter(Boolean) as string[])].sort(), [lojas]);

  const lista = useMemo(() => {
    const q = norm(busca);
    return lojas.filter(
      (l) =>
        (!ocultarInativas || l.ativa) &&
        (!gestor || l.gestor === gestor) &&
        (!rede || l.rede === rede) &&
        (!q || norm(`${l.loja} ${l.razaoSocial ?? ""} ${l.cnpj} ${l.gestor ?? ""} ${l.rede ?? ""}`).includes(q)) &&
        (!soFaltando || faltam(l) > 0)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lojas, busca, gestor, rede, ocultarInativas, soFaltando, docsIndex]);

  return (
    <div style={{ width: "calc(100vw - var(--sidebar-width) - 48px)", maxWidth: 1700, position: "relative", left: "50%", transform: "translateX(-50%)" }}>
      <h1 style={{ marginBottom: 6 }}>Documentações</h1>
      <p style={{ color: "var(--text-dim)", marginTop: 0 }}>
        Documentos das lojas, guardados por empresa e por CNPJ. Clique no nome da loja para ver e enviar os documentos dela.
      </p>

      <div className="card" style={{ padding: "10px 14px", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por loja, razão social, CNPJ, gestor ou rede"
            style={{ minWidth: 300, padding: "7px 10px" }}
            aria-label="Buscar"
          />
          <select value={gestor} onChange={(e) => setGestor(e.target.value)} aria-label="Gestor" style={{ padding: "7px 10px" }}>
            <option value="">Todos os gestores</option>
            {gestores.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <select value={rede} onChange={(e) => setRede(e.target.value)} aria-label="Rede" style={{ padding: "7px 10px" }}>
            <option value="">Todas as redes</option>
            {redes.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={ocultarInativas} onChange={(e) => setOcultarInativas(e.target.checked)} />
            Ocultar lojas inativas
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={soFaltando} onChange={(e) => setSoFaltando(e.target.checked)} />
            Só com documento faltando
          </label>
          <span style={{ flex: 1 }} />
          <label className="btn-importar" style={{ cursor: importando ? "default" : "pointer", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, padding: "6px 12px", background: "var(--panel-2)" }}>
            {importando ? "Importando…" : "Importar planilha de lojas"}
            <input
              type="file"
              accept=".xlsx"
              hidden
              disabled={importando}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importar(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      <div
        className="card"
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastando(false); enviarArquivos(e.dataTransfer.files); }}
        style={{ marginBottom: 14, textAlign: "center", padding: 18, border: `2px dashed ${arrastando ? "var(--green)" : "var(--border)"}` }}
      >
        <div style={{ fontSize: 14 }}>
          {enviando ? "Enviando…" : "Arraste os documentos aqui, ou "}
          {!enviando && (
            <label style={{ textDecoration: "underline", cursor: "pointer" }}>
              escolha os arquivos
              <input type="file" multiple hidden onChange={(e) => { if (e.target.files) enviarArquivos(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
          O app identifica a loja e o tipo pelo nome do arquivo (CNPJ, nome da loja, "alvará", "contrato", "cartão CNPJ"…). O que não identificar vai para a fila abaixo.
        </div>
      </div>
      {resEnvio && (
        <div className="card" style={{ marginBottom: 14, fontSize: 13 }}>
          {resEnvio.map((r, i) => (
            <div key={i} style={{ color: r.status === "erro" ? "var(--red)" : r.status === "pendente" ? "var(--yellow)" : undefined }}>
              {r.arquivo && <strong>{r.arquivo}: </strong>}{r.status === "guardado" ? `guardado como ${r.detalhe}` : r.detalhe}
            </div>
          ))}
        </div>
      )}
      {erroPend && <div className="card" style={{ marginBottom: 14, color: "var(--red)", fontSize: 13 }}>{erroPend}</div>}
      {pendentes.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 13 }}>Fila de não identificados ({pendentes.length})</strong>
          {pendentes.map((p) => (
            <PendenteLinha key={p.key} p={p} lojas={lojas} onAtribuir={atribuir} onDescartar={descartar} />
          ))}
        </div>
      )}

      {erroImport && <div className="card" style={{ marginBottom: 14, color: "var(--red)" }}>{erroImport}</div>}
      {resultado && (
        <div className="card" style={{ marginBottom: 14, fontSize: 13 }}>
          <strong>Planilha {resultado.origem} importada.</strong> {resultado.novas} loja(s) nova(s), {resultado.atualizadas} atualizada(s).{" "}
          {resultado.ignoradasNrn} com NRN no nome ficaram de fora
          {resultado.semCnpj > 0 && `, ${resultado.semCnpj} sem CNPJ`}.
          {resultado.cnpjRepetido.length > 0 && (
            <div style={{ marginTop: 6, color: "var(--text-dim)" }}>
              Mesmo CNPJ ativo em mais de uma loja: {resultado.cnpjRepetido.map((c) => `${fmtCnpj(c.cnpj)} (${c.lojas.join(", ")})`).join("; ")}.
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {erro && <p style={{ color: "var(--red)", padding: 14 }}>{erro}</p>}
        {!erro && !carregando && lojas.length === 0 ? (
          <p style={{ padding: 24, textAlign: "center", color: "var(--text-dim)" }}>
            Nenhuma loja cadastrada ainda. Use "Importar planilha de lojas" com a planilha LOJAS e depois a LOJAS_MFPLAI.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={TH}>Loja</th>
                  <th style={TH}>Razão social</th>
                  <th style={TH}>CNPJ</th>
                  <th style={TH}>Unidade</th>
                  <th style={TH}>Gestor</th>
                  <th style={TH}>Rede</th>
                  <th style={TH}>Documentos</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((l) => (
                  <tr key={l.id} style={l.ativa ? undefined : { opacity: 0.6 }}>
                    <td style={CORTA(260)} title={l.loja}>
                      <Link href={`/documentacoes/${l.id}`}><strong>{l.loja}</strong></Link>
                      {!l.ativa && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-dim)" }}>(inativa)</span>}
                    </td>
                    <td style={CORTA(300)} title={l.razaoSocial ?? ""}>{l.razaoSocial ?? "—"}</td>
                    <td style={{ ...TD, fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12.5 }}>{l.cnpj ? fmtCnpj(l.cnpj) : "sem CNPJ"}</td>
                    <td style={{ ...TD, color: "var(--text-dim)" }}>{l.unidade || "—"}</td>
                    <td style={{ ...TD, color: "var(--text-dim)" }}>{l.gestor ?? "—"}</td>
                    <td style={{ ...TD, color: "var(--text-dim)" }}>{l.rede ?? "—"}</td>
                    <td style={TD}>
                      <div style={{ display: "flex", gap: 5, flexWrap: "nowrap" }}>
                        {TIPOS_DOC.map((t) => {
                          const e = estado(l, t.id);
                          return (
                            <span key={t.id} title={t.nome} style={{ ...chipEstilo[e], fontSize: 11.5, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>
                              {t.curto}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, marginTop: 10 }}>
        Verde: guardado. Cinza: falta enviar. Amarelo: certificado vence em até 30 dias. Vermelho: vencido. Fotos não contam como falta.
        {lista.length > 0 && ` ${lista.length} loja(s) na lista.`}
      </p>
    </div>
  );
}
