/**
 * Diagnóstico SOMENTE LEITURA: confirma que a tabela de preços do PDV vem ordenada por data
 * (o mais novo nas últimas páginas). Mostra as datas da 1ª e das últimas páginas.
 * Uso: npx tsx --env-file=.env scripts\diagnostico-preco-ultimas-paginas.ts
 */
import { consultarPrecosComParametros } from "../src/lib/pdvapi";

const TABELA = 3;
async function pag(n: number) {
  const r = await consultarPrecosComParametros(TABELA, { Pagina: n, TamanhoPagina: 50 });
  return r;
}
async function main() {
  const p1 = await pag(1);
  const total = p1.paginacao?.TotalPaginas ?? 0;
  console.log(`Total de páginas: ${total} | registros: ${p1.paginacao?.TotalRegistros}`);
  for (const n of [1, Math.floor(total / 2), total - 200, total - 20, total - 2, total - 1, total]) {
    if (n < 1) continue;
    const r = await pag(n);
    const d = r.registros.map((x) => x.DataAtualizacao ?? "").filter(Boolean).sort();
    console.log(`pág ${String(n).padStart(6)}: ${r.registros.length} regs | de ${d[0] ?? "-"} até ${d[d.length - 1] ?? "-"}`);
  }
}
main();
