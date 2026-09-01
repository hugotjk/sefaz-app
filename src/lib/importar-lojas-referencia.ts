import { prisma } from "@/lib/db";

export interface ResultadoImportacao {
  linhas: number;
  importadas: number;
  ignoradas: number;
  erros: string[];
}

const COLUNAS = [
  "cnpj",
  "status",
  "loja",
  "gestor",
  "rede",
  "tipoLoja",
  "razaoSocial",
  "comprador",
] as const;

/**
 * Importa a planilha de referência de lojas (TSV com header
 * `cnpj status loja gestor rede tipoLoja razaoSocial comprador`) fazendo
 * upsert por `cnpj`. Tolerante: pula linhas em branco e o header.
 */
export async function importarLojasReferenciaTsv(tsv: string): Promise<ResultadoImportacao> {
  const linhas = tsv.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  const erros: string[] = [];
  let importadas = 0;
  let ignoradas = 0;

  for (let i = 0; i < linhas.length; i++) {
    const cols = linhas[i].split("\t");
    const cnpjRaw = (cols[0] ?? "").trim();
    const cnpj = cnpjRaw.replace(/\D/g, "");

    // Header ou linha inválida
    if (cnpjRaw.toLowerCase() === "cnpj") {
      ignoradas++;
      continue;
    }
    if (cnpj.length < 11) {
      ignoradas++;
      if (cnpjRaw) erros.push(`Linha ${i + 1}: CNPJ inválido ("${cnpjRaw}")`);
      continue;
    }

    const v = (idx: number) => {
      const s = (cols[idx] ?? "").trim();
      return s === "" ? null : s;
    };
    const status = (v(1) ?? "").toUpperCase();
    const loja = v(2);
    if (!loja) {
      ignoradas++;
      erros.push(`Linha ${i + 1}: sem nome de loja (CNPJ ${cnpj})`);
      continue;
    }

    const dados = {
      status: status || "INATIVO",
      loja,
      gestor: v(3),
      rede: v(4),
      tipoLoja: v(5),
      razaoSocial: v(6),
      comprador: v(7),
    };

    try {
      await prisma.lojaReferencia.upsert({
        where: { cnpj },
        create: { cnpj, ...dados },
        update: dados,
      });
      importadas++;
    } catch (e: any) {
      erros.push(`Linha ${i + 1} (CNPJ ${cnpj}): ${e?.message ?? "erro ao gravar"}`);
    }
  }

  return { linhas: linhas.length, importadas, ignoradas, erros };
}

export { COLUNAS };
