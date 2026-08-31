"use client";

import { Fragment, type CSSProperties } from "react";
import type { RelatorioResultado } from "@/lib/relatorio-movimentacao";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const qtd = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

// Colunas fixas à esquerda (sticky). Larguras somadas definem os offsets `left`.
const FIXAS = [
  { key: "ref", label: "Referência", w: 150 },
  { key: "desc", label: "Descrição", w: 240 },
  { key: "preco", label: "Preço varejo", w: 100 },
  { key: "venda", label: "Venda total", w: 120 },
  { key: "estoque", label: "Estoque total", w: 110 },
];
const OFFSETS = FIXAS.reduce<number[]>((acc, _c, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + FIXAS[i - 1].w);
  return acc;
}, []);

function fixProps(i: number, esquerda = false) {
  return {
    className: esquerda ? "mov-fix mov-esq" : "mov-fix",
    style: { left: OFFSETS[i], minWidth: FIXAS[i].w, maxWidth: FIXAS[i].w } as CSSProperties,
  };
}

export function MovimentacaoResumidaTabela({
  dados,
  listarPor,
}: {
  dados: RelatorioResultado;
  listarPor: "referencia" | "referenciaFornecedor";
}) {
  const { colunas, produtos } = dados;

  return (
    <div className="mov-tabela-wrap">
      <table className="mov-tabela">
        <thead>
          <tr>
            {FIXAS.map((c, i) => (
              <th key={c.key} rowSpan={2} {...fixProps(i, true)}>
                {c.label}
              </th>
            ))}
            {colunas.map((col) => (
              <th key={col.key} colSpan={2} className="mov-grp-hdr">
                {col.nome}
              </th>
            ))}
          </tr>
          <tr>
            {colunas.map((col) => (
              <Fragment key={col.key}>
                <th>Venda</th>
                <th>Estoque</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {produtos.map((p, idx) => {
            const refPrincipal =
              listarPor === "referenciaFornecedor" ? p.referenciaFornecedor || "—" : p.referencia;
            const refSecundaria =
              listarPor === "referenciaFornecedor" ? p.referencia : p.referenciaFornecedor || "—";
            return (
              <tr key={p.id} className={idx % 2 === 0 ? "impar" : "par"}>
                <td {...fixProps(0, true)}>
                  <div className="mov-num-forte">{refPrincipal}</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{refSecundaria}</div>
                </td>
                <td {...fixProps(1, true)} title={p.descricao ?? ""}>
                  <div
                    style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: FIXAS[1].w - 24 }}
                  >
                    {p.descricao || "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    {[p.grupoNome, p.colecaoNome].filter(Boolean).join(" · ") || " "}
                  </div>
                </td>
                <td {...fixProps(2)}>{p.precoVarejo == null ? "—" : brl.format(p.precoVarejo)}</td>
                <td {...fixProps(3)}>
                  <div className="mov-num-forte">{brl.format(p.vendaValor)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    {qtd.format(p.vendaQtd)} un
                  </div>
                </td>
                <td {...fixProps(4)}>{qtd.format(p.estoque)}</td>
                {p.colunas.map((c, ci) => (
                  <Fragment key={colunas[ci].key}>
                    <td>{c.venda ? brl.format(c.venda) : "—"}</td>
                    <td>{c.estoque ? qtd.format(c.estoque) : "—"}</td>
                  </Fragment>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
