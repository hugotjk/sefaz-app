import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseNFeXml } from "@/lib/parse-nfe-xml";
import {
  identificarModelo,
  identificarReferenciaFornecedor,
} from "@/lib/identificar-produto";

export interface ResultadoPopularNota {
  itens: number;
  duplicatas: number;
}

export interface ItemParaAvaliar {
  ean: string | null | undefined;
  /** = NotaItem.referenciaFornecedorIdentificada (regra 2/3) */
  referenciaFornecedor: string | null | undefined;
  /** = NotaItem.modeloIdentificado (regra 1) */
  modelo: string | null | undefined;
}

/**
 * Decide `temCadastro` de cada item seguindo o processo manual do cliente:
 *
 *   1. Acha uma `VariacaoProduto` cujo `ean` bate com o EAN do item; se não
 *      achar, acha um `Produto` cujo (`referenciaFornecedor` + `modeloNome`)
 *      bate com (referência do fornecedor identificada + modelo identificado),
 *      comparação case-insensitive (igual ao "=" do Excel usado nas regras).
 *   2. Só conta como CADASTRADO se a variação encontrada (ou alguma variação
 *      do produto encontrado) tiver `PrecoVariacao` com `preco > 0`. Variação
 *      sem preço (ou preço zerado) => NÃO cadastrado.
 *
 * SIMPLIFICAÇÃO TEMPORÁRIA: a busca por referência+modelo NÃO filtra por Rede.
 * O cliente cruza Referência+Modelo+Rede no Excel dele, mas não há hoje uma
 * ponte confiável entre `LojaReferencia.rede` (nomes: "MULTI"/"FLUMINENSE"/…)
 * e `Produto.redeId` (números): a tabela `RedeSync` tem nomes duplicados
 * (FLUMINENSE = id 9 e 10; LACOSTE = 15 e 16) e há valores de
 * `LojaReferencia.rede` sem nenhuma entrada em `RedeSync` (MARACANA,
 * ESCRITORIO, NUVEM, …). Na prática 98%+ dos itens são da rede MULTI e o
 * catálogo é 94% MULTI, então o risco de falso-positivo por omitir a rede é
 * baixo. Reavaliar quando/se a fonte da Rede ficar confiável.
 *
 * Compartilhada entre a criação do item (`popularNotaItens`) e a reavaliação
 * periódica (`reavaliarCadastroNotaItens` no Inngest). Retorna um boolean por
 * item, na MESMA ordem da entrada.
 */
export async function avaliarCadastroItens(
  itens: ItemParaAvaliar[]
): Promise<boolean[]> {
  // ---- Path A: EAN -> VariacaoProduto ----
  const eans = [...new Set(itens.map((i) => i.ean).filter((e): e is string => !!e))];
  const varsPorEan = eans.length
    ? await prisma.variacaoProduto.findMany({
        where: { ean: { in: eans } },
        select: { id: true, ean: true },
      })
    : [];

  // ---- Path B: (referência + modelo) case-insensitive -> Produto ----
  const norm = (v: string | null | undefined) => v?.trim().toUpperCase() || "";
  const refsU = [...new Set(itens.map((i) => norm(i.referenciaFornecedor)).filter(Boolean))];
  const modsU = [...new Set(itens.map((i) => norm(i.modelo)).filter(Boolean))];
  const prods =
    refsU.length && modsU.length
      ? await prisma.$queryRaw<{ id: string; ref: string; modelo: string }[]>(Prisma.sql`
          SELECT id,
                 upper(trim("referenciaFornecedor")) AS ref,
                 upper(trim("modeloNome"))           AS modelo
          FROM "Produto"
          WHERE upper(trim("referenciaFornecedor")) IN (${Prisma.join(refsU)})
            AND upper(trim("modeloNome"))           IN (${Prisma.join(modsU)})
        `)
      : [];
  const paresProd = new Map<string, string[]>(); // chave JSON([REF, MODELO]) -> produtoIds
  for (const p of prods) {
    const k = JSON.stringify([p.ref, p.modelo]);
    const arr = paresProd.get(k) ?? [];
    arr.push(p.id);
    paresProd.set(k, arr);
  }
  const prodIds = prods.map((p) => p.id);
  const varsPorProd = prodIds.length
    ? await prisma.variacaoProduto.findMany({
        where: { produtoId: { in: prodIds } },
        select: { id: true, produtoId: true },
      })
    : [];

  // ---- Preço > 0 das variações candidatas dos dois paths ----
  const varIds = [...new Set([...varsPorEan.map((v) => v.id), ...varsPorProd.map((v) => v.id)])];
  const comPreco = varIds.length
    ? new Set(
        (
          await prisma.precoVariacao.findMany({
            where: { variacaoId: { in: varIds }, preco: { gt: 0 } },
            select: { variacaoId: true },
          })
        ).map((p) => p.variacaoId)
      )
    : new Set<string>();

  const eansOk = new Set(
    varsPorEan.filter((v) => comPreco.has(v.id)).map((v) => v.ean!).filter(Boolean)
  );
  const prodComPreco = new Set(
    varsPorProd.filter((v) => comPreco.has(v.id)).map((v) => v.produtoId)
  );
  const paresOk = new Set(
    [...paresProd.entries()]
      .filter(([, ids]) => ids.some((id) => prodComPreco.has(id)))
      .map(([k]) => k)
  );

  return itens.map((i) => {
    if (i.ean && eansOk.has(i.ean)) return true;
    const ref = norm(i.referenciaFornecedor);
    const mod = norm(i.modelo);
    return !!ref && !!mod && paresOk.has(JSON.stringify([ref, mod]));
  });
}

/**
 * A partir do XML completo de uma nota, (re)cria as linhas `NotaItem` E
 * `NotaDuplicata`: apaga as existentes daquela nota e insere de novo.
 * NotaItem já vem com `modelo`, `referenciaFornecedor` e `temCadastro`.
 *
 * Retorna a contagem de itens e duplicatas gravados (ambos 0 se o XML não
 * for interpretável).
 */
export async function popularNotaItens(
  noteId: string,
  xml: string
): Promise<ResultadoPopularNota> {
  let nfe;
  try {
    nfe = parseNFeXml(xml);
  } catch {
    return { itens: 0, duplicatas: 0 };
  }

  const emitente = nfe.emitente.nome || "";
  const infCpl = nfe.informacoesComplementares || "";
  const itens = nfe.itens;

  // ---- Duplicatas ----
  const dups = (nfe.duplicatas ?? [])
    .map((d) => {
      const venc = new Date(d.vencimento);
      return {
        numero: String(d.numero ?? ""),
        vencimento: venc,
        valor: d.valor && d.valor !== "" ? d.valor : "0",
        _ok: !isNaN(venc.getTime()),
      };
    })
    .filter((d) => d._ok)
    .map(({ _ok, ...rest }) => ({ noteId, ...rest }));

  // ---- Itens ----
  if (itens.length === 0) {
    await prisma.$transaction([
      prisma.notaItem.deleteMany({ where: { noteId } }),
      prisma.notaDuplicata.deleteMany({ where: { noteId } }),
      ...(dups.length ? [prisma.notaDuplicata.createMany({ data: dups })] : []),
    ]);
    return { itens: 0, duplicatas: dups.length };
  }

  const dados = itens.map((it) => {
    const modelo = identificarModelo(emitente, it.codigo, it.descricao);
    const ref = identificarReferenciaFornecedor(emitente, it.codigo, it.descricao, infCpl);
    return {
      noteId,
      codigoProduto: it.codigo,
      descricao: it.descricao,
      ean: it.ean || null,
      ncm: it.ncm || null,
      cfop: it.cfop || null,
      quantidade: it.quantidade || "0",
      valorUnitario: it.valorUnitario || "0",
      valorTotal: it.valorTotal || "0",
      modeloIdentificado: modelo,
      referenciaFornecedorIdentificada: ref.valor,
      referenciaComRegraEspecifica: ref.comRegraEspecifica,
      temCadastro: false, // preenchido logo abaixo (EAN ou ref+modelo, + preço)
    };
  });

  // temCadastro: EAN OU (referência + modelo), sempre com preço > 0.
  const flags = await avaliarCadastroItens(
    dados.map((d) => ({
      ean: d.ean,
      referenciaFornecedor: d.referenciaFornecedorIdentificada,
      modelo: d.modeloIdentificado,
    }))
  );
  dados.forEach((d, i) => {
    d.temCadastro = flags[i];
  });

  await prisma.$transaction([
    prisma.notaItem.deleteMany({ where: { noteId } }),
    prisma.notaDuplicata.deleteMany({ where: { noteId } }),
    prisma.notaItem.createMany({ data: dados }),
    ...(dups.length ? [prisma.notaDuplicata.createMany({ data: dups })] : []),
  ]);

  return { itens: dados.length, duplicatas: dups.length };
}
