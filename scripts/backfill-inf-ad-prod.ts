/**
 * Backfill do campo novo NotaItem.infAdProd (det/infAdProd -- info adicional
 * DO ITEM, diferente de informacoesComplementares que é da nota inteira).
 *
 * Relê o xmlCompleto já salvo de cada Note (sem buscar de novo na
 * SEFAZ/Qive) e repopula infAdProd em todos os NotaItem existentes,
 * casando pela ORDEM dos itens (mesma ordem em que popularNotaItens criou
 * as linhas a partir do mesmo parseNFeXml) com um fallback por
 * codigoProduto quando a contagem não bate (nota reprocessada depois de
 * salva, item duplicado, etc.).
 *
 *   Dry-run (só conta):  npx tsx --env-file=.env scripts/backfill-inf-ad-prod.ts
 *   Aplicar:             npx tsx --env-file=.env scripts/backfill-inf-ad-prod.ts --apply
 */
import { prisma } from "../src/lib/db";
import { parseNFeXml } from "../src/lib/parse-nfe-xml";

const APLICAR = process.argv.includes("--apply");
const LOTE_NOTAS = 200;
const LOTE_GRAVAR = 2000;

async function main() {
  const noteIds = (await prisma.note.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map(
    (n) => n.id
  );
  console.log(`Notes no banco: ${noteIds.length}`);

  let notasProcessadas = 0;
  let notasComXmlInvalido = 0;
  let notasComContagemDivergente = 0;
  let itensComInfAdProd = 0;
  let itensSemMatch = 0;
  const pendentes: { id: string; infAdProd: string }[] = [];
  let totalGravado = 0;

  const gravarPendentes = async (forcar = false) => {
    if (!APLICAR) {
      pendentes.length = 0;
      return;
    }
    while (pendentes.length >= LOTE_GRAVAR || (forcar && pendentes.length > 0)) {
      const chunk = pendentes.splice(0, LOTE_GRAVAR);
      const values = chunk
        .map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`)
        .join(",");
      const params = chunk.flatMap((c) => [c.id, c.infAdProd]);
      await prisma.$executeRawUnsafe(
        `UPDATE "NotaItem" AS t SET "infAdProd" = v.val
         FROM (VALUES ${values}) AS v(id, val)
         WHERE t.id = v.id`,
        ...params
      );
      totalGravado += chunk.length;
    }
  };

  for (let i = 0; i < noteIds.length; i += LOTE_NOTAS) {
    const lote = noteIds.slice(i, i + LOTE_NOTAS);
    const notas = await prisma.note.findMany({
      where: { id: { in: lote } },
      select: { id: true, xmlCompleto: true },
    });
    const itensPorNota = await prisma.notaItem.findMany({
      where: { noteId: { in: lote } },
      select: { id: true, noteId: true, codigoProduto: true },
      orderBy: { id: "asc" },
    });
    const itensAgrupados = new Map<string, typeof itensPorNota>();
    for (const it of itensPorNota) {
      if (!itensAgrupados.has(it.noteId)) itensAgrupados.set(it.noteId, []);
      itensAgrupados.get(it.noteId)!.push(it);
    }

    for (const nota of notas) {
      notasProcessadas++;
      let parsedItens;
      try {
        parsedItens = parseNFeXml(nota.xmlCompleto || "").itens;
      } catch {
        notasComXmlInvalido++;
        continue;
      }
      const dbItens = itensAgrupados.get(nota.id) ?? [];
      if (dbItens.length === 0) continue;

      if (dbItens.length === parsedItens.length) {
        // Caminho feliz: mesma contagem, casa por posição (mesma ordem que
        // popularNotaItens usou pra criar as linhas a partir do mesmo parse).
        for (let k = 0; k < dbItens.length; k++) {
          const v = parsedItens[k].infAdProd || "";
          if (v) itensComInfAdProd++;
          pendentes.push({ id: dbItens[k].id, infAdProd: v });
        }
      } else {
        // Contagem divergente: casa por codigoProduto (1ª ocorrência não usada
        // ainda), best-effort.
        notasComContagemDivergente++;
        const fila = new Map<string, string[]>();
        for (const pi of parsedItens) {
          if (!fila.has(pi.codigo)) fila.set(pi.codigo, []);
          fila.get(pi.codigo)!.push(pi.infAdProd || "");
        }
        for (const dbIt of dbItens) {
          const q = fila.get(dbIt.codigoProduto);
          const v = q && q.length ? q.shift()! : "";
          if (!v) itensSemMatch++;
          else itensComInfAdProd++;
          pendentes.push({ id: dbIt.id, infAdProd: v });
        }
      }
      await gravarPendentes();
    }
    process.stdout.write(
      `\r  notas processadas: ${notasProcessadas}/${noteIds.length} | gravados: ${totalGravado}`
    );
  }
  await gravarPendentes(true);
  process.stdout.write("\n");

  console.log(`\nNotas processadas: ${notasProcessadas}`);
  console.log(`Notas com XML ilegível (puladas): ${notasComXmlInvalido}`);
  console.log(`Notas com contagem de itens divergente (fallback por código): ${notasComContagemDivergente}`);
  console.log(`Itens com infAdProd não-vazio: ${itensComInfAdProd}`);
  console.log(`Itens sem match no fallback por código: ${itensSemMatch}`);

  if (!APLICAR) {
    console.log("\n[DRY-RUN] Nada gravado. Rode com --apply para atualizar.");
  } else {
    console.log(`\n[APPLY] ${totalGravado} NotaItem atualizados com infAdProd.`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
