/** SOMENTE LEITURA: onde estão os itens Thug Nine da R Dois e com que emitente/valores estão gravados. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const nomes = await prisma.$queryRaw<{ emitente: string | null; n: number }[]>`
    SELECT n."emitenteNome" AS emitente, COUNT(*)::int AS n
    FROM "NotaItem" i JOIN "Note" n ON n.id = i."noteId"
    WHERE n."emitenteNome" ILIKE '%DOIS%' OR i.descricao ILIKE '%THUG NINE%'
    GROUP BY 1 ORDER BY 2 DESC`;
  console.log("Emitentes (nome exato entre aspas | itens):");
  for (const r of nomes) console.log(`  "${r.emitente}" | ${r.n}`);
  const itens = await prisma.$queryRaw<{ cod: string; emitente: string | null; modelo: string | null; ref: string | null; tem: boolean; comRegra: boolean; atualizado: Date }[]>`
    SELECT i."codigoProduto" AS cod, n."emitenteNome" AS emitente, i."modeloIdentificado" AS modelo,
           i."referenciaFornecedorIdentificada" AS ref, i."temCadastro" AS tem,
           i."referenciaComRegraEspecifica" AS "comRegra", i."updatedAt" AS atualizado
    FROM "NotaItem" i JOIN "Note" n ON n.id = i."noteId"
    WHERE i."codigoProduto" IN ('26012702-02','26012703-59','1703.FL0008')
    ORDER BY i."updatedAt" DESC LIMIT 20`;
  console.log("\nItens 26012702-02 / 26012703-59 / 1703.FL0008 (cod | emitente | modelo | ref | tem | comRegra | atualizado):");
  for (const r of itens) console.log(`  ${r.cod} | "${r.emitente}" | ${r.modelo} | ${r.ref} | ${r.tem} | ${r.comRegra} | ${r.atualizado.toISOString()}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
