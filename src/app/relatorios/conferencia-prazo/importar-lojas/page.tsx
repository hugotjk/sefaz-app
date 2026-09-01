"use client";

import { useState } from "react";
import Link from "next/link";

interface Resultado {
  linhas: number;
  importadas: number;
  ignoradas: number;
  erros: string[];
}

export default function ImportarLojasPage() {
  const [tsv, setTsv] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function importar() {
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const res = await fetch("/api/lojas-referencia/importar", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: tsv,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Falha na importação.");
      setResultado(json as Resultado);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
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
        <h1 style={{ margin: 0 }}>Importar planilha de lojas</h1>
        <Link
          href="/relatorios/conferencia-prazo"
          style={{ fontSize: 13, color: "var(--text-dim)" }}
        >
          ← Conferência de Prazo
        </Link>
      </div>

      <div className="card">
        <p style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 0 }}>
          Cole o conteúdo da planilha em formato TSV (separado por tabulação), com as colunas
          na ordem: <code>cnpj</code>, <code>status</code>, <code>loja</code>, <code>gestor</code>,{" "}
          <code>rede</code>, <code>tipoLoja</code>, <code>razaoSocial</code>,{" "}
          <code>comprador</code>. A primeira linha pode ser o cabeçalho (é ignorada). A gravação
          é por <strong>upsert por CNPJ</strong> — reimportar substitui os dados existentes.
        </p>

        <textarea
          value={tsv}
          onChange={(e) => setTsv(e.target.value)}
          placeholder="cnpj&#9;status&#9;loja&#9;gestor&#9;rede&#9;tipoLoja&#9;razaoSocial&#9;comprador&#10;03088750000155&#9;ATIVO&#9;NRN URUBUTIQUE&#9;ZECA&#9;MULTI&#9;FLAMENGO&#9;URUBUTIQUE ARTIGOS ESPORTIVOS LTDA ME&#9;0"
          rows={14}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: 12,
            background: "var(--panel-2)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            resize: "vertical",
          }}
        />

        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={importar} disabled={enviando || !tsv.trim()}>
            {enviando ? "Importando…" : "Importar"}
          </button>
        </div>

        {erro && <p style={{ color: "var(--red)", marginTop: 14 }}>{erro}</p>}

        {resultado && (
          <div style={{ marginTop: 16, fontSize: 14 }}>
            <p style={{ color: "var(--green)", margin: "0 0 6px" }}>
              ✓ {resultado.importadas} loja(s) importada(s)/atualizada(s).
            </p>
            <p style={{ color: "var(--text-dim)", margin: 0 }}>
              {resultado.linhas} linha(s) no total, {resultado.ignoradas} ignorada(s).
            </p>
            {resultado.erros.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <p style={{ color: "var(--yellow)", margin: "0 0 4px" }}>
                  {resultado.erros.length} aviso(s):
                </p>
                <ul style={{ color: "var(--text-dim)", fontSize: 13, margin: 0 }}>
                  {resultado.erros.slice(0, 20).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
