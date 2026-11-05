/**
 * Diagnóstico SOMENTE LEITURA: por qual campo a tabela de preços do PDV está ordenada?
 * Se for pelo VariacaoId, dá para achar o preço de UMA variação por busca binária (~14 chamadas).
 * Uso: npx tsx --env-file=.env scripts\diagnostico-preco-ordem.ts
 */
import { PrismaClient } from "@prisma/client";
import { consultarPrecosComParametros } from "../src/lib/pdvapi";

const prisma = new PrismaClient();
const TABELA = 3;
const pag = (n: number) => consultarPrecosComParametros(TABELA, { Pagina: n, TamanhoPagina: 50 });

async function main() {
  const p1 = await pag(1);
  const total = p1.paginacao?.TotalPaginas ?? 0;
  console.log(`Total de páginas: ${total}\n`);

  const amostra = [1, 2, 100, 1000, 5000, 10000, 15000, total - 1];
  let ultimoNum = -Infinity;
  let ultimoStr = "";
  let numCresc = true;
  let strCresc = true;
  for (const n of amostra) {
    const r = await pag(n);
    const ids = r.registros.map((x) => String(x.VariacaoId));
    const nums = ids.map(Number);
    const dentroNum = nums.every((v, i) => i === 0 || v >= nums[i - 1]);
    const dentroStr = ids.every((v, i) => i === 0 || v >= ids[i - 1]);
    console.log(`pág ${String(n).padStart(6)}: 1º=${ids[0]} último=${ids[ids.length - 1]} | ordenada na página: número=${dentroNum} texto=${dentroStr}`);
    if (nums[0] < ultimoNum) numCresc = false;
    if (ids[0] < ultimoStr) strCresc = false;
    ultimoNum = nums[nums.length - 1];
    ultimoStr = ids[ids.length - 1];
  }
  console.log(`\nCresce entre as páginas amostradas: número=${numCresc} texto=${strCresc}`);

  // Busca binária de uma variação conhecida (preço também conferido com o banco)
  const [v] = await prisma.$queryRawUnsafe<{ id: string; preco: number }[]>(
    `SELECT pv."variacaoId" AS id, pv.preco::float8 AS preco FROM "PrecoVariacao" pv ORDER BY pv."updatedAt" DESC LIMIT 1`
  );
  console.log(`\nBusca binária da variação ${v.id} (preço no banco: ${v.preco})`);
  for (const modo of ["número", "texto"] as const) {
    let lo = 1, hi = total, chamadas = 0, achou: number | null = null;
    while (lo <= hi && chamadas < 40) {
      const mid = Math.floor((lo + hi) / 2);
      const r = await pag(mid);
      chamadas++;
      const ids = r.registros.map((x) => String(x.VariacaoId));
      if (!ids.length) { hi = mid - 1; continue; }
      const hit = r.registros.find((x) => String(x.VariacaoId) === v.id);
      if (hit) { achou = Number(hit.PrecoOriginal); break; }
      const menor = (a: string, b: string) => (modo === "número" ? Number(a) < Number(b) : a < b);
      if (menor(v.id, ids[0])) hi = mid - 1;
      else lo = mid + 1;
    }
    console.log(`  comparando como ${modo}: ${achou == null ? "NÃO achou" : `achou preço ${achou}`} em ${chamadas} chamadas`);
  }
}
main().finally(() => prisma.$disconnect());
