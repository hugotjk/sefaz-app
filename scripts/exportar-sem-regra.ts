/**
 * SOMENTE LEITURA. Gera `fornecedores-sem-regra.xlsx` (na pasta onde você rodar): 5 itens de cada fornecedor
 * que aparece em "Sem regra de Modelo" e/ou "Sem regra de Referência" na Conferência de Produtos,
 * com uma coluna dizendo o que falta (Modelo, Referência ou Ambos).
 *
 *   npx tsx --env-file=.env scripts/exportar-sem-regra.ts
 */
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { EMPRESAS_BANIDAS } from "../src/lib/identificar-produto";

const prisma = new PrismaClient();
const POR_FORNECEDOR = 5;

type Linha = {
  emitente: string; numero: string | null; codigo: string; descricao: string; ean: string | null;
  modelo: string | null; referencia: string | null; comRegra: boolean; temCadastro: boolean;
};

async function main() {
  const rows = await prisma.$queryRaw<Linha[]>`
    SELECT COALESCE(n."emitenteNome", '(sem emitente)') AS emitente, n.numero::text AS numero,
           regexp_replace(i."codigoProduto", '[^[:print:]]', ' ', 'g') AS codigo,
           regexp_replace(i.descricao, '[^[:print:]]', ' ', 'g') AS descricao,
           i.ean, i."modeloIdentificado" AS modelo, i."referenciaFornecedorIdentificada" AS referencia,
           i."referenciaComRegraEspecifica" AS "comRegra", i."temCadastro" AS "temCadastro"
    FROM "NotaItem" i JOIN "Note" n ON n.id = i."noteId"
    WHERE (i."modeloIdentificado" IS NULL OR i."modeloIdentificado" = '' OR i."referenciaComRegraEspecifica" = false)
    ORDER BY n."dataEmissao" DESC NULLS LAST, i.id`;

  const banidos = new Set<string>(EMPRESAS_BANIDAS);
  const porForn = new Map<string, Linha[]>();
  const totais = new Map<string, number>();
  for (const r of rows) {
    if (banidos.has(r.emitente)) continue;
    totais.set(r.emitente, (totais.get(r.emitente) ?? 0) + 1);
    const l = porForn.get(r.emitente) ?? [];
    if (l.length < POR_FORNECEDOR) l.push(r);
    porForn.set(r.emitente, l);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sem regra");
  ws.columns = [
    { header: "Fornecedor", key: "f", width: 48 },
    { header: "Itens sem regra (total)", key: "t", width: 14 },
    { header: "O que falta", key: "falta", width: 14 },
    { header: "Nota", key: "n", width: 10 },
    { header: "Código", key: "c", width: 20 },
    { header: "Descrição", key: "d", width: 52 },
    { header: "EAN", key: "e", width: 16 },
    { header: "Modelo identificado", key: "m", width: 22 },
    { header: "Referência identificada", key: "r", width: 26 },
    { header: "Tem cadastro?", key: "tc", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const ordem = [...porForn.keys()].sort((a, b) => (totais.get(b)! - totais.get(a)!) || a.localeCompare(b));
  for (const f of ordem) {
    for (const r of porForn.get(f)!) {
      const semModelo = !r.modelo || r.modelo === "";
      const semRef = !r.comRegra;
      ws.addRow({
        f, t: totais.get(f), falta: semModelo && semRef ? "Ambos" : semModelo ? "Modelo" : "Referência",
        n: r.numero ?? "", c: r.codigo, d: r.descricao, e: r.ean ?? "", m: r.modelo ?? "", r: r.referencia ?? "",
        tc: r.temCadastro ? "Sim" : "Não",
      });
    }
  }
  ws.autoFilter = { from: "A1", to: "J1" };
  await wb.xlsx.writeFile("fornecedores-sem-regra.xlsx");
  console.log(`Gerado fornecedores-sem-regra.xlsx — ${ordem.length} fornecedores, até ${POR_FORNECEDOR} itens cada.`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
