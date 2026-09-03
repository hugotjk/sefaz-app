"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NotaModal } from "@/components/NotaModal";

interface Linha {
  id: string;
  chaveAcesso: string;
  numeroNota: string | null;
  dataEmissao: string | null;
  emitenteNome: string | null;
  codigoProduto: string;
  descricao: string;
  ean: string | null;
  fornecedorIdentificado: string | null;
  modeloIdentificado: string | null;
  comRegraEspecifica: boolean;
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
  semRegra: FornecedorSemRegra[];
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
function intervaloPadrao() {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { inicio: ymd(inicio), fim: ymd(fim) };
}
function formatarData(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("pt-BR");
}

export default function ConferenciaProdutosPage() {
  const [emitente, setEmitente] = useState("");
  const [emitenteAplicado, setEmitenteAplicado] = useState("");
  const [dataInicial, setDataInicial] = useState(() => intervaloPadrao().inicio);
  const [dataFinal, setDataFinal] = useState(() => intervaloPadrao().fim);
  const [pagina, setPagina] = useState(1);

  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [chaveAberta, setChaveAberta] = useState<string | null>(null);

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
      const qs = new URLSearchParams({
        pagina: String(pagina),
        dataInicial,
        dataFinal,
      });
      if (emitenteAplicado.trim()) qs.set("emitente", emitenteAplicado.trim());

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
    const p = intervaloPadrao();
    setDataInicial(p.inicio);
    setDataFinal(p.fim);
    setPagina(1);
  }

  const total = dados?.total ?? 0;
  const porPagina = dados?.porPagina ?? 50;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const inicio = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fim = Math.min(pagina * porPagina, total);
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
        <Link href="/relatorios" style={{ fontSize: 13, color: "var(--text-dim)" }}>
          ← Relatórios
        </Link>
      </div>

      {dados?.semRegra && dados.semRegra.length > 0 && (
        <div className="card aviso-sem-regra">
          <strong>
            Fornecedores sem regra de identificação ({dados.semRegra.length})
          </strong>
          <p>
            Itens destes emitentes <b>não aparecem</b> na lista abaixo porque ainda
            falta ensinar as regras de Modelo / Referência do Fornecedor. Peça as
            regras para liberar a conferência deles. (Um emitente pode ter regra
            para alguns produtos e cair aqui só com os que a regra não cobre.)
          </p>
          <ul>
            {dados.semRegra.map((s) => (
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
            Nenhum item sem cadastro (de fornecedor com regra completa) no
            período/filtro selecionado.
          </p>
        ) : (
          <>
            <p className="notes-pag" style={{ justifyContent: "flex-start", marginTop: 0 }}>
              {total.toLocaleString("pt-BR")} item{total === 1 ? "" : "s"} sem cadastro
              {carregando ? " · atualizando…" : ""}
            </p>

            <div className="notes-table-wrap">
              <table className="notes-table">
                <thead>
                  <tr>
                    <th>Nota</th>
                    <th>Emissão</th>
                    <th className="col-empresa">Emitente</th>
                    <th>Cód. produto</th>
                    <th className="col-empresa">Descrição</th>
                    <th>EAN</th>
                    <th className="col-empresa">Fornecedor identificado</th>
                    <th>Modelo identificado</th>
                    <th>Regra</th>
                  </tr>
                </thead>
                <tbody>
                  {dados!.linhas.map((l) => (
                    <tr key={l.id} className="nota-row">
                      <td>
                        <button
                          type="button"
                          className="nota-link"
                          onClick={() => setChaveAberta(l.chaveAcesso)}
                          title={l.chaveAcesso}
                        >
                          {l.numeroNota || "ver"}
                        </button>
                      </td>
                      <td>{formatarData(l.dataEmissao)}</td>
                      <td className="col-empresa">{l.emitenteNome || "-"}</td>
                      <td>{l.codigoProduto}</td>
                      <td className="col-empresa">{l.descricao}</td>
                      <td>{l.ean || "-"}</td>
                      <td className="col-empresa">{l.fornecedorIdentificado || "-"}</td>
                      <td>{l.modeloIdentificado || "-"}</td>
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

      {chaveAberta && (
        <NotaModal chave={chaveAberta} onClose={() => setChaveAberta(null)} />
      )}
    </div>
  );
}
