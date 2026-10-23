"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Campo = "conteudo" | "emitente" | "chave" | "numero";

interface Opcoes {
  emitentes: string[];
  gestores: string[];
  lojas: string[];
}
interface Resumo {
  notas: number;
  itens: number;
  semXml: number;
}

const CAMPOS: { valor: Campo; rotulo: string; dica: string }[] = [
  { valor: "conteudo", rotulo: "Conteúdo da NF-e", dica: "Código, descrição ou EAN do item…" },
  { valor: "emitente", rotulo: "Nome/CNPJ do Emitente", dica: "Escolha ou digite o fornecedor…" },
  { valor: "chave", rotulo: "Chave de Acesso", dica: "Chave de 44 dígitos (ou parte dela)…" },
  { valor: "numero", rotulo: "Número da NF-e", dica: "Número da nota…" },
];

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
// Padrão: últimos 30 dias. Não persiste — toda vez que a página carrega, volta a isso.
function intervaloPadrao() {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { inicio: ymd(inicio), fim: ymd(fim) };
}

const nFmt = new Intl.NumberFormat("pt-BR");

export default function ItensResumidoPage() {
  const [dataInicial, setDataInicial] = useState(() => intervaloPadrao().inicio);
  const [dataFinal, setDataFinal] = useState(() => intervaloPadrao().fim);
  const [campo, setCampo] = useState<Campo>("conteudo");
  const [valor, setValor] = useState("");
  const [valorAplicado, setValorAplicado] = useState("");
  const [gestor, setGestor] = useState("");
  const [loja, setLoja] = useState("");

  const [opcoes, setOpcoes] = useState<Opcoes>({ emitentes: [], gestores: [], lojas: [] });
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Debounce do texto digitado.
  useEffect(() => {
    const id = setTimeout(() => setValorAplicado(valor), 400);
    return () => clearTimeout(id);
  }, [valor]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (dataInicial) p.set("dataInicial", dataInicial);
    if (dataFinal) p.set("dataFinal", dataFinal);
    p.set("campo", campo);
    if (valorAplicado.trim()) p.set("valor", valorAplicado.trim());
    if (gestor) p.set("gestor", gestor);
    if (loja) p.set("loja", loja);
    return p.toString();
  }, [dataInicial, dataFinal, campo, valorAplicado, gestor, loja]);

  // Opções das caixas de seleção dependem só do período.
  useEffect(() => {
    const p = new URLSearchParams();
    if (dataInicial) p.set("dataInicial", dataInicial);
    if (dataFinal) p.set("dataFinal", dataFinal);
    let cancelado = false;
    fetch(`/api/relatorios/itens-resumido/opcoes?${p}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelado && !j.error) setOpcoes(j as Opcoes);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [dataInicial, dataFinal]);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    fetch(`/api/relatorios/itens-resumido?${qs}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Erro ao carregar o relatório.");
        if (!cancelado) setResumo(j as Resumo);
      })
      .catch((e) => {
        if (!cancelado) {
          setErro(e.message);
          setResumo(null);
        }
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [qs]);

  const campoAtual = CAMPOS.find((c) => c.valor === campo)!;
  const filtroAtivo = !!valor || !!gestor || !!loja || campo !== "conteudo";

  function limpar() {
    const p = intervaloPadrao();
    setDataInicial(p.inicio);
    setDataFinal(p.fim);
    setCampo("conteudo");
    setValor("");
    setValorAplicado("");
    setGestor("");
    setLoja("");
  }

  function aoMudarCampo(c: Campo) {
    setCampo(c);
    setValor("");
    setValorAplicado("");
  }

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
        <h1 style={{ margin: 0 }}>Itens Resumido</h1>
        <Link href="/relatorios" style={{ color: "var(--text-dim)", fontSize: 13 }}>
          ← Relatórios
        </Link>
      </div>

      <div className="card notes-filtros-card">
        <div className="notes-filtros">
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
                onChange={(e) => setDataInicial(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Data final (emissão)</label>
              <input
                type="date"
                value={dataFinal}
                min={dataInicial || undefined}
                onChange={(e) => setDataFinal(e.target.value)}
              />
            </div>
          </div>

          <div
            className="notes-filtros-linha"
            style={{ gridTemplateColumns: "minmax(180px,230px) minmax(0,1fr)" }}
          >
            <div className="field">
              <label>Buscar por</label>
              <select value={campo} onChange={(e) => aoMudarCampo(e.target.value as Campo)}>
                {CAMPOS.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.rotulo}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>&nbsp;</label>
              {campo === "emitente" ? (
                <>
                  <input
                    type="text"
                    list="itens-resumido-emitentes"
                    placeholder={campoAtual.dica}
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                  />
                  <datalist id="itens-resumido-emitentes">
                    {opcoes.emitentes.map((e) => (
                      <option key={e} value={e} />
                    ))}
                  </datalist>
                </>
              ) : (
                <input
                  type="text"
                  inputMode={campo === "chave" || campo === "numero" ? "numeric" : "text"}
                  placeholder={campoAtual.dica}
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                />
              )}
            </div>
          </div>

          <div
            className="notes-filtros-linha"
            style={{ gridTemplateColumns: "minmax(160px,260px) minmax(160px,260px)" }}
          >
            <div className="field">
              <label>Gestor</label>
              <select value={gestor} onChange={(e) => setGestor(e.target.value)}>
                <option value="">Todos</option>
                {opcoes.gestores.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Loja</label>
              <select value={loja} onChange={(e) => setLoja(e.target.value)}>
                <option value="">Todas</option>
                {opcoes.lojas.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "-2px 0 0" }}>
            Padrão: últimos 30 dias (volta a isso ao recarregar a página). Notas canceladas não entram.
            Em "Conteúdo da NF-e" só saem as linhas dos itens que contêm o texto.
          </p>
          {filtroAtivo && (
            <div className="notes-filtros-rodape">
              <button type="button" className="btn-secundario" onClick={limpar}>
                Limpar filtros
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        {erro ? (
          <p style={{ color: "var(--red)" }}>{erro}</p>
        ) : !resumo && carregando ? (
          <p style={{ color: "var(--text-dim)" }}>Carregando…</p>
        ) : resumo && resumo.notas === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>Nenhuma nota fiscal encontrada no filtro selecionado.</p>
        ) : resumo ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <p className="notes-pag" style={{ justifyContent: "flex-start", margin: 0 }}>
              {nFmt.format(resumo.notas)} nota{resumo.notas === 1 ? "" : "s"} ·{" "}
              {campo === "conteudo" && valorAplicado.trim() ? "até " : "≈ "}
              {nFmt.format(resumo.itens)} iten{resumo.itens === 1 ? "" : "s"}
              {resumo.semXml > 0
                ? ` · ${nFmt.format(resumo.semXml)} sem XML completo (não entram no arquivo)`
                : ""}
              {carregando ? " · atualizando…" : ""}
            </p>
            <a
              className="btn"
              href={`/api/relatorios/itens-resumido/download?${qs}`}
              download
              style={{ textDecoration: "none" }}
            >
              ⬇ Baixar .xlsx
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}
