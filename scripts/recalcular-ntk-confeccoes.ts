/**
 * Recalcula modeloIdentificado / referenciaFornecedorIdentificada /
 * referenciaComRegraEspecifica / temCadastro dos NotaItem JÁ existentes de
 * NTK CONFECCOES LTDA — depois de adicionar o ramo "MT" -> "Mitchell & Ness"
 * (itens que caíam no fallback "Starter Fla" por engano).
 *
 * `informacoesComplementares` é lido do XML da nota (Note.xmlCompleto),
 * memoizado por nota, igual aos outros scripts de recálculo pontual.
 *
 *   Dry-run (só conta):  npx tsx --env-file=.env scripts/recalcular-ntk-confeccoes.ts
 *   Aplicar:             npx tsx --env-file=.env scripts/recalcular-ntk-confeccoes.ts --apply
 */
import { prisma } from "../src/lib/db";
import {
  identificarModelo,
  identificarReferenciaFornecedor,
} from "../src/lib/identificar-produto";
import { avaliarCadastroItens } from "../src/lib/popular-nota-itens";
import { parseNFeXml } from "../src/lib/parse-nfe-xml";

const APLICAR = process.argv.includes("--apply");
const ALVO = "NTK CONFECCOES LTDA";

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
      mudouModelo: (modelo ?? "") !== (it.modeloIdentificado ?? ""),
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

  const mudaramModelo = recalc.filter((r) => r.mudouModelo);
  const temCadAntes = recalc.filter((r) => r.it.temCadastro).length;
  const temCadDepois = flags.filter(Boolean).length;

  console.log(`Modelo mudou em ${mudaramModelo.length}/${recalc.length} itens.`);
  if (mudaramModelo.length) {
    console.log("Amostra (código | descrição -> modelo antigo => modelo novo):");
    for (const r of mudaramModelo.slice(0, 40)) {
      console.log(
        `  ${r.it.codigoProduto.padEnd(18)} ${r.it.descricao.slice(0, 30).padEnd(32)} ${String(
          r.it.modeloIdentificado ?? ""
        ).padEnd(14)} => ${String(r.modelo)}`
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
