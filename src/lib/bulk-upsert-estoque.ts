import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Upsert em massa de linhas de estoque (uma variação costuma ter MILHARES de
 * linhas — loja a loja). Um `INSERT ... ON CONFLICT` por chunk em vez de N
 * round-trips: derruba o tempo de ~80ms/linha pra ~1 statement/chunk.
 */
export async function upsertEstoqueBulk(
  linhas: { variacaoId: string; lojaId: number; quantidade: number }[]
): Promise<number> {
  // Dedup por (variacaoId, lojaId) — a API do PDV às vezes devolve a mesma
  // combinação repetida, e o ON CONFLICT não aceita a mesma linha 2x no mesmo
  // INSERT.
  const porChave = new Map<string, { variacaoId: string; lojaId: number; quantidade: number }>();
  for (const l of linhas) {
    if (!l.variacaoId || l.lojaId == null) continue;
    porChave.set(`${l.variacaoId}|${l.lojaId}`, {
      variacaoId: String(l.variacaoId),
      lojaId: l.lojaId,
      quantidade: Number(l.quantidade ?? 0),
    });
  }
  const rows = [...porChave.values()];
  if (rows.length === 0) return 0;

  const CHUNK = 2000;
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = Prisma.join(
      chunk.map((r) => Prisma.sql`(${r.variacaoId}, ${r.lojaId}, ${r.quantidade}, now())`)
    );
    total += await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "EstoqueVariacaoSync" ("variacaoId", "lojaId", "quantidade", "updatedAt")
      VALUES ${values}
      ON CONFLICT ("variacaoId", "lojaId")
      DO UPDATE SET "quantidade" = EXCLUDED."quantidade", "updatedAt" = now()
    `);
  }
  return total;
}
