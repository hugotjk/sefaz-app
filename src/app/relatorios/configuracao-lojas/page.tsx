"use client";

import { useEffect, useState } from "react";

const OPCOES_TIPO_LOJA = [
  "FLAMENGO",
  "FLUMINENSE",
  "FUTEBOL",
  "LACOSTE",
  "LACOSTE INATIVA",
  "MARACANÃ",
  "SANDALS & CO",
  "STANCE",
];

interface Loja {
  id: number;
  nome: string;
  razaoSocial: string;
  cnpj: string;
  inativa: boolean;
  gestor: string;
  tipoLoja: string;
}

export default function ConfiguracaoLojasPage() {
  const [lojas, setLojas] = useState<Loja[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<number | null>(null);

  async function carregar() {
    setErro(null);
    try {
      const res = await fetch("/api/lojas");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLojas(data.lojas);
    } catch (e: any) {
      setErro(e.message);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function salvar(loja: Loja, campo: "gestor" | "tipoLoja", valor: string) {
    setSalvando(loja.id);
    const atualizado = { ...loja, [campo]: valor };
    setLojas((prev) => prev?.map((l) => (l.id === loja.id ? atualizado : l)) ?? null);

    await fetch("/api/lojas/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lojaId: loja.id,
        nome: loja.nome,
        gestor: atualizado.gestor,
        tipoLoja: atualizado.tipoLoja,
      }),
    });
    setSalvando(null);
  }

  return (
    <div>
      <h1>Configuração de Lojas</h1>
      <p style={{ color: "var(--text-dim)", marginTop: -10, marginBottom: 20, fontSize: 14 }}>
        A API do PDV não informa Gestor nem Tipo Loja — atribua aqui uma vez pra cada loja.
        Salva automaticamente ao trocar o valor.
      </p>

      {erro && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ color: "var(--red)" }}>{erro}</p>
        </div>
      )}

      <div className="card">
        {!lojas ? (
          <p style={{ color: "var(--text-dim)" }}>Carregando lojas da API do PDV...</p>
        ) : (
          <table className="notes-table">
            <thead>
              <tr>
                <th>Loja</th>
                <th>CNPJ</th>
                <th>Gestor</th>
                <th>Tipo Loja</th>
              </tr>
            </thead>
            <tbody>
              {lojas.map((loja) => (
                <tr key={loja.id}>
                  <td>{loja.nome}{loja.inativa ? " (inativa)" : ""}</td>
                  <td>{loja.cnpj}</td>
                  <td>
                    <input
                      type="text"
                      defaultValue={loja.gestor}
                      placeholder="Nome do gestor"
                      onBlur={(e) => salvar(loja, "gestor", e.target.value)}
                      style={{
                        background: "var(--panel-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        color: "var(--text)",
                        fontSize: 13,
                        width: "100%",
                      }}
                    />
                  </td>
                  <td>
                    <select
                      value={loja.tipoLoja}
                      onChange={(e) => salvar(loja, "tipoLoja", e.target.value)}
                      style={{
                        background: "var(--panel-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        color: "var(--text)",
                        fontSize: 13,
                        width: "100%",
                      }}
                    >
                      <option value="">Selecione...</option>
                      {OPCOES_TIPO_LOJA.map((op) => (
                        <option key={op} value={op}>{op}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {salvando !== null && (
          <p style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 10 }}>Salvando...</p>
        )}
      </div>
    </div>
  );
}
