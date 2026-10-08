"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface ProdutoSemCadastro {
  chave: string;
  referencia: string | null;
  descricao: string;
  ean: string | null;
  emitenteNome: string | null;
  comRegraEspecifica: boolean;
  nNotas: number;
}

interface GrupoModelo {
  modelo: string | null;
  produtos: ProdutoSemCadastro[];
}

interface FornecedorSemRegra {
  emitente: string;
  itens: number;
}

interface Resposta {
  grupos: GrupoModelo[];
  totalModelos: number;
  totalProdutos: number;
  pagina: number;
  porPagina: number;
  semRegraModelo: FornecedorSemRegra[];
  semRegraReferencia: FornecedorSemRegra[];
  banidos: FornecedorSemRegra[];
}

const chaveModelo = (m: string | null) => m ?? " sem-modelo";
const CHAVE_SELECAO = "conferencia-produtos:selecionados";

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
// Padrão: últimos 30 dias. Não persiste — toda vez que a página carrega, volta
// a isso.
function intervaloPadrao() {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { inicio: ymd(inicio), fim: ymd(fim) };
}

export default function ConferenciaProdutosPage() {
  const [emitente, setEmitente] = useState("");
  const [emitenteAplicado, setEmitenteAplicado] = useState("");
  // filtro de data — pré-preenchido com os últimos 30 dias, editável livremente.
  const [dataInicial, setDataInicial] = useState(() => intervaloPadrao().inicio);
  const [dataFinal, setDataFinal] = useState(() => intervaloPadrao().fim);
  const [pagina, setPagina] = useState(1);

  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarBanidos, setMostrarBanidos] = useState(false);
  // Modelos recolhidos (por padrão TODOS recolhidos). Guarda os abertos.
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  // Avisos "Sem regra de..." — por padrão só o título aparece.
  const [avisoModeloAberto, setAvisoModeloAberto] = useState(false);
  const [avisoReferenciaAberto, setAvisoReferenciaAberto] = useState(false);

  // Produtos marcados para cadastrar (chave = JSON([modelo, referência])).
  // Persiste entre páginas da lista e ao recarregar (localStorage, com try/catch).
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [selecaoCarregada, setSelecaoCarregada] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAVE_SELECAO);
      if (raw) setSelecionados(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* sem storage: segue só em memória */
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

  // debounce do texto de emitente (400ms), volta pra página 1
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

      const res = await fetch(`/api/relatorios/conferencia-produtos?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar o relatório.");
      setDados(json as Resposta);
      setAbertos(new Set()); // nova busca -> tudo recolhido de novo
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

  function alternarProduto(chave: string) {
    setSelecionados((prev) => {
      const prox = new Set(prev);
      if (prox.has(chave)) prox.delete(chave);
      else prox.add(chave);
      return prox;
    });
  }

  // Marca/desmarca TODOS os produtos do modelo (todos estão na mesma página).
  function alternarModelo(g: GrupoModelo) {
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

  const grupos = dados?.grupos ?? [];
  const todasChaves = useMemo(
    () => grupos.map((g) => chaveModelo(g.modelo)),
    [grupos]
  );
  const todosAbertos = todasChaves.length > 0 && todasChaves.every((k) => abertos.has(k));

  function alternarTodos() {
    setAbertos(todosAbertos ? new Set() : new Set(todasChaves));
  }

  const totalModelos = dados?.totalModelos ?? 0;
  const totalProdutos = dados?.totalProdutos ?? 0;
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
        <h1 style={{ margin: 0 }}>Conferência de Produtos Sem Cadastro</h1>
        <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 13 }}>
          <button
            type="button"
            className="btn-secundario"
            style={{ padding: "6px 10px", fontSize: 12 }}
            onClick={() => setMostrarBanidos(true)}
            disabled={!dados?.banidos?.length}
          >
            Ver fornecedores banidos
            {dados?.banidos?.length ? ` (${dados.banidos.length})` : ""}
          </button>
          <Link href="/relatorios" style={{ color: "var(--text-dim)" }}>
            ← Relatórios
          </Link>
        </div>
      </div>

      {mostrarBanidos && dados?.banidos && (
        <div className="modal-overlay" onClick={() => setMostrarBanidos(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: 560 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setMostrarBanidos(false)}
              aria-label="Fechar"
            >
              ✕
            </button>
            <h2 style={{ margin: "0 0 6px" }}>Fornecedores banidos</h2>
            <p style={{ color: "var(--text-dim)", fontSize: 13, margin: "0 0 14px" }}>
              Excluídos da Conferência de Produtos (não é produto de revenda:
              embalagens, veículos, descartáveis, brindes genéricos…). Contagem =
              total de itens no banco.
            </p>
            <table className="notes-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th style={{ textAlign: "right" }}>Itens</th>
                </tr>
              </thead>
              <tbody>
                {dados.banidos.map((b) => (
                  <tr key={b.emitente}>
                    <td>{b.emitente}</td>
                    <td style={{ textAlign: "right" }}>{b.itens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(dados?.semRegraModelo?.length || dados?.semRegraReferencia?.length) && (
        <div className="avisos-sem-regra">
          {dados!.semRegraModelo.length > 0 && (
            <div className={`card aviso-sem-regra${avisoModeloAberto ? " aberto" : ""}`}>
              <button
                type="button"
                className="aviso-sem-regra-cab"
                onClick={() => setAvisoModeloAberto((a) => !a)}
                aria-expanded={avisoModeloAberto}
              >
                <span className="cp-chevron">▶</span>
                <strong>Sem regra de Modelo ({dados!.semRegraModelo.length})</strong>
              </button>
              {avisoModeloAberto && (
                <>
                  <p>
                    Fornecedores com itens cujo <b>Modelo</b> não foi identificado
                    (nenhuma regra cobre). Peça a regra de Modelo para liberá-los na
                    conferência.
                  </p>
                  <ul>
                    {dados!.semRegraModelo.map((s) => (
                      <li key={s.emitente}>
                        {s.emitente}{" "}
                        <span className="cnt">
                          — {s.itens} {s.itens === 1 ? "item" : "itens"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {dados!.semRegraReferencia.length > 0 && (
            <div className={`card aviso-sem-regra${avisoReferenciaAberto ? " aberto" : ""}`}>
              <button
                type="button"
                className="aviso-sem-regra-cab"
                onClick={() => setAvisoReferenciaAberto((a) => !a)}
                aria-expanded={avisoReferenciaAberto}
              >
                <span className="cp-chevron">▶</span>
                <strong>Sem regra de Referência ({dados!.semRegraReferencia.length})</strong>
              </button>
              {avisoReferenciaAberto && (
                <>
                  <p>
                    Fornecedores com itens cuja <b>Referência do Fornecedor</b> caiu
                    no fallback (código puro, sem regra própria) — mesmo que o Modelo
                    já esteja OK.
                  </p>
                  <ul>
                    {dados!.semRegraReferencia.map((s) => (
                      <li key={s.emitente}>
                        {s.emitente}{" "}
                        <span className="cnt">
                          — {s.itens} {s.itens === 1 ? "item" : "itens"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
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
            Nenhum produto sem cadastro (de fornecedor com regra completa) no
            filtro selecionado.
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
                {totalProdutos === 1 ? "" : "s"} sem cadastro em{" "}
                {totalModelos.toLocaleString("pt-BR")} modelo
                {totalModelos === 1 ? "" : "s"}
                {carregando ? " · atualizando…" : ""}
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  {selecionados.size.toLocaleString("pt-BR")} selecionado
                  {selecionados.size === 1 ? "" : "s"} para cadastrar
                </span>
                {selecionados.size > 0 && (
                  <button
                    type="button"
                    className="btn-secundario"
                    style={{ padding: "5px 10px", fontSize: 12 }}
                    onClick={() => setSelecionados(new Set())}
                  >
                    Limpar seleção
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secundario"
                  style={{ padding: "5px 10px", fontSize: 12 }}
                  onClick={alternarTodos}
                >
                  {todosAbertos ? "Recolher todos" : "Expandir todos"}
                </button>
              </div>
            </div>

            <div className="cp-grupos">
              {grupos.map((g) => {
                const ck = chaveModelo(g.modelo);
                const aberto = abertos.has(ck);
                const marcados = g.produtos.filter((p) => selecionados.has(p.chave)).length;
                return (
                  <div key={ck} className={`cp-grupo${aberto ? " aberto" : ""}`}>
                    <div className="cp-grupo-topo">
                    <label
                      className="cp-sel"
                      title="Marcar/desmarcar todos os produtos deste modelo"
                    >
                      <input
                        type="checkbox"
                        checked={marcados === g.produtos.length && g.produtos.length > 0}
                        ref={(el) => {
                          if (el) el.indeterminate = marcados > 0 && marcados < g.produtos.length;
                        }}
                        onChange={() => alternarModelo(g)}
                        aria-label={`Selecionar todos os produtos de ${g.modelo ?? "sem modelo"}`}
                      />
                    </label>
                    <button
                      type="button"
                      className="cp-grupo-cab"
                      onClick={() => alternarGrupo(ck)}
                      aria-expanded={aberto}
                    >
                      <span className="cp-chevron">▶</span>
                      <span className="cp-grupo-modelo">
                        {g.modelo || (
                          <span className="cp-sem-modelo">(sem modelo)</span>
                        )}
                      </span>
                      <span className="cp-grupo-cont">
                        {marcados > 0 ? `${marcados}/` : ""}
                        {g.produtos.length} referência
                        {g.produtos.length === 1 ? "" : "s"}
                      </span>
                    </button>
                    </div>
                    {aberto && (
                      <div className="cp-refs">
                        {g.produtos.map((p) => (
                          <div key={p.chave} className="cp-ref cp-ref-selecionavel">
                            <label className="cp-sel" title="Marcar este produto">
                              <input
                                type="checkbox"
                                checked={selecionados.has(p.chave)}
                                onChange={() => alternarProduto(p.chave)}
                                aria-label={`Selecionar ${p.referencia ?? "produto"}`}
                              />
                            </label>
                            <span className="cp-ref-ref">{p.referencia || "-"}</span>
                            <span className="cp-ref-desc">
                              <span className="cp-ref-desc-txt" title={p.descricao}>
                                {p.descricao}
                              </span>
                              <span className="cp-ref-meta">
                                {p.nNotas} nota{p.nNotas === 1 ? "" : "s"}
                                {!p.comRegraEspecifica && (
                                  <>
                                    {" · "}
                                    <span
                                      className="badge badge-sem-regra"
                                      title="Referência caiu no fallback (código puro) — sem regra de identificação própria"
                                    >
                                      sem regra
                                    </span>
                                  </>
                                )}
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
