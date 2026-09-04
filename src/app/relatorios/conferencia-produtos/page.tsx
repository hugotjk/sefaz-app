"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Linha {
  chave: string;
  modelo: string | null;
  referencia: string | null;
  descricao: string;
  ean: string | null;
  emitenteNome: string | null;
  comRegraEspecifica: boolean;
  nNotas: number;
}

interface FornecedorSemRegra {
  emitente: string;
  itens: number;
}

interface Resposta {
  linhas: Linha[];
  total: number;
  pagina: number;
  porPagina: number;
  semRegraModelo: FornecedorSemRegra[];
  semRegraReferencia: FornecedorSemRegra[];
  banidos: FornecedorSemRegra[];
}

export default function ConferenciaProdutosPage() {
  const [emitente, setEmitente] = useState("");
  const [emitenteAplicado, setEmitenteAplicado] = useState("");
  // filtro de data OPCIONAL — vazio = todos os períodos (produto único não tem
  // data natural, e produtos de meses atrás não devem ficar escondidos).
  const [dataInicial, setDataInicial] = useState("");
  const [dataFinal, setDataFinal] = useState("");
  const [pagina, setPagina] = useState(1);

  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarBanidos, setMostrarBanidos] = useState(false);

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
    setDataInicial("");
    setDataFinal("");
    setPagina(1);
  }

  const total = dados?.total ?? 0;
  const porPagina = dados?.porPagina ?? 50;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const inicio = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fim = Math.min(pagina * porPagina, total);
  const filtroAtivo = emitenteAplicado.trim() !== "" || !!dataInicial || !!dataFinal;

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
            <div className="card aviso-sem-regra">
              <strong>Sem regra de Modelo ({dados!.semRegraModelo.length})</strong>
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
            </div>
          )}
          {dados!.semRegraReferencia.length > 0 && (
            <div className="card aviso-sem-regra">
              <strong>
                Sem regra de Referência ({dados!.semRegraReferencia.length})
              </strong>
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
              <label>Data inicial (emissão) — opcional</label>
              <input
                type="date"
                value={dataInicial}
                max={dataFinal || undefined}
                onChange={(e) => aoMudarData("inicial", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Data final (emissão) — opcional</label>
              <input
                type="date"
                value={dataFinal}
                min={dataInicial || undefined}
                onChange={(e) => aoMudarData("final", e.target.value)}
              />
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "-2px 0 0" }}>
            Sem data = todos os períodos.
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
        ) : total === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>
            Nenhum produto sem cadastro (de fornecedor com regra completa) no
            filtro selecionado.
          </p>
        ) : (
          <>
            <p className="notes-pag" style={{ justifyContent: "flex-start", marginTop: 0 }}>
              {total.toLocaleString("pt-BR")} produto{total === 1 ? "" : "s"} único
              {total === 1 ? "" : "s"} sem cadastro
              {carregando ? " · atualizando…" : ""}
            </p>

            <div className="notes-table-wrap">
              <table className="notes-table">
                <thead>
                  <tr>
                    <th className="col-modelo">Modelo</th>
                    <th>Referência Fornecedor</th>
                    <th className="col-empresa">Descrição</th>
                    <th>EAN</th>
                    <th className="col-empresa">Emitente</th>
                    <th style={{ textAlign: "right" }}>Em notas</th>
                    <th>Regra</th>
                  </tr>
                </thead>
                <tbody>
                  {dados!.linhas.map((l) => (
                    <tr key={l.chave} className="nota-row">
                      <td className="col-modelo">{l.modelo || "-"}</td>
                      <td>{l.referencia || "-"}</td>
                      <td className="col-empresa">{l.descricao}</td>
                      <td>{l.ean || "-"}</td>
                      <td className="col-empresa">{l.emitenteNome || "-"}</td>
                      <td style={{ textAlign: "right" }}>{l.nNotas}</td>
                      <td>
                        {l.comRegraEspecifica ? (
                          <span style={{ color: "var(--text-dim)" }}>—</span>
                        ) : (
                          <span
                            className="badge badge-sem-regra"
                            title="Caiu no fallback (código puro) — sem regra de identificação própria"
                          >
                            sem regra
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="notes-pag">
              <span>
                Mostrando {inicio}&ndash;{fim} de {total.toLocaleString("pt-BR")}
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
