import { prisma } from "@/lib/db";
import { parseNFeXml } from "@/lib/parse-nfe-xml";
import {
  identificarModelo,
  identificarReferenciaFornecedor,
} from "@/lib/identificar-produto";

/**
 * A partir do XML completo de uma nota, (re)cria as linhas `NotaItem`:
 * apaga as existentes daquela nota e insere de novo, já com `modelo`,
 * `referenciaFornecedor` e `temCadastro` (EAN encontrado no catálogo).
 *
 * Retorna quantos itens foram gravados (0 se o XML não for interpretável).
 */
export async function popularNotaItens(noteId: string, xml: string): Promise<number> {
  let nfe;
  try {
    nfe = parseNFeXml(xml);
  } catch {
    return 0;
  }

  const emitente = nfe.emitente.nome || "";
  const infCpl = nfe.informacoesComplementares || "";
  const itens = nfe.itens;

  if (itens.length === 0) {
    await prisma.notaItem.deleteMany({ where: { noteId } });
    return 0;
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
    prisma.notaItem.createMany({ data: dados }),
  ]);

  return dados.length;
}
