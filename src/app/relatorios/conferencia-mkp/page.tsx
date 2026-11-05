"use client";

import { useCallback, useEffect, useState } from "react";

type Status = "OK" | "ERRO" | "PRECOS_DIVERGENTES" | "SEM_PRECO_PDV" | "SEM_PRODUTO_PDV" | "SEM_XML";

interface Linha {
  modelo: string;
  referencia: string;
  descricao: string;
  emitente: string;
  nf: string;
  data: string | null;
  nNotas: number;
  custoBruto: number | null;
  custoTotal: number | null;
  precoPdv: number | null;
  precosPdvDistintos: number[];
  precosPdvDetalhe: { preco: number; qtd: number }[];
  mkpAtual: number | null;
  mkpEsperado: number | null;
  precoCorreto: number | null;
  status: Status;
}

interface Resposta {
  linhas: Linha[];
  total: number;
  comAlerta: number;
  modelosSemRegra: string[];
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const mkpFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dinheiro = (v: number | null) => (v == null ? "—" : brl.format(v));
const mkp = (v: number | null) => (v == null ? "—" : mkpFmt.format(v));

const ROTULO: Record<Status, string> = {
  OK: "OK",
  ERRO: "⚠ PREÇO ERRADO",
  PRECOS_DIVERGENTES: "⚠ VARIAÇÕES COM PREÇOS DIFERENTES",
  SEM_PRECO_PDV: "AGUARDANDO PREÇO DO PDV",
  SEM_PRODUTO_PDV: "⚠ NÃO ACHADO NO PDV",
  SEM_XML: "XML INCOMPLETO",
};

const TD: React.CSSProperties = { whiteSpace: "nowrap", padding: "5px 8px", fontSize: 12.5 };
const TH: React.CSSProperties = { whiteSpace: "nowrap", padding: "6px 8px", fontSize: 12.5 };
const CORTA = (w: number): React.CSSProperties => ({
  ...TD,
  maxWidth: w,
  overflow: "hidden",
  textOverflow: "ellipsis",
});
const DIR: React.CSSProperties = { ...TD, textAlign: "right" };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function intervaloPadrao() {
  const fim = new Date();
  return { inicio: ymd(new Date(fim.getTime() - 60 * 24 * 60 * 60 * 1000)), fim: ymd(fim) };
}

export default function ConferenciaMkpPage() {
  const [emitente, setEmitente] = useState("");
  const [modelo, setModelo] = useState("");
  const [dataInicial, setDataInicial] = useState(() => intervaloPadrao().inicio);
  const [dataFinal, setDataFinal] = useState(() => intervaloPadrao().fim);
  const [somenteAlerta, setSomenteAlerta] = useState(true);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const qs = new URLSearchParams();
      if (emitente.trim()) qs.set("emitente", emitente.trim());
      if (modelo.trim()) qs.set("modelo", modelo.trim());
      if (dataInicial) qs.set("dataInicial", dataInicial);
      if (dataFinal) qs.set("dataFinal", dataFinal);
      if (somenteAlerta) qs.set("somenteAlerta", "1");
      const res = await fetch(`/api/relatorios/conferencia-mkp?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar o relatório.");
      setDados(json as Resposta);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [emitente, modelo, dataInicial, dataFinal, somenteAlerta]);

  useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataInicial, dataFinal, somenteAlerta]);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Conferência de MKP</h1>
      <p style={{ color: "var(--text-dim)", marginTop: 0 }}>
        Produtos já cadastrados no PDV, com o custo faturado na nota (bruto e total, com desconto, IPI e ST) e o
        preço esperado pelo MKP do modelo. Só aparecem modelos que já têm regra de preço.
      </p>

      <div className="card" style={{ padding: "10px 14px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12 }}>
            Fornecedor
            <input style={{ display: "block", width: 170 }} value={emitente} onChange={(e) => setEmitente(e.target.value)} />
          </label>
          <label style={{ fontSize: 12 }}>
            Modelo
            <input style={{ display: "block", width: 130 }} value={modelo} onChange={(e) => setModelo(e.target.value)} />
          </label>
          <label style={{ fontSize: 12 }}>
            Emissão de
            <input style={{ display: "block", width: 140 }} type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} />
          </label>
          <label style={{ fontSize: 12 }}>
            até
            <input style={{ display: "block", width: 140 }} type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} />
          </label>
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", paddingBottom: 6 }}>
            <input type="checkbox" checked={somenteAlerta} onChange={(e) => setSomenteAlerta(e.target.checked)} />
            Só com alerta
          </label>
          <button type="button" style={{ width: "auto", padding: "6px 16px" }} onClick={buscar} disabled={carregando}>
            {carregando ? "Carregando…" : "Buscar"}
          </button>
        </div>
      </div>

      <div
        className="card"
        style={{ width: "min(98vw, 1700px)", position: "relative", left: "50%", transform: "translateX(-50%)" }}
      >
        {erro && <p style={{ color: "var(--danger, #c0392b)" }}>{erro}</p>}
        {dados && !erro && (
          <>
            <p>
              <strong>{dados.comAlerta}</strong> com alerta de {dados.total} produtos conferidos.
              {dados.modelosSemRegra.length > 0 && (
                <span style={{ color: "var(--text-dim)" }}>
                  {" "}
                  Sem regra de preço (não conferidos): {dados.modelosSemRegra.join(", ")}.
                </span>
              )}
            </p>
            {dados.linhas.length === 0 ? (
              <p>Nenhum produto para mostrar neste filtro.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="tabela" style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={TH}>Alerta</th>
                      <th style={TH}>Modelo</th>
                      <th style={TH}>Referência</th>
                      <th style={TH}>Descrição</th>
                      <th style={TH}>Fornecedor</th>
                      <th style={TH}>NF</th>
                      <th style={{ ...TH, textAlign: "right" }}>Custo bruto</th>
                      <th style={{ ...TH, textAlign: "right" }}>Custo total</th>
                      <th style={{ ...TH, textAlign: "right" }}>Preço PDV</th>
                      <th style={{ ...TH, textAlign: "right" }}>MKP atual</th>
                      <th style={{ ...TH, textAlign: "right" }}>MKP esperado</th>
                      <th style={{ ...TH, textAlign: "right" }}>Preço correto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.linhas.map((l) => (
                      <tr key={l.modelo + "|" + l.referencia} style={l.status === "ERRO" || l.status === "PRECOS_DIVERGENTES" || l.status === "SEM_PRODUTO_PDV" ? { background: "rgba(231,76,60,.10)" } : undefined}>
                        <td style={{ ...TD, fontWeight: 600 }}>{ROTULO[l.status]}</td>
                        <td style={TD}>{l.modelo}</td>
                        <td style={TD}>{l.referencia}</td>
                        <td style={CORTA(340)} title={l.descricao}>{l.descricao}</td>
                        <td style={CORTA(200)} title={l.emitente}>{l.emitente}</td>
                        <td style={TD} title={`${l.nNotas} nota(s); última em ${l.data ?? "—"}`}>{l.nf}</td>
                        <td style={DIR}>{dinheiro(l.custoBruto)}</td>
                        <td style={DIR}>{dinheiro(l.custoTotal)}</td>
                        <td style={DIR}>
                          {l.precosPdvDetalhe.length > 1
                            ? l.precosPdvDetalhe.map((d) => `${dinheiro(d.preco)} (${d.qtd})`).join(" / ")
                            : dinheiro(l.precoPdv)}
                        </td>
                        <td style={DIR}>{mkp(l.mkpAtual)}</td>
                        <td style={DIR}>{mkp(l.mkpEsperado)}</td>
                        <td style={{ ...DIR, fontWeight: l.status === "ERRO" ? 700 : 400 }}>{dinheiro(l.precoCorreto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
