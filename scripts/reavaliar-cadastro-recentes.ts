/**
 * Roda AGORA a reavaliação de cadastro para produtos alterados nos últimos N dias.
 * Uso: npx tsx --env-file=.env scripts\reavaliar-cadastro-recentes.ts [DIAS=7]
 */
import { reavaliarCadastroRecentes } from "../src/lib/reavaliar-cadastro-recentes";

async function main() {
  const dias = Number(process.argv[2] ?? 7);
  const n = await reavaliarCadastroRecentes(dias);
  console.log(`NotaItem que passaram a ter cadastro (produtos alterados nos últimos ${dias} dias): ${n}`);
}
main().then(() => process.exit(0));
