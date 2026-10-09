/**
 * Roda AGORA a reavaliação de cadastro para produtos alterados nos últimos N dias.
 * Uso: npx tsx --env-file=.env scripts\reavaliar-cadastro-recentes.ts [DIAS=7]
 */
import { reavaliarCadastroRecentes } from "../src/lib/reavaliar-cadastro-recentes";

async function main() {
  const dias = Number(process.argv[2] ?? 7);
  console.log(`Reavaliando produtos alterados nos últimos ${dias} dias...`);
  const t0 = Date.now();
  const n = await reavaliarCadastroRecentes(dias);
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(`NotaItem que passaram a ter cadastro (produtos alterados nos últimos ${dias} dias): ${n}`);
}
main().then(() => process.exit(0));
