"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

type Status = "OK" | "ERRO" | "PRECOS_DIVERGENTES" | "AGUARDANDO_PRECO" | "EM_PROMOCAO" | "SEM_PRECO_PDV" | "SEM_PRODUTO_PDV" | "SEM_XML";

interface Variacao { codigo: string; tamanho: string | null; cor: string | null; preco: number | null; promo: number | null }

interface Linha {
  redeId: number | null;
  produtosPdv: { codigo: string; nome: string | null }[];
  rede: string;
  variacoes: Variacao[];
  emPromocao: boolean;
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
  aguardandoPreco: number;
  modelosSemRegra: string[];
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const mkpFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dinheiro = (v: number | null) => (v == null ? "—" : brl.format(v));
const mkp = (v: number | null) => (v == null ? "—" : mkpFmt.format(v));

const ROTULO: Record<Status, string> = {
  OK: "OK",
  ERRO: "⚠ PREÇO ERRADO",
  PRECOS_DIVERGENTES: "⚠ PREÇOS DIFERENTES",
  EM_PROMOCAO: "⚠ EM PROMOÇÃO",
  SEM_PRECO_PDV: "⚠ SEM PREÇO",
  AGUARDANDO_PRECO: "AGUARDANDO PREÇO",
  SEM_PRODUTO_PDV: "⚠ NÃO ACHADO",
  SEM_XML: "XML INCOMPLETO",
};

const TD: React.CSSProperties = { whiteSpace: "nowrap", padding: "5px 6px", fontSize: 12.5 };
const TH: React.CSSProperties = { whiteSpace: "nowrap", padding: "6px 6px", fontSize: 12.5 };
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
  const [rede, setRede] = useState("");
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [dataInicial, setDataInicial] = useState(() => intervaloPadrao().inicio);
  const [dataFinal, setDataFinal] = useState(() => intervaloPadrao().fim);
  const [somenteAlerta, setSomenteAlerta] = useState(true);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Modelos abertos (por padrão todos fechados) e referências marcadas para a planilha de alteração.
  const [modelosAbertos, setModelosAbertos] = useState<Set<string>>(new Set());
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [exportando, setExportando] = useState(false);
  const [msgExport, setMsgExport] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const qs = new URLSearchParams();
      if (emitente.trim()) qs.set("emitente", emitente.trim());
      if (modelo.trim()) qs.set("modelo", modelo.trim());
      if (rede.trim()) qs.set("rede", rede.trim());
      if (dataInicial) qs.set("dataInicial", dataInicial);
      if (dataFinal) qs.set("dataFinal", dataFinal);
      if (somenteAlerta) qs.set("somenteAlerta", "1");
      const res = await fetch(`/api/relatorios/conferencia-mkp?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar o relatório.");
      setDados(json as Resposta);
      setModelosAbertos(new Set());
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [emitente, modelo, rede, dataInicial, dataFinal, somenteAlerta]);

  useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataInicial, dataFinal, somenteAlerta]);

  // Só dá para alterar preço de produto já cadastrado na MULTI (rede 2): é a rede das fórmulas da planilha.
  const elegivel = (l: Linha) => l.redeId === 2 && l.produtosPdv.length > 0;
  const chaveSel = (l: Linha) => JSON.stringify([l.modelo, l.referencia]);
  const grupos = useMemo(() => {
    const m = new Map<string, Linha[]>();
    for (const l of dados?.linhas ?? []) {
      const lista = m.get(l.modelo) ?? [];
      lista.push(l);
      m.set(l.modelo, lista);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [dados]);
  const todosAbertos = grupos.length > 0 && grupos.every(([m]) => modelosAbertos.has(m));

  function alternarModelo(linhas: Linha[]) {
    const el = linhas.filter(elegivel);
    setSelecionados((prev) => {
      const prox = new Set(prev);
      const todos = el.every((l) => prox.has(chaveSel(l)));
      for (const l of el) {
        if (todos) prox.delete(chaveSel(l));
        else prox.add(chaveSel(l));
      }
      return prox;
    });
  }

  async function exportar() {
    if (selecionados.size === 0 || exportando) return;
    setExportando(true);
    setMsgExport(null);
    try {
      const res = await fetch("/api/relatorios/alteracao-preco/exportar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chaves: [...selecionados], emitente: emitente.trim(), modelo: modelo.trim(), dataInicial, dataFinal }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Erro ao gerar o arquivo.");
      }
      const nome = res.headers.get("X-Nome-Arquivo") || "ALTERACAO_PRECO.xlsx";
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
      if (r.semPreco3) avisos.push(`${r.semPreco3} referência(s) sem Preço 3 (célula amarela)`);
      if (r.semCodigoPdv?.length) avisos.push(`${r.semCodigoPdv.length} fora da planilha (sem produto na MULTI)`);
      setMsgExport(`${nome}: ${r.linhas ?? "?"} linha${r.linhas === 1 ? "" : "s"}` + (avisos.length ? ` · atenção: ${avisos.join("; ")}` : ""));
    } catch (e: any) {
      setMsgExport(`Erro: ${e.message}`);
    } finally {
      setExportando(false);
    }
  }

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
            Rede
            <input style={{ display: "block", width: 110 }} value={rede} placeholder="ex.: MULTI" onChange={(e) => setRede(e.target.value)} />
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
        style={{ width: "min(calc(100vw - var(--sidebar-width) - 48px), 1700px)", position: "relative", left: "50%", transform: "translateX(-50%)" }}
      >
        {erro && <p style={{ color: "var(--danger, #c0392b)" }}>{erro}</p>}
        {dados && !erro && (
          <>
            <p>
              <strong>{dados.comAlerta}</strong> com alerta de {dados.total} produtos conferidos.
              {dados.aguardandoPreco > 0 && (
                <span style={{ color: "var(--text-dim)" }}> {dados.aguardandoPreco} cadastrado(s) há menos de 6 horas aguardando o preço (sem alerta por enquanto).</span>
              )}
              {dados.modelosSemRegra.length > 0 && (
                <span style={{ color: "var(--text-dim)" }}>
                  {" "}
                  Sem regra de preço (não conferidos): {dados.modelosSemRegra.join(", ")}.
                </span>
              )}
            </p>
            {dados.linhas.length > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "0 0 10px" }}>
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  {selecionados.size.toLocaleString("pt-BR")} referência{selecionados.size === 1 ? "" : "s"} marcada{selecionados.size === 1 ? "" : "s"} para alterar o preço (só produtos da MULTI)
                </span>
                {selecionados.size > 0 && (
                  <button type="button" className="btn-secundario" style={{ width: "auto", padding: "5px 10px", fontSize: 12 }} onClick={() => setSelecionados(new Set())}>
                    Limpar seleção
                  </button>
                )}
                <button type="button" style={{ width: "auto", padding: "5px 12px", fontSize: 12 }} disabled={selecionados.size === 0 || exportando} onClick={exportar}
                  title="Baixar a planilha de alteração de cadastro (Preço 1 a 4)">
                  {exportando ? "Gerando…" : "⬇ Exportar planilha de alteração"}
                </button>
                <button type="button" className="btn-secundario" style={{ width: "auto", padding: "5px 10px", fontSize: 12 }}
                  onClick={() => setModelosAbertos(todosAbertos ? new Set() : new Set(grupos.map(([m]) => m)))}>
                  {todosAbertos ? "Recolher todos" : "Expandir todos"}
                </button>
                {msgExport && <span style={{ fontSize: 12, color: msgExport.startsWith("Erro") ? "var(--red)" : "var(--text-dim)" }}>{msgExport}</span>}
              </div>
            )}
            {dados.linhas.length === 0 ? (
              <p>Nenhum produto para mostrar neste filtro.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="tabela" style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={TH}></th>
                      <th style={TH}>Alerta</th>
                      <th style={TH}>Rede</th>
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
                    {grupos.map(([nomeModelo, linhasModelo]) => {
                      const aberto = modelosAbertos.has(nomeModelo);
                      const el = linhasModelo.filter(elegivel);
                      const marcados = el.filter((l) => selecionados.has(chaveSel(l))).length;
                      const alertas = linhasModelo.filter((l) => l.status !== "OK" && l.status !== "AGUARDANDO_PRECO" && l.status !== "SEM_XML").length;
                      return (
                        <Fragment key={"m:" + nomeModelo}>
                          <tr style={{ background: "rgba(127,127,127,.12)", cursor: "pointer" }}
                            onClick={() => setModelosAbertos((p) => { const n = new Set(p); if (n.has(nomeModelo)) n.delete(nomeModelo); else n.add(nomeModelo); return n; })}>
                            <td style={TD} onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" disabled={el.length === 0} checked={el.length > 0 && marcados === el.length}
                                ref={(x) => { if (x) x.indeterminate = marcados > 0 && marcados < el.length; }}
                                title="Marcar/desmarcar todas as referências deste modelo (MULTI)"
                                onChange={() => alternarModelo(linhasModelo)} />
                            </td>
                            <td style={{ ...TD, fontWeight: 700 }} colSpan={13}>
                              {aberto ? "▼" : "▶"} {nomeModelo}
                              <span style={{ fontWeight: 400, color: "var(--text-dim)", marginLeft: 10 }}>
                                {linhasModelo.length} referência{linhasModelo.length === 1 ? "" : "s"}
                                {alertas > 0 ? ` · ${alertas} com alerta` : ""}
                                {marcados > 0 ? ` · ${marcados} marcada${marcados === 1 ? "" : "s"}` : ""}
                              </span>
                            </td>
                          </tr>
                          {aberto &&
                            linhasModelo.map((l) => {
                              const chave = l.rede + "|" + l.modelo + "|" + l.referencia;
                              const aberta = abertas.has(chave);
                              return (
                      <Fragment key={chave}>
                      <tr style={l.status === "ERRO" || l.status === "EM_PROMOCAO" || l.status === "PRECOS_DIVERGENTES" || l.status === "SEM_PRECO_PDV" || l.status === "SEM_PRODUTO_PDV" ? { background: "rgba(231,76,60,.10)" } : undefined}>
                        <td style={TD}>
                          <input type="checkbox" disabled={!elegivel(l)} checked={selecionados.has(chaveSel(l))}
                            title={elegivel(l) ? "Marcar para a planilha de alteração" : "Só produtos já cadastrados na MULTI"}
                            onChange={() => setSelecionados((p) => { const n = new Set(p); const k = chaveSel(l); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
                        </td>
                        <td style={{ ...TD, fontWeight: 600 }}>{ROTULO[l.status]}</td>
                        <td style={TD}>{l.rede}</td>
                        <td style={TD}>{l.modelo}</td>
                        <td style={TD}>
                          {l.variacoes.length > 0 && (
                            <button type="button" title="Ver variações" style={{ width: "auto", padding: "0 6px", marginRight: 6, fontSize: 11 }}
                              onClick={() => setAbertas((a) => { const n = new Set(a); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; })}>
                              {aberta ? "−" : "+"}
                            </button>
                          )}
                          {l.referencia}
                        </td>
                        <td style={CORTA(250)} title={l.descricao}>{l.descricao}</td>
                        <td style={CORTA(110)} title={l.emitente}>{l.emitente}</td>
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
                      {aberta && (
                        <tr>
                          <td colSpan={14} style={{ padding: "4px 8px 10px 40px", fontSize: 12 }}>
                            <table style={{ borderCollapse: "collapse" }}>
                              <thead><tr><th style={TH}>Código</th><th style={TH}>Tamanho</th><th style={TH}>Cor</th><th style={{ ...TH, textAlign: "right" }}>Preço</th><th style={{ ...TH, textAlign: "right" }}>Promoção</th></tr></thead>
                              <tbody>
                                {l.variacoes.map((v) => (
                                  <tr key={v.codigo}>
                                    <td style={TD}>{v.codigo}</td><td style={TD}>{v.tamanho ?? "—"}</td><td style={TD}>{v.cor ?? "—"}</td>
                                    <td style={DIR}>{dinheiro(v.preco)}</td>
                                    <td style={{ ...DIR, fontWeight: v.promo ? 700 : 400 }}>{v.promo ? dinheiro(v.promo) : "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                              );
                            })}
                        </Fragment>
                      );
                    })}
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
