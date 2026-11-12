/**
 * Nome dos arquivos baixados das notas emitidas:
 *   OUT FLA_SERIE 010_NF 002_case #03151099.xml
 * O nome curto é o começo da razão social, antes de "COMERCIO DE ROUPAS", "ARTIGOS DO VESTUARIO",
 * abreviações (COM., ART., IND.) ou do tipo societário (LTDA, ME, EPP...).
 */
const CORTE = new Set([
  "COMERCIO", "COMÉRCIO", "COM", "COM.", "ARTIGOS", "ARTIGO", "ART", "ART.", "ARTS", "ARTS.",
  "INDUSTRIA", "INDÚSTRIA", "IND", "IND.", "LTDA", "LTDA.", "ME", "EPP", "EIRELI", "S/A", "SA", "S.A.", "S.A", "VAREJO", "DE", "DO", "DA",
]);

export function nomeCurto(razaoSocial: string): string {
  const palavras = razaoSocial.trim().replace(/\s+/g, " ").split(" ");
  const out: string[] = [];
  for (const p of palavras) {
    if (CORTE.has(p.toUpperCase()) && out.length > 0) break;
    out.push(p);
  }
  const nome = (out.length ? out.join(" ") : palavras[0] ?? "NFE").replace(/[\\/:*?"<>|]/g, "").trim();
  return nome || "NFE";
}

export function nomeArquivoNota(o: {
  razaoSocial: string; serie: number; numero: number; caso?: string | null;
  ext: "xml" | "pdf"; prefixo?: string; sufixo?: string;
}): string {
  const caso = (o.caso ?? "").replace(/\D/g, "");
  return (
    `${o.prefixo ?? ""}${nomeCurto(o.razaoSocial)}_SERIE ${String(o.serie).padStart(3, "0")}` +
    `_NF ${String(o.numero).padStart(3, "0")}${caso ? `_case #${caso}` : ""}${o.sufixo ?? ""}.${o.ext}`
  );
}

/** Content-Disposition com nome UTF-8 seguro (espaços, # e acentos). */
export function contentDisposition(tipo: "inline" | "attachment", nome: string): string {
  const ascii = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}
