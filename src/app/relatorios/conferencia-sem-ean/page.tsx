"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface ProdutoSemEan {
  chave: string;
  referencia: string | null;
  descricao: string;
  emitenteNome: string | null;
  nNotas: number;
  eansNota: string[];
  variacoesComEan: number;
  variacoesTotal: number;
}

interface GrupoModelo {
  modelo: string | null;
  produtos: ProdutoSemEan[];
}

interface Resposta {
  grupos: GrupoModelo[];
  totalModelos: number;
  totalProdutos: number;
  totalEans: number;
  pagina: number;
  porPagina: number;
  aguardandoEnriquecimento: number;
}

const chaveModelo = (m: string | null) => m ?? " sem-modelo";
const MAX_EANS_VISIVEIS = 4;

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
// Padrão: últimos 30 dias (não persiste).
function intervaloPadrao() {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { inicio: ymd(inicio), fim: ymd(fim) };
}

export default function ConferenciaSemEanPage() {
  const [emitente, setEmitente] = useState("");
  const [emitenteAplicado, setEmitenteAplicado] = useState("");
  const [dataInicial, setDataInicial] = useState(() => intervaloPadrao().inicio);
  const [dataFinal, setDataFinal] = useState(() => intervaloPadrao().fim);
  const [pagina, setPagina] = useState(1);

  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  // Produtos marcados para a planilha de Alteração de Cadastro (chave = [modelo, referencia]); mantém entre páginas/filtros.
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [exportando, setExportando] = useState(false);
  const [msgExport, setMsgExport] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setEmitenteAplicado(emitente);
      setPagina(1);
    }, 400);
    return () => clearTimeout(id);
  }, [emitente]);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const qs = new URLSearchParams({ pagina: String(pagina) });
      if (emitenteAplicado.trim()) qs.set("emitente", emitenteAplicado.trim());
      if (dataInicial) qs.set("dataInicial", dataInicial);
      if (dataFinal) qs.set("dataFinal", dataFinal);

      const res = await fetch(`/api/relatorios/conferencia-sem-ean?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar o relatório.");
      setDados(json as Resposta);
      setAbertos(new Set());
    } catch (e: any) {
      setErro(e.message);
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [pagina, dataInicial, dataFinal, emitenteAplicado]);

  useEffect(() => {
    buscar();
  }, [buscar]);

  function aoMudarData(qual: "inicial" | "final", valor: string) {
    if (qual === "inicial") setDataInicial(valor);
    else setDataFinal(valor);
    setPagina(1);
  }

  function limparFiltros() {
    setEmitente("");
    setEmitenteAplicado("");
    const p = intervaloPadrao();
    setDataInicial(p.inicio);
    setDataFinal(p.fim);
    setPagina(1);
  }

  function alternarGrupo(chave: string) {
    setAbertos((prev) => {
      const prox = new Set(prev);
      if (prox.has(chave)) prox.delete(chave);
      else prox.add(chave);
      return prox;
    });
  }

  const grupos = dados?.grupos ?? [];
  const todasChaves = useMemo(() => grupos.map((g) => chaveModelo(g.modelo)), [grupos]);
  const todosAbertos = todasChaves.length > 0 && todasChaves.every((k) => abertos.has(k));

  function alternarTodos() {
    setAbertos(todosAbertos ? new Set() : new Set(todasChaves));
  }

  function alternarProduto(chave: string) {
    setSelecionados((prev) => {
      const prox = new Set(prev);
      if (prox.has(chave)) prox.delete(chave);
      else prox.add(chave);
      return prox;
    });
  }
  function alternarModeloSel(g: GrupoModelo) {
    setSelecionados((prev) => {
      const prox = new Set(prev);
      const todos = g.produtos.every((p) => prox.has(p.chave));
      for (const p of g.produtos) {
        if (todos) prox.delete(p.chave);
        else prox.add(p.chave);
      }
      return prox;
    });
  }
  function marcarPagina() {
    setSelecionados((prev) => {
      const prox = new Set(prev);
      const todos = grupos.every((g) => g.produtos.every((p) => prox.has(p.chave)));
      for (const g of grupos) for (const p of g.produtos) {
        if (todos) prox.delete(p.chave);
        else prox.add(p.chave);
      }
      return prox;
    });
  }

  async function exportar() {
    if (selecionados.size === 0 || exportando) return;
    setExportando(true);
    setMsgExport(null);
    try {
      const res = await fetch("/api/relatorios/conferencia-sem-ean/exportar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chaves: [...selecionados] }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Erro ao gerar o arquivo.");
      }
      const nome = res.headers.get("X-Nome-Arquivo") || "ALTERACAO_DE_CADASTRO.xlsx";
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
      if (r.semProdutoPdv?.length) avisos.push(`${r.semProdutoPdv.length} sem produto na MULTI (fora da planilha)`);
      if (r.eansSemPosicao?.length) avisos.push(`${r.eansSemPosicao.length} EAN(s) da nota não encaixados (célula EANs em amarelo): ${r.eansSemPosicao.slice(0, 3).join(" | ")}${r.eansSemPosicao.length > 3 ? " …" : ""}`);
      setMsgExport(`${nome}: ${r.linhas ?? "?"} linha${r.linhas === 1 ? "" : "s"} · ${r.eansPreenchidos ?? 0} EAN(s) da nota encaixados` + (avisos.length ? ` · atenção: ${avisos.join("; ")}` : ""));
    } catch (e: any) {
      setMsgExport(`Erro: ${e.message}`);
    } finally {
      setExportando(false);
    }
  }

  const totalModelos = dados?.totalModelos ?? 0;
  const totalProdutos = dados?.totalProdutos ?? 0;
  const totalEans = dados?.totalEans ?? 0;
  const aguardando = dados?.aguardandoEnriquecimento ?? 0;
  const porPagina = dados?.porPagina ?? 25;
  const totalPaginas = Math.max(1, Math.ceil(totalModelos / porPagina));
  const inicio = totalModelos === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fim = Math.min(pagina * porPagina, totalModelos);
  const filtroAtivo =
    emitenteAplicado.trim() !== "" ||
    dataInicial !== intervaloPadrao().inicio ||
    dataFinal !== intervaloPadrao().fim;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h1 style={{ margin: 0 }}>Conferência de Produtos Sem EAN</h1>
        <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 13 }}>
          <Link href="/relatorios" style={{ color: "var(--text-dim)" }}>
            ← Relatórios
          </Link>
        </div>
      </div>

      <p style={{ color: "var(--text-dim)", fontSize: 13, margin: "0 0 14px" }}>
        Produtos que <b>já existem no sistema</b> (mesma referência e modelo), mas cujo{" "}
        <b>EAN da nota fiscal não está cadastrado</b> em nenhuma variação.
      </p>

      {aguardando > 0 && (
        <div className="card aviso-sem-regra aberto">
          <p style={{ margin: 0 }}>
            <strong>{aguardando.toLocaleString("pt-BR")}</strong> produto
            {aguardando === 1 ? "" : "s"} ainda não aparece{aguardando === 1 ? "" : "m"}{" "}
            aqui: o sistema ainda não consultou os EANs de todas as variações deles
            (atualização do catálogo em andamento). Entram na lista automaticamente
            quando forem consultados.
          </p>
        </div>
      )}

      <div className="card notes-filtros-card">
        <div className="notes-filtros">
          <div className="notes-filtros-linha linha-empresa">
            <div className="field">
              <label>Emitente</label>
              <input
                type="text"
                placeholder="Filtrar por nome do emitente…"
                value={emitente}
                onChange={(e) => setEmitente(e.target.value)}
              />
            </div>
          </div>
          <div
            className="notes-filtros-linha"
            style={{ gridTemplateColumns: "minmax(150px,190px) minmax(150px,190px)" }}
          >
            <div className="field">
              <label>Data inicial (emissão)</label>
              <input
                type="date"
                value={dataInicial}
                max={dataFinal || undefined}
                onChange={(e) => aoMudarData("inicial", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Data final (emissão)</label>
              <input
                type="date"
                value={dataFinal}
                min={dataInicial || undefined}
                onChange={(e) => aoMudarData("final", e.target.value)}
              />
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "-2px 0 0" }}>
            Padrão: últimos 30 dias (some ao recarregar a página). Deixe em branco pra ver todos os períodos.
          </p>
          {filtroAtivo && (
            <div className="notes-filtros-rodape">
              <button type="button" className="btn-secundario" onClick={limparFiltros}>
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
        ) : totalModelos === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>
            Nenhum produto com EAN da nota ausente no sistema no filtro selecionado.
          </p>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 14,
              }}
            >
              <p className="notes-pag" style={{ justifyContent: "flex-start", margin: 0 }}>
                {totalProdutos.toLocaleString("pt-BR")} produto
                {totalProdutos === 1 ? "" : "s"} ({totalEans.toLocaleString("pt-BR")} EAN
                {totalEans === 1 ? "" : "s"}) sem EAN no sistema em{" "}
                {totalModelos.toLocaleString("pt-BR")} modelo
                {totalModelos === 1 ? "" : "s"}
                {carregando ? " · atualizando…" : ""}
              </p>
              <button
                type="button"
                className="btn-secundario"
                style={{ padding: "5px 10px", fontSize: 12 }}
                onClick={alternarTodos}
              >
                {todosAbertos ? "Recolher todos" : "Expandir todos"}
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12, fontSize: 13 }}>
              <button type="button" className="btn-secundario" style={{ width: "auto", padding: "5px 10px", fontSize: 12 }} onClick={marcarPagina}>
                Marcar/desmarcar todos da página
              </button>
              <span style={{ color: "var(--text-dim)" }}>
                {selecionados.size.toLocaleString("pt-BR")} produto{selecionados.size === 1 ? "" : "s"} marcado{selecionados.size === 1 ? "" : "s"} para alteração de cadastro (só produtos da MULTI)
              </span>
              {selecionados.size > 0 && (
                <button type="button" className="btn-secundario" style={{ width: "auto", padding: "5px 10px", fontSize: 12 }} onClick={() => setSelecionados(new Set())}>
                  Limpar seleção
                </button>
              )}
              <button type="button" style={{ width: "auto", padding: "5px 12px", fontSize: 12 }} disabled={selecionados.size === 0 || exportando} onClick={exportar}>
                {exportando ? "Gerando…" : "Exportar alteração de cadastro"}
              </button>
              {msgExport && <span style={{ color: msgExport.startsWith("Erro") ? "var(--red)" : "var(--text-dim)" }}>{msgExport}</span>}
            </div>

            <div className="cp-grupos">
              {grupos.map((g) => {
                const ck = chaveModelo(g.modelo);
                const aberto = abertos.has(ck);
                const marcadosNoGrupo = g.produtos.filter((p) => selecionados.has(p.chave)).length;
                return (
                  <div key={ck} className={`cp-grupo${aberto ? " aberto" : ""}`}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      title="Marcar todas as referências deste modelo"
                      style={{ width: "auto", marginLeft: 8 }}
                      checked={g.produtos.length > 0 && marcadosNoGrupo === g.produtos.length}
                      ref={(el) => { if (el) el.indeterminate = marcadosNoGrupo > 0 && marcadosNoGrupo < g.produtos.length; }}
                      onChange={() => alternarModeloSel(g)}
                    />
                    <button
                      type="button"
                      className="cp-grupo-cab"
                      style={{ flex: 1 }}
                      onClick={() => alternarGrupo(ck)}
                      aria-expanded={aberto}
                    >
                      <span className="cp-chevron">▶</span>
                      <span className="cp-grupo-modelo">
                        {g.modelo || <span className="cp-sem-modelo">(sem modelo)</span>}
                      </span>
                      <span className="cp-grupo-cont">
                        {g.produtos.length} referência{g.produtos.length === 1 ? "" : "s"}
                        {marcadosNoGrupo > 0 ? ` · ${marcadosNoGrupo} marcada${marcadosNoGrupo === 1 ? "" : "s"}` : ""}
                      </span>
                    </button>
                    </div>
                    {aberto && (
                      <div className="cp-refs">
                        {g.produtos.map((p) => (
                          <div key={p.chave} className="cp-ref">
                            <input
                              type="checkbox"
                              style={{ width: "auto", marginRight: 8 }}
                              checked={selecionados.has(p.chave)}
                              onChange={() => alternarProduto(p.chave)}
                            />
                            <span className="cp-ref-ref">{p.referencia || "-"}</span>
                            <span className="cp-ref-desc">
                              <span className="cp-ref-desc-txt" title={p.descricao}>
                                {p.descricao}
                              </span>
                              <span className="cp-ref-meta">
                                {p.nNotas} nota{p.nNotas === 1 ? "" : "s"}
                                {" · "}
                                sistema: {p.variacoesComEan}/{p.variacoesTotal} variações com EAN
                                {" · "}
                                <span title={p.eansNota.join(", ")}>
                                  EAN da nota: {p.eansNota.slice(0, MAX_EANS_VISIVEIS).join(", ")}
                                  {p.eansNota.length > MAX_EANS_VISIVEIS
                                    ? ` +${p.eansNota.length - MAX_EANS_VISIVEIS}`
                                    : ""}
                                </span>
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

            <div className="notes-pag">
              <span>
                Modelos {inicio}&ndash;{fim} de {totalModelos.toLocaleString("pt-BR")}
              </span>
              <div className="notes-pag-controles">
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  disabled={pagina <= 1 || carregando}
                >
                  ← Anterior
                </button>
                <span>
                  {pagina} / {totalPaginas}
                </span>
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                  disabled={pagina >= totalPaginas || carregando}
                >
                  Próxima →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
