/** Texto das primeiras páginas de um PDF (vazio se for imagem escaneada ou der erro). */
export async function textoDoPdf(buffer: Buffer, maxPaginas = 4): Promise<string> {
  try {
    // import direto do arquivo da lib: o index dela tenta ler um PDF de teste ao ser carregado
    const mod: any = await import("pdf-parse/lib/pdf-parse.js");
    const pdf = mod.default ?? mod;
    const r = await pdf(buffer, { max: maxPaginas });
    return String(r?.text ?? "");
  } catch {
    return "";
  }
}
