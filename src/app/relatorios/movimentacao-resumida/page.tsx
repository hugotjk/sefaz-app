"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MovimentacaoResumidaFiltros,
  type FiltrosForm,
} from "@/components/MovimentacaoResumidaFiltros";
import { MovimentacaoResumidaTabela } from "@/components/MovimentacaoResumidaTabela";
import type { RelatorioResultado } from "@/lib/relatorio-movimentacao";

const TAM_PAGINA = 50;

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}
function diasAtras(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const FILTROS_INICIAIS: FiltrosForm = {
  ordenacao: "venda",
  verPor: "loja",
  dataInicial: diasAtras(30),
  dataFinal: hojeISO(),
  redeId: null,
  tipoLojaId: null,
  grupoLojaId: null,
  campoProduto: "fornecedor",
  fornecedorNome: null,
  modeloNome: null,
  subGrupo: null,
  colecao: null,
  grupoProduto: null,
  listarPor: "referencia",
};

function montarQuery(f: FiltrosForm, pagina: number): string {
  const p = new URLSearchParams();
  p.set("ordenacao", f.ordenacao);
  p.set("verPor", f.verPor);
  p.set("dataInicial", f.dataInicial);
  p.set("dataFinal", f.dataFinal);
  if (f.redeId != null) p.set("redeId", String(f.redeId));
  if (f.tipoLojaId != null) p.set("tipoLojaId", String(f.tipoLojaId));
  if (f.grupoLojaId != null) p.set("grupoLojaId", String(f.grupoLojaId));
  p.set("campoProduto", f.campoProduto);
  if (f.campoProduto === "fornecedor" && f.fornecedorNome) p.set("fornecedorNome", f.fornecedorNome);
  if (f.campoProduto === "modelo" && f.modeloNome) p.set("modeloNome", f.modeloNome);
  if (f.subGrupo) p.set("subGrupo", f.subGrupo);
  if (f.colecao) p.set("colecao", f.colecao);
  if (f.grupoProduto) p.set("grupoProduto", f.grupoProduto);
  p.set("listarPor", f.listarPor);
  p.set("pagina", String(pagina));
  p.set("tamanhoPagina", String(TAM_PAGINA));
  return p.toString();
}

export default function MovimentacaoResumidaPage() {
  const [rascunho, setRascunho] = useState<FiltrosForm>(FILTROS_INICIAIS);
  const aplicadoRef = useRef<FiltrosForm>(FILTROS_INICIAIS);
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<RelatorioResultado | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = useCallback(async (f: FiltrosForm, pag: number) => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/relatorios/movimentacao-resumida?${montarQuery(f, pag)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar o relatório.");
      setDados(json as RelatorioResultado);
    } catch (e: any) {
      setErro(e.message);
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    buscar(aplicadoRef.current, 1);
  }, [buscar]);

  function aplicar() {
    aplicadoRef.current = rascunho;
    setPagina(1);
    buscar(rascunho, 1);
  }

  function irPara(pag: number) {
    setPagina(pag);
    buscar(aplicadoRef.current, pag);
  }

  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / TAM_PAGINA)) : 1;

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
        <h1 style={{ margin: 0 }}>Movimentação Resumida</h1>
        <Link href="/relatorios" style={{ fontSize: 13, color: "var(--text-dim)" }}>
          ← Relatórios
        </Link>
      </div>

      <MovimentacaoResumidaFiltros
        filtros={rascunho}
        opcoes={dados?.opcoes ?? null}
        carregando={carregando}
        onChange={(patch) => setRascunho((f) => ({ ...f, ...patch }))}
        onAplicar={aplicar}
      />

      <div className="card">
        {erro && <p style={{ color: "var(--red)" }}>{erro}</p>}

        {!erro && carregando && !dados && (
          <p style={{ color: "var(--text-dim)" }}>Carregando relatório...</p>
        )}

        {!erro && dados && (
          <>
            <div className="mov-count">
              {dados.total.toLocaleString("pt-BR")} produto{dados.total === 1 ? "" : "s"} encontrado
              {dados.total === 1 ? "" : "s"}
              {dados.aviso ? ` — ${dados.aviso}` : ""}
              {carregando ? " · atualizando..." : ""}
            </div>

            {dados.produtos.length === 0 ? (
              <p style={{ color: "var(--text-dim)" }}>
                Nada para exibir com os filtros atuais.
              </p>
            ) : (
              <>
                <MovimentacaoResumidaTabela
                  dados={dados}
                  listarPor={aplicadoRef.current.listarPor}
                />
                <div className="mov-paginacao">
                  <button type="button" onClick={() => irPara(pagina - 1)} disabled={pagina <= 1 || carregando}>
                    ← Anterior
                  </button>
                  <span>
                    Página {pagina} de {totalPaginas}
                  </span>
                  <button
                    type="button"
                    onClick={() => irPara(pagina + 1)}
                    disabled={pagina >= totalPaginas || carregando}
                  >
                    Próxima →
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
