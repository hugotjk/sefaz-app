"use client";

import { useEffect, useState } from "react";

interface Resultado {
  fileName: string;
  ok: boolean;
  cnpj?: string;
  erro?: string;
}

interface CertificadoSalvo {
  id: string;
  cnpj: string;
  razaoSocial: string | null;
  status: "PENDING" | "ACTIVE" | "PASSWORD_ERROR" | "EXPIRED";
  lastError: string | null;
  backfillDone: boolean;
  validUntil: string | null;
  createdAt: string;
  _count: { notes: number };
}

function statusLabel(c: CertificadoSalvo) {
  if (c.status === "PASSWORD_ERROR") return { texto: "Senha incorreta — reenvie", classe: "status-erro" };
  if (c.status === "EXPIRED") return { texto: "Expirado", classe: "status-erro" };
  if (c.status === "ACTIVE" && !c.backfillDone)
    return { texto: "Carregando histórico...", classe: "status-ok" };
  if (c.status === "ACTIVE") return { texto: "Ativo, sincronizando de hora em hora", classe: "status-ok" };
  return { texto: "Pendente", classe: "status-erro" };
}

export default function CertificadosPage() {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [certificados, setCertificados] = useState<CertificadoSalvo[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [sincronizando, setSincronizando] = useState<string | null>(null);
  const [avisoSync, setAvisoSync] = useState<string | null>(null);

  async function carregarCertificados() {
    setCarregandoLista(true);
    const res = await fetch("/api/certificados");
    const data = await res.json();
    setCertificados(data.certificados ?? []);
    setCarregandoLista(false);
  }

  useEffect(() => {
    carregarCertificados();
  }, []);

  async function enviar() {
    if (arquivos.length === 0 || !senha) return;
    setEnviando(true);
    setResultados(null);

    const formData = new FormData();
    formData.set("senha", senha);
    arquivos.forEach((a) => formData.append("certificados", a));

    const res = await fetch("/api/certificados/upload", { method: "POST", body: formData });
    const data = await res.json();
    setResultados(data.resultados ?? []);
    setEnviando(false);
    setArquivos([]);
    await carregarCertificados();
  }

  async function sincronizarAgora(id: string) {
    setSincronizando(id);
    setAvisoSync(null);
    const res = await fetch(`/api/certificados/${id}/sync`, { method: "POST" });
    const data = await res.json();
    setSincronizando(null);
    if (!res.ok) {
      setAvisoSync(data.error ?? "Erro ao disparar sincronização.");
    } else {
      setAvisoSync("Sincronização disparada — acompanhe o progresso no painel do Inngest.");
    }
  }

  const comErro = resultados?.filter((r) => !r.ok) ?? [];

  return (
    <div>
      <h1>Certificados digitais</h1>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="field">
          <label>Arquivos .pfx (pode selecionar vários de uma vez)</label>
          <div className="dropzone">
            <input
              type="file"
              accept=".pfx,.p12"
              multiple
              onChange={(e) => setArquivos(Array.from(e.target.files ?? []))}
            />
            {arquivos.length > 0 && (
              <p style={{ marginTop: 10 }}>{arquivos.length} arquivo(s) selecionado(s)</p>
            )}
          </div>
        </div>

        <div className="field">
          <label>Senha (mesma para todos os certificados selecionados)</label>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Senha do certificado"
          />
        </div>

        <button className="btn" disabled={enviando || arquivos.length === 0 || !senha} onClick={enviar}>
          {enviando ? "Enviando..." : "Enviar certificados"}
        </button>

        {resultados && (
          <div className="file-list">
            {resultados.map((r) => (
              <div key={r.fileName} className="file-row">
                <span>{r.fileName}</span>
                {r.ok ? (
                  <span className="status-ok">✓ CNPJ {r.cnpj} validado</span>
                ) : (
                  <span className="status-erro">
                    ✗ {r.erro === "SENHA_INCORRETA" ? "Senha incorreta" : r.erro}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {comErro.length > 0 && (
          <p style={{ marginTop: 14, color: "var(--text-dim)", fontSize: 13 }}>
            {comErro.length} certificado(s) falharam. Selecione só esses arquivos de novo, digite a
            senha correta e envie novamente — os que já deram certo não precisam ser reenviados.
          </p>
        )}
      </div>

      <h2>Certificados cadastrados</h2>
      {avisoSync && (
        <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: -8, marginBottom: 12 }}>{avisoSync}</p>
      )}
      <div className="card">
        {carregandoLista ? (
          <p style={{ color: "var(--text-dim)" }}>Carregando...</p>
        ) : certificados.length === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>Nenhum certificado cadastrado ainda.</p>
        ) : (
          <table className="notes-table">
            <thead>
              <tr>
                <th>CNPJ</th>
                <th>Razão social</th>
                <th>Status</th>
                <th>Notas salvas</th>
                <th>Válido até</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {certificados.map((c) => {
                const s = statusLabel(c);
                return (
                  <tr key={c.id}>
                    <td>{c.cnpj}</td>
                    <td>{c.razaoSocial || "-"}</td>
                    <td><span className={s.classe}>{s.texto}</span></td>
                    <td>{c._count.notes}</td>
                    <td>{c.validUntil ? new Date(c.validUntil).toLocaleDateString("pt-BR") : "-"}</td>
                    <td>
                      {c.status === "ACTIVE" && (
                        <button
                          className="btn"
                          style={{ padding: "6px 12px", fontSize: 12 }}
                          disabled={sincronizando === c.id}
                          onClick={() => sincronizarAgora(c.id)}
                        >
                          {sincronizando === c.id ? "Disparando..." : "Sincronizar agora"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
