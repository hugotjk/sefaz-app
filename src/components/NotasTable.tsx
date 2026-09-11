"use client";

import { useCallback, useEffect, useState } from "react";
import { NotaModal } from "@/components/NotaModal";

type StatusXml = "completo" | "aguardando" | "indisponivel";

interface NotaLinha {
  chaveAcesso: string;
  numero: string | null;
  dataEmissao: string | null;
  tipoOperacao: string | null;
  valorTotal: string;
  emitenteNome: string | null;
  emitenteCnpj: string | null;
  // null = nota importada do histórico da Qive sem Certificate associado.
  destinatarioNome: string | null;
  status: string;
  qtdEventos: number;
  statusXml: StatusXml;
}

interface CertificadoOpcao {
  id: string;
  cnpj: string;
  razaoSocial: string | null;
}

const TITULO_AGUARDANDO = "Aguardando XML completo da SEFAZ";
const MSG_INDISPONIVEL =
  "A SEFAZ não disponibilizou o XML completo desta nota (só o resumo está disponível).";

interface Resposta {
  notas: NotaLinha[];
  total: number;
  pagina: number;
  porPagina: number;
  ordem: "asc" | "desc";
}

const POR_PAGINA_OPCOES = [25, 50, 100];

const CAMPOS_BUSCA: { valor: string; label: string }[] = [
  { valor: "conteudo", label: "Conteúdo da NF-e" },
  { valor: "emitente", label: "Nome/CNPJ do Emitente" },
  { valor: "chave", label: "Chave de Acesso" },
  { valor: "numero", label: "Número da NF-e" },
];

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
function intervaloPadrao() {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { inicio: ymd(inicio), fim: ymd(fim) };
}

function formatarMoeda(valor: unknown) {
  return Number(valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatarData(data: string | null) {
  if (!data) return "-";
  return new Date(data).toLocaleDateString("pt-BR");
}
function badgeClasse(status: string) {
  if (status === "CANCELADA") return "badge badge-cancelada";
  if (status === "DENEGADA") return "badge badge-denegada";
  return "badge badge-autorizada";
}

export function NotasTable() {
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  const [ordem, setOrdem] = useState<"asc" | "desc">("desc");

  // filtros
  const [buscaCampo, setBuscaCampo] = useState("conteudo");
  const [buscaTermo, setBuscaTermo] = useState("");
  const [buscaTermoAplicado, setBuscaTermoAplicado] = useState("");
  const [certificateId, setCertificateId] = useState("");
  const [empresaTexto, setEmpresaTexto] = useState(""); // texto visível do input com datalist
  const [certificados, setCertificados] = useState<CertificadoOpcao[]>([]);
  // intervalo de data de emissão — pré-preenchido com os últimos 30 dias
  const [dataInicial, setDataInicial] = useState(() => intervaloPadrao().inicio);
  const [dataFinal, setDataFinal] = useState(() => intervaloPadrao().fim);

  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [chaveAberta, setChaveAberta] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null); // `${chave}:${tipo}`
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const filtroAtivo = buscaTermoAplicado.trim() !== "" || certificateId !== "";

  // Lista de empresas recebedoras (certificados), ordenada alfabeticamente.
  useEffect(() => {
    fetch("/api/certificados")
      .then((r) => r.json())
      .then((j) => {
        const lista: CertificadoOpcao[] = j.certificados ?? [];
        lista.sort((a, b) =>
          (a.razaoSocial?.trim() || a.cnpj).localeCompare(
            b.razaoSocial?.trim() || b.cnpj,
            "pt-BR"
          )
        );
        setCertificados(lista);
      })
      .catch(() => setCertificados([]));
  }, []);

  // Debounce do termo de busca (400ms). Ao aplicar, volta pra página 1.
  useEffect(() => {
    const id = setTimeout(() => {
      setBuscaTermoAplicado(buscaTermo);
      setPagina(1);
    }, 400);
    return () => clearTimeout(id);
  }, [buscaTermo]);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const qs = new URLSearchParams({
        pagina: String(pagina),
        porPagina: String(porPagina),
        ordem,
      });
      if (buscaTermoAplicado.trim()) {
        qs.set("buscaCampo", buscaCampo);
        qs.set("buscaTermo", buscaTermoAplicado.trim());
      }
      if (certificateId) qs.set("certificateId", certificateId);
      if (dataInicial) qs.set("dataInicial", dataInicial);
      if (dataFinal) qs.set("dataFinal", dataFinal);

      const res = await fetch(`/api/notas?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar as notas.");
      setDados(json as Resposta);
    } catch (e: any) {
      setErro(e.message);
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [pagina, porPagina, ordem, buscaCampo, buscaTermoAplicado, certificateId, dataInicial, dataFinal]);

  useEffect(() => {
    buscar();
  }, [buscar]);

  function alternarOrdem() {
    setPagina(1);
    setOrdem((o) => (o === "desc" ? "asc" : "desc"));
  }

  // Quando o modal consegue buscar o XML completo, o backend já gravou
  // xmlCompleto/numero no banco. Atualiza só a linha afetada em memória pra ela
  // sair do estado "aguardando" (amarelo) sem recarregar a página.
  const aoXmlCarregado = useCallback(
    (chave: string, numero: string | null) => {
      setDados((atual) => {
        if (!atual) return atual;
        return {
          ...atual,
          notas: atual.notas.map((n) =>
            n.chaveAcesso === chave
              ? { ...n, statusXml: "completo" as StatusXml, numero: n.numero || numero }
              : n
          ),
        };
      });
    },
    []
  );

  function limparFiltros() {
    setBuscaTermo("");
    setBuscaTermoAplicado("");
    setCertificateId("");
    setEmpresaTexto("");
    const p = intervaloPadrao();
    setDataInicial(p.inicio);
    setDataFinal(p.fim);
    setPagina(1);
  }

  async function baixar(chave: string, tipo: "xml" | "pdf") {
    setErroAcao(null);
    setBaixando(`${chave}:${tipo}`);
    try {
      const res = await fetch(`/api/notas/${chave}/download-${tipo}`);
      if (!res.ok) {
        let msg = `Falha ao baixar o ${tipo.toUpperCase()}.`;
        try {
          msg = (await res.json()).error || msg;
        } catch {
          /* resposta não-JSON */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = tipo === "xml" ? `NFe-${chave}.xml` : `DANFE-${chave}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErroAcao(e.message);
    } finally {
      setBaixando(null);
    }
  }

  // Texto visível/pesquisável de cada certificado no datalist: "Razão Social - CNPJ".
  const rotuloCertificado = (c: CertificadoOpcao) =>
    c.razaoSocial?.trim() ? `${c.razaoSocial.trim()} - ${c.cnpj}` : c.cnpj;

  function aoMudarEmpresa(texto: string) {
    setEmpresaTexto(texto);
    const achado = certificados.find((c) => rotuloCertificado(c) === texto.trim());
    setCertificateId(achado ? achado.id : "");
    setPagina(1);
  }

  const total = dados?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const inicio = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fim = Math.min(pagina * porPagina, total);

  function aoMudarData(qual: "inicial" | "final", valor: string) {
    if (qual === "inicial") setDataInicial(valor);
    else setDataFinal(valor);
    setPagina(1);
  }

  const filtros = (
    <div className="card notes-filtros-card">
      <div className="notes-filtros">
        {/* Linha 1 — Empresa recebedora, largura total */}
        <div className="notes-filtros-linha linha-empresa">
          <div className="field">
            <label>Empresa recebedora</label>
            <input
              type="text"
              list="notas-empresas-recebedoras"
              placeholder="Todas as empresas — digite o nome ou o CNPJ pra buscar…"
              value={empresaTexto}
              onChange={(e) => aoMudarEmpresa(e.target.value)}
            />
            <datalist id="notas-empresas-recebedoras">
              {certificados.map((c) => (
                <option key={c.id} value={rotuloCertificado(c)} />
              ))}
            </datalist>
          </div>
        </div>

        {/* Linha 2 — Data inicial, Data final, Buscar por */}
        <div className="notes-filtros-linha linha-busca">
          <div className="field">
            <label>Data inicial</label>
            <input
              type="date"
              value={dataInicial}
              max={dataFinal || undefined}
              onChange={(e) => aoMudarData("inicial", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Data final</label>
            <input
              type="date"
              value={dataFinal}
              min={dataInicial || undefined}
              onChange={(e) => aoMudarData("final", e.target.value)}
            />
          </div>
          <div className="field notes-filtro-busca">
            <label>Buscar por</label>
            <div className="notes-busca-linha">
              <select value={buscaCampo} onChange={(e) => setBuscaCampo(e.target.value)}>
                {CAMPOS_BUSCA.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Digite o termo…"
                value={buscaTermo}
                onChange={(e) => setBuscaTermo(e.target.value)}
              />
            </div>
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
  );

  return (
    <>
      {filtros}

      <div className="card">
        {erroAcao && (
          <p style={{ color: "var(--red)", fontSize: 13, marginTop: 0 }}>{erroAcao}</p>
        )}

        {erro ? (
          <p style={{ color: "var(--red)" }}>{erro}</p>
        ) : !dados && carregando ? (
          <p style={{ color: "var(--text-dim)" }}>Carregando notas...</p>
        ) : total === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>
            {filtroAtivo
              ? "Nenhuma nota encontrada para os filtros selecionados."
              : 'Nenhuma nota ainda. Cadastre um certificado na aba "Certificados" para começar a sincronizar.'}
          </p>
        ) : (
          <>
          <div className="notes-table-wrap">
            <table className="notes-table">
              <thead>
                <tr>
                  <th>Ações</th>
                  <th>Número</th>
                  <th>
                    <button type="button" className="notes-sort" onClick={alternarOrdem}>
                      Emissão <span>{ordem === "desc" ? "↓" : "↑"}</span>
                    </button>
                  </th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th className="col-empresa">Empresa (Emit.)</th>
                  <th className="col-empresa">Empresa (Receb.)</th>
                  <th>Status</th>
                  <th className="col-nowrap">Eventos</th>
                </tr>
              </thead>
              <tbody>
                {(dados?.notas ?? []).map((nota) => {
                  const chave = nota.chaveAcesso;
                  const aguardando = nota.statusXml === "aguardando";
                  const indisponivel = nota.statusXml === "indisponivel";
                  const titulo = aguardando
                    ? TITULO_AGUARDANDO
                    : indisponivel
                    ? MSG_INDISPONIVEL
                    : undefined;
                  const marcador = aguardando
                    ? " aguardando"
                    : indisponivel
                    ? " indisponivel"
                    : "";
                  const abrir = () =>
                    indisponivel ? setErroAcao(MSG_INDISPONIVEL) : setChaveAberta(chave);
                  const baixarOuAvisar = (tipo: "xml" | "pdf") =>
                    indisponivel ? setErroAcao(MSG_INDISPONIVEL) : baixar(chave, tipo);
                  return (
                    <tr key={chave} className="nota-row">
                      <td>
                        <span className={`nota-acoes${marcador}`}>
                          <button type="button" title={titulo} onClick={abrir}>
                            Ver
                          </button>
                          <button
                            type="button"
                            title={titulo}
                            disabled={baixando === `${chave}:xml`}
                            onClick={() => baixarOuAvisar("xml")}
                          >
                            {baixando === `${chave}:xml` ? "…" : "XML"}
                          </button>
                          <button
                            type="button"
                            title={titulo}
                            disabled={baixando === `${chave}:pdf`}
                            onClick={() => baixarOuAvisar("pdf")}
                          >
                            {baixando === `${chave}:pdf` ? "…" : "PDF"}
                          </button>
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`nota-link${marcador}`}
                          title={titulo}
                          onClick={abrir}
                        >
                          {nota.numero || "-"}
                        </button>
                      </td>
                      <td>{formatarData(nota.dataEmissao)}</td>
                      <td>{nota.tipoOperacao || "-"}</td>
                      <td>{formatarMoeda(nota.valorTotal)}</td>
                      <td className="col-empresa">{nota.emitenteNome || nota.emitenteCnpj}</td>
                      <td className="col-empresa">
                        {nota.destinatarioNome || (
                          <span
                            style={{ fontStyle: "italic", color: "var(--text-dim)" }}
                            title="Nota importada do histórico da Qive; o CNPJ destinatário ainda não tem certificado cadastrado aqui"
                          >
                            Sem certificado (importado da Qive)
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={badgeClasse(nota.status)}>{nota.status}</span>
                      </td>
                      <td className="col-nowrap">
                        {nota.qtdEventos > 0 ? `${nota.qtdEventos} evento(s)` : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="notes-pag">
            <span>
              Mostrando {inicio}&ndash;{fim} de {total.toLocaleString("pt-BR")} nota
              {total === 1 ? "" : "s"} {carregando ? "· atualizando…" : ""}
            </span>
            <div className="notes-pag-controles">
              <label>
                Linhas:{" "}
                <select
                  value={porPagina}
                  onChange={(e) => {
                    setPagina(1);
                    setPorPagina(Number(e.target.value));
                  }}
                >
                  {POR_PAGINA_OPCOES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
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
        <NotaModal
          chave={chaveAberta}
          onClose={() => setChaveAberta(null)}
          onXmlCarregado={aoXmlCarregado}
        />
      )}
    </>
  );
}
