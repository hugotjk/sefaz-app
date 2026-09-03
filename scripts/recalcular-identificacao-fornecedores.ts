/**
 * Recalcula modeloIdentificado / referenciaFornecedorIdentificada /
 * referenciaComRegraEspecifica (e depois temCadastro) dos NotaItem JÁ
 * existentes de um conjunto de fornecedores — usado quando uma regra de
 * identificação nova/corrigida entra e os itens antigos precisam ser
 * reprocessados (eles foram calculados antes da regra existir).
 *
 * Escopo: só os emitentes da lista ALVOS abaixo. As regras desses fornecedores
 * (Thug Nine/Dubs/Brotherhood, PCF, VF Ferrari) NÃO usam
 * `informacoesComplementares`, então recomputamos com infCpl = "" sem risco.
 *
 *   Dry-run (só conta):  npx tsx --env-file=.env scripts/recalcular-identificacao-fornecedores.ts
 *   Aplicar:             npx tsx --env-file=.env scripts/recalcular-identificacao-fornecedores.ts --apply
 */
import { prisma } from "../src/lib/db";
import {
  identificarModelo,
  identificarReferenciaFornecedor,
  EMPRESAS_THUG_DUBS,
} from "../src/lib/identificar-produto";
import { avaliarCadastroItens } from "../src/lib/popular-nota-itens";

const APLICAR = process.argv.includes("--apply");

const ALVOS = [
  ...EMPRESAS_THUG_DUBS,
  "PCF IMPORTACAO EXPORTACAO E COMERCIO LTD",
  "VF FERRARI PRODUTOS LICENCIADOS",
];

async function main() {
  const itens = await prisma.notaItem.findMany({
    where: { note: { emitenteNome: { in: ALVOS } } },
    select: {
      id: true,
      codigoProduto: true,
      descricao: true,
      ean: true,
      modeloIdentificado: true,
      referenciaFornecedorIdentificada: true,
      referenciaComRegraEspecifica: true,
      temCadastro: true,
      note: { select: { emitenteNome: true } },
    },
  });
  console.log(`NotaItem dos fornecedores alvo: ${itens.length}\n`);

  const recalc = itens.map((it) => {
    const emit = it.note.emitenteNome ?? "";
    const modelo = identificarModelo(emit, it.codigoProduto, it.descricao);
    const ref = identificarReferenciaFornecedor(emit, it.codigoProduto, it.descricao, "");
    return {
      it,
      emit,
      modelo,
      referencia: ref.valor,
      comRegra: ref.comRegraEspecifica,
    };
  });

  // temCadastro com a lógica nova (EAN / ref+modelo + preço, com exceção de prefixo)
  const flags = await avaliarCadastroItens(
    recalc.map((r) => ({
      ean: r.it.ean,
      referenciaFornecedor: r.referencia,
      modelo: r.modelo,
      emitente: r.emit,
    }))
  );

  // ---- Relatório por emitente ----
  const porEmit = new Map<
    string,
    { total: number; comModelo: number; comRegra: number; temCadastro: number; modeloNull: number }
  >();
  recalc.forEach((r, i) => {
    const k = r.emit || "(sem emitente)";
    const g = porEmit.get(k) ?? { total: 0, comModelo: 0, comRegra: 0, temCadastro: 0, modeloNull: 0 };
    g.total++;
    if (r.modelo != null) g.comModelo++;
    else g.modeloNull++;
    if (r.comRegra) g.comRegra++;
    if (flags[i]) g.temCadastro++;
    porEmit.set(k, g);
  });

  console.log("emitente".padEnd(42), "| itens | c/modelo | modelo=null | c/regra | temCadastro");
  for (const [k, g] of [...porEmit.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      k.slice(0, 42).padEnd(42),
      "|",
      String(g.total).padStart(5),
      "|",
      String(g.comModelo).padStart(8),
      "|",
      String(g.modeloNull).padStart(11),
      "|",
      String(g.comRegra).padStart(7),
      "|",
      String(g.temCadastro).padStart(11)
    );
  }

  // amostra dos que ficaram modelo=null (4º dígito fora de 1/2/8/9)
  const nulls = recalc.filter((r) => r.modelo == null);
  if (nulls.length) {
    console.log(`\n${nulls.length} itens com modelo=null. Amostra de códigos (8 primeiros dígitos):`);
    console.log(
      [...new Set(nulls.map((r) => r.it.codigoProduto.slice(0, 8)))].slice(0, 20).join("  ")
    );
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
