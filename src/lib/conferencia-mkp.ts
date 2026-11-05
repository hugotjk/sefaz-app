import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { EMPRESAS_BANIDAS } from "@/lib/identificar-produto";
import { detalhesDoXml, type ItemBase } from "@/lib/exportar-cadastro-produtos";
import { REDES_ATIVAS } from "@/lib/redes-ativas";
import { arred2, calcularPrecosModelo, modeloTemRegraDePreco } from "@/lib/precos-modelo";

export interface FiltrosConferenciaMkp {
  emitente: string;
  modelo: string;
  rede: string;
  dataInicial: string;
  dataFinal: string;
  somenteAlerta: boolean;
}

export type StatusMkp = "OK" | "ERRO" | "PRECOS_DIVERGENTES" | "AGUARDANDO_PRECO" | "EM_PROMOCAO" | "SEM_PRECO_PDV" | "SEM_PRODUTO_PDV" | "SEM_XML";

export interface VariacaoMkp {
  codigo: string;
  tamanho: string | null;
  cor: string | null;
  preco: number | null;
  promo: number | null;
}

export interface LinhaMkp {
  redeId: number | null;
  rede: string;
  variacoes: VariacaoMkp[];
  emPromocao: boolean;
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
  precosPdvDetalhe: { preco: number; qtd: number }[]; // cada preço e em quantas variações aparece
  mkpAtual: number | null; // preço no PDV / custo total
  mkpEsperado: number | null; // preço correto / custo total
  precoCorreto: number | null; // preço que deveria estar no sistema
  status: StatusMkp;
}

export interface ResultadoConferenciaMkp {
  linhas: LinhaMkp[];
  total: number;
  comAlerta: number;
  aguardandoPreco: number; // cadastrados há pouco: o preço ainda pode chegar (não é alerta)
  modelosSemRegra: string[]; // modelos com produtos cadastrados no período, mas sem regra de preço ensinada
}

export function parseFiltrosConferenciaMkp(sp: URLSearchParams): FiltrosConferenciaMkp {
  return {
    emitente: (sp.get("emitente") ?? "").trim(),
    modelo: (sp.get("modelo") ?? "").trim(),
    rede: (sp.get("rede") ?? "").trim(),
    dataInicial: (sp.get("dataInicial") ?? "").trim(),
    dataFinal: (sp.get("dataFinal") ?? "").trim(),
    somenteAlerta: sp.get("somenteAlerta") === "1",
  };
}

// Depois desse tempo sem preço no app, vira alerta (produto até 3h no app + preço até 2h depois).
export const JANELA_AGUARDANDO_PRECO_H = 6;

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

  // Produtos no PDV por (referência, modelo, rede) — o código só vale dentro da rede.
  interface Prod { redeId: number; nome: string | null; primeiro: number; vars: VariacaoMkp[] }
  const refs = [...new Set(reps.map(({ r }) => up(r.referencia)))];
  const prodsPorChave = new Map<string, Map<number, Prod>>(); // "REF|MODELO" -> rede -> produto
  const nomesRede = new Map<number, string>();
  for (const x of await prisma.redeSync.findMany()) nomesRede.set(x.id, x.nome);
  if (refs.length) {
    const pr = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT UPPER(BTRIM(p."referenciaFornecedor")) AS ref, UPPER(BTRIM(p."modeloNome")) AS modelo,
             p."redeId" AS rede, p.nome AS nome, p."primeiroSyncEm" AS primeiro,
             v.id AS vid, v.tamanho, v.cor, pv.preco::float8 AS preco, pv."precoPromocional"::float8 AS promo
      FROM "Produto" p
      LEFT JOIN "VariacaoProduto" v ON v."produtoId" = p.id
      LEFT JOIN "PrecoVariacao" pv ON pv."variacaoId" = v.id
      WHERE UPPER(BTRIM(p."referenciaFornecedor")) = ANY(${refs}::text[])
        AND p."redeId" = ANY(${REDES_ATIVAS}::int[])
    `);
    for (const x of pr) {
      const k = `${x.ref}|${x.modelo}`;
      const porRede = prodsPorChave.get(k) ?? new Map<number, Prod>();
      prodsPorChave.set(k, porRede);
      const t = new Date(x.primeiro).getTime();
      const pd = porRede.get(x.rede) ?? { redeId: x.rede, nome: x.nome?.trim() ?? null, primeiro: t, vars: [] };
      pd.primeiro = Math.min(pd.primeiro, t);
      if (x.vid) pd.vars.push({ codigo: x.vid, tamanho: x.tamanho, cor: x.cor, preco: x.preco == null ? null : arred2(x.preco), promo: x.promo ? arred2(x.promo) : null });
      porRede.set(x.rede, pd);
    }
  }

  const linhas: LinhaMkp[] = [];
  for (const { r, n } of reps) {
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
    const porRede = prodsPorChave.get(`${ref}|${up(r.modelo)}`);
    const alvos: (Prod | null)[] = porRede && porRede.size ? [...porRede.values()].sort((a, b) => a.redeId - b.redeId) : [null];

    for (const pd of alvos) {
      const vars = pd?.vars ?? [];
      const comPreco = vars.filter((v) => v.preco != null);
      const moda = (vals: number[]) => {
        const c = new Map<number, number>();
        for (const v of vals) c.set(v, (c.get(v) ?? 0) + 1);
        return c;
      };
      // Preço efetivo = promocional (se diferente de zero) senão varejo.
      const efetivos = comPreco.map((v) => (v.promo ? v.promo : (v.preco as number)));
      const contEf = moda(efetivos);
      const ordenado = [...contEf.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      const precoPdv = ordenado.length ? ordenado[0][0] : null;
      const contVarejo = moda(comPreco.map((v) => v.preco as number));
      const varejo = contVarejo.size ? [...contVarejo.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] : null;
      const emPromocao = comPreco.some((v) => v.promo);

      let status: StatusMkp;
      if (p.preco3 == null) status = p.preco2 == null ? "SEM_XML" : "OK";
      else if (!pd) status = "SEM_PRODUTO_PDV";
      else if (varejo == null) {
        const idade = Date.now() - pd.primeiro;
        status = idade < JANELA_AGUARDANDO_PRECO_H * 3600000 ? "AGUARDANDO_PRECO" : "SEM_PRECO_PDV";
      }
      else if (Math.abs(varejo - p.preco3) > 0.005) status = "ERRO";
      else if (contVarejo.size > 1) status = "PRECOS_DIVERGENTES";
      else status = emPromocao ? "EM_PROMOCAO" : "OK";

      const base = p.preco2;
      const razao = (v: number | null) => (v != null && base ? Math.round((v / base) * 100) / 100 : null);
      linhas.push({
        redeId: pd?.redeId ?? null,
        rede: pd ? (nomesRede.get(pd.redeId) ?? `Rede ${pd.redeId}`) : "—",
        variacoes: [...vars].sort((a, b) => (a.tamanho ?? "").localeCompare(b.tamanho ?? "", "pt-BR", { numeric: true }) || (a.cor ?? "").localeCompare(b.cor ?? "")),
        emPromocao,
        modelo: r.modelo,
        referencia: r.referencia,
        descricao: pd?.nome ?? r.descricao,
        emitente: r.emitente,
        nf: r.numero ?? "",
        data: r.data ? new Date(r.data).toISOString().slice(0, 10) : null,
        nNotas: n,
        custoBruto: p.preco1,
        custoTotal: p.preco2,
        precoPdv,
        precosPdvDistintos: ordenado.map((e) => e[0]).sort((a, b) => a - b),
        precosPdvDetalhe: ordenado.map(([preco, q]) => ({ preco, qtd: q })),
        mkpAtual: razao(precoPdv),
        mkpEsperado: razao(p.preco3),
        precoCorreto: p.preco3,
        status,
      });
    }
  }

  const peso: Record<StatusMkp, number> = { ERRO: 0, PRECOS_DIVERGENTES: 0, EM_PROMOCAO: 0, AGUARDANDO_PRECO: 5, SEM_PRECO_PDV: 1, SEM_PRODUTO_PDV: 2, SEM_XML: 3, OK: 4 };
  linhas.sort(
    (a, b) =>
      peso[a.status] - peso[b.status] ||
      a.modelo.localeCompare(b.modelo) ||
      a.referencia.localeCompare(b.referencia)
  );
  if (f.rede) {
    const alvo = f.rede.toUpperCase();
    for (let i = linhas.length - 1; i >= 0; i--) if (!linhas[i].rede.toUpperCase().includes(alvo)) linhas.splice(i, 1);
  }
  const aguardandoPreco = linhas.filter((l) => l.status === "AGUARDANDO_PRECO").length;
  const ehAlerta = (l: LinhaMkp) => l.status !== "OK" && l.status !== "AGUARDANDO_PRECO" && l.status !== "SEM_XML";
  const comAlerta = linhas.filter(ehAlerta).length;
  return {
    linhas: f.somenteAlerta ? linhas.filter(ehAlerta) : linhas,
    total: linhas.length,
    aguardandoPreco,
    comAlerta,
    modelosSemRegra: [...modelosSemRegra].sort(),
  };
}
