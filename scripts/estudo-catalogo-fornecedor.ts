/** SOMENTE LEITURA: lista produtos do catálogo de Radu/Bagaggio, Xeryus e CHP/Champion. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function bloco(titulo: string, where: any) {
  console.log(`\n===== ${titulo} =====`);
  const total = await prisma.produto.count({ where });
  console.log("Produtos no catálogo:", total);
  const porModelo = await prisma.produto.groupBy({ by: ["modeloNome"], where, _count: true, orderBy: { _count: { modeloNome: "desc" } }, take: 10 });
  console.log("Modelos:", porModelo.map((m) => `${m.modeloNome}=${m._count}`).join(" ; "));
  const porForn = await prisma.produto.groupBy({ by: ["fornecedorNome"], where, _count: true, orderBy: { _count: { fornecedorNome: "desc" } }, take: 6 });
  console.log("Fornecedor no catálogo:", porForn.map((m) => `${m.fornecedorNome}=${m._count}`).join(" ; "));
  const amostra = await prisma.produto.findMany({ where, take: 25, orderBy: { referenciaFornecedor: "asc" }, select: { referenciaFornecedor: true, modeloNome: true, nome: true as any } as any });
  for (const p of amostra as any[]) console.log(`  ${p.referenciaFornecedor} | ${p.modeloNome} | ${p.nome ?? ""}`);
}

async function main() {
  await bloco("RADU / BAGAGGIO", { OR: [{ fornecedorNome: { contains: "RADU", mode: "insensitive" } }, { modeloNome: { contains: "BAGAGG", mode: "insensitive" } }] });
  await bloco("XERYUS", { fornecedorNome: { contains: "XERYUS", mode: "insensitive" } });
  await bloco("CHP / CHAMPION", { OR: [{ fornecedorNome: { contains: "CHP", mode: "insensitive" } }, { modeloNome: { equals: "CHAMPION", mode: "insensitive" } }] });
  // referências das notas que procuramos (Xeryus 22xxx) existem no catálogo?
  const x = await prisma.produto.findMany({ where: { referenciaFornecedor: { in: ["22012", "22014", "22016", "22022", "22027"] } }, select: { referenciaFornecedor: true, modeloNome: true, fornecedorNome: true } });
  console.log("\nXeryus 22012/22014/22016/22022/22027 no catálogo:", JSON.stringify(x));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
