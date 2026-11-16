/**
 * Atualiza o catálogo local (tabela Produto) com o que MUDOU no PDV, varrendo
 * TODA a lista da API de uma rede. Serve para pegar alterações que o sync
 * incremental do app não enxerga (ex.: renomear um MODELO no PDV não muda a
 * data de atualização dos produtos). Roda no seu PC — não usa Inngest, não tem
 * limite de steps. Seguro para repetir: só grava produtos cujos dados mudaram.
 *
 * Compara estes campos: nome, referenciaFornecedor, fornecedor, modelo,
 * coleção, grupo, comprador. NÃO insere produtos novos (para isso existe
 * scripts/completar-catalogo-produtos.ts) e não mexe em variações/EAN.
 *
 * Uso (simulação, não grava):  npx tsx --env-file=.env scripts/atualizar-catalogo-produtos.ts --rede=9
 * Para gravar:                  npx tsx --env-file=.env scripts/atualizar-catalogo-produtos.ts --rede=9 --apply
 * Outras opções: --de=1  --ate=2592  --ultimos-dias=60  --so-modelo=Xeryus
 *   --so-modelo: só atualiza produtos cujo modelo (antigo OU novo) contenha o texto.
 *
 * Se interromper (Ctrl+C), retome com --de=<última página impressa>.
 * Depois de gravar, rode scripts/recalcular-fornecedores.ts (dry-run e --apply).
 */
import { PrismaClient } from "@prisma/client";
import { listarProdutos, type ProdutoPdv } from "../src/lib/pdvapi";
import { vincularCadastroDeProdutos } from "../src/lib/reavaliar-cadastro-recentes";
import { chaveProduto } from "../src/lib/produto-id";

const prisma = new PrismaClient();

function arg(nome: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a?.slice(nome.length + 3);
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
async function lerPagina(redeId: number, pagina: number, aPartirDe: string) {
  let ultimoErro: any;
  for (let t = 1; t <= 6; t++) {
    try {
      return await listarProdutos({ redeId, aPartirDe, pagina, tamanhoPagina: 50 });
    } catch (e: any) {
      ultimoErro = e;
      const espera = Math.min(60000, 3000 * t * t);
      console.log(`  ! pág ${pagina}: ${String(e.message).slice(0, 90)} — tentativa ${t}/6, aguardando ${espera / 1000}s`);
      await dormir(espera);
    }
  }
  throw ultimoErro;
}

// Campos comparados (nome no banco -> valor vindo do PDV).
function camposDoPdv(p: ProdutoPdv, redeId: number) {
  return {
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
  };
}
type Campos = ReturnType<typeof camposDoPdv>;
const NOMES_CAMPOS = Object.keys(camposDoPdv({ Id: "", RedeId: 0 }, 0)) as (keyof Campos)[];

const igual = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

async function main() {
  const apply = process.argv.includes("--apply");
  const redeId = Number(arg("rede") ?? 2);
  const de = Number(arg("de") ?? 1);
  const soModelo = arg("so-modelo")?.toUpperCase() ?? null;
  const ultimosDias = arg("ultimos-dias") ? Number(arg("ultimos-dias")) : null;
  const aPartirDe = ultimosDias
    ? new Date(Date.now() - ultimosDias * 86_400_000).toISOString().slice(0, 10)
    : "2000-01-01";

  const primeira = await lerPagina(redeId, de, aPartirDe);
  const totalPaginas = primeira.paginacao?.TotalPaginas ?? 1;
  const ate = Math.min(Number(arg("ate") ?? totalPaginas), totalPaginas);
  console.log(
    `${apply ? "[APPLY]" : "[SIMULAÇÃO]"} rede ${redeId}: páginas ${de} a ${ate} de ${totalPaginas}` +
      `${ultimosDias ? ` | alterados desde ${aPartirDe}` : ""}${soModelo ? ` | só modelo ~ "${soModelo}"` : ""}`
  );

  let lidos = 0, naoNoBanco = 0, mudaram = 0, gravados = 0;
  const porCampo: Record<string, number> = {};
  const trocasModelo = new Map<string, number>(); // "antigo -> novo" => qtd
  const exemplos: string[] = [];
  const idsAtualizados: string[] = [];
  const paginasComErro: number[] = [];
  const t0 = Date.now();

  for (let pg = de; pg <= ate; pg++) {
    let registros: ProdutoPdv[];
    try {
      registros = (pg === de ? primeira : await lerPagina(redeId, pg, aPartirDe)).registros;
    } catch {
      paginasComErro.push(pg);
      console.log(`  !! pág ${pg} PULADA após 6 tentativas (será listada no fim)`);
      continue;
    }
    if (registros.length === 0) break;
    lidos += registros.length;

    const chaveDe = (r: ProdutoPdv) => chaveProduto(r.RedeId ?? redeId, r.Id);
    const existentes: any[] = await comRetryDb(() =>
      prisma.produto.findMany({
        where: { id: { in: registros.map(chaveDe) } },
        select: {
          id: true, redeId: true, nome: true, referenciaFornecedor: true, fornecedorId: true,
          fornecedorNome: true, modeloId: true, modeloNome: true, colecaoId: true, colecaoNome: true,
          grupoId: true, grupoNome: true, compradorId: true, compradorNome: true,
        },
      })
    );
    const porId = new Map<string, any>(existentes.map((e: any) => [e.id as string, e]));

    const updates: { id: string; dados: Partial<Campos> & { dataAtualizacaoPdv: Date | null } }[] = [];
    for (const p of registros) {
      const id = chaveDe(p);
      const atual = porId.get(id);
      if (!atual) { naoNoBanco++; continue; }
      const novo = camposDoPdv(p, redeId);
      const diffs = NOMES_CAMPOS.filter((c) => !igual((atual as any)[c], novo[c]));
      if (diffs.length === 0) continue;
      if (soModelo) {
        const texto = `${atual.modeloNome ?? ""}|${novo.modeloNome ?? ""}`.toUpperCase();
        if (!texto.includes(soModelo)) continue;
      }
      mudaram++;
      for (const c of diffs) porCampo[c] = (porCampo[c] ?? 0) + 1;
      if (diffs.includes("modeloNome")) {
        const k = `${atual.modeloNome ?? "(vazio)"}  ->  ${novo.modeloNome ?? "(vazio)"}`;
        trocasModelo.set(k, (trocasModelo.get(k) ?? 0) + 1);
      }
      if (exemplos.length < 15) {
        exemplos.push(
          `  ${id} [${diffs.join(", ")}] ` +
            diffs.map((c) => `${c}: "${(atual as any)[c] ?? ""}" -> "${novo[c] ?? ""}"`).join(" | ")
        );
      }
      updates.push({
        id,
        dados: { ...novo, dataAtualizacaoPdv: p.DataAtualizacao ? new Date(p.DataAtualizacao) : null },
      });
    }

    if (apply && updates.length > 0) {
      await comRetryDb(() =>
        prisma.$transaction(updates.map((u) => prisma.produto.update({ where: { id: u.id }, data: u.dados })))
      );
      gravados += updates.length;
      idsAtualizados.push(...updates.map((u) => u.id));
    }

    if (pg % 25 === 0 || pg === ate) {
      const min = (Date.now() - t0) / 60000;
      const feitas = pg - de + 1;
      const restantes = ate - pg;
      const prev = feitas > 0 ? ((min / feitas) * restantes).toFixed(1) : "?";
      console.log(
        `  pág ${pg}/${ate} | lidos ${lidos} | mudaram ${mudaram} | gravados ${gravados} | ${min.toFixed(1)} min | faltam ~${prev} min`
      );
    }
    if (apply && idsAtualizados.length >= 1500) {
      const lote = idsAtualizados.splice(0, idsAtualizados.length);
      const n = await comRetryDb(() => vincularCadastroDeProdutos(lote));
      console.log(`  (vinculados ${n} itens de nota ao catálogo)`);
    }
  }
  if (apply && idsAtualizados.length > 0) {
    const n = await comRetryDb(() => vincularCadastroDeProdutos(idsAtualizados));
    console.log(`  (vinculados ${n} itens de nota ao catálogo)`);
  }

  console.log(`\n=== RESUMO ===`);
  console.log(`Lidos do PDV: ${lidos} | não estão no banco (use completar-catalogo-produtos): ${naoNoBanco}`);
  console.log(`Produtos com dados diferentes do banco: ${mudaram}${apply ? ` (gravados ${gravados})` : " (nada foi gravado — simulação)"}`);
  console.log(`Por campo:`, porCampo);
  if (trocasModelo.size > 0) {
    console.log(`\nTrocas de MODELO (antigo -> novo : produtos):`);
    [...trocasModelo.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .forEach(([k, n]) => console.log(`  ${k} : ${n}`));
  }
  if (exemplos.length > 0) {
    console.log(`\nExemplos:`);
    exemplos.forEach((l) => console.log(l));
  }
  if (paginasComErro.length > 0) {
    console.log(`\nPÁGINAS NÃO LIDAS (rode de novo para completar): ${paginasComErro.join(", ")}`);
  }
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
