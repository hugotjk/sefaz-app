"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface NotaConferencia {
  id: string;
  dataEmissao: string | null;
  notaFiscal: string;
  modelo: string;
  loja: string;
  lojaEncontrada: boolean;
  prazoPagamento: string;
  qtdPecas: number;
  valorTotal: string;
}

interface GrupoFornecedor {
  fornecedor: string;
  notas: NotaConferencia[];
  somaPecas: number;
}

interface Resposta {
  grupos: GrupoFornecedor[];
  totalFornecedores: number;
  totalNotas: number;
  pagina: number;
  porPagina: number;
}

const qtdFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatarData(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("pt-BR");
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
// Padrão: últimos 30 dias. Não persiste — toda vez que a página carrega, volta a isso.
function intervaloPadrao() {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { inicio: ymd(inicio), fim: ymd(fim) };
}

export default function ConferenciaPrazoPage() {
  const [emitente, setEmitente] = useState("");
  const [emitenteAplicado, setEmitenteAplicado] = useState("");
  const [dataInicial, setDataInicial] = useState(() => intervaloPadrao().inicio);
  const [dataFinal, setDataFinal] = useState(() => intervaloPadrao().fim);
  const [pagina, setPagina] = useState(1);

  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Fornecedores recolhidos (por padrão TODOS recolhidos). Guarda os abertos.
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

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

      const res = await fetch(`/api/relatorios/conferencia-prazo?${qs}`);
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

  function alternarGrupo(nome: string) {
    setAbertos((prev) => {
      const prox = new Set(prev);
      if (prox.has(nome)) prox.delete(nome);
      else prox.add(nome);
      return prox;
    });
  }

  const grupos = dados?.grupos ?? [];
  const todosNomes = useMemo(() => grupos.map((g) => g.fornecedor), [grupos]);
  const todosAbertos = todosNomes.length > 0 && todosNomes.every((n) => abertos.has(n));

  function alternarTodos() {
    setAbertos(todosAbertos ? new Set() : new Set(todosNomes));
  }

  const totalFornecedores = dados?.totalFornecedores ?? 0;
  const totalNotas = dados?.totalNotas ?? 0;
  const porPagina = dados?.porPagina ?? 20;
  const totalPaginas = Math.max(1, Math.ceil(totalFornecedores / porPagina));
  const inicio = totalFornecedores === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fim = Math.min(pagina * porPagina, totalFornecedores);
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
        <h1 style={{ margin: 0 }}>Conferência de Prazo</h1>
        <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
          <Link
            href="/relatorios/conferencia-prazo/importar-lojas"
            style={{ color: "var(--text-dim)" }}
          >
            ⚙ Importar planilha de lojas
          </Link>
          <Link href="/relatorios" style={{ color: "var(--text-dim)" }}>
            ← Relatórios
          </Link>
        </div>
      </div>

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
        ) : totalFornecedores === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>
            Nenhuma nota fiscal encontrada no filtro selecionado.
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
                {totalNotas.toLocaleString("pt-BR")} nota{totalNotas === 1 ? "" : "s"} em{" "}
                {totalFornecedores.toLocaleString("pt-BR")} fornecedor
                {totalFornecedores === 1 ? "" : "es"}
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

            <div className="cp-grupos">
              {grupos.map((g) => {
                const aberto = abertos.has(g.fornecedor);
                return (
                  <div key={g.fornecedor} className={`cp-grupo${aberto ? " aberto" : ""}`}>
                    <button
                      type="button"
                      className="cp-grupo-cab"
                      onClick={() => alternarGrupo(g.fornecedor)}
                      aria-expanded={aberto}
                    >
                      <span className="cp-chevron">▶</span>
                      <span className="cp-grupo-modelo" title={g.fornecedor}>
                        {g.fornecedor}
                      </span>
                      <span className="cp-grupo-cont">
                        {g.notas.length} nota{g.notas.length === 1 ? "" : "s"} ·{" "}
                        {qtdFmt.format(g.somaPecas)} peça{g.somaPecas === 1 ? "" : "s"}
                      </span>
                    </button>
                    {aberto && (
                      <div className="notes-table-wrap">
                        <table className="notes-table">
                          <thead>
                            <tr>
                              <th className="col-empresa">Data Emissão</th>
                              <th className="col-empresa">Nota Fiscal</th>
                              <th className="col-empresa">Modelo</th>
                              <th className="col-empresa">Loja</th>
                              <th className="col-empresa">Prazo de Pagamento</th>
                              <th className="col-empresa" style={{ textAlign: "right" }}>
                                Peças / Valor
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.notas.map((n) => (
                              <tr key={n.id} className="nota-row">
                                <td className="col-empresa">{formatarData(n.dataEmissao)}</td>
                                <td className="col-empresa">{n.notaFiscal}</td>
                                <td className="col-empresa">{n.modelo}</td>
                                <td
                                  className="col-empresa"
                                  style={
                                    n.lojaEncontrada
                                      ? undefined
                                      : { color: "var(--text-dim)", fontStyle: "italic" }
                                  }
                                  title={
                                    n.lojaEncontrada
                                      ? undefined
                                      : "CNPJ não encontrado na planilha de lojas"
                                  }
                                >
                                  {n.loja}
                                </td>
                                <td className="col-empresa">{n.prazoPagamento}</td>
                                <td className="col-empresa" style={{ textAlign: "right" }}>
                                  <div className="mov-num-forte">{qtdFmt.format(n.qtdPecas)}</div>
                                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                                    {brlFmt.format(Number(n.valorTotal))}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="notes-pag">
              <span>
                Fornecedores {inicio}&ndash;{fim} de {totalFornecedores.toLocaleString("pt-BR")}
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
