/**
 * SOMENTE LEITURA: procura fornecedores em que a regra de identificação pode estar "aplicada, mas errada"
 * (não aparecem em "sem regra", porém muitos itens ficam sem cadastro) e nomes de emitente escritos de
 * mais de um jeito (maiúsculas/espaços), que o recálculo por nome exato poderia pular.
 *   npx tsx --env-file=.env scripts/diag-regras-suspeitas.ts
 */
import { PrismaClient } from "@prisma/client";
import { EMPRESAS_BANIDAS } from "../src/lib/identificar-produto";
const prisma = new PrismaClient();

async function main() {
  const banidos = new Set(EMPRESAS_BANIDAS);
  const rows = await prisma.$queryRaw<{ emitente: string; total: number; sem: number; semComRegra: number; semModelo: number }[]>`
    SELECT COALESCE(n."emitenteNome", '(sem emitente)') AS emitente,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE i."temCadastro" = false)::int AS sem,
           COUNT(*) FILTER (WHERE i."temCadastro" = false AND i."referenciaComRegraEspecifica" = true
                            AND COALESCE(i."modeloIdentificado", '') <> '')::int AS "semComRegra",
           COUNT(*) FILTER (WHERE COALESCE(i."modeloIdentificado", '') = '')::int AS "semModelo"
    FROM "NotaItem" i JOIN "Note" n ON n.id = i."noteId"
    GROUP BY 1`;

  console.log("== A) Itens SEM cadastro mesmo com regra de modelo E de referência aplicada (suspeitos) ==");
  console.log("(fornecedor | itens | sem cadastro | sem cadastro c/ regra | % sem cadastro)");
  const sus = rows
    .filter((r) => !banidos.has(r.emitente) && r.semComRegra >= 5)
    .sort((a, b) => b.semComRegra - a.semComRegra)
    .slice(0, 40);
  for (const r of sus)
    console.log(`  ${r.emitente} | ${r.total} | ${r.sem} | ${r.semComRegra} | ${((r.sem / r.total) * 100).toFixed(0)}%`);

  console.log("\n== B) Mesmo fornecedor escrito de mais de um jeito ==");
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();
  const g = new Map<string, string[]>();
  for (const r of rows) g.set(norm(r.emitente), [...(g.get(norm(r.emitente)) ?? []), r.emitente]);
  let achou = false;
  for (const [k, v] of g) if (v.length > 1) { achou = true; console.log(`  ${k}: ${v.map((x) => `"${x}"`).join("  /  ")}`); }
  if (!achou) console.log("  (nenhum)");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
