"use client";

import { useCallback, useEffect, useState } from "react";
import { NotaModal } from "@/components/NotaModal";

interface NotaLinha {
  chaveAcesso: string;
  numero: string | null;
  dataEmissao: string | null;
  tipoOperacao: string | null;
  valorTotal: string;
  emitenteNome: string | null;
  emitenteCnpj: string | null;
  destinatarioNome: string;
  status: string;
  qtdEventos: number;
  temXmlCompleto: boolean;
}

const TITULO_PENDENTE = "Aguardando XML completo da SEFAZ";

interface Resposta {
  notas: NotaLinha[];
  total: number;
  pagina: number;
  porPagina: number;
  ordem: "asc" | "desc";
}

const POR_PAGINA_OPCOES = [25, 50, 100];

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

  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [chaveAberta, setChaveAberta] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null); // `${chave}:${tipo}`
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const qs = new URLSearchParams({
        pagina: String(pagina),
        porPagina: String(porPagina),
        ordem,
      });
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
  }, [pagina, porPagina, ordem]);

  useEffect(() => {
    buscar();
  }, [buscar]);

  function alternarOrdem() {
    setPagina(1);
    setOrdem((o) => (o === "desc" ? "asc" : "desc"));
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

  const total = dados?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const inicio = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fim = Math.min(pagina * porPagina, total);

  if (erro) {
    return <p style={{ color: "var(--red)" }}>{erro}</p>;
  }

  if (!dados && carregando) {
    return <p style={{ color: "var(--text-dim)" }}>Carregando notas...</p>;
  }

  if (dados && total === 0) {
    return (
      <p style={{ color: "var(--text-dim)" }}>
        Nenhuma nota ainda. Cadastre um certificado na aba &quot;Certificados&quot; para começar a
        sincronizar.
      </p>
    );
  }

  return (
    <>
      {erroAcao && (
        <p style={{ color: "var(--red)", fontSize: 13, marginTop: 0 }}>{erroAcao}</p>
      )}

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
              <th>Empresa (Emit.)</th>
              <th>Empresa (Receb.)</th>
              <th>Status</th>
              <th>Eventos</th>
            </tr>
          </thead>
          <tbody>
            {(dados?.notas ?? []).map((nota) => {
              const pendente = !nota.temXmlCompleto;
              const tituloPendente = pendente ? TITULO_PENDENTE : undefined;
              return (
              <tr key={nota.chaveAcesso} className="nota-row">
                <td>
                  <span className={`nota-acoes${pendente ? " aguardando" : ""}`}>
                    <button
                      type="button"
                      title={tituloPendente}
                      onClick={() => setChaveAberta(nota.chaveAcesso)}
                    >
                      Ver
                    </button>
                    <button
                      type="button"
                      title={tituloPendente}
                      disabled={baixando === `${nota.chaveAcesso}:xml`}
                      onClick={() => baixar(nota.chaveAcesso, "xml")}
                    >
                      {baixando === `${nota.chaveAcesso}:xml` ? "…" : "XML"}
                    </button>
                    <button
                      type="button"
                      title={tituloPendente}
                      disabled={baixando === `${nota.chaveAcesso}:pdf`}
                      onClick={() => baixar(nota.chaveAcesso, "pdf")}
                    >
                      {baixando === `${nota.chaveAcesso}:pdf` ? "…" : "PDF"}
                    </button>
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className={`nota-link${pendente ? " aguardando" : ""}`}
                    title={tituloPendente}
                    onClick={() => setChaveAberta(nota.chaveAcesso)}
                  >
                    {nota.numero || "-"}
                  </button>
                </td>
                <td>{formatarData(nota.dataEmissao)}</td>
                <td>{nota.tipoOperacao || "-"}</td>
                <td>{formatarMoeda(nota.valorTotal)}</td>
                <td>{nota.emitenteNome || nota.emitenteCnpj}</td>
                <td>{nota.destinatarioNome}</td>
                <td>
                  <span className={badgeClasse(nota.status)}>{nota.status}</span>
                </td>
                <td>{nota.qtdEventos > 0 ? `${nota.qtdEventos} evento(s)` : "-"}</td>
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

      {chaveAberta && <NotaModal chave={chaveAberta} onClose={() => setChaveAberta(null)} />}
    </>
  );
}
