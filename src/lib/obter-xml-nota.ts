import { prisma } from "@/lib/db";
import { decryptCertificate } from "@/lib/crypto";
import { consultarPorChave } from "@/lib/sefaz";
import { parseNFeXml } from "@/lib/parse-nfe-xml";

export type ResultadoXmlNota = { xml: string } | { erro: string; status: number };

/**
 * Retorna o XML completo (procNFe) de uma nota.
 *  - Se já está em cache no banco (`Note.xmlCompleto` preenchido), devolve
 *    direto SEM bater na SEFAZ.
 *  - Senão, consulta a SEFAZ por chave, salva no banco (e completa
 *    número/série, best-effort) e devolve.
 *
 * Usado pelas rotas /xml, /download-xml e /download-pdf pra garantir o mesmo
 * comportamento de cache nas três.
 */
export async function obterXmlNota(chave: string): Promise<ResultadoXmlNota> {
  const nota = await prisma.note.findUnique({
    where: { chaveAcesso: chave },
    include: { certificate: true },
  });

  if (!nota) return { erro: "Nota não encontrada.", status: 404 };

  // Cache: XML já salvo -> usa o do banco, sem nova consulta à SEFAZ.
  if (nota.xmlCompleto) return { xml: nota.xmlCompleto };

  try {
    const { pfxBase64, password } = decryptCertificate(nota.certificate);
    const pfxBuffer = Buffer.from(pfxBase64, "base64");

    const resultado = await consultarPorChave({
      chaveAcesso: nota.chaveAcesso,
      cnpj: nota.cnpjDestino,
      pfxBuffer,
      senha: password,
    });

    if ("erro" in resultado) {
      return {
        erro: `SEFAZ não retornou o XML completo desta nota. Motivo (cStat ${resultado.statusCode}): ${resultado.erro}`,
        status: 502,
      };
    }

    // Completa número/série (a consulta resumida não trazia). Best-effort:
    // se o XML não puder ser interpretado, ainda assim guardamos o XML cru.
    let numero = nota.numero;
    let serie = nota.serie;
    try {
      const nfe = parseNFeXml(resultado.xmlCompleto);
      numero = nfe.numero || numero;
      serie = nfe.serie || serie;
    } catch {
      // ignora — só não completa numero/serie
    }

    await prisma.note.update({
      where: { id: nota.id },
      data: { xmlCompleto: resultado.xmlCompleto, numero, serie },
    });

    return { xml: resultado.xmlCompleto };
  } catch (err: any) {
    return { erro: err?.message ?? "Erro ao consultar a SEFAZ.", status: 500 };
  }
}
