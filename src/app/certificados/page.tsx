"use client";

import { useState } from "react";

interface Resultado {
  fileName: string;
  ok: boolean;
  cnpj?: string;
  erro?: string;
}

export default function CertificadosPage() {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);

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
  }

  const comErro = resultados?.filter((r) => !r.ok) ?? [];

  return (
    <div>
      <h1>Certificados digitais</h1>
      <div className="card">
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
    </div>
  );
}
