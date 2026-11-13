/** SOMENTE LEITURA: por que itens da Radu seguem sem cadastro? Mostra, por item, se a referência existe no catálogo e com qual modelo. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const itens = await prisma.notaItem.findMany({
    where: { note: { emitenteNome: { startsWith: "RADU INDUSTRIA" } } },
    select: { codigoProduto: true, descricao: true, modeloIdentificado: true, referenciaFornecedorIdentificada: true, temCadastro: true },
  });
  const vistos = new Set<string>();
  for (const i of itens) {
    const ref = (i.referenciaFornecedorIdentificada ?? "").trim();
    if (vistos.has(ref)) continue;
    vistos.add(ref);
    const ps = await prisma.produto.findMany({ where: { referenciaFornecedor: { equals: ref, mode: "insensitive" } }, select: { modeloNome: true } });
    console.log(`${i.temCadastro ? "OK  " : "FALTA"} | ref ${ref} | modelo gerado "${i.modeloIdentificado}" | catálogo: ${ps.length ? ps.map((p) => p.modeloNome).join(", ") : "(referência NÃO existe)"} | ${i.descricao}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
