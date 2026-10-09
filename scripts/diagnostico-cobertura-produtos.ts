/**
 * Diagnóstico SOMENTE LEITURA: amostra páginas espalhadas da API do PDV e mede
 * quanto de cada trecho já está no banco (cobertura), por rede.
 * Uso: npx tsx --env-file=.env scripts\diagnostico-cobertura-produtos.ts [AMOSTRAS=24]
 */
import { PrismaClient } from "@prisma/client";
import { listarProdutos } from "../src/lib/pdvapi";
const prisma = new PrismaClient();

const REDES = [2, 4, 9, 14];

async function main() {
  const amostras = Number(process.argv[2] ?? 24);
  for (const redeId of REDES) {
    const primeira = await listarProdutos({ redeId, aPartirDe: "2000-01-01", pagina: 1, tamanhoPagina: 50 });
    const total = primeira.paginacao?.TotalPaginas ?? 1;
    const n = Math.min(amostras, total);
    const paginas = [...new Set(Array.from({ length: n }, (_, i) => Math.max(1, Math.round(1 + (i * (total - 1)) / Math.max(1, n - 1)))))];
    console.log(`\n=== Rede ${redeId}: ${total} páginas; amostrando ${paginas.length} ===`);
    let tot = 0, noBanco = 0, outraRede = 0, atualizadoRecente = 0;
    const porTrecho: Record<string, { t: number; ok: number }> = {};
    for (const pg of paginas) {
      const { registros } = await listarProdutos({ redeId, aPartirDe: "2000-01-01", pagina: pg, tamanhoPagina: 50 });
      const ids = registros.map((r) => r.Id);
      const achados = await prisma.$queryRawUnsafe<{ id: string; redeId: number }[]>(
        `SELECT id, "redeId" FROM "Produto" WHERE id = ANY($1::text[])`, ids
      );
      const set = new Set(achados.map((a) => a.id));
      const trecho = `${Math.floor(((pg - 1) / total) * 4) * 25}-${Math.floor(((pg - 1) / total) * 4) * 25 + 25}%`;
      porTrecho[trecho] ??= { t: 0, ok: 0 };
      porTrecho[trecho].t += ids.length;
      porTrecho[trecho].ok += set.size;
      tot += ids.length;
      noBanco += set.size;
      outraRede += achados.filter((a) => a.redeId !== redeId).length;
      for (const r of registros) if (r.DataAtualizacao && Date.now() - new Date(r.DataAtualizacao).getTime() < 7 * 86400000) atualizadoRecente++;
    }
    console.log(`amostra: ${tot} produtos | no banco: ${noBanco} (${((noBanco / tot) * 100).toFixed(0)}%) | desses, gravados sob OUTRA rede: ${outraRede} | alterados nos últimos 7 dias: ${atualizadoRecente}`);
    for (const [k, v] of Object.entries(porTrecho)) console.log(`  trecho ${k} da lista: ${v.ok}/${v.t} (${((v.ok / v.t) * 100).toFixed(0)}%)`);
  }
}
main().catch((e) => console.error(e.message)).finally(() => prisma.$disconnect());
