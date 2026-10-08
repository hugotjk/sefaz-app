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
import { identificarTamanho, temRegraTamanho, tamanhoGenerico, canonicalizarTamanho } from "../src/lib/identificar-tamanho";

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

  type Ac = {
    n: number; regra: boolean; calculou: number; comPdv: number; acertou: number;
    pares: Map<string, number>; ex: string;
  };
  const porEmit = new Map<string, Ac>();

  for (const it of itens) {
    const emit = it.emit ?? "(sem emitente)";
    const entrada = {
      emitente: emit, modelo: it.modelo, codigo: it.codigo ?? "", descricao: it.descricao ?? "",
      ean: it.ean, infAdProd: it.inf, referencia: it.ref,
    };
    const regra = temRegraTamanho({ emitente: emit, modelo: it.modelo });
    let calc: string | null = regra ? identificarTamanho(entrada) : null;
    if (!calc) calc = tamanhoGenerico(entrada); // sem regra (ou regra sem resultado): genérica

    const a = porEmit.get(emit) ?? {
      n: 0, regra, calculou: 0, comPdv: 0, acertou: 0, pares: new Map<string, number>(),
      ex: `cód="${(it.codigo ?? "").slice(0, 24)}"  desc="${(it.descricao ?? "").slice(0, 60)}"  info="${(it.inf ?? "").slice(0, 30)}"`,
    };
    a.n++;
    if (calc) a.calculou++;
    if (it.tam_pdv) {
      a.comPdv++;
      if (calc && canonicalizarTamanho(calc) === canonicalizarTamanho(it.tam_pdv)) a.acertou++;
      else {
        const k = `${calc ?? "∅"}  →  PDV ${it.tam_pdv}`;
        a.pares.set(k, (a.pares.get(k) ?? 0) + 1);
      }
    }
    porEmit.set(emit, a);
  }

  const linha = (e: string, a: Ac) =>
    `  ${e.slice(0, 44).padEnd(44)} itens=${String(a.n).padStart(6)}  achou tamanho=${pct(a.calculou, a.n).padStart(4)}  comparáveis=${String(a.comPdv).padStart(5)}  acerto=${pct(a.acertou, a.comPdv).padStart(4)}`;

  console.log("==================== 1. COM REGRA da fórmula (acerto comparado ao tamanho do PDV; S/M/L e P/M/G contam como iguais) ====================");
  const comRegra = [...porEmit.entries()].filter(([, a]) => a.regra).sort((x, y) => y[1].n - x[1].n);
  for (const [e, a] of comRegra) {
    console.log(linha(e, a));
    if (a.comPdv > 0 && a.acertou < a.comPdv) {
      [...a.pares.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).forEach(([k, n]) => console.log(`        ✗ ${String(n).padStart(4)}x  ${k}`));
    }
  }

  console.log("\n==================== 2. SEM REGRA — regra GENÉRICA (últimos 365 dias; 'acerto' só onde o PDV conhece o EAN) ====================");
  const sem = [...porEmit.entries()].filter(([, a]) => !a.regra).sort((x, y) => y[1].n - x[1].n).slice(0, 50);
  for (const [e, a] of sem) {
    console.log(linha(e, a));
    console.log(`        ex.: ${a.ex}`);
    if (a.comPdv > 0 && a.acertou < a.comPdv) {
      [...a.pares.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).forEach(([k, n]) => console.log(`        ✗ ${String(n).padStart(4)}x  ${k}`));
    }
  }
  console.log("\nFim. Nada foi gravado.");
}

main()
  .catch((e) => { console.error("Falhou:", String(e?.message ?? e).slice(0, 400)); process.exit(1); })
  .finally(() => prisma.$disconnect());
