"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type OrdenarPor = "dataEmissao" | "notaFiscal" | "fornecedor" | "modelo" | "loja";

interface Linha {
  id: string;
  fornecedor: string;
  modelo: string;
  dataEmissao: string | null;
  loja: string;
  lojaEncontrada: boolean;
  notaFiscal: string;
  prazoPagamento: string;
  qtdPecas: number;
}

interface Resposta {
  linhas: Linha[];
  total: number;
  pagina: number;
  porPagina: number;
}

const qtdFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

function formatarData(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("pt-BR");
}

const COLUNAS_ORDENAVEIS: { chave: OrdenarPor; label: string }[] = [
  { chave: "fornecedor", label: "Fornecedor" },
  { chave: "modelo", label: "Modelo" },
  { chave: "dataEmissao", label: "Data Emissão" },
  { chave: "loja", label: "Loja" },
  { chave: "notaFiscal", label: "Nota Fiscal" },
];

export default function ConferenciaPrazoPage() {
  const [ordenarPor, setOrdenarPor] = useState<OrdenarPor>("dataEmissao");
  const [ordem, setOrdem] = useState<"asc" | "desc">("desc");
  const [pagina, setPagina] = useState(1);

  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const qs = new URLSearchParams({
        ordenarPor,
        ordem,
        pagina: String(pagina),
      });
      const res = await fetch(`/api/relatorios/conferencia-prazo?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar o relatório.");
      setDados(json as Resposta);
    } catch (e: any) {
      setErro(e.message);
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [ordenarPor, ordem, pagina]);

  useEffect(() => {
    buscar();
  }, [buscar]);

  function clicarCabecalho(chave: OrdenarPor) {
    setPagina(1);
    if (ordenarPor === chave) {
      setOrdem((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setOrdenarPor(chave);
      setOrdem("desc"); // padrão de todas as colunas: maior primeiro
    }
  }

  const total = dados?.total ?? 0;
  const porPagina = dados?.porPagina ?? 50;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const inicio = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fim = Math.min(pagina * porPagina, total);

  const th = (chave: OrdenarPor, label: string) => (
    <th key={chave}>
      <button type="button" className="notes-sort" onClick={() => clicarCabecalho(chave)}>
        {label}{" "}
        <span>{ordenarPor === chave ? (ordem === "desc" ? "↓" : "↑") : ""}</span>
      </button>
    </th>
  );

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

      <div className="card">
        {erro ? (
          <p style={{ color: "var(--red)" }}>{erro}</p>
        ) : !dados && carregando ? (
          <p style={{ color: "var(--text-dim)" }}>Carregando…</p>
        ) : total === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>Nenhuma nota fiscal para exibir.</p>
        ) : (
          <>
            <p className="notes-pag" style={{ justifyContent: "flex-start", marginTop: 0 }}>
              {total.toLocaleString("pt-BR")} nota{total === 1 ? "" : "s"} fiscal
              {total === 1 ? "" : "s"}
              {carregando ? " · atualizando…" : ""}
            </p>

            <div className="notes-table-wrap">
              <table className="notes-table">
                <thead>
                  <tr>
                    {COLUNAS_ORDENAVEIS.map((c) => th(c.chave, c.label))}
                    <th>Prazo de Pagamento</th>
                    <th style={{ textAlign: "right" }}>Qtd. de Peças</th>
                  </tr>
                </thead>
                <tbody>
                  {dados!.linhas.map((l) => (
                    <tr key={l.id} className="nota-row">
                      <td>{l.fornecedor}</td>
                      <td>{l.modelo}</td>
                      <td>{formatarData(l.dataEmissao)}</td>
                      <td
                        style={
                          l.lojaEncontrada
                            ? undefined
                            : { color: "var(--text-dim)", fontStyle: "italic" }
                        }
                        title={l.lojaEncontrada ? undefined : "CNPJ não encontrado na planilha de lojas"}
                      >
                        {l.loja}
                      </td>
                      <td>{l.notaFiscal}</td>
                      <td>{l.prazoPagamento}</td>
                      <td style={{ textAlign: "right" }}>{qtdFmt.format(l.qtdPecas)}</td>
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
