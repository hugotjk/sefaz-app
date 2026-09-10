/**
 * Recálculo GERAL de identificação: recomputa modeloIdentificado /
 * referenciaFornecedorIdentificada / referenciaComRegraEspecifica / temCadastro
 * de TODOS os NotaItem existentes com as regras atuais de identificar-produto.ts.
 *
 * Usado quando entra uma mudança de regra que afeta muitos fornecedores de uma
 * vez (ex.: normalização Title Case do nome do Modelo, novas regras de
 * Referência para Cebola/Coimbra/Surf Co).
 *
 * `informacoesComplementares` é lido do XML da nota (Note.xmlCompleto),
 * memoizado por nota — reproduz exatamente o que o popularNotaItens faria.
 *
 *   Dry-run (só relatório):  npx tsx --env-file=.env scripts/recalcular-identificacao-geral.ts
 *   Aplicar:                 npx tsx --env-file=.env scripts/recalcular-identificacao-geral.ts --apply
 */
import { prisma } from "../src/lib/db";
import {
  identificarModelo,
  identificarReferenciaFornecedor,
} from "../src/lib/identificar-produto";
import { avaliarCadastroItens } from "../src/lib/popular-nota-itens";
import { parseNFeXml } from "../src/lib/parse-nfe-xml";

const APLICAR = process.argv.includes("--apply");
const LOTE_AVALIAR = 1000;

function j(o: unknown) {
  return JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
}

async function main() {
  const itens = await prisma.notaItem.findMany({
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
      note: { select: { emitenteNome: true } },
    },
    orderBy: { id: "asc" },
  });
  console.log(`NotaItem no banco: ${itens.length}`);

  // infocompl por nota — lê o XML nota a nota (evita um único findMany gigante
  // que estoura o driver do Prisma se algum xmlCompleto tiver byte inválido).
  const noteIds = [...new Set(itens.map((i) => i.noteId))];
  const infCplPorNota = new Map<string, string>();
  let xmlFalhou = 0;
  for (let i = 0; i < noteIds.length; i += 50) {
    const lote = noteIds.slice(i, i + 50);
    await Promise.all(
      lote.map(async (id) => {
        let xml = "";
        try {
          const n = await prisma.note.findUnique({
            where: { id },
            select: { xmlCompleto: true },
          });
          xml = n?.xmlCompleto ?? "";
        } catch {
          xmlFalhou++;
        }
        let inf = "";
        try {
          inf = parseNFeXml(xml || "").informacoesComplementares || "";
        } catch {
          inf = "";
        }
        infCplPorNota.set(id, inf);
      })
    );
    process.stdout.write(`\r  XML lido de ${Math.min(i + 50, noteIds.length)}/${noteIds.length} notas`);
  }
  process.stdout.write("\n");
  if (xmlFalhou) console.log(`  (${xmlFalhou} notas com XML ilegível -> infocompl vazio)`);

  const recalc = itens.map((it) => {
    const emit = it.note.emitenteNome ?? "";
    const modelo = identificarModelo(emit, it.codigoProduto, it.descricao);
    const ref = identificarReferenciaFornecedor(
      emit,
      it.codigoProduto,
      it.descricao,
      infCplPorNota.get(it.noteId) ?? ""
    );
    return {
      it,
      emit,
      modelo,
      referencia: ref.valor,
      comRegra: ref.comRegraEspecifica,
    };
  });

  // temCadastro novo (em lotes)
  const flags: boolean[] = new Array(recalc.length);
  for (let i = 0; i < recalc.length; i += LOTE_AVALIAR) {
    const chunk = recalc.slice(i, i + LOTE_AVALIAR);
    const f = await avaliarCadastroItens(
      chunk.map((r) => ({
        ean: r.it.ean,
        referenciaFornecedor: r.referencia,
        modelo: r.modelo,
        emitente: r.emit,
      }))
    );
    f.forEach((x, k) => (flags[i + k] = x));
    process.stdout.write(`\r  avaliados ${Math.min(i + LOTE_AVALIAR, recalc.length)}/${recalc.length}`);
  }
  process.stdout.write("\n");

  // ---------- Relatório ----------
  const modeloMudou = recalc.filter((r, k) => (r.modelo ?? "") !== (r.it.modeloIdentificado ?? ""));
  const refMudou = recalc.filter(
    (r, k) => r.referencia !== (r.it.referenciaFornecedorIdentificada ?? "")
  );
  const tcAntes = recalc.filter((r) => r.it.temCadastro).length;
  const tcDepois = flags.filter(Boolean).length;
  const tcGanho = recalc.filter((r, k) => !r.it.temCadastro && flags[k]).length;
  const tcPerda = recalc.filter((r, k) => r.it.temCadastro && !flags[k]).length;

  const modelosAntes = new Set(recalc.map((r) => r.it.modeloIdentificado ?? "∅"));
  const modelosDepois = new Set(recalc.map((r) => r.modelo ?? "∅"));

  console.log("\n===== ITEM 1 — normalização Title Case do Modelo =====");
  console.log(`modeloIdentificado mudou em ${modeloMudou.length}/${recalc.length} itens`);
  console.log(
    `Modelos distintos: ${modelosAntes.size} -> ${modelosDepois.size} (colapsaram ${
      modelosAntes.size - modelosDepois.size
    })`
  );
  // pares antigo->novo que colapsaram (grafias diferentes viram o mesmo)
  const paresColapso = new Map<string, Set<string>>();
  for (const r of recalc) {
    const novo = r.modelo ?? "∅";
    const velho = r.it.modeloIdentificado ?? "∅";
    if (novo !== velho) {
      if (!paresColapso.has(novo)) paresColapso.set(novo, new Set());
      paresColapso.get(novo)!.add(velho);
    }
  }
  console.log("Exemplos de grafias que passaram a colapsar (novo <= {antigos}):");
  for (const [novo, antigos] of [...paresColapso.entries()].slice(0, 25)) {
    console.log(`  ${novo}  <=  ${[...antigos].join(" | ")}`);
  }

  const porEmitRef = (nomes: string[]) => {
    const alvo = recalc.filter((r) => nomes.some((n) => n.toLowerCase() === r.emit.toLowerCase()));
    const mud = alvo.filter(
      (r) => r.referencia !== (r.it.referenciaFornecedorIdentificada ?? "")
    );
    const tcA = alvo.filter((r) => r.it.temCadastro).length;
    const tcD = alvo.filter((r) => flags[recalc.indexOf(r)]).length;
    return { total: alvo.length, mudou: mud.length, tcAntes: tcA, tcDepois: tcD, amostra: mud.slice(0, 8) };
  };

  console.log("\n===== ITEM 2 — Cebola (Ferrari): referência sem zeros à esquerda =====");
  for (const nome of [
    "D L FERRARI PRODUTOS LICENCIADOS LTDA",
    "V F FERRARI PRODUTOS LICENCIADOS LTDA",
    "VF FERRARI PRODUTOS LICENCIADOS",
  ]) {
    const s = porEmitRef([nome]);
    console.log(`  ${nome}`);
    console.log(
      `    itens=${s.total} | ref mudou=${s.mudou} | temCadastro ${s.tcAntes} -> ${s.tcDepois}`
    );
    for (const r of s.amostra)
      console.log(
        `      ${r.it.codigoProduto}  ${r.it.referenciaFornecedorIdentificada} => ${r.referencia}`
      );
  }

  console.log("\n===== ITEM 3 — Coimbra: 5 primeiros do código =====");
  {
    const s = porEmitRef(["COIMBRA SP INDUSTRIA E COMERCIO LTDA"]);
    console.log(
      `  itens=${s.total} | ref mudou=${s.mudou} | temCadastro ${s.tcAntes} -> ${s.tcDepois}`
    );
    for (const r of s.amostra)
      console.log(
        `    ${r.it.codigoProduto}  ${r.it.referenciaFornecedorIdentificada} => ${r.referencia}`
      );
  }

  console.log("\n===== ITEM 5 — Surf Co (ramo HY/HL/VL/02) =====");
  {
    const s = porEmitRef(["SURF CO LTDA"]);
    console.log(
      `  itens=${s.total} | ref mudou=${s.mudou} | temCadastro ${s.tcAntes} -> ${s.tcDepois}`
    );
    for (const r of s.amostra)
      console.log(
        `    ${r.it.codigoProduto}  ${r.it.referenciaFornecedorIdentificada} => ${r.referencia}`
      );
  }

  console.log("\n===== GERAL =====");
  console.log(`referência mudou em ${refMudou.length}/${recalc.length} itens`);
  console.log(
    `temCadastro: ${tcAntes} -> ${tcDepois}  (ganho ${tcGanho}, perda ${tcPerda})`
  );

  if (!APLICAR) {
    console.log("\n[DRY-RUN] Nada gravado. Rode com --apply para atualizar.");
    await prisma.$disconnect();
    return;
  }

  // ---------- Aplicar: agrupa por tupla de destino e usa updateMany ----------
  const grupos = new Map<string, { data: any; ids: string[] }>();
  recalc.forEach((r, k) => {
    const novo = {
      modeloIdentificado: r.modelo,
      referenciaFornecedorIdentificada: r.referencia,
      referenciaComRegraEspecifica: r.comRegra,
      temCadastro: flags[k],
    };
    const mudou =
      (novo.modeloIdentificado ?? "") !== (r.it.modeloIdentificado ?? "") ||
      novo.referenciaFornecedorIdentificada !== (r.it.referenciaFornecedorIdentificada ?? "") ||
      novo.referenciaComRegraEspecifica !== r.it.referenciaComRegraEspecifica ||
      novo.temCadastro !== r.it.temCadastro;
    if (!mudou) return;
    const chave = j(novo);
    if (!grupos.has(chave)) grupos.set(chave, { data: novo, ids: [] });
    grupos.get(chave)!.ids.push(r.it.id);
  });

  const totalMudar = [...grupos.values()].reduce((a, g) => a + g.ids.length, 0);
  console.log(`\n[APPLY] ${totalMudar} itens a atualizar em ${grupos.size} grupos de destino`);
  let n = 0;
  for (const g of grupos.values()) {
    for (let i = 0; i < g.ids.length; i += 5000) {
      const chunk = g.ids.slice(i, i + 5000);
      await prisma.notaItem.updateMany({ where: { id: { in: chunk } }, data: g.data });
      n += chunk.length;
      process.stdout.write(`\r  gravados ${n}/${totalMudar}`);
    }
  }
  process.stdout.write("\n");
  console.log(`[APPLY] concluído: ${n} NotaItem atualizados.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
