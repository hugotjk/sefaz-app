import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { EMPRESAS_BANIDAS } from "@/lib/identificar-produto";
import { detalhesDoXml, type ItemBase } from "@/lib/exportar-cadastro-produtos";
import { arred2, calcularPrecosModelo, modeloTemRegraDePreco } from "@/lib/precos-modelo";

export interface FiltrosConferenciaMkp {
  emitente: string;
  modelo: string;
  dataInicial: string;
  dataFinal: string;
  somenteAlerta: boolean;
}

export type StatusMkp = "OK" | "ERRO" | "SEM_PRECO_PDV" | "SEM_PRODUTO_PDV" | "SEM_XML";

export interface LinhaMkp {
  modelo: string;
  referencia: string;
  descricao: string;
  emitente: string;
  nf: string; // nota usada no custo
  data: string | null;
  nNotas: number;
  custoBruto: number | null; // Preço 1 (da nota)
  custoTotal: number | null; // Preço 2 (desconto, IPI e ST)
  precoPdv: number | null; // preço que está no sistema
  precosPdvDistintos: number[];
  mkpAtual: number | null; // preço no PDV / custo total
  mkpEsperado: number | null; // preço correto / custo total
  precoCorreto: number | null; // preço que deveria estar no sistema
  status: StatusMkp;
}

export interface ResultadoConferenciaMkp {
  linhas: LinhaMkp[];
  total: number;
  comAlerta: number;
  modelosSemRegra: string[]; // modelos com produtos cadastrados no período, mas sem regra de preço ensinada
}

export function parseFiltrosConferenciaMkp(sp: URLSearchParams): FiltrosConferenciaMkp {
  return {
    emitente: (sp.get("emitente") ?? "").trim(),
    modelo: (sp.get("modelo") ?? "").trim(),
    dataInicial: (sp.get("dataInicial") ?? "").trim(),
    dataFinal: (sp.get("dataFinal") ?? "").trim(),
    somenteAlerta: sp.get("somenteAlerta") === "1",
  };
}

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

export async function montarConferenciaMkp(f: FiltrosConferenciaMkp): Promise<ResultadoConferenciaMkp> {
  const gte = f.dataInicial ? new Date(`${f.dataInicial}T00:00:00.000Z`) : null;
  const lte = f.dataFinal ? new Date(`${f.dataFinal}T23:59:59.999Z`) : null;
  const fGte = gte && !Number.isNaN(gte.getTime()) ? Prisma.sql`AND n."dataEmissao" >= ${gte}` : Prisma.empty;
  const fLte = lte && !Number.isNaN(lte.getTime()) ? Prisma.sql`AND n."dataEmissao" <= ${lte}` : Prisma.empty;
  const fEmit = f.emitente ? Prisma.sql`AND n."emitenteNome" ILIKE ${"%" + f.emitente + "%"}` : Prisma.empty;
  const fModelo = f.modelo ? Prisma.sql`AND i."modeloIdentificado" ILIKE ${"%" + f.modelo + "%"}` : Prisma.empty;
  const fBan = EMPRESAS_BANIDAS.length
    ? Prisma.sql`AND (n."emitenteNome" IS NULL OR n."emitenteNome" NOT IN (${Prisma.join(EMPRESAS_BANIDAS)}))`
    : Prisma.empty;

  // Itens JÁ cadastrados (temCadastro) com modelo e referência por regra.
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT i.id, i."noteId" AS note_id,
           regexp_replace(i."codigoProduto", '[^[:print:]]', ' ', 'g') AS codigo,
           regexp_replace(i."descricao", '[^[:print:]]', ' ', 'g') AS descricao,
           i.ean, i.ncm,
           i.quantidade::float8 AS qtd, i."valorUnitario"::float8 AS vun, i."valorTotal"::float8 AS vtot,
           i."modeloIdentificado" AS modelo, i."referenciaFornecedorIdentificada" AS referencia,
           regexp_replace(COALESCE(n."emitenteNome", ''), '[^[:print:]]', ' ', 'g') AS emitente,
           n.numero AS numero, n."dataEmissao" AS data
    FROM "NotaItem" i
    JOIN "Note" n ON n.id = i."noteId"
    WHERE i."temCadastro" = true
      AND i."modeloIdentificado" IS NOT NULL
      AND i."referenciaFornecedorIdentificada" IS NOT NULL
      AND i."referenciaComRegraEspecifica" = true
      ${fGte} ${fLte} ${fEmit} ${fModelo} ${fBan}
    ORDER BY n."dataEmissao" DESC NULLS LAST, i.id
  `);

  const modelosSemRegra = new Set<string>();
  const grupos = new Map<string, any[]>();
  for (const r of rows) {
    if (!modeloTemRegraDePreco(r.modelo)) {
      modelosSemRegra.add(r.modelo);
      continue;
    }
    const k = JSON.stringify([r.modelo, r.referencia]);
    const l = grupos.get(k) ?? [];
    l.push(r);
    grupos.set(k, l);
  }

  // Item representativo de cada grupo: o mais recente (New Balance: o custo mais comum).
  const reps: { r: any; n: number }[] = [];
  for (const [, lista] of grupos) {
    let rep = lista[0];
    if (up(rep.modelo) === "NEW BALANCE" && lista.length > 1) {
      const cont = new Map<number, number>();
      for (const i of lista) {
        const k = Math.round(i.vun * 100);
        cont.set(k, (cont.get(k) ?? 0) + 1);
      }
      const [melhor] = [...cont.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
      rep = lista.find((i) => Math.round(i.vun * 100) === melhor) ?? lista[0];
    }
    reps.push({ r: rep, n: new Set(lista.map((i) => i.note_id)).size });
  }

  const itensBase: ItemBase[] = reps.map(({ r }) => ({
    id: r.id,
    noteId: r.note_id,
    codigo: r.codigo ?? "",
    descricao: r.descricao ?? "",
    ean: r.ean,
    ncm: r.ncm,
    infAdProd: null,
    quantidade: Number(r.qtd),
    valorUnitario: Number(r.vun),
    valorTotal: Number(r.vtot),
    modelo: r.modelo,
    referencia: r.referencia,
    emitente: r.emitente || null,
    data: r.data,
  }));
  const detalhes = itensBase.length ? await detalhesDoXml(itensBase) : new Map();

  // Preços que estão no PDV, por referência do fornecedor.
  const refs = [...new Set(reps.map(({ r }) => up(r.referencia)))];
  const precosPdv = new Map<string, number[]>();
  const achouProduto = new Set<string>();
  const nomePdv = new Map<string, string>();
  if (refs.length) {
    const pr = await prisma.$queryRaw<{ ref: string; nome: string | null; preco: number | null }[]>(Prisma.sql`
      SELECT UPPER(BTRIM(p."referenciaFornecedor")) AS ref, p.nome AS nome, pv.preco::float8 AS preco
      FROM "Produto" p
      LEFT JOIN "VariacaoProduto" v ON v."produtoId" = p.id
      LEFT JOIN "PrecoVariacao" pv ON pv."variacaoId" = v.id
      WHERE UPPER(BTRIM(p."referenciaFornecedor")) = ANY(${refs}::text[])
    `);
    for (const x of pr) {
      achouProduto.add(x.ref);
      if (x.nome && !nomePdv.has(x.ref)) nomePdv.set(x.ref, x.nome.trim());
      if (x.preco == null) continue;
      const l = precosPdv.get(x.ref) ?? [];
      l.push(arred2(Number(x.preco)));
      precosPdv.set(x.ref, l);
    }
  }

  const linhas: LinhaMkp[] = reps.map(({ r, n }) => {
    const det = detalhes.get(r.id);
    const qtd = Number(r.qtd) || 1;
    const custoUn = Number(r.vun);
    const custoTotUn = det ? (Number(r.vtot) - det.desconto + det.ipi + det.icmsSt) / qtd : null;
    const p = calcularPrecosModelo({
      modelo: r.modelo,
      emitente: r.emitente,
      referencia: r.referencia,
      descricao: r.descricao,
      custoUn,
      custoTotUn,
    });
    const ref = up(r.referencia);
    const lista = precosPdv.get(ref) ?? [];
    // Preço "do sistema" = o mais comum entre as variações (empate: o menor).
    const cont = new Map<number, number>();
    for (const v of lista) cont.set(v, (cont.get(v) ?? 0) + 1);
    const precoPdv = lista.length
      ? [...cont.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
      : null;
    const distintos = [...cont.keys()].sort((a, b) => a - b);

    let status: StatusMkp;
    if (p.preco3 == null) status = p.preco2 == null ? "SEM_XML" : "OK";
    else if (!achouProduto.has(ref)) status = "SEM_PRODUTO_PDV";
    else if (precoPdv == null) status = "SEM_PRECO_PDV";
    else status = Math.abs(precoPdv - p.preco3) > 0.005 || distintos.length > 1 ? "ERRO" : "OK";

    const base = p.preco2;
    const razao = (v: number | null) => (v != null && base ? Math.round((v / base) * 100) / 100 : null);
    return {
      modelo: r.modelo,
      referencia: r.referencia,
      descricao: nomePdv.get(ref) ?? r.descricao,
      emitente: r.emitente,
      nf: r.numero ?? "",
      data: r.data ? new Date(r.data).toISOString().slice(0, 10) : null,
      nNotas: n,
      custoBruto: p.preco1,
      custoTotal: p.preco2,
      precoPdv,
      precosPdvDistintos: distintos,
      mkpAtual: razao(precoPdv),
      mkpEsperado: razao(p.preco3),
      precoCorreto: p.preco3,
      status,
    };
  });

  const peso: Record<StatusMkp, number> = { ERRO: 0, SEM_PRECO_PDV: 1, SEM_PRODUTO_PDV: 2, SEM_XML: 3, OK: 4 };
  linhas.sort(
    (a, b) =>
      peso[a.status] - peso[b.status] ||
      a.modelo.localeCompare(b.modelo) ||
      a.referencia.localeCompare(b.referencia)
  );
  const ehAlerta = (l: LinhaMkp) => l.status !== "OK" && l.status !== "SEM_PRECO_PDV" && l.status !== "SEM_XML";
  const comAlerta = linhas.filter(ehAlerta).length;
  return {
    linhas: f.somenteAlerta ? linhas.filter(ehAlerta) : linhas,
    total: linhas.length,
    comAlerta,
    modelosSemRegra: [...modelosSemRegra].sort(),
  };
}
