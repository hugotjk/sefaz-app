"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Item {
  chave: string;
  referencia: string;
  descricao: string;
  status: string;
  precoPdv: number | null;
  precoCorreto: number | null;
  custoBruto: number | null;
  custoTotal: number | null;
  preco4: number | null;
  nProdutos: number;
}
interface Grupo {
  modelo: string;
  itens: Item[];
}
interface Resposta {
  grupos: Grupo[];
  totalModelos: number;
  totalReferencias: number;
}

const CHAVE_SELECAO = "alteracao-preco:selecionados";
const ROTULO: Record<string, string> = {
  ERRO: "preço errado",
  PRECOS_DIVERGENTES: "preços diferentes",
  SEM_PRECO_PDV: "sem preço",
  AGUARDANDO_PRECO: "aguardando preço",
  EM_PROMOCAO: "em promoção",
  OK: "certo",
  SEM_XML: "sem custo",
  SEM_PRODUTO_PDV: "sem produto",
};
const brl = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function intervaloPadrao() {
  const fim = new Date();
  return { inicio: ymd(new Date(fim.getTime() - 30 * 86_400_000)), fim: ymd(fim) };
}

export default function AlteracaoPrecoPage() {
  const [emitente, setEmitente] = useState("");
  const [emitenteAplicado, setEmitenteAplicado] = useState("");
  const [dataInicial, setDataInicial] = useState(() => intervaloPadrao().inicio);
  const [dataFinal, setDataFinal] = useState(() => intervaloPadrao().fim);
  const [todos, setTodos] = useState(false);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [selecaoCarregada, setSelecaoCarregada] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [msgExport, setMsgExport] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAVE_SELECAO);
      if (raw) setSelecionados(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* sem storage: segue em memória */
    }
    setSelecaoCarregada(true);
  }, []);
  useEffect(() => {
    if (!selecaoCarregada) return;
    try {
      localStorage.setItem(CHAVE_SELECAO, JSON.stringify([...selecionados]));
    } catch {
      /* ignora */
    }
  }, [selecionados, selecaoCarregada]);
  useEffect(() => {
    const id = setTimeout(() => setEmitenteAplicado(emitente), 400);
    return () => clearTimeout(id);
  }, [emitente]);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const qs = new URLSearchParams();
      if (emitenteAplicado.trim()) qs.set("emitente", emitenteAplicado.trim());
      if (dataInicial) qs.set("dataInicial", dataInicial);
      if (dataFinal) qs.set("dataFinal", dataFinal);
      if (todos) qs.set("todos", "1");
      const res = await fetch(`/api/relatorios/alteracao-preco?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar.");
      setDados(json as Resposta);
      setAbertos(new Set());
    } catch (e: any) {
      setErro(e.message);
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [emitenteAplicado, dataInicial, dataFinal, todos]);
  useEffect(() => {
    buscar();
  }, [buscar]);

  function alternar<T>(set: Set<T>, v: T) {
    const prox = new Set(set);
    if (prox.has(v)) prox.delete(v);
    else prox.add(v);
    return prox;
  }
  function alternarModelo(g: Grupo) {
    setSelecionados((prev) => {
      const prox = new Set(prev);
      const todosMarcados = g.itens.every((i) => prox.has(i.chave));
      for (const i of g.itens) {
        if (todosMarcados) prox.delete(i.chave);
        else prox.add(i.chave);
      }
      return prox;
    });
  }

  async function exportar() {
    if (selecionados.size === 0 || exportando) return;
    setExportando(true);
    setMsgExport(null);
    try {
      const res = await fetch("/api/relatorios/alteracao-preco/exportar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chaves: [...selecionados], emitente: emitenteAplicado.trim(), dataInicial, dataFinal }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Erro ao gerar o arquivo.");
      }
      const nome = res.headers.get("X-Nome-Arquivo") || "ALTERACAO_PRECO.xlsx";
      const r = JSON.parse(decodeURIComponent(res.headers.get("X-Resumo") || "{}"));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const avisos: string[] = [];
      if (r.semPreco3) avisos.push(`${r.semPreco3} referência(s) sem Preço 3 (célula amarela)`);
      if (r.semCodigoPdv?.length) avisos.push(`${r.semCodigoPdv.length} fora da planilha (sem produto na MULTI)`);
      setMsgExport(`${nome}: ${r.linhas ?? "?"} linha${r.linhas === 1 ? "" : "s"}` + (avisos.length ? ` · atenção: ${avisos.join("; ")}` : ""));
    } catch (e: any) {
      setMsgExport(`Erro: ${e.message}`);
    } finally {
      setExportando(false);
    }
  }

  const grupos = dados?.grupos ?? [];
  const todosAbertos = grupos.length > 0 && grupos.every((g) => abertos.has(g.modelo));
  const filtroAtivo =
    emitenteAplicado.trim() !== "" || dataInicial !== intervaloPadrao().inicio || dataFinal !== intervaloPadrao().fim || todos;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Alteração de Preço</h1>
        <Link href="/relatorios" style={{ color: "var(--text-dim)", fontSize: 13 }}>
          ← Relatórios
        </Link>
      </div>

      <div className="card notes-filtros-card">
        <div className="notes-filtros">
          <div className="notes-filtros-linha linha-empresa">
            <div className="field">
              <label>Emitente</label>
              <input type="text" placeholder="Filtrar por nome do emitente…" value={emitente} onChange={(e) => setEmitente(e.target.value)} />
            </div>
          </div>
          <div className="notes-filtros-linha" style={{ gridTemplateColumns: "minmax(150px,190px) minmax(150px,190px)" }}>
            <div className="field">
              <label>Data inicial (emissão)</label>
              <input type="date" value={dataInicial} max={dataFinal || undefined} onChange={(e) => setDataInicial(e.target.value)} />
            </div>
            <div className="field">
              <label>Data final (emissão)</label>
              <input type="date" value={dataFinal} min={dataInicial || undefined} onChange={(e) => setDataFinal(e.target.value)} />
            </div>
          </div>
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
            Mostrar também os que já estão com o preço certo
          </label>
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "-2px 0 0" }}>
            Só produtos já cadastrados na MULTI. Por padrão aparecem os com preço errado, sem preço ou com preços diferentes entre as variações.
          </p>
          {filtroAtivo && (
            <div className="notes-filtros-rodape">
              <button
                type="button"
                className="btn-secundario"
                onClick={() => {
                  setEmitente("");
                  setEmitenteAplicado("");
                  setDataInicial(intervaloPadrao().inicio);
                  setDataFinal(intervaloPadrao().fim);
                  setTodos(false);
                }}
              >
                Limpar filtros
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        {erro ? (
          <p style={{ color: "var(--red)" }}>{erro}</p>
        ) : !dados && carregando ? (
          <p style={{ color: "var(--text-dim)" }}>Carregando…</p>
        ) : grupos.length === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>Nenhum produto com preço a alterar no filtro selecionado.</p>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
              <p className="notes-pag" style={{ justifyContent: "flex-start", margin: 0 }}>
                {dados!.totalReferencias.toLocaleString("pt-BR")} referência{dados!.totalReferencias === 1 ? "" : "s"} em{" "}
                {dados!.totalModelos.toLocaleString("pt-BR")} modelo{dados!.totalModelos === 1 ? "" : "s"}
                {carregando ? " · atualizando…" : ""}
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  {selecionados.size.toLocaleString("pt-BR")} selecionada{selecionados.size === 1 ? "" : "s"}
                </span>
                {selecionados.size > 0 && (
                  <button type="button" className="btn-secundario" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setSelecionados(new Set())}>
                    Limpar seleção
                  </button>
                )}
                <button type="button" className="btn" style={{ padding: "5px 12px", fontSize: 12 }} disabled={selecionados.size === 0 || exportando} onClick={exportar}>
                  {exportando ? "Gerando…" : "⬇ Exportar planilha"}
                </button>
                <button
                  type="button"
                  className="btn-secundario"
                  style={{ padding: "5px 10px", fontSize: 12 }}
                  onClick={() => setAbertos(todosAbertos ? new Set() : new Set(grupos.map((g) => g.modelo)))}
                >
                  {todosAbertos ? "Recolher todos" : "Expandir todos"}
                </button>
              </div>
            </div>
            {msgExport && (
              <p style={{ fontSize: 12, margin: "-4px 0 12px", color: msgExport.startsWith("Erro") ? "var(--red)" : "var(--text-dim)" }}>{msgExport}</p>
            )}

            <div className="cp-grupos">
              {grupos.map((g) => {
                const aberto = abertos.has(g.modelo);
                const marcados = g.itens.filter((i) => selecionados.has(i.chave)).length;
                return (
                  <div key={g.modelo} className={`cp-grupo${aberto ? " aberto" : ""}`}>
                    <div className="cp-grupo-topo">
                      <label className="cp-sel" title="Marcar/desmarcar todas as referências deste modelo">
                        <input
                          type="checkbox"
                          checked={marcados === g.itens.length && g.itens.length > 0}
                          ref={(el) => {
                            if (el) el.indeterminate = marcados > 0 && marcados < g.itens.length;
                          }}
                          onChange={() => alternarModelo(g)}
                          aria-label={`Selecionar todas as referências de ${g.modelo}`}
                        />
                      </label>
                      <button type="button" className="cp-grupo-cab" onClick={() => setAbertos((p) => alternar(p, g.modelo))} aria-expanded={aberto}>
                        <span className="cp-chevron">▶</span>
                        <span className="cp-grupo-modelo">{g.modelo}</span>
                        <span className="cp-grupo-cont">
                          {marcados > 0 ? `${marcados}/` : ""}
                          {g.itens.length} referência{g.itens.length === 1 ? "" : "s"}
                        </span>
                      </button>
                    </div>
                    {aberto && (
                      <div className="cp-refs">
                        {g.itens.map((i) => (
                          <div key={i.chave} className="cp-ref cp-ref-selecionavel">
                            <label className="cp-sel" title="Marcar esta referência">
                              <input type="checkbox" checked={selecionados.has(i.chave)} onChange={() => setSelecionados((p) => alternar(p, i.chave))} aria-label={`Selecionar ${i.referencia}`} />
                            </label>
                            <span className="cp-ref-ref">{i.referencia}</span>
                            <span className="cp-ref-desc">
                              <span className="cp-ref-desc-txt" title={i.descricao}>
                                {i.descricao}
                              </span>
                              <span className="cp-ref-meta">
                                {ROTULO[i.status] ?? i.status} · PDV {brl(i.precoPdv)} → Preço 3 {brl(i.precoCorreto)} · {i.nProdutos} produto{i.nProdutos === 1 ? "" : "s"} no PDV
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
