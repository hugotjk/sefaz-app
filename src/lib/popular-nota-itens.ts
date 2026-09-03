import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseNFeXml } from "@/lib/parse-nfe-xml";
import {
  identificarModelo,
  identificarReferenciaFornecedor,
  EMPRESAS_THUG_DUBS,
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
  /** = Note.emitenteNome — decide igualdade x prefixo na comparação de referência */
  emitente?: string | null;
}

// Emitentes cuja referência no catálogo é "8dígitos-2dígitos" (ex "80405235-03")
// mas na nota só traz os 8 primeiros ("80405235"): a comparação de referência
// é por PREFIXO (primeiros 8 dígitos), não igualdade. Os 8 dígitos são únicos
// por produto, então não há ambiguidade.
const EMPRESAS_REF_PREFIXO = new Set(
  EMPRESAS_THUG_DUBS.map((n) => n.toUpperCase())
);

/**
 * Decide `temCadastro` de cada item seguindo o processo manual do cliente:
 *
 *   1. Acha uma `VariacaoProduto` cujo `ean` bate com o EAN do item; se não
 *      achar, acha um `Produto` cujo (`referenciaFornecedor` + `modeloNome`)
 *      bate com (referência do fornecedor identificada + modelo identificado).
 *      Referência: case-insensitive IGUAL, exceto para o grupo
 *      EMPRESAS_REF_PREFIXO (Thug Nine/Dubs/Brotherhood), onde casa por
 *      PREFIXO de 8 dígitos (o catálogo guarda "8díg-2díg" e a nota só os 8).
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

  // ---- Path B: (referência + modelo) -> Produto ----
  // Regra geral: referência case-insensitive IGUAL. Exceção (grupo
  // EMPRESAS_REF_PREFIXO): referência casa por PREFIXO de 8 dígitos.
  const norm = (v: string | null | undefined) => v?.trim().toUpperCase() || "";
  const digitos8 = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(0, 8);
  const usaPrefixo = (emit: string | null | undefined) =>
    !!emit && EMPRESAS_REF_PREFIXO.has(emit.trim().toUpperCase());

  const modsU = [...new Set(itens.map((i) => norm(i.modelo)).filter(Boolean))];
  const refsExato = [
    ...new Set(
      itens.filter((i) => !usaPrefixo(i.emitente)).map((i) => norm(i.referenciaFornecedor)).filter(Boolean)
    ),
  ];
  const refsPrefixo = [
    ...new Set(
      itens.filter((i) => usaPrefixo(i.emitente)).map((i) => digitos8(i.referenciaFornecedor)).filter(Boolean)
    ),
  ];

  // chave = JSON(["EXACT"|"PREFIX", <ref>, <modelo>]) -> produtoIds
  const paresProd = new Map<string, string[]>();
  const addPar = (chave: string, id: string) => {
    const arr = paresProd.get(chave) ?? [];
    arr.push(id);
    paresProd.set(chave, arr);
  };

  if (modsU.length && refsExato.length) {
    const r = await prisma.$queryRaw<{ id: string; ref: string; modelo: string }[]>(Prisma.sql`
      SELECT id,
             upper(trim("referenciaFornecedor")) AS ref,
             upper(trim("modeloNome"))           AS modelo
      FROM "Produto"
      WHERE upper(trim("referenciaFornecedor")) IN (${Prisma.join(refsExato)})
        AND upper(trim("modeloNome"))           IN (${Prisma.join(modsU)})
    `);
    for (const p of r) addPar(JSON.stringify(["EXACT", p.ref, p.modelo]), p.id);
  }
  if (modsU.length && refsPrefixo.length) {
    const r = await prisma.$queryRaw<{ id: string; pref: string; modelo: string }[]>(Prisma.sql`
      SELECT id,
             left(regexp_replace("referenciaFornecedor", '[^0-9]', '', 'g'), 8) AS pref,
             upper(trim("modeloNome"))                                          AS modelo
      FROM "Produto"
      WHERE left(regexp_replace("referenciaFornecedor", '[^0-9]', '', 'g'), 8) IN (${Prisma.join(refsPrefixo)})
        AND upper(trim("modeloNome"))                                          IN (${Prisma.join(modsU)})
    `);
    for (const p of r) addPar(JSON.stringify(["PREFIX", p.pref, p.modelo]), p.id);
  }

  const prodIds = [...new Set([...paresProd.values()].flat())];
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
    const mod = norm(i.modelo);
    if (!mod) return false;
    if (usaPrefixo(i.emitente)) {
      const pref = digitos8(i.referenciaFornecedor);
      return !!pref && paresOk.has(JSON.stringify(["PREFIX", pref, mod]));
    }
    const ref = norm(i.referenciaFornecedor);
    return !!ref && paresOk.has(JSON.stringify(["EXACT", ref, mod]));
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
      emitente,
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
