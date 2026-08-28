"use client";

import { useEffect, useState } from "react";
import { parseNFeXml, type NFeParaExibir } from "@/lib/parse-nfe-xml";
import { DanfeView } from "@/components/DanfeView";

export default function NotaPage({ params }: { params: { chave: string } }) {
  const [nfe, setNfe] = useState<NFeParaExibir | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    fetch(`/api/notas/${params.chave}/xml`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setNfe(parseNFeXml(data.xml));
      })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [params.chave]);

  return (
    <div>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <h1>Nota fiscal</h1>
        {nfe && <button className="btn" onClick={() => window.print()}>Imprimir</button>}
      </div>

      {carregando && <p style={{ color: "var(--text-dim)" }}>Buscando XML completo na SEFAZ...</p>}
      {erro && <p style={{ color: "var(--red)" }}>{erro}</p>}
      {nfe && <DanfeView nfe={nfe} />}
    </div>
  );
}
