/**
 * Reseta certificados ACTIVE que ficaram com 0 notas por causa do bug do
 * cStat 656 (sincronizarCertificado tratava a rejeição de rate limit como
 * fim de paginação: copiava o ultNSU ecoado, zerava o maxNSU e marcava
 * backfillDone=true, pulando todo o histórico).
 *
 * Critério: status = 'ACTIVE' E 0 notas no banco. Cobre os grupos mapeados no
 * diagnóstico:
 *   - "impressão digital do FMS" (backfillDone=true, ultNSU>0, maxNSU=0)
 *   - "paginou mas 0 nota" (backfillDone=true, maxNSU!=0)
 *   - "marcado done sem avançar" (backfillDone=true, ultNSU=0)
 *   - "nunca sincronizaram" (backfillDone=false, ultNSU=0)
 * Os certificados que JÁ têm >=1 nota são saudáveis e NÃO são tocados.
 *
 * Reset = ultNSU/maxNSU -> '000000000000000', backfillDone -> false. Na próxima
 * execução horária o backfill recomeça do NSU 0.
 *
 *   Dry-run (só lista):   npx tsx --env-file=.env scripts/resetar-certificados-sem-notas.ts
 *   Aplicar de verdade:   npx tsx --env-file=.env scripts/resetar-certificados-sem-notas.ts --apply
 */
import { prisma } from "../src/lib/db";

const ZERO_NSU = "000000000000000";
const APLICAR = process.argv.includes("--apply");

async function main() {
  const alvos = await prisma.$queryRawUnsafe<
    {
      id: string;
      cnpj: string;
      razaoSocial: string | null;
      backfillDone: boolean;
      ultNSU: string;
      maxNSU: string;
      createdAt: Date;
    }[]
  >(`
    SELECT c.id, c.cnpj, c."razaoSocial", c."backfillDone", c."ultNSU", c."maxNSU", c."createdAt"
      FROM "Certificate" c
      LEFT JOIN "Note" n ON n."certificateId" = c.id
     WHERE c.status = 'ACTIVE'
     GROUP BY c.id
    HAVING COUNT(n.id) = 0
     ORDER BY c."backfillDone" DESC, c."ultNSU" DESC
  `);

  const jaZerados = alvos.filter(
    (c) => c.ultNSU === ZERO_NSU && c.maxNSU === ZERO_NSU && !c.backfillDone
  ).length;

  console.log(`Certificados ACTIVE com 0 notas: ${alvos.length}`);
  console.log(
    `  - já em estado "zerado" (ultNSU=0, maxNSU=0, backfillDone=false): ${jaZerados}`
  );
  console.log(
    `  - com ponteiro/flag a corrigir: ${alvos.length - jaZerados}\n`
  );
  for (const c of alvos) {
    console.log(
      `  ${(c.razaoSocial ?? "(sem nome)").slice(0, 44).padEnd(44)} cnpj=${c.cnpj} ` +
        `backfillDone=${String(c.backfillDone).padEnd(5)} ultNSU=${c.ultNSU} maxNSU=${c.maxNSU} ` +
        `criado=${c.createdAt.toISOString().slice(0, 10)}`
    );
  }

  if (!APLICAR) {
    console.log(
      `\n[DRY-RUN] Nada foi alterado. Rode com --apply para resetar os ${alvos.length} certificados acima.`
    );
    await prisma.$disconnect();
    return;
  }

  const ids = alvos.map((c) => c.id);
  const r = await prisma.certificate.updateMany({
    where: { id: { in: ids } },
    data: { ultNSU: ZERO_NSU, maxNSU: ZERO_NSU, backfillDone: false },
  });
  console.log(`\n[APPLY] ${r.count} certificados resetados (ultNSU=0, maxNSU=0, backfillDone=false).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
