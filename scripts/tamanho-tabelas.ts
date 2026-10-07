/**
 * Relatório SOMENTE-LEITURA: tamanho de cada tabela do banco (dados + índices)
 * e número aproximado de linhas. Não altera nada.
 *
 *   npx tsx --env-file=.env scripts/tamanho-tabelas.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.$queryRaw<{ mb: number }[]>`
    SELECT (pg_database_size(current_database()) / 1024.0 / 1024.0)::float AS mb`;
  console.log(`Banco inteiro: ${Math.round(total[0].mb)} MB`);
  console.log("---");
  const rows = await prisma.$queryRaw<
    { tabela: string; mb: number; linhas: bigint }[]
  >`
    SELECT c.relname AS tabela,
           (pg_total_relation_size(c.oid) / 1024.0 / 1024.0)::float AS mb,
           c.reltuples::bigint AS linhas
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = 'public'
    ORDER BY pg_total_relation_size(c.oid) DESC`;
  for (const r of rows) {
    console.log(`${r.tabela.padEnd(26)} ${String(Math.round(r.mb)).padStart(6)} MB   ~${Number(r.linhas)} linhas`);
  }
}

main()
  .catch((e) => console.error("Falhou:", String(e?.message ?? e).slice(0, 300)))
  .finally(() => prisma.$disconnect());
