/**
 * Recalcula `temCadastro` de TODOS os NotaItem existentes com a lógica atual de
 * `avaliarCadastroItens` (EAN ou referência+modelo contra o catálogo, SEM
 * checagem de preço). Usado depois de mudar a regra de "tem cadastro" — é uma
 * mudança geral, afeta todos os fornecedores, não só os alvos de antes.
 *
 * Reaproveita `modeloIdentificado` / `referenciaFornecedorIdentificada` / `ean`
 * já gravados no NotaItem (não reprocessa as regras de identificação nem lê XML).
 *
 *   Dry-run (só conta):  npx tsx --env-file=.env scripts/recalcular-tem-cadastro.ts
 *   Aplicar:             npx tsx --env-file=.env scripts/recalcular-tem-cadastro.ts --apply
 */
import { prisma } from "../src/lib/db";
import { avaliarCadastroItens } from "../src/lib/popular-nota-itens";

const APLICAR = process.argv.includes("--apply");
const LOTE = 1000;

async function main() {
  const itens = await prisma.notaItem.findMany({
    select: {
      id: true,
      ean: true,
      modeloIdentificado: true,
      referenciaFornecedorIdentificada: true,
      temCadastro: true,
      note: { select: { emitenteNome: true } },
    },
    orderBy: { id: "asc" },
  });
  console.log(`NotaItem no banco: ${itens.length}`);

  const antesTrue = itens.filter((i) => i.temCadastro).length;
  const antesFalse = itens.length - antesTrue;
  console.log(`ANTES  -> temCadastro=true: ${antesTrue} | temCadastro=false (sem cadastro): ${antesFalse}`);

  const novos: boolean[] = new Array(itens.length);
  for (let i = 0; i < itens.length; i += LOTE) {
    const chunk = itens.slice(i, i + LOTE);
    const flags = await avaliarCadastroItens(
      chunk.map((it) => ({
        ean: it.ean,
        referenciaFornecedor: it.referenciaFornecedorIdentificada,
        modelo: it.modeloIdentificado,
        emitente: it.note.emitenteNome,
      }))
    );
    flags.forEach((f, j) => (novos[i + j] = f));
    process.stdout.write(`\r  avaliados ${Math.min(i + LOTE, itens.length)}/${itens.length}`);
  }
  process.stdout.write("\n");

  const depoisTrue = novos.filter(Boolean).length;
  const depoisFalse = itens.length - depoisTrue;
  const virouTrue = itens.filter((it, k) => !it.temCadastro && novos[k]).length;
  const virouFalse = itens.filter((it, k) => it.temCadastro && !novos[k]).length;

  console.log(`DEPOIS -> temCadastro=true: ${depoisTrue} | temCadastro=false (sem cadastro): ${depoisFalse}`);
  console.log(`Mudanças: ${virouTrue} viraram true (false->true) | ${virouFalse} viraram false (true->false)`);
  console.log(
    `"Sem cadastro": ${antesFalse} -> ${depoisFalse}  (${depoisFalse - antesFalse >= 0 ? "+" : ""}${
      depoisFalse - antesFalse
    })`
  );

  if (!APLICAR) {
    console.log("\n[DRY-RUN] Nada gravado. Rode com --apply para atualizar.");
    await prisma.$disconnect();
    return;
  }

  const viraramTrueIds = itens.filter((it, k) => !it.temCadastro && novos[k]).map((it) => it.id);
  const viraramFalseIds = itens.filter((it, k) => it.temCadastro && !novos[k]).map((it) => it.id);

  const aplicarLote = async (ids: string[], valor: boolean) => {
    let n = 0;
    for (let i = 0; i < ids.length; i += 2000) {
      const chunk = ids.slice(i, i + 2000);
      await prisma.notaItem.updateMany({
        where: { id: { in: chunk } },
        data: { temCadastro: valor },
      });
      n += chunk.length;
      process.stdout.write(`\r  temCadastro=${valor}: ${n}/${ids.length}`);
    }
    if (ids.length) process.stdout.write("\n");
  };

  await aplicarLote(viraramTrueIds, true);
  await aplicarLote(viraramFalseIds, false);
  console.log(`[APPLY] ${viraramTrueIds.length + viraramFalseIds.length} NotaItem atualizados.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
