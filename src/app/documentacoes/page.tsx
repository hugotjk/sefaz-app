"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  id: string;
  nomeArquivo: string;
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
interface FormLoja {
  id?: string;
  loja: string;
  razaoSocial: string;
  cnpj: string;
  gestor: string;
  rede: string;
  ativa: boolean;
}
interface Alvo {
  loja: Loja;
  tipo: string;
  validade?: string;
  todos?: boolean;
}

const FORM_VAZIO: FormLoja = { loja: "", razaoSocial: "", cnpj: "", gestor: "", rede: "", ativa: true };

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

const TD: React.CSSProperties = { whiteSpace: "nowrap", padding: "8px 10px", fontSize: 13, borderBottom: "1px solid var(--border)" };
const TH: React.CSSProperties = {
  whiteSpace: "nowrap", padding: "8px 10px", fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".05em",
  color: "var(--text-dim)", textAlign: "left", borderBottom: "1px solid var(--border)", fontWeight: 500,
};
const CORTA = (w: number): React.CSSProperties => ({ ...TD, maxWidth: w, overflow: "hidden", textOverflow: "ellipsis" });
const BTN: React.CSSProperties = { fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, padding: "6px 12px", background: "var(--panel-2)" };

type EstadoDoc = "ok" | "falta" | "vence" | "vencido";
const chipEstilo: Record<EstadoDoc, React.CSSProperties> = {
  ok: { background: "rgba(21,128,61,.12)", color: "var(--green)", border: "1px solid transparent" },
  falta: { background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)" },
  vence: { background: "rgba(180,83,9,.14)", color: "var(--yellow)", border: "1px solid transparent" },
  vencido: { background: "rgba(220,38,38,.12)", color: "var(--red)", border: "1px solid transparent" },
};

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
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [aberto, setAberto] = useState<{ lojaId: string; tipo: string } | null>(null);
  const [validade, setValidade] = useState("");
  const [todos, setTodos] = useState(true);
  const [form, setForm] = useState<FormLoja | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const alvoRef = useRef<Alvo | null>(null);

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
  useEffect(() => {
    carregar();
  }, [carregar]);

  // ---------- envio de documentos (sempre escolhido na mão, pelo chip) ----------
  async function enviar(alvo: Alvo, files: File[]) {
    if (!files.length) return;
    setEnviando(`${alvo.loja.id}|${alvo.tipo}`);
    setMsg(null);
    try {
      const out: { arquivo: string; status: string; detalhe: string }[] = [];
      for (let i = 0; i < files.length; i += 3) {
        const fd = new FormData();
        files.slice(i, i + 3).forEach((f) => fd.append("arquivos", f));
        fd.append("tipo", alvo.tipo);
        fd.append("cnpj", alvo.loja.cnpj);
        fd.append("lojaId", alvo.loja.id);
        if (alvo.validade) fd.append("validade", alvo.validade);
        if (alvo.todos) fd.append("todosCnpjs", "1");
        const r = await fetch("/api/documentacoes/upload", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Falha no envio.");
        out.push(...j.resultados);
      }
      const ruins = out.filter((x) => x.status === "erro");
      if (ruins.length) setMsg({ ok: false, texto: ruins.map((x) => `${x.arquivo}: ${x.detalhe}`).join(" • ") });
      else if (out.every((x) => x.status === "repetido")) setMsg({ ok: true, texto: `${alvo.loja.loja}: esse arquivo já estava guardado.` });
      else setMsg({ ok: true, texto: `${alvo.loja.loja}: guardado como ${out.map((x) => x.detalhe).join(" | ")}` });
      await carregar();
    } catch (e: any) {
      setMsg({ ok: false, texto: e.message });
    } finally {
      setEnviando(null);
    }
  }

  function escolherArquivo(alvo: Alvo) {
    alvoRef.current = alvo;
    if (inputRef.current) {
      inputRef.current.multiple = alvo.tipo === "foto";
      inputRef.current.click();
    }
  }

  async function excluirDoc(d: Doc) {
    if (!confirm(`Excluir "${d.nomeArquivo}"? Isso apaga o arquivo guardado.`)) return;
    const r = await fetch(`/api/documentacoes/arquivo?id=${d.id}`, { method: "DELETE" });
    if (!r.ok) setMsg({ ok: false, texto: "Não foi possível excluir." });
    setAberto(null);
    await carregar();
  }

  // ---------- cadastro de loja ----------
  async function salvarLoja() {
    if (!form) return;
    setSalvando(true);
    setErroForm(null);
    try {
      const corpo = JSON.stringify({ loja: form.loja, razaoSocial: form.razaoSocial, cnpj: form.cnpj, gestor: form.gestor, rede: form.rede, ativa: form.ativa });
      const r = await fetch(form.id ? `/api/documentacoes/loja/${form.id}` : "/api/documentacoes/lojas", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: corpo,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao salvar a loja.");
      setForm(null);
      setMsg({ ok: true, texto: form.id ? "Loja atualizada." : "Loja cadastrada." });
      await carregar();
    } catch (e: any) {
      setErroForm(e.message);
    } finally {
      setSalvando(false);
    }
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

  // quantos CNPJs distintos cada empresa (raiz do CNPJ) tem cadastrados
  const cnpjsPorRaiz = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of lojas) if (l.raiz && l.cnpj) m.set(l.raiz, (m.get(l.raiz) ?? new Set()).add(l.cnpj));
    return m;
  }, [lojas]);

  function arquivosDe(l: Loja, tipoId: string): Doc[] {
    const t = TIPOS_DOC.find((x) => x.id === tipoId)!;
    const chave = t.escopo === "EMPRESA" ? l.raiz : t.escopo === "CNPJ" ? l.cnpj : l.id;
    return (chave ? docsIndex.get(`${t.escopo}|${chave}`) : undefined)?.filter((d) => d.tipo === tipoId) ?? [];
  }
  function estado(l: Loja, tipoId: string): EstadoDoc {
    const achados = arquivosDe(l, tipoId);
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

  function clicarChip(l: Loja, tipoId: string) {
    if (!l.cnpj) {
      setMsg({ ok: false, texto: `${l.loja} está sem CNPJ. Clique em "editar" e informe o CNPJ antes de enviar documentos.` });
      return;
    }
    const irmaos = cnpjsPorRaiz.get(l.raiz)?.size ?? 1;
    const precisaPainel = arquivosDe(l, tipoId).length > 0 || tipoId === "cert" || (tipoId === "contrato" && irmaos > 1);
    if (precisaPainel) {
      const igual = aberto?.lojaId === l.id && aberto.tipo === tipoId;
      setValidade("");
      setTodos(true);
      setAberto(igual ? null : { lojaId: l.id, tipo: tipoId });
    } else {
      setAberto(null);
      escolherArquivo({ loja: l, tipo: tipoId });
    }
  }

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

  const campo = (rotulo: string, valor: string, set: (v: string) => void, opc?: { desabilitado?: boolean; placeholder?: string }) => (
    <label style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
      {rotulo}
      <input value={valor} onChange={(e) => set(e.target.value)} disabled={opc?.desabilitado} placeholder={opc?.placeholder} style={{ padding: "6px 8px" }} />
    </label>
  );

  return (
    <div style={{ width: "calc(100vw - var(--sidebar-width) - 48px)", maxWidth: 1700, position: "relative", left: "50%", transform: "translateX(-50%)" }}>
      <h1 style={{ marginBottom: 6 }}>Documentações</h1>
      <p style={{ color: "var(--text-dim)", marginTop: 0 }}>
        Cadastre a loja e clique no documento (Contrato, Cartão CNPJ, IE…) para escolher o arquivo no seu computador. Nada é identificado
        automaticamente: o arquivo vai para a loja em que você clicou.
      </p>

      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(e) => {
          const fs = e.target.files ? [...e.target.files] : [];
          const alvo = alvoRef.current;
          e.target.value = "";
          if (alvo && fs.length) enviar(alvo, fs);
        }}
      />

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
          <button onClick={() => { setErroForm(null); setForm({ ...FORM_VAZIO }); }} style={BTN}>+ Nova loja</button>
          <a href="/api/documentacoes/modelo" style={{ ...BTN, textDecoration: "none", color: "inherit" }}>Baixar modelo (xlsx)</a>
          <label style={{ ...BTN, cursor: importando ? "default" : "pointer" }}>
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

      {msg && (
        <div className="card" style={{ marginBottom: 14, fontSize: 13, color: msg.ok ? undefined : "var(--red)" }}>
          {msg.texto}
          <a href="#" onClick={(ev) => { ev.preventDefault(); setMsg(null); }} style={{ float: "right", fontSize: 12 }}>fechar</a>
        </div>
      )}
      {erroImport && <div className="card" style={{ marginBottom: 14, color: "var(--red)" }}>{erroImport}</div>}
      {resultado && (
        <div className="card" style={{ marginBottom: 14, fontSize: 13 }}>
          <strong>Planilha importada.</strong> {resultado.novas} loja(s) nova(s), {resultado.atualizadas} atualizada(s).{" "}
          {resultado.ignoradasNrn > 0 && `${resultado.ignoradasNrn} com NRN no nome ficaram de fora`}
          {resultado.semCnpj > 0 && `, ${resultado.semCnpj} sem CNPJ (cadastre o CNPJ em "editar" para enviar documentos)`}.
          {resultado.cnpjRepetido.length > 0 && (
            <div style={{ marginTop: 6, color: "var(--text-dim)" }}>
              Mesmo CNPJ ativo em mais de uma loja: {resultado.cnpjRepetido.map((c) => `${fmtCnpj(c.cnpj)} (${c.lojas.join(", ")})`).join("; ")}.
            </div>
          )}
        </div>
      )}

      {form && (
        <div className="card" style={{ marginBottom: 14, padding: 14 }}>
          <strong style={{ fontSize: 14 }}>{form.id ? "Editar loja" : "Nova loja"}</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 10 }}>
            {campo("Loja *", form.loja, (v) => setForm({ ...form, loja: v }))}
            {campo("Razão social", form.razaoSocial, (v) => setForm({ ...form, razaoSocial: v }))}
            {campo(form.id ? "CNPJ (não muda aqui)" : "CNPJ *", form.cnpj, (v) => setForm({ ...form, cnpj: v }), { desabilitado: !!form.id, placeholder: "00.000.000/0000-00" })}
            {campo("Gestor", form.gestor, (v) => setForm({ ...form, gestor: v }))}
            {campo("Rede", form.rede, (v) => setForm({ ...form, rede: v }))}
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, alignSelf: "end", paddingBottom: 6 }}>
              <input type="checkbox" checked={form.ativa} onChange={(e) => setForm({ ...form, ativa: e.target.checked })} />
              Loja ativa
            </label>
          </div>
          {erroForm && <p style={{ color: "var(--red)", fontSize: 13, margin: "8px 0 0" }}>{erroForm}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={salvarLoja} disabled={salvando || !form.loja.trim() || (!form.id && !form.cnpj.trim())} style={BTN}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
            <button onClick={() => setForm(null)} disabled={salvando} style={BTN}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {erro && <p style={{ color: "var(--red)", padding: 14 }}>{erro}</p>}
        {!erro && !carregando && lojas.length === 0 ? (
          <p style={{ padding: 24, textAlign: "center", color: "var(--text-dim)" }}>
            Nenhuma loja cadastrada ainda. Use "+ Nova loja", ou baixe o modelo (xlsx), preencha e use "Importar planilha de lojas".
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
                    <td style={CORTA(300)} title={l.loja}>
                      <Link href={`/documentacoes/${l.id}`}><strong>{l.loja}</strong></Link>
                      {!l.ativa && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-dim)" }}>(inativa)</span>}
                      <a
                        href="#"
                        onClick={(ev) => {
                          ev.preventDefault();
                          setErroForm(null);
                          setForm({ id: l.id, loja: l.loja, razaoSocial: l.razaoSocial ?? "", cnpj: l.cnpj, gestor: l.gestor ?? "", rede: l.rede ?? "", ativa: l.ativa });
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        style={{ marginLeft: 8, fontSize: 11.5 }}
                      >
                        editar
                      </a>
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
                          const arqs = arquivosDe(l, t.id);
                          const aberta = aberto?.lojaId === l.id && aberto.tipo === t.id;
                          const ocupado = enviando === `${l.id}|${t.id}`;
                          const irmaos = cnpjsPorRaiz.get(l.raiz)?.size ?? 1;
                          return (
                            <span key={t.id} style={{ position: "relative" }}>
                              <span
                                title={arqs.length ? `${t.nome} — clique para ver, baixar ou enviar outro` : `${t.nome} — clique para escolher o arquivo`}
                                onClick={() => !enviando && clicarChip(l, t.id)}
                                style={{ ...chipEstilo[e], fontSize: 11.5, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap", cursor: enviando ? "wait" : "pointer", display: "inline-block", opacity: ocupado ? 0.6 : 1 }}
                              >
                                {ocupado ? "Enviando…" : t.curto}
                              </span>
                              {aberta && (
                                <div
                                  className="card"
                                  style={{ position: "absolute", top: "100%", left: 0, zIndex: 20, marginTop: 4, padding: 10, minWidth: 340, boxShadow: "0 6px 20px rgba(0,0,0,.18)" }}
                                >
                                  <div style={{ fontSize: 12.5, marginBottom: 6 }}><strong>{t.nome}</strong> — {l.loja}</div>
                                  {arqs.map((a) => (
                                    <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, padding: "4px 2px" }}>
                                      <span style={{ flex: 1, whiteSpace: "normal" }}>{a.nomeArquivo}</span>
                                      <a href={`/api/documentacoes/arquivo?id=${a.id}&ver=1`} target="_blank" rel="noreferrer">Ver</a>
                                      <a href={`/api/documentacoes/arquivo?id=${a.id}`}>Baixar</a>
                                      <a href="#" onClick={(ev) => { ev.preventDefault(); excluirDoc(a); }} style={{ color: "var(--red)" }}>Excluir</a>
                                    </div>
                                  ))}
                                  {t.id === "cert" && (
                                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginTop: 6 }}>
                                      Validade do certificado <input type="date" value={validade} onChange={(ev) => setValidade(ev.target.value)} />
                                    </label>
                                  )}
                                  {t.id === "contrato" && irmaos > 1 && (
                                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginTop: 6 }}>
                                      <input type="checkbox" checked={todos} onChange={(ev) => setTodos(ev.target.checked)} />
                                      usar para todos os CNPJs da empresa ({irmaos})
                                    </label>
                                  )}
                                  <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 8 }}>
                                    <button
                                      style={BTN}
                                      onClick={() => {
                                        setAberto(null);
                                        escolherArquivo({ loja: l, tipo: t.id, validade: t.id === "cert" ? validade : undefined, todos: t.id === "contrato" && irmaos > 1 ? todos : false });
                                      }}
                                    >
                                      {arqs.length ? (t.id === "foto" ? "Enviar mais fotos…" : "Enviar outro arquivo…") : t.id === "foto" ? "Escolher fotos…" : "Escolher arquivo…"}
                                    </button>
                                    <span style={{ flex: 1 }} />
                                    <a href={`/documentacoes/${l.id}`} style={{ fontSize: 12 }}>Abrir loja</a>
                                    <a href="#" onClick={(ev) => { ev.preventDefault(); setAberto(null); }} style={{ fontSize: 12 }}>Fechar</a>
                                  </div>
                                </div>
                              )}
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
        Verde: guardado. Cinza: falta enviar (clique para escolher o arquivo). Amarelo: certificado vence em até 30 dias. Vermelho: vencido. Fotos não contam como falta.
        {lista.length > 0 && ` ${lista.length} loja(s) na lista.`}
      </p>
    </div>
  );
}
