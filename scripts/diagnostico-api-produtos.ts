/**
 * Diagnóstico SOMENTE LEITURA: compara o que a API do PDV diz ter (por rede)
 * com o que temos no banco, e procura uma referência direto na API.
 * Uso: npx tsx --env-file=.env scripts\diagnostico-api-produtos.ts [REFERENCIA]
 * Faz poucas chamadas (1 por rede + até 40 páginas por rede se informar referência).
 */
import { PrismaClient } from "@prisma/client";
import { listarRedes, listarProdutos } from "../src/lib/pdvapi";
const prisma = new PrismaClient();

async function main() {
  const ref = process.argv[2]?.toUpperCase();
  const redes = await listarRedes();
  console.log("=== Redes na API ===");
  for (const r of redes) console.log(`rede ${r.Id} | ${r.Nome} | ${r.Inativa ? "INATIVA" : "ativa"}`);

  console.log("\n=== Total na API (ApartirDe=2000-01-01) x banco ===");
  for (const r of redes.filter((x) => !x.Inativa)) {
    try {
      const { registros, paginacao } = await listarProdutos({
        redeId: r.Id, aPartirDe: "2000-01-01", pagina: 1, tamanhoPagina: 50,
      });
      const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "Produto" WHERE "redeId" = $1`, r.Id
      );
      console.log(`rede ${r.Id} (${r.Nome}): API paginacao=${JSON.stringify(paginacao)} | 1ª página=${registros.length} | banco=${n}`);
    } catch (e: any) {
      console.log(`rede ${r.Id} (${r.Nome}): ERRO ${e.message}`);
    }
  }

  if (ref) {
    console.log(`\n=== Procurando "${ref}" direto na API (varre as páginas, por rede) ===`);
    for (const r of redes.filter((x) => !x.Inativa)) {
      let pagina = 1, achou = 0;
      while (pagina <= 400) {
        const { registros, paginacao } = await listarProdutos({
          redeId: r.Id, aPartirDe: "2000-01-01", pagina, tamanhoPagina: 50,
        });
        for (const p of registros) {
          if ((p.ReferenciaProdutoFornecedor ?? "").toUpperCase().includes(ref) || (p.Nome ?? "").toUpperCase().includes(ref)) {
            achou++;
            console.log(`rede ${r.Id} | id=${p.Id} | ref=[${p.ReferenciaProdutoFornecedor}] | modelo=[${p.Modelo}] | ${p.Nome} | atualizado=${p.DataAtualizacao} | inativo=${p.Inativo}`);
          }
        }
        if (!(paginacao?.TemProximaPagina ?? registros.length > 0)) break;
        pagina++;
      }
      console.log(`rede ${r.Id}: ${pagina} páginas lidas, ${achou} encontrado(s)`);
    }
  }
}
main().catch((e) => console.error(e.message)).finally(() => prisma.$disconnect());
