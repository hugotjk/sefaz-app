/**
 * Completa EAN/cor/tamanho das variações de produtos específicos, direto da API do PDV
 * (o enriquecimento automático roda de 2 em 2h e pode demorar a chegar neles). Cria também
 * as variações que o app ainda não conhece. Depois marca "com cadastro" os itens de nota
 * que passam a casar. Roda no seu PC; seguro para repetir.
 *
 *   Simulação (não grava): npx tsx --env-file=.env scripts/enriquecer-variacoes-ref.ts --ref=UN.17200.99,UN.18200.99
 *   Gravar:                npx tsx --env-file=.env scripts/enriquecer-variacoes-ref.ts --ref=UN.17200.99,UN.18200.99 --apply
 *
 * --ref: trecho(s) da referência do fornecedor (separe por vírgula). --modelo=Rikam (opcional).
 */
import { PrismaClient } from "@prisma/client";
import { listarVariacoesProduto } from "../src/lib/pdvapi";
import { vincularCadastroDeProdutos } from "../src/lib/reavaliar-cadastro-recentes";
import { idApiDoProduto } from "../src/lib/produto-id";

const prisma = new PrismaClient();
const arg = (n: string) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);
const APLICAR = process.argv.includes("--apply");

async function main() {
  const refs = (arg("ref") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const modelo = arg("modelo");
  if (refs.length === 0) throw new Error("Informe --ref=TRECHO[,TRECHO2]");

  const produtos = await prisma.produto.findMany({
    where: {
      OR: refs.map((r) => ({ referenciaFornecedor: { contains: r, mode: "insensitive" as const } })),
      ...(modelo ? { modeloNome: { equals: modelo, mode: "insensitive" as const } } : {}),
    },
    select: { id: true, redeId: true, referenciaFornecedor: true, modeloNome: true, nome: true },
    take: 200,
  });
  console.log(`${APLICAR ? "[APPLY]" : "[SIMULAÇÃO]"} ${produtos.length} produto(s) encontrados para ${refs.join(", ")}${modelo ? ` (modelo ${modelo})` : ""}\n`);

  const ids: string[] = [];
  let atualizadas = 0, criadas = 0, semEanNoPdv = 0;
  for (const p of produtos) {
    let lista;
    try {
      lista = await listarVariacoesProduto(p.redeId, idApiDoProduto(p.id));
    } catch (e: any) {
      console.log(`  ! ${p.referenciaFornecedor} (${p.id}): ${String(e.message).slice(0, 80)}`);
      continue;
    }
    const existentes = new Set(
      (await prisma.variacaoProduto.findMany({ where: { produtoId: p.id }, select: { id: true } })).map((v) => v.id)
    );
    const comEan = lista.filter((v) => (v.EAN ?? "").trim());
    semEanNoPdv += lista.length - comEan.length;
    console.log(`  ${p.referenciaFornecedor} | ${p.modeloNome} | ${p.nome} -> ${lista.length} variações, ${comEan.length} com EAN (${comEan.map((v) => String(v.EAN).trim()).join(", ") || "-"})`);
    if (!APLICAR) continue;
    for (const v of lista) {
      const data = { ean: (v.EAN ?? "").trim(), cor: v.Cor || null, tamanho: v.Tamanho || null };
      if (existentes.has(String(v.Id))) {
        await prisma.variacaoProduto.update({ where: { id: String(v.Id) }, data });
        atualizadas++;
      } else {
        await prisma.variacaoProduto.create({ data: { id: String(v.Id), produtoId: p.id, redeId: p.redeId, ...data } });
        criadas++;
      }
    }
    ids.push(p.id);
  }

  if (APLICAR && ids.length) {
    const n = await vincularCadastroDeProdutos(ids);
    console.log(`\nVariações atualizadas: ${atualizadas} | criadas: ${criadas} | sem EAN no PDV: ${semEanNoPdv}`);
    console.log(`Itens de nota que passaram a ter cadastro: ${n}`);
  } else if (!APLICAR) {
    console.log("\n[SIMULAÇÃO] Nada gravado. Rode com --apply para gravar.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
