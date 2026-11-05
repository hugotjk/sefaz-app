"use client";

import { useCallback, useEffect, useState } from "react";

type Status = "OK" | "ERRO" | "SEM_PRECO_PDV" | "SEM_PRODUTO_PDV" | "SEM_XML";

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
  SEM_PRECO_PDV: "⚠ SEM PREÇO NO PDV",
  SEM_PRODUTO_PDV: "⚠ NÃO ACHADO NO PDV",
  SEM_XML: "XML INCOMPLETO",
};

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

      <div className="card notes-filtros-card">
        <div className="notes-filtros">
          <div className="notes-filtros-linha">
            <div className="field">
              <label>Fornecedor</label>
              <input value={emitente} onChange={(e) => setEmitente(e.target.value)} placeholder="Nome do fornecedor" />
            </div>
            <div className="field">
              <label>Modelo</label>
              <input value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Ex.: Hurley" />
            </div>
            <div className="field">
              <label>Emissão de</label>
              <input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} />
            </div>
            <div className="field">
              <label>até</label>
              <input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} />
            </div>
          </div>
          <div className="notes-filtros-linha">
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={somenteAlerta} onChange={(e) => setSomenteAlerta(e.target.checked)} />
              Mostrar só os com alerta
            </label>
            <button type="button" onClick={buscar} disabled={carregando}>
              {carregando ? "Carregando…" : "Buscar"}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
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
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Alerta</th>
                      <th>Modelo</th>
                      <th>Referência</th>
                      <th>Descrição</th>
                      <th>Fornecedor</th>
                      <th>NF</th>
                      <th style={{ textAlign: "right" }}>Custo bruto</th>
                      <th style={{ textAlign: "right" }}>Custo total</th>
                      <th style={{ textAlign: "right" }}>Preço no PDV</th>
                      <th style={{ textAlign: "right" }}>MKP atual</th>
                      <th style={{ textAlign: "right" }}>MKP esperado</th>
                      <th style={{ textAlign: "right" }}>Preço correto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.linhas.map((l) => (
                      <tr key={l.modelo + "|" + l.referencia} style={l.status !== "OK" ? { background: "rgba(231,76,60,.10)" } : undefined}>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{ROTULO[l.status]}</td>
                        <td>{l.modelo}</td>
                        <td>{l.referencia}</td>
                        <td title={l.descricao}>{l.descricao}</td>
                        <td>{l.emitente}</td>
                        <td title={`${l.nNotas} nota(s); última em ${l.data ?? "—"}`}>{l.nf}</td>
                        <td style={{ textAlign: "right" }}>{dinheiro(l.custoBruto)}</td>
                        <td style={{ textAlign: "right" }}>{dinheiro(l.custoTotal)}</td>
                        <td
                          style={{ textAlign: "right" }}
                          title={l.precosPdvDistintos.length > 1 ? `Preços diferentes nas variações: ${l.precosPdvDistintos.join(" / ")}` : undefined}
                        >
                          {dinheiro(l.precoPdv)}
                          {l.precosPdvDistintos.length > 1 ? " *" : ""}
                        </td>
                        <td style={{ textAlign: "right" }}>{mkp(l.mkpAtual)}</td>
                        <td style={{ textAlign: "right" }}>{mkp(l.mkpEsperado)}</td>
                        <td style={{ textAlign: "right", fontWeight: l.status === "ERRO" ? 700 : 400 }}>{dinheiro(l.precoCorreto)}</td>
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
