/**
 * Recalcula modeloIdentificado / referenciaFornecedorIdentificada /
 * referenciaComRegraEspecifica / temCadastro dos NotaItem JÁ existentes de
 * 3 grupos, depois da correção que passou a usar infAdProd (info DO ITEM)
 * em vez de informacoesComplementares (info da NOTA) pra extrair cor:
 *
 *   - MCD/Lost:      OUTSIDE CO LTDA, CORE BRANDS MODA LTDA
 *   - Fuel:          DMF DISTRIBUIDORA LTDA
 *   - Approve/R3:    APPROVE STREET WEAR COMERCIAL LTDA, R3 TECIDOS E
 *                     CONFECCOES LTDA, JUST BRANDS COMERCIAL E SERVICOS LTDA,
 *                     PROPARRA - CONFECCAO E COMERCIO DE ARTIGOS DO VESTUARIO
 *                     LTDA, SF7 COMERCIAL E SERVICOS LTDA, L6 COMERCIAL DO
 *                     VESTUARIO LTDA
 *
 * Usa o infAdProd já gravado no NotaItem (rode scripts/backfill-inf-ad-prod.ts
 * antes) -- não precisa reler XML pra isso. informacoesComplementares (nota
 * inteira) ainda é lido do XML, igual aos outros scripts de recálculo.
 *
 *   Dry-run (só conta):  npx tsx --env-file=.env scripts/recalcular-mcd-fuel-approve.ts
 *   Aplicar:             npx tsx --env-file=.env scripts/recalcular-mcd-fuel-approve.ts --apply
 */
import { prisma } from "../src/lib/db";
import {
  identificarModelo,
  identificarReferenciaFornecedor,
} from "../src/lib/identificar-produto";
import { avaliarCadastroItens } from "../src/lib/popular-nota-itens";
import { parseNFeXml } from "../src/lib/parse-nfe-xml";

const APLICAR = process.argv.includes("--apply");

const GRUPOS: Record<string, string[]> = {
  "MCD/Lost (OUTSIDE CO / CORE BRANDS)": ["OUTSIDE CO LTDA", "CORE BRANDS MODA LTDA"],
  "Fuel (DMF DISTRIBUIDORA LTDA)": ["DMF DISTRIBUIDORA LTDA"],
  "Approve/R3": [
    "APPROVE STREET WEAR COMERCIAL LTDA",
    "R3 TECIDOS E CONFECCOES LTDA",
    "JUST BRANDS COMERCIAL E SERVICOS LTDA",
    "PROPARRA - CONFECCAO E COMERCIO DE ARTIGOS DO VESTUARIO LTDA",
    "SF7 COMERCIAL E SERVICOS LTDA",
    "L6 COMERCIAL DO VESTUARIO LTDA",
  ],
};

const TODOS_EMITENTES = Object.values(GRUPOS).flat();

async function main() {
  const itens = await prisma.notaItem.findMany({
    where: { note: { emitenteNome: { in: TODOS_EMITENTES } } },
    select: {
      id: true,
      noteId: true,
      codigoProduto: true,
      descricao: true,
      ean: true,
      infAdProd: true,
      modeloIdentificado: true,
      referenciaFornecedorIdentificada: true,
      referenciaComRegraEspecifica: true,
      temCadastro: true,
      note: { select: { emitenteNome: true, xmlCompleto: true } },
    },
  });
  console.log(`NotaItem nos 3 grupos: ${itens.length}\n`);

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
      infCpl(it.noteId, it.note.xmlCompleto),
      it.infAdProd ?? ""
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

  console.log("===== RESULTADO POR GRUPO =====");
  for (const [nomeGrupo, emitentes] of Object.entries(GRUPOS)) {
    const idxs = recalc
      .map((r, i) => i)
      .filter((i) => emitentes.some((e) => e.toLowerCase() === recalc[i].emit.toLowerCase()));
    const alvo = idxs.map((i) => recalc[i]);
    const mudouRef = idxs.filter((i) => recalc[i].mudouRef);
    const tcAntes = alvo.filter((r) => r.it.temCadastro).length;
    const tcDepois = idxs.filter((i) => flags[i]).length;
    const ganhou = idxs.filter((i) => !recalc[i].it.temCadastro && flags[i]);
    const perdeu = idxs.filter((i) => recalc[i].it.temCadastro && !flags[i]);

    console.log(`\n--- ${nomeGrupo} ---`);
    console.log(`itens=${alvo.length} | referência mudou em ${mudouRef.length}`);
    console.log(`temCadastro: ${tcAntes} -> ${tcDepois}  (ganhou ${ganhou.length}, perdeu ${perdeu.length})`);
    const vistos = new Set<string>();
    console.log("Amostra (código | ref antiga => ref nova):");
    for (const i of mudouRef) {
      const r = recalc[i];
      const chave = `${r.it.referenciaFornecedorIdentificada}=>${r.referencia}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      if (vistos.size > 25) break;
      console.log(
        `  ${r.it.codigoProduto.padEnd(14)} ${String(r.it.referenciaFornecedorIdentificada ?? "").padEnd(20)} => ${r.referencia}`
      );
    }
    if (perdeu.length) {
      console.log(`⚠ itens que PERDERAM cadastro (${perdeu.length}), amostra:`);
      for (const i of perdeu.slice(0, 10)) {
        const r = recalc[i];
        console.log(`  ${r.it.codigoProduto} | ${r.it.descricao} | ${r.it.referenciaFornecedorIdentificada} => ${r.referencia}`);
      }
    }
  }

  const totalMudouRef = recalc.filter((r) => r.mudouRef).length;
  const tcAntesGeral = recalc.filter((r) => r.it.temCadastro).length;
  const tcDepoisGeral = flags.filter(Boolean).length;
  console.log(`\n===== GERAL =====`);
  console.log(`referência mudou em ${totalMudouRef}/${recalc.length}`);
  console.log(`temCadastro: ${tcAntesGeral} -> ${tcDepoisGeral} (de ${recalc.length})`);

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
