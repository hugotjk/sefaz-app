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

  // EANs (não vazios) que já existem no catálogo (VariacaoProduto.ean).
  const eans = [...new Set(itens.map((i) => i.ean).filter((e) => !!e))];
  const comCadastro = eans.length
    ? new Set(
        (
          await prisma.variacaoProduto.findMany({
            where: { ean: { in: eans } },
            select: { ean: true },
          })
        )
          .map((v) => v.ean)
          .filter((e): e is string => !!e)
      )
    : new Set<string>();

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
      temCadastro: it.ean ? comCadastro.has(it.ean) : false,
    };
  });

  await prisma.$transaction([
    prisma.notaItem.deleteMany({ where: { noteId } }),
    prisma.notaDuplicata.deleteMany({ where: { noteId } }),
    prisma.notaItem.createMany({ data: dados }),
    ...(dups.length ? [prisma.notaDuplicata.createMany({ data: dups })] : []),
  ]);

  return { itens: dados.length, duplicatas: dups.length };
}
