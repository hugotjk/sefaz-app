"use client";

import { useEffect, useState } from "react";
import { parseNFeXml, type NFeParaExibir } from "@/lib/parse-nfe-xml";
import { DanfeView } from "@/components/DanfeView";

export function NotaModal({
  chave,
  onClose,
  onXmlCarregado,
}: {
  chave: string;
  onClose: () => void;
  /** Chamado quando o XML completo é obtido com sucesso (o backend acabou de
   *  salvar `xmlCompleto`/`numero`/`serie` no banco). Serve pra o NotasTable
   *  atualizar a linha correspondente sem recarregar a página. */
  onXmlCarregado?: (chave: string, numero: string | null, serie: string | null) => void;
}) {
  const [nfe, setNfe] = useState<NFeParaExibir | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    setNfe(null);

    fetch(`/api/notas/${chave}/xml`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        const parsed = parseNFeXml(data.xml);
        if (!cancelado) setNfe(parsed);
        // Sucesso => a nota agora tem XML completo no banco. Avisa o pai mesmo
        // se o modal já foi fechado (a atualização é na tabela, não aqui).
        onXmlCarregado?.(chave, parsed.numero || null, parsed.serie || null);
      })
      .catch((e) => {
        if (!cancelado) setErro(e.message);
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [chave, onXmlCarregado]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Fechar">
          ✕
        </button>

        <div className="no-print" style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Nota fiscal</h2>
          {nfe && (
            <button className="btn" onClick={() => window.print()}>
              Imprimir
            </button>
          )}
        </div>

        {carregando && <p style={{ color: "var(--text-dim)" }}>Buscando XML completo na SEFAZ...</p>}
        {erro && <p style={{ color: "var(--red)" }}>{erro}</p>}
        {nfe && <DanfeView nfe={nfe} />}
      </div>
    </div>
  );
}
