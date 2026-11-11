import { prisma } from "@/lib/db";
import { decryptCertificate } from "@/lib/crypto";
import { assinarNFe } from "@/lib/nfe-assinatura";
import { CNPJ_CONTADOR_PADRAO, lerNotaOriginal, montarDevolucao } from "@/lib/nfe-devolucao";
import {
  autorizarNFe, consultarChaveNFe, montarNfeProc, statusServico,
  type Ambiente, type RetornoAutorizacao,
} from "@/lib/nfe-sefaz";

/** Produção só com EMISSOR_NFE_PRODUCAO=1 no ambiente do servidor. */
export const PRODUCAO_LIBERADA = process.env.EMISSOR_NFE_PRODUCAO === "1";

export async function carregarCertificado(cnpj: string) {
  const cert = await prisma.certificate.findUnique({ where: { cnpj } });
  if (!cert) throw new Error("Esta loja não tem certificado cadastrado.");
  if (cert.validUntil && cert.validUntil.getTime() < Date.now()) throw new Error("O certificado desta loja está vencido.");
  const { pfxBase64, password } = decryptCertificate(cert);
  return { pfx: pfxBase64, senha: password };
}

export async function testarConexao(lojaCnpj: string, ambiente: Ambiente) {
  const loja = await prisma.emissorLoja.findUnique({ where: { cnpj: lojaCnpj } });
  if (!loja?.codMunicipio) throw new Error("Loja não encontrada.");
  const { pfx, senha } = await carregarCertificado(lojaCnpj);
  return statusServico(ambiente, loja.codMunicipio.slice(0, 2), pfx, senha);
}

function statusDoRetorno(r: RetornoAutorizacao): "AUTORIZADA" | "DENEGADA" | "REJEITADA" {
  if (["100", "150"].includes(r.cStat)) return "AUTORIZADA";
  if (["110", "301", "302", "303"].includes(r.cStat)) return "DENEGADA";
  return "REJEITADA";
}

async function aplicarRetorno(id: string, nfeAssinada: string, r: RetornoAutorizacao, lojaCnpj: string, ambiente: Ambiente, numero: number) {
  const status = statusDoRetorno(r);
  const autorizada = status === "AUTORIZADA" && r.protNFeXml;
  await prisma.emissaoNfe.update({
    where: { id },
    data: {
      status, cStat: r.cStat, xMotivo: r.xMotivo, nProt: r.nProt ?? null,
      dhRecbto: r.dhRecbto ? new Date(r.dhRecbto) : null,
      xmlAutorizado: autorizada ? montarNfeProc(nfeAssinada, r.protNFeXml!) : null,
    },
  });
  if (ambiente === 1 && (status === "AUTORIZADA" || status === "DENEGADA")) {
    const loja = await prisma.emissorLoja.findUnique({ where: { cnpj: lojaCnpj }, select: { proximoNumero: true } });
    if (loja && loja.proximoNumero <= numero)
      await prisma.emissorLoja.update({ where: { cnpj: lojaCnpj }, data: { proximoNumero: numero + 1 } });
  }
}

export interface PedidoEmissao {
  xmlOriginal: string;
  selecao: { nItem: number; qtd: number }[];
  caso: string;
  infCpl: string;
  contador: boolean;
  ambiente: Ambiente;
  /** reenvio: reaproveita o registro e o número */
  emissaoId?: string;
}

export async function emitir(p: PedidoEmissao) {
  if (p.ambiente === 1 && !PRODUCAO_LIBERADA)
    throw new Error("Emissão em produção ainda não está liberada (somente homologação).");
  const original = lerNotaOriginal(p.xmlOriginal);
  const loja = await prisma.emissorLoja.findUnique({ where: { cnpj: original.destCnpj } });
  if (!loja) throw new Error("Loja destinatária não cadastrada.");
  if (loja.serie == null) throw new Error("Defina a série própria da loja antes de emitir.");
  const { pfx, senha } = await carregarCertificado(loja.cnpj);

  // Número: reaproveita o de uma tentativa REJEITADA; bloqueia se houver tentativa INCERTA.
  const incerta = await prisma.emissaoNfe.findFirst({
    where: { lojaCnpj: loja.cnpj, ambiente: p.ambiente, serie: loja.serie, status: { in: ["INCERTA", "ASSINADA"] }, ...(p.emissaoId ? { id: { not: p.emissaoId } } : {}) },
  });
  if (incerta)
    throw new Error(`Há uma nota sem resposta da SEFAZ (nº ${incerta.numero}). Consulte-a em “Notas emitidas” antes de emitir outra.`);

  let numero: number;
  let reaproveitar: string | null = p.emissaoId ?? null;
  if (p.emissaoId) {
    numero = (await prisma.emissaoNfe.findUniqueOrThrow({ where: { id: p.emissaoId } })).numero;
  } else {
    const rej = await prisma.emissaoNfe.findFirst({
      where: { lojaCnpj: loja.cnpj, ambiente: p.ambiente, serie: loja.serie, status: "REJEITADA" },
      orderBy: { numero: "asc" },
    });
    if (rej) { numero = rej.numero; reaproveitar = rej.id; }
    else if (p.ambiente === 2) {
      const max = await prisma.emissaoNfe.aggregate({ where: { lojaCnpj: loja.cnpj, ambiente: 2, serie: loja.serie }, _max: { numero: true } });
      numero = (max._max.numero ?? 0) + 1;
    } else numero = loja.proximoNumero;
  }

  const r = montarDevolucao({
    loja, original, selecao: p.selecao, serie: loja.serie, numero,
    infCpl: p.infCpl, contadorCnpj: p.contador ? CNPJ_CONTADOR_PADRAO : null, ambiente: p.ambiente,
  });
  const assinado = assinarNFe(r.xml, pfx, senha);

  const dados = {
    lojaCnpj: loja.cnpj, ambiente: p.ambiente, serie: loja.serie, numero, chave: r.chave, status: "ASSINADA",
    cStat: null, xMotivo: null, nProt: null, dhRecbto: null, xmlAutorizado: null,
    vNF: r.vNF, notaOriginalChave: original.chave, notaOriginalNumero: original.numero,
    caso: p.caso, infCpl: p.infCpl, contador: p.contador, selecao: p.selecao as any,
    xmlOriginal: p.xmlOriginal, xmlAssinado: assinado,
  };
  const reg = reaproveitar
    ? await prisma.emissaoNfe.update({ where: { id: reaproveitar }, data: dados })
    : await prisma.emissaoNfe.create({ data: dados });

  try {
    const ret = await autorizarNFe(assinado, p.ambiente, pfx, senha);
    await aplicarRetorno(reg.id, assinado, ret, loja.cnpj, p.ambiente, numero);
  } catch (e: any) {
    await prisma.emissaoNfe.update({
      where: { id: reg.id },
      data: { status: "INCERTA", xMotivo: `Sem resposta da SEFAZ: ${e?.message ?? e}` },
    });
  }
  return prisma.emissaoNfe.findUniqueOrThrow({ where: { id: reg.id }, select: LISTA });
}

export async function consultarEmissao(id: string) {
  const e = await prisma.emissaoNfe.findUniqueOrThrow({ where: { id } });
  const { pfx, senha } = await carregarCertificado(e.lojaCnpj);
  const ret = await consultarChaveNFe(e.chave, e.ambiente as Ambiente, pfx, senha);
  if (ret.cStat === "217") {
    // SEFAZ não conhece a chave: a tentativa não existe lá; libera o número.
    await prisma.emissaoNfe.update({ where: { id }, data: { status: "REJEITADA", cStat: ret.cStat, xMotivo: ret.xMotivo } });
  } else if (e.xmlAssinado && ret.protNFeXml) {
    await aplicarRetorno(id, e.xmlAssinado, ret, e.lojaCnpj, e.ambiente as Ambiente, e.numero);
  } else {
    await prisma.emissaoNfe.update({ where: { id }, data: { cStat: ret.cStat, xMotivo: ret.xMotivo } });
  }
  return prisma.emissaoNfe.findUniqueOrThrow({ where: { id }, select: LISTA });
}

export const LISTA = {
  id: true, lojaCnpj: true, ambiente: true, serie: true, numero: true, chave: true, status: true,
  cStat: true, xMotivo: true, nProt: true, dhRecbto: true, vNF: true, notaOriginalNumero: true,
  caso: true, createdAt: true,
} as const;
