/**
 * SOMENTE LEITURA. Procura um produto direto na API do PDV em TODAS as redes (ativas ou não):
 * lê os produtos alterados nos últimos N dias e mostra os que batem com a referência do
 * fornecedor (prefixo) ou com o código. Serve para descobrir em que rede um produto está.
 *
 *   npx tsx --env-file=.env scripts/diag-produto-pdv.ts --ref=26122701 [--id=147430] [--dias=3]
 */
import { listarRedes, listarProdutos } from "../src/lib/pdvapi";

const arg = (n: string) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);
const REF = (arg("ref") ?? "").toUpperCase();
const ID = arg("id");
const DIAS = Number(arg("dias") ?? 3);

async function main() {
  const aPartirDe = new Date(Date.now() - DIAS * 86_400_000).toISOString().slice(0, 10);
  const redes = await listarRedes();
  console.log(`Redes no PDV: ${redes.map((r) => `${r.Id}=${r.Nome}${r.Inativa ? "(inativa)" : ""}`).join(", ")}`);
  console.log(`Buscando ref "${REF}"${ID ? ` / código ${ID}` : ""} em produtos alterados desde ${aPartirDe}\n`);
  for (const rede of redes) {
    let achou = 0, total = 0;
    try {
      for (let pg = 1; pg < 400; pg++) {
        const { registros, paginacao } = await listarProdutos({ redeId: rede.Id, aPartirDe, pagina: pg, tamanhoPagina: 50 });
        total += registros.length;
        for (const p of registros) {
          const ref = (p.ReferenciaProdutoFornecedor ?? "").toUpperCase();
          if ((REF && ref.startsWith(REF)) || (ID && String(p.Id).replace(/\D/g, "").endsWith(ID))) {
            achou++;
            console.log(`  >>> rede ${rede.Id} (${rede.Nome}) | Id ${p.Id} | ref "${p.ReferenciaProdutoFornecedor}" | modelo "${p.Modelo}" | fornecedor "${p.Fornecedor}" | atualizado ${p.DataAtualizacao} | inativo ${p.Inativo ?? false}`);
          }
        }
        if (!(paginacao?.TemProximaPagina ?? registros.length > 0) || registros.length === 0) break;
      }
      console.log(`rede ${rede.Id} (${rede.Nome}): ${total} produtos alterados, ${achou} batem`);
    } catch (e: any) {
      console.log(`rede ${rede.Id} (${rede.Nome}): erro ${String(e?.message).slice(0, 100)}`);
    }
  }
}
main().catch((e) => console.error(e));
