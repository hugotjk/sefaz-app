/**
 * Recalcula modeloIdentificado / referenciaFornecedorIdentificada /
 * referenciaComRegraEspecifica / temCadastro dos NotaItem JÁ existentes de
 * APPROVE STREET WEAR COMERCIAL LTDA — depois da regra nova de Referência pros
 * códigos no formato REF-COR-TAM (ramo "Approve").
 *
 * `informacoesComplementares` é lido do XML da nota (Note.xmlCompleto),
 * memoizado por nota — a regra antiga do grupo R3 usa a cor das infos compl.
 *
 *   Dry-run (só conta):  npx tsx --env-file=.env scripts/recalcular-approve-street-wear.ts
 *   Aplicar:             npx tsx --env-file=.env scripts/recalcular-approve-street-wear.ts --apply
 */
import { prisma } from "../src/lib/db";
import {
  identificarModelo,
  identificarReferenciaFornecedor,
} from "../src/lib/identificar-produto";
import { avaliarCadastroItens } from "../src/lib/popular-nota-itens";
import { parseNFeXml } from "../src/lib/parse-nfe-xml";

const APLICAR = process.argv.includes("--apply");
const ALVO = "APPROVE STREET WEAR COMERCIAL LTDA";

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
    // Classifica QUAL caminho a nova lógica seguiu (só para o relatório).
    const g1 = it.codigoProduto.slice(0, 1).toUpperCase();
    const nHifens = (it.codigoProduto.match(/-/g) ?? []).length;
    let caminho: "ramo-J" | "regra-nova" | "fallback-antigo-cor" | "fallback-codigo-puro";
    if (g1 === "J") caminho = "ramo-J";
    else if (nHifens >= 2) caminho = "regra-nova";
    else if (ref.comRegraEspecifica) caminho = "fallback-antigo-cor";
    else caminho = "fallback-codigo-puro";
    return {
      it,
      emit,
      modelo,
      referencia: ref.valor,
      comRegra: ref.comRegraEspecifica,
      caminho,
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

  const porCaminho = new Map<string, number>();
  for (const r of recalc) porCaminho.set(r.caminho, (porCaminho.get(r.caminho) ?? 0) + 1);

  const mudaramRef = recalc.filter((r) => r.mudouRef);
  const temCadAntes = recalc.filter((r) => r.it.temCadastro).length;
  const temCadDepois = flags.filter(Boolean).length;

  console.log("Distribuição por caminho da regra:");
  for (const [k, v] of porCaminho) console.log(`  ${k.padEnd(22)} ${v}`);
  console.log(`\nReferência mudou em ${mudaramRef.length}/${recalc.length} itens.`);
  if (mudaramRef.length) {
    console.log("Amostra (código -> ref antiga => ref nova) [caminho]:");
    for (const r of mudaramRef.slice(0, 40)) {
      console.log(
        `  ${r.it.codigoProduto.padEnd(18)} ${String(
          r.it.referenciaFornecedorIdentificada ?? ""
        ).padEnd(16)} => ${String(r.referencia).padEnd(16)} [${r.caminho}]`
      );
    }
  }
  console.log(`\ntemCadastro: ${temCadAntes} -> ${temCadDepois} (de ${recalc.length})`);

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
