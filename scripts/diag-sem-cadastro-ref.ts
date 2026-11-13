/**
 * SOMENTE LEITURA: para os itens SEM cadastro de alguns fornecedores, procura no catálogo um produto com a
 * mesma referência (qualquer modelo/fornecedor). Responde: "o produto não existe no PDV" ou
 * "existe, mas com outro modelo/referência".
 *   npx tsx --env-file=.env scripts/diag-sem-cadastro-ref.ts "M&L SPORT" "RANC" ...
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

async function main() {
  const alvos = process.argv.slice(2);
  for (const alvo of alvos) {
    console.log(`\n==================== ${alvo} ====================`);
    const itens = await prisma.$queryRaw<{ cod: string; descricao: string; modelo: string | null; ref: string | null }[]>`
      SELECT DISTINCT ni."codigoProduto" AS cod, ni.descricao, ni."modeloIdentificado" AS modelo, ni."referenciaFornecedorIdentificada" AS ref
      FROM "NotaItem" ni JOIN "Note" n ON n.id = ni."noteId"
      WHERE n."emitenteNome" ILIKE ${alvo + "%"} AND ni."temCadastro" = false`;
    console.log(`Itens (distintos) sem cadastro: ${itens.length}`);
    let existe = 0, naoExiste = 0;
    const mostrar: string[] = [];
    for (const i of itens) {
      const ref = up(i.ref);
      const semEsp = ref.replace(/\s+/g, "");
      const ps = await prisma.produto.findMany({
        where: { OR: [{ referenciaFornecedor: { equals: ref, mode: "insensitive" } }, { referenciaFornecedor: { equals: semEsp, mode: "insensitive" } }] },
        select: { referenciaFornecedor: true, modeloNome: true, fornecedorNome: true },
        take: 3,
      });
      if (ps.length) {
        existe++;
        if (mostrar.length < 15)
          mostrar.push(`  EXISTE com outro modelo? gerado "${i.modelo}" / ref "${i.ref}" -> catálogo: ${ps.map((p) => `${p.referenciaFornecedor} [${p.modeloNome}] (${p.fornecedorNome})`).join(" ; ")}`);
      } else naoExiste++;
    }
    console.log(`  Referência EXISTE no catálogo (mas o item não casou — modelo diferente?): ${existe}`);
    console.log(`  Referência NÃO existe no catálogo (produto não cadastrado): ${naoExiste}`);
    for (const m of mostrar) console.log(m);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
