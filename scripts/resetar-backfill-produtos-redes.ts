/**
 * Reseta o cursor de sincronização de PRODUTOS (SyncState "produtos:rede:{id}")
 * de redes específicas pra elas refazerem o BACKFILL completo por janelas de
 * data, em vez de ficarem só no modo incremental (que não recupera o que
 * ficou pra trás).
 *
 * Alvo padrão: rede 9 (FLUMINENSE) e rede 4 (ALMOXARIFADO).
 *
 * Reset = { lastSync: null, pagina: 1, janela: 0 } — mesmo formato que
 * `CursorProdutos` em src/inngest/functions.ts. Na próxima execução de
 * syncProdutos a rede recomeça da janela 0 (30 dias), página 1. Os produtos
 * já baixados NÃO se perdem (continuam no banco); o upsert só regrava.
 *
 *   Dry-run (só mostra o estado atual):
 *     npx tsx --env-file=.env scripts/resetar-backfill-produtos-redes.ts
 *   Aplicar de verdade:
 *     npx tsx --env-file=.env scripts/resetar-backfill-produtos-redes.ts --apply
 *   Outras redes:
 *     npx tsx --env-file=.env scripts/resetar-backfill-produtos-redes.ts --redes 9,4,7 --apply
 */
import { prisma } from "../src/lib/db";

const APLICAR = process.argv.includes("--apply");

const idxRedes = process.argv.indexOf("--redes");
const REDES_ALVO: number[] =
  idxRedes !== -1 && process.argv[idxRedes + 1]
    ? process.argv[idxRedes + 1]
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n))
    : [9, 4];

const RESET_VALOR = { lastSync: null as string | null, pagina: 1, janela: 0 };

async function main() {
  console.log(`Redes alvo: ${REDES_ALVO.join(", ")}\n`);

  for (const redeId of REDES_ALVO) {
    const chave = `produtos:rede:${redeId}`;
    const [row, rede] = await Promise.all([
      prisma.syncState.findUnique({ where: { chave } }),
      prisma.redeSync.findUnique({ where: { id: redeId } }),
    ]);

    const nome = rede?.nome ?? "(nome não sincronizado)";
    const atual = row ? row.valor : "(sem SyncState — ainda nunca sincronizou)";
    console.log(`  rede ${redeId} — ${nome}`);
    console.log(`    antes:  ${atual}`);
    console.log(`    depois: ${JSON.stringify(RESET_VALOR)}`);

    if (APLICAR) {
      await prisma.syncState.upsert({
        where: { chave },
        create: { chave, valor: JSON.stringify(RESET_VALOR) },
        update: { valor: JSON.stringify(RESET_VALOR) },
      });
      console.log(`    -> [APPLY] gravado.`);
    }
    console.log();
  }

  if (!APLICAR) {
    console.log("[DRY-RUN] Nada foi alterado. Rode com --apply pra gravar.");
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
