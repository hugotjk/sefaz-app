import { listarPrecos, type PrecoPdv } from "@/lib/pdvapi";

/**
 * Busca o preço de variações específicas na tabela de preços do PDV SEM varrer tudo.
 * A tabela vem ordenada pelo VariacaoId como TEXTO (confirmado em 05/11/2026 com o
 * diagnóstico-preco-ordem), então achamos a página de cada id por busca binária
 * (~14 chamadas) e reaproveitamos as páginas já lidas (as variações de um mesmo
 * produto ficam juntas).
 *
 * `ids` deve vir ORDENADO como texto (a função ordena de qualquer jeito).
 */
export async function precosPorVariacao(
  tabelaId: number,
  ids: string[],
  totalPaginas: number
): Promise<{ precos: Map<string, { preco: number; promo: number }>; chamadas: number }> {
  const alvos = [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const cache = new Map<number, PrecoPdv[]>();
  const precos = new Map<string, { preco: number; promo: number }>();
  const guarda = (alvo: string, r: PrecoPdv) =>
    precos.set(alvo, { preco: Number(r.PrecoOriginal ?? 0), promo: Number(r.PrecoPromocional ?? 0) });
  let chamadas = 0;

  const pagina = async (n: number): Promise<PrecoPdv[]> => {
    const c = cache.get(n);
    if (c) return c;
    chamadas++;
    const { registros } = await listarPrecos(tabelaId, { pagina: n, tamanhoPagina: 50 });
    cache.set(n, registros);
    return registros;
  };
  const id = (r: PrecoPdv) => String(r.VariacaoId);

  let lo = 1; // os alvos estão em ordem crescente: o próximo nunca fica antes da página anterior
  for (const alvo of alvos) {
    // 1) alguma página já lida cobre este id?
    let resolvido = false;
    for (const [n, regs] of cache) {
      if (!regs.length) continue;
      if (alvo >= id(regs[0]) && alvo <= id(regs[regs.length - 1])) {
        const hit = regs.find((r) => id(r) === alvo);
        if (hit) guarda(alvo, hit);
        lo = Math.max(lo, n);
        resolvido = true;
        break;
      }
    }
    if (resolvido) continue;

    // 2) busca binária entre `lo` e a última página
    let l = lo;
    let h = totalPaginas;
    while (l <= h) {
      const mid = Math.floor((l + h) / 2);
      const regs = await pagina(mid);
      if (!regs.length) {
        h = mid - 1; // a API pode devolver vazio/404 na última página
        continue;
      }
      if (alvo < id(regs[0])) h = mid - 1;
      else if (alvo > id(regs[regs.length - 1])) l = mid + 1;
      else {
        const hit = regs.find((r) => id(r) === alvo);
        if (hit) guarda(alvo, hit);
        lo = Math.max(lo, mid);
        break;
      }
    }
  }
  return { precos, chamadas };
}
