/**
 * ESTUDO SOMENTE-LEITURA (não grava nada) das regras de TAMANHO (port da
 * fórmula do Excel, em src/lib/identificar-tamanho.ts):
 *   1. ACERTO: para itens de nota cujo EAN já existe no PDV com tamanho
 *      preenchido, compara o tamanho calculado com o do PDV (por emitente).
 *   2. COBERTURA: nos itens dos últimos 90 dias, quanto vira tamanho e quais
 *      fornecedores ainda NÃO têm regra (a aprender), com exemplo de linha.
 *
 *   npx tsx --env-file=.env scripts/estudo-tamanhos.ts
 */
import { PrismaClient } from "@prisma/client";
import { identificarTamanho, temRegraTamanho } from "../src/lib/identificar-tamanho";

const prisma = new PrismaClient();
const LIMPA = (c: string) => `regexp_replace(${c}, '[^[:print:]]', ' ', 'g')`;
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "—");
const norm = (t: string | null | undefined) => (t ?? "").trim().toUpperCase();

async function main() {
  const itens = await prisma.$queryRawUnsafe<
    {
      emit: string | null; modelo: string | null; codigo: string; descricao: string;
      inf: string | null; ref: string | null; ean: string | null; recente: boolean; tam_pdv: string | null;
    }[]
  >(`
    SELECT n."emitenteNome" AS emit, i."modeloIdentificado" AS modelo,
           ${LIMPA('i."codigoProduto"')} AS codigo, ${LIMPA("i.descricao")} AS descricao,
           ${LIMPA('left(i."infAdProd", 500)')} AS inf,
           i."referenciaFornecedorIdentificada" AS ref, i.ean,
           (n."dataEmissao" >= now() - interval '90 days') AS recente,
           (SELECT v.tamanho FROM "VariacaoProduto" v
             WHERE i.ean IS NOT NULL AND i.ean <> '' AND v.ean = i.ean AND v.tamanho IS NOT NULL AND v.tamanho <> '' LIMIT 1) AS tam_pdv
    FROM "NotaItem" i JOIN "Note" n ON n.id = i."noteId"
    WHERE n."dataEmissao" >= now() - interval '365 days'`);
  console.log(`Itens analisados (últimos 365 dias): ${itens.length}\n`);

  type Ac = { n: number; comRegra: number; calculou: number; comPdv: number; acertou: number; erros: string[] };
  const porEmit = new Map<string, Ac>();
  const semRegra = new Map<string, { n: number; ex: string }>();

  for (const it of itens) {
    const emit = it.emit ?? "(sem emitente)";
    const entrada = {
      emitente: emit, modelo: it.modelo, codigo: it.codigo ?? "", descricao: it.descricao ?? "",
      ean: it.ean, infAdProd: it.inf, referencia: it.ref,
    };
    const regra = temRegraTamanho({ emitente: emit, modelo: it.modelo });
    const calc = regra ? identificarTamanho(entrada) : null;

    const a = porEmit.get(emit) ?? { n: 0, comRegra: 0, calculou: 0, comPdv: 0, acertou: 0, erros: [] };
    a.n++;
    if (regra) a.comRegra++;
    if (calc) a.calculou++;
    if (it.tam_pdv) {
      a.comPdv++;
      if (calc && norm(calc) === norm(it.tam_pdv)) a.acertou++;
      else if (a.erros.length < 3) a.erros.push(`calc="${calc ?? ""}" pdv="${it.tam_pdv}" cód="${(it.codigo ?? "").slice(0, 22)}" desc="${(it.descricao ?? "").slice(-30)}"`);
    }
    porEmit.set(emit, a);

    if (it.recente && !regra) {
      const s = semRegra.get(emit) ?? { n: 0, ex: `cód="${(it.codigo ?? "").slice(0, 24)}"  desc="${(it.descricao ?? "").slice(0, 60)}"  info="${(it.inf ?? "").slice(0, 40)}"` };
      s.n++;
      semRegra.set(emit, s);
    }
  }

  console.log("==================== 1. ACERTO vs TAMANHO DO PDV (só onde o PDV tem o tamanho do EAN) ====================");
  const comPdv = [...porEmit.entries()].filter(([, a]) => a.comRegra > 0 && a.comPdv > 0).sort((x, y) => y[1].comPdv - x[1].comPdv);
  if (!comPdv.length) console.log("  (nenhum emitente com regra teve EAN encontrado no PDV com tamanho — o PDV ainda tem poucos EANs preenchidos)");
  for (const [e, a] of comPdv) {
    console.log(`  ${e.slice(0, 44).padEnd(44)} comparáveis=${String(a.comPdv).padStart(5)}  acerto=${pct(a.acertou, a.comPdv).padStart(4)}`);
    if (a.acertou < a.comPdv) a.erros.forEach((x) => console.log(`        ✗ ${x}`));
  }

  console.log("\n==================== 2. COBERTURA — fornecedores COM regra: % de itens com tamanho calculado ====================");
  for (const [e, a] of [...porEmit.entries()].filter(([, v]) => v.comRegra > 0).sort((x, y) => y[1].n - x[1].n).slice(0, 40)) {
    console.log(`  ${e.slice(0, 44).padEnd(44)} itens=${String(a.n).padStart(6)}  calculou=${pct(a.calculou, a.comRegra).padStart(4)}`);
  }

  console.log("\n==================== 3. A APRENDER — fornecedores SEM regra de tamanho (últimos 90 dias) ====================");
  for (const [e, s] of [...semRegra.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, 50)) {
    console.log(`  ${e.slice(0, 50).padEnd(50)} itens=${String(s.n).padStart(5)}`);
    console.log(`       ex.: ${s.ex}`);
  }
  console.log("\nFim. Nada foi gravado.");
}

main()
  .catch((e) => { console.error("Falhou:", String(e?.message ?? e).slice(0, 400)); process.exit(1); })
  .finally(() => prisma.$disconnect());
