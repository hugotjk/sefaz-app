/**
 * Zera os DOCUMENTOS da tela de Documentações: apaga os arquivos guardados no Backblaze, a fila de
 * "não identificados" e os registros dos chips (tabela DocumentoLoja). NÃO mexe na LojaCadastro (que alimenta a busca de
 * notas do Qive) nem na LojaDocumentacao (lojas da tela, nova e separada). Irreversível depois do --apply.
 *
 *   Simulação (só conta, não apaga):  npx tsx --env-file=.env scripts/zerar-documentacoes.ts
 *   Apagar de verdade:                 npx tsx --env-file=.env scripts/zerar-documentacoes.ts --apply
 *   Opção: --incluir-orfaos  também apaga arquivos do bucket que não têm registro no banco
 *
 * Obs.: se o bucket guarda versões antigas, o Backblaze pode manter cópias ocultas até a regra de ciclo de vida limpá-las.
 */
import { prisma } from "../src/lib/db";
import { b2Delete, b2List } from "../src/lib/b2";

const APLICAR = process.argv.includes("--apply");
const ORFAOS = process.argv.includes("--incluir-orfaos");
const PREFIXO_FILA = "_nao-identificados/";

async function main() {
  const docs = await prisma.documentoLoja.findMany({ select: { id: true, driveItemId: true } });
  const chavesDocs = new Set(docs.map((d) => d.driveItemId).filter(Boolean) as string[]);
  const fila = (await b2List(PREFIXO_FILA)).filter((i) => i.key !== PREFIXO_FILA);
  const todos = await b2List("");
  const noBucket = new Set(todos.map((t) => t.key));
  const orfaos = todos.filter((t) => !chavesDocs.has(t.key) && !t.key.startsWith(PREFIXO_FILA));
  const faltandoNoBucket = [...chavesDocs].filter((k) => !noBucket.has(k)).length;
  const lojasQive = await prisma.lojaCadastro.count();
  const lojasDoc = await prisma.lojaDocumentacao.count();

  console.log(`${APLICAR ? "[APPLY]" : "[SIMULAÇÃO]"} Documentos zerados só da tela de Documentações.`);
  console.log(`  registros de documentos (chips): ${docs.length} (${chavesDocs.size} com arquivo; ${faltandoNoBucket} cujo arquivo já não está no bucket)`);
  console.log(`  fila de não identificados:       ${fila.length} arquivo(s)`);
  console.log(`  arquivos soltos no bucket (sem registro): ${orfaos.length}${ORFAOS ? " — serão apagados (--incluir-orfaos)" : " — NÃO serão apagados (use --incluir-orfaos)"}`);
  console.log(`  lojas do Qive (LojaCadastro, não mexo): ${lojasQive} | lojas da tela de Documentações (não mexo): ${lojasDoc}`);
  if (!APLICAR) {
    console.log("\nNada foi apagado. Para apagar de verdade, rode de novo com --apply.");
    await prisma.$disconnect();
    return;
  }

  let apagados = 0;
  let falhas = 0;
  const idsOk: string[] = [];
  for (const d of docs) {
    if (!d.driveItemId) {
      idsOk.push(d.id);
      continue;
    }
    try {
      await b2Delete(d.driveItemId);
      apagados++;
      idsOk.push(d.id);
    } catch (e: any) {
      falhas++;
      console.log(`  ! não consegui apagar ${d.driveItemId}: ${e?.message ?? e} (o registro foi mantido)`);
    }
  }
  for (const f of fila) {
    try { await b2Delete(f.key); apagados++; } catch (e: any) { falhas++; console.log(`  ! fila ${f.key}: ${e?.message ?? e}`); }
  }
  if (ORFAOS) {
    for (const o of orfaos) {
      try { await b2Delete(o.key); apagados++; } catch (e: any) { falhas++; console.log(`  ! solto ${o.key}: ${e?.message ?? e}`); }
    }
  }
  const r = await prisma.documentoLoja.deleteMany({ where: { id: { in: idsOk } } });
  console.log(`\nFim. Arquivos apagados: ${apagados} | registros apagados: ${r.count} | falhas: ${falhas}`);
  if (falhas) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
