/**
 * Completa EAN/cor/tamanho das variações do catálogo direto da API do PDV, no seu PC (sem Inngest).
 * Faz o mesmo que a função `pdv-enriquecer-variacoes`, mas sem limite de lote.
 *
 * Por padrão só as variações PRIORITÁRIAS: produtos cuja referência bate com itens de notas ainda
 * "sem cadastro" que têm EAN (são os que aparecem como "aguardando" na Conferência sem EAN e os que
 * destravam o cadastro). Com --todos, também varre as demais variações sem EAN.
 *
 *   Simulação (só conta):  npx tsx --env-file=.env scripts/enriquecer-variacoes-pendentes.ts
 *   Gravar:                npx tsx --env-file=.env scripts/enriquecer-variacoes-pendentes.ts --apply
 *
 * Opções: --todos  --limite=500 (máx. de produtos)  --paralelo=4 (consultas simultâneas ao PDV)  --rede=2
 * Seguro para repetir: quem já tem EAN sai da fila. Se interromper (Ctrl+C), é só rodar de novo.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { listarVariacoesProduto } from "../src/lib/pdvapi";
import { vincularCadastroDeProdutos } from "../src/lib/reavaliar-cadastro-recentes";
import { idApiDoProduto } from "../src/lib/produto-id";

const prisma = new PrismaClient();
const APLICAR = process.argv.includes("--apply");
const TODOS = process.argv.includes("--todos");
const arg = (n: string) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);
const LIMITE = arg("limite") ? Number(arg("limite")) : Infinity;
const PARALELO = Math.max(1, Math.min(8, Number(arg("paralelo") ?? 4)));
const REDE = arg("rede") ? Number(arg("rede")) : null;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function comRetryDb<T>(fn: () => Promise<T>): Promise<T> {
  let ultimo: any;
  for (let t = 1; t <= 6; t++) {
    try { return await fn(); } catch (e: any) {
      ultimo = e;
      console.log(`  ! banco: ${String(e.code ?? e.message).slice(0, 80)} — tentativa ${t}/6`);
      try { await prisma.$disconnect(); } catch { /* ignora */ }
      await dormir(Math.min(30000, 2000 * t * t));
    }
  }
  throw ultimo;
}

async function listarComRetry(redeId: number, produtoId: string) {
  let ultimo: any;
  for (let t = 1; t <= 4; t++) {
    try { return await listarVariacoesProduto(redeId, idApiDoProduto(produtoId)); } catch (e: any) {
      ultimo = e;
      await dormir(Math.min(30000, 2000 * t * t));
    }
  }
  throw ultimo;
}

async function main() {
  const filtroRede = REDE != null ? Prisma.sql`AND v."redeId" = ${REDE}` : Prisma.empty;
  const prioritarias = await prisma.$queryRaw<{ produtoId: string; redeId: number; n: bigint }[]>(Prisma.sql`
    SELECT v."produtoId", v."redeId", count(*) AS n
      FROM "VariacaoProduto" v
      JOIN "Produto" p ON p.id = v."produtoId"
     WHERE v.ean IS NULL ${filtroRede}
       AND upper(trim(p."referenciaFornecedor")) IN (
         SELECT DISTINCT upper(trim("referenciaFornecedorIdentificada")) FROM "NotaItem"
          WHERE "temCadastro" = false AND ean IS NOT NULL AND ean <> ''
            AND "referenciaFornecedorIdentificada" IS NOT NULL)
     GROUP BY v."produtoId", v."redeId"`);
  let fila = prioritarias.map((r) => ({ produtoId: r.produtoId, redeId: r.redeId, n: Number(r.n) }));
  const totalVar = fila.reduce((s, r) => s + r.n, 0);
  console.log(`${APLICAR ? "[APPLY]" : "[SIMULAÇÃO]"} prioritárias: ${fila.length} produtos, ${totalVar} variações sem EAN`);

  if (TODOS) {
    const ja = new Set(fila.map((f) => f.produtoId));
    const outros = await prisma.$queryRaw<{ produtoId: string; redeId: number; n: bigint }[]>(Prisma.sql`
      SELECT v."produtoId", v."redeId", count(*) AS n FROM "VariacaoProduto" v
       WHERE v.ean IS NULL ${filtroRede} GROUP BY v."produtoId", v."redeId"`);
    const extra = outros.filter((o) => !ja.has(o.produtoId)).map((o) => ({ produtoId: o.produtoId, redeId: o.redeId, n: Number(o.n) }));
    console.log(`--todos: + ${extra.length} produtos (${extra.reduce((s, r) => s + r.n, 0)} variações) fora da fila prioritária`);
    fila = fila.concat(extra);
  }
  if (Number.isFinite(LIMITE)) fila = fila.slice(0, LIMITE);

  if (!APLICAR) {
    console.log(`\nNada foi gravado (simulação). Rode com --apply para consultar o PDV (${fila.length} produtos, ${PARALELO} em paralelo).`);
    return;
  }

  let feitos = 0, atualizadas = 0, falhas = 0, semVariacao = 0;
  const lote: string[] = [];
  const t0 = Date.now();
  let idx = 0;

  async function trabalhador() {
    while (true) {
      const i = idx++;
      if (i >= fila.length) return;
      const { produtoId, redeId } = fila[i];
      try {
        const lista = await listarComRetry(redeId, produtoId);
        if (lista.length === 0) semVariacao++;
        const ops = lista.map((v: any) =>
          prisma.variacaoProduto.updateMany({
            where: { id: String(v.Id) },
            // "" quando o PDV não tem EAN: sai da fila e não é reconsultado.
            data: { ean: (v.EAN ?? "").trim(), cor: v.Cor || null, tamanho: v.Tamanho || null },
          })
        );
        if (ops.length) await comRetryDb(() => prisma.$transaction(ops));
        atualizadas += lista.length;
        lote.push(produtoId);
      } catch (e: any) {
        falhas++;
        console.log(`  ! ${produtoId}: ${String(e?.message ?? e).slice(0, 90)}`);
      }
      feitos++;
      if (feitos % 25 === 0 || feitos === fila.length) {
        const min = (Date.now() - t0) / 60000;
        const falta = (min / feitos) * (fila.length - feitos);
        console.log(`  ${feitos}/${fila.length} produtos | variações atualizadas ${atualizadas} | falhas ${falhas} | ${min.toFixed(1)} min | faltam ~${falta.toFixed(1)} min`);
      }
    }
  }
  const trabalhadores = Array.from({ length: PARALELO }, () => trabalhador());
  // vincula itens de nota ao catálogo por lotes enquanto roda
  const vinculador = (async () => {
    let encerrou = false;
    Promise.all(trabalhadores).then(() => (encerrou = true));
    while (!encerrou) {
      await dormir(20000);
      if (lote.length >= 200) {
        const ids = lote.splice(0, lote.length);
        const n = await comRetryDb(() => vincularCadastroDeProdutos(ids));
        console.log(`  (vinculados ${n} itens de nota ao catálogo)`);
      }
    }
  })();
  await Promise.all(trabalhadores);
  await vinculador;
  if (lote.length) {
    const n = await comRetryDb(() => vincularCadastroDeProdutos(lote.splice(0, lote.length)));
    console.log(`  (vinculados ${n} itens de nota ao catálogo)`);
  }
  console.log(`\n=== RESUMO === produtos consultados: ${feitos} | variações atualizadas: ${atualizadas} | produtos sem variação no PDV: ${semVariacao} | falhas: ${falhas}`);
  if (falhas) console.log("Houve falhas: rode de novo (quem já foi atualizado sai da fila).");
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
