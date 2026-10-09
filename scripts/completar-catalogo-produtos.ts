/**
 * Completa o catálogo local de produtos varrendo TODA a lista da API do PDV
 * de uma rede e gravando só o que está faltando no banco. Roda no seu PC
 * (não usa o Inngest). Seguro para repetir: só insere produtos ausentes.
 *
 * Uso (simulação, não grava):  npx tsx --env-file=.env scripts\completar-catalogo-produtos.ts
 * Para gravar:                  npx tsx --env-file=.env scripts\completar-catalogo-produtos.ts --apply
 * Outras opções: --rede=2  --de=1  --ate=2592  --so-ativos
 *
 * Se interromper (Ctrl+C), retome com --de=<última página impressa>.
 */
import { PrismaClient } from "@prisma/client";
import { listarProdutos, listarVariacoesProduto } from "../src/lib/pdvapi";
import { vincularCadastroDeProdutos } from "../src/lib/reavaliar-cadastro-recentes";

const prisma = new PrismaClient();

function arg(nome: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a?.split("=")[1];
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Executa uma operação no banco; se a conexão cair, reconecta e tenta de novo. */
async function comRetryDb<T>(fn: () => Promise<T>): Promise<T> {
  let ultimo: any;
  for (let t = 1; t <= 6; t++) {
    try {
      return await fn();
    } catch (e: any) {
      ultimo = e;
      console.log(`  ! banco: ${String(e.code ?? e.message).slice(0, 80)} — tentativa ${t}/6, reconectando`);
      try { await prisma.$disconnect(); } catch { /* ignora */ }
      await dormir(Math.min(30000, 2000 * t * t));
    }
  }
  throw ultimo;
}

/** Lê uma página com novas tentativas (a API do PDV às vezes dá HTTP 500 passageiro). */
async function lerPagina(redeId: number, pagina: number) {
  let ultimoErro: any;
  for (let t = 1; t <= 6; t++) {
    try {
      return await listarProdutos({ redeId, aPartirDe: "2000-01-01", pagina, tamanhoPagina: 50 });
    } catch (e: any) {
      ultimoErro = e;
      const espera = Math.min(60000, 3000 * t * t);
      console.log(`  ! pág ${pagina}: ${String(e.message).slice(0, 90)} — tentativa ${t}/6, aguardando ${espera / 1000}s`);
      await dormir(espera);
    }
  }
  throw ultimoErro;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const soAtivos = process.argv.includes("--so-ativos");
  const redeId = Number(arg("rede") ?? 2);
  const de = Number(arg("de") ?? 1);

  const primeira = await lerPagina(redeId, de);
  const totalPaginas = primeira.paginacao?.TotalPaginas ?? 1;
  const ate = Math.min(Number(arg("ate") ?? totalPaginas), totalPaginas);
  console.log(`${apply ? "[APPLY]" : "[SIMULAÇÃO]"} rede ${redeId}: páginas ${de} a ${ate} de ${totalPaginas}${soAtivos ? " (só ativos)" : ""}`);

  let faltantes = 0, gravados = 0, variacoes = 0, semVariacaoEmbutida = 0;
  const novosIds: string[] = [];
  const paginasComErro: number[] = [];
  const t0 = Date.now();

  for (let pg = de; pg <= ate; pg++) {
    let registros;
    try {
      registros = (pg === de ? primeira : await lerPagina(redeId, pg)).registros;
    } catch {
      paginasComErro.push(pg);
      console.log(`  !! pág ${pg} PULADA após 6 tentativas (será listada no fim)`);
      continue;
    }
    if (registros.length === 0) break;

    const ids = registros.map((r) => r.Id);
    // Já completos = existem em Produto E têm ao menos 1 variação (ou a API não traz variações).
    const completos = new Set(
      (await comRetryDb(() =>
        prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT p.id FROM "Produto" p WHERE p.id = ANY($1::text[])
             AND EXISTS (SELECT 1 FROM "VariacaoProduto" v WHERE v."produtoId" = p.id)`,
          ids
        )
      )).map((r) => r.id)
    );
    const falta = registros.filter((r) => !completos.has(r.Id) && !(soAtivos && r.Inativo));
    faltantes += falta.length;

    if (apply && falta.length > 0) {
      // Gravação em LOTE (2 comandos por página em vez de centenas de upserts).
      // skipDuplicates: nunca altera o que já existe.
      const produtosData = falta.map((p) => ({
        id: p.Id,
        redeId: p.RedeId ?? redeId,
        nome: p.Nome || null,
        referenciaFornecedor: p.ReferenciaProdutoFornecedor || null,
        fornecedorId: p.FornecedorId || null,
        fornecedorNome: p.Fornecedor || null,
        modeloId: p.ModeloId != null ? String(p.ModeloId) : null,
        modeloNome: p.Modelo || null,
        colecaoId: p.ColecaoId ?? null,
        colecaoNome: p.Colecao || null,
        grupoId: p.GrupoId ?? null,
        grupoNome: p.Grupo || null,
        compradorId: p.CompradorId != null ? String(p.CompradorId) : null,
        compradorNome: p.Comprador || null,
      }));
      const variacoesData = falta.flatMap((p) =>
        (p.Variacoes ?? []).map((v) => ({ id: v.Id, produtoId: p.Id, redeId: p.RedeId ?? redeId }))
      );
      await comRetryDb(() => prisma.produto.createMany({ data: produtosData, skipDuplicates: true }));
      for (let i = 0; i < variacoesData.length; i += 500) {
        const fatia = variacoesData.slice(i, i + 500);
        await comRetryDb(() => prisma.variacaoProduto.createMany({ data: fatia, skipDuplicates: true }));
      }
      variacoes += variacoesData.length;
      semVariacaoEmbutida += falta.filter((p) => (p.Variacoes ?? []).length === 0).length;
      novosIds.push(...falta.map((p) => p.Id));
      gravados += falta.length;

      // Produtos sem variação embutida: busca no endpoint dedicado (poucos).
      for (const p of falta.filter((x) => (x.Variacoes ?? []).length === 0)) {
        try {
          const lista = await listarVariacoesProduto(redeId, p.Id);
          for (const v of lista) {
            await prisma.variacaoProduto.upsert({
              where: { id: v.Id },
              create: { id: v.Id, produtoId: p.Id, redeId: v.RedeId ?? redeId },
              update: {},
            });
            variacoes++;
          }
        } catch { /* segue; o enriquecimento/sync pega depois */ }
      }
    }

    if (pg % 25 === 0 || pg === ate) {
      const min = ((Date.now() - t0) / 60000).toFixed(1);
      console.log(`  pág ${pg}/${ate} | faltavam ${faltantes} | gravados ${gravados} | variações ${variacoes} | ${min} min`);
    }
    if (apply && novosIds.length >= 1500) {
      const lote = novosIds.splice(0, novosIds.length);
      const n = await comRetryDb(() => vincularCadastroDeProdutos(lote));
      console.log(`  (vinculados ${n} itens de nota ao catálogo)`);
    }
  }
  if (apply && novosIds.length > 0) {
    const n = await comRetryDb(() => vincularCadastroDeProdutos(novosIds));
    console.log(`  (vinculados ${n} itens de nota ao catálogo)`);
  }
  if (paginasComErro.length > 0) {
    console.log(`\nPÁGINAS NÃO LIDAS (rode de novo para completar): ${paginasComErro.join(", ")}`);
  }
  console.log(`\nFim. Faltavam ${faltantes} produtos${apply ? `; gravados ${gravados}, variações ${variacoes} (${semVariacaoEmbutida} produtos sem variação embutida).` : ". Nada foi gravado (simulação)."}`);
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
