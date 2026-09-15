/**
 * Recalcula referenciaFornecedorIdentificada / referenciaComRegraEspecifica /
 * temCadastro dos NotaItem JÁ existentes da BETEL LTDA — depois de adicionar
 * o fallback de cor conhecida (nome->código) pra quando a descrição foge do
 * padrão "<código numérico>-<nome da cor>".
 *
 *   Dry-run (só conta):  npx tsx --env-file=.env scripts/recalcular-betel.ts
 *   Aplicar:             npx tsx --env-file=.env scripts/recalcular-betel.ts --apply
 */
import { prisma } from "../src/lib/db";
import {
  identificarModelo,
  identificarReferenciaFornecedor,
} from "../src/lib/identificar-produto";
import { avaliarCadastroItens } from "../src/lib/popular-nota-itens";
import { parseNFeXml } from "../src/lib/parse-nfe-xml";

const APLICAR = process.argv.includes("--apply");
const ALVO = "BETEL LTDA";

async function main() {
  const itens = await prisma.notaItem.findMany({
    where: { note: { emitenteNome: ALVO } },
    select: {
      id: true,
      noteId: true,
      codigoProduto: true,
      descricao: true,
      ean: true,
      modeloIdentificado: true,
      referenciaFornecedorIdentificada: true,
      referenciaComRegraEspecifica: true,
      temCadastro: true,
      note: { select: { emitenteNome: true, xmlCompleto: true } },
    },
  });
  console.log(`NotaItem de ${ALVO}: ${itens.length}\n`);

  const infCplPorNota = new Map<string, string>();
  const infCpl = (noteId: string, xml: string): string => {
    let v = infCplPorNota.get(noteId);
    if (v === undefined) {
      try {
        v = parseNFeXml(xml || "").informacoesComplementares || "";
      } catch {
        v = "";
      }
      infCplPorNota.set(noteId, v);
    }
    return v;
  };

  const recalc = itens.map((it) => {
    const emit = it.note.emitenteNome ?? "";
    const modelo = identificarModelo(emit, it.codigoProduto, it.descricao);
    const ref = identificarReferenciaFornecedor(
      emit,
      it.codigoProduto,
      it.descricao,
      infCpl(it.noteId, it.note.xmlCompleto)
    );
    return {
      it,
      emit,
      modelo,
      referencia: ref.valor,
      comRegra: ref.comRegraEspecifica,
      mudouRef: ref.valor !== (it.referenciaFornecedorIdentificada ?? ""),
    };
  });

  const flags = await avaliarCadastroItens(
    recalc.map((r) => ({
      ean: r.it.ean,
      referenciaFornecedor: r.referencia,
      modelo: r.modelo,
      emitente: r.emit,
    }))
  );

  const mudaramRef = recalc.filter((r) => r.mudouRef);
  const temCadAntes = recalc.filter((r) => r.it.temCadastro).length;
  const temCadDepois = flags.filter(Boolean).length;
  const viraramCadastro = recalc.filter((r, i) => !r.it.temCadastro && flags[i]);

  console.log(`Referência mudou em ${mudaramRef.length}/${recalc.length} itens.`);
  if (mudaramRef.length) {
    console.log("Amostra (código | ref antiga => ref nova):");
    const vistos = new Set<string>();
    for (const r of mudaramRef) {
      const chave = `${r.it.referenciaFornecedorIdentificada}=>${r.referencia}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      if (vistos.size > 40) break;
      console.log(
        `  ${r.it.codigoProduto.padEnd(10)} ${String(r.it.referenciaFornecedorIdentificada ?? "").padEnd(24)} => ${r.referencia}`
      );
    }
  }
  console.log(`\ntemCadastro: ${temCadAntes} -> ${temCadDepois} (de ${recalc.length})`);
  console.log(
    `Itens que ESTAVAM sem cadastro e PASSARAM a ter (via fallback de cor): ${viraramCadastro.length}`
  );
  if (viraramCadastro.length) {
    const vistos = new Set<string>();
    for (const r of viraramCadastro) {
      if (vistos.has(r.it.codigoProduto)) continue;
      vistos.add(r.it.codigoProduto);
      console.log(`  ${r.it.codigoProduto} | ${r.it.descricao} -> ${r.referencia}`);
    }
  }

  if (!APLICAR) {
    console.log("\n[DRY-RUN] Nada gravado. Rode com --apply para atualizar.");
    await prisma.$disconnect();
    return;
  }

  let n = 0;
  for (let i = 0; i < recalc.length; i += 200) {
    const chunk = recalc.slice(i, i + 200);
    await prisma.$transaction(
      chunk.map((r, j) =>
        prisma.notaItem.update({
          where: { id: r.it.id },
          data: {
            modeloIdentificado: r.modelo,
            referenciaFornecedorIdentificada: r.referencia,
            referenciaComRegraEspecifica: r.comRegra,
            temCadastro: flags[i + j],
          },
        })
      )
    );
    n += chunk.length;
  }
  console.log(`\n[APPLY] ${n} NotaItem atualizados.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
