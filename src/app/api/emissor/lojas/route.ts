import { NextRequest, NextResponse } from "next/server";
import { lerNotaOriginal } from "@/lib/nfe-devolucao";
import { prisma } from "@/lib/db";
import { statusCertificado } from "@/lib/emissor-certificado-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const lojas = await prisma.emissorLoja.findMany({ orderBy: { razaoSocial: "asc" } });
  const cnpjs = lojas.map((l) => l.cnpj);
  const [certs, refs] = await Promise.all([
    prisma.certificate.findMany({
      where: { cnpj: { in: cnpjs } },
      select: { cnpj: true, status: true, validUntil: true },
    }),
    prisma.lojaReferencia.findMany({
      where: { cnpj: { in: cnpjs } },
      select: { cnpj: true, loja: true },
    }),
  ]);
  const certPorCnpj = new Map(certs.map((c) => [c.cnpj, c]));
  const nomePorCnpj = new Map(refs.map((r) => [r.cnpj, r.loja]));

  return NextResponse.json({
    lojas: lojas.map((l) => ({
      ...l,
      loja: nomePorCnpj.get(l.cnpj) ?? null,
      certificado: {
        ...statusCertificado(certPorCnpj.get(l.cnpj)),
        validUntil: certPorCnpj.get(l.cnpj)?.validUntil ?? null,
      },
    })),
  });
}

/** Cadastro rápido: usa os dados do destinatário do XML original; regime (CRT) e série vêm do usuário. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const arquivo = form.get("xml");
  const crt = Number(form.get("crt"));
  const serieRaw = String(form.get("serie") ?? "").trim();
  if (!(arquivo instanceof File)) return NextResponse.json({ error: "Envie o XML." }, { status: 400 });
  if (![1, 3].includes(crt)) return NextResponse.json({ error: "Escolha o regime: Simples (1) ou Normal (3)." }, { status: 400 });
  const serie = serieRaw === "" ? null : Number(serieRaw);
  if (serie !== null && (!Number.isInteger(serie) || serie < 0 || serie > 999))
    return NextResponse.json({ error: "Série inválida (0 a 999)." }, { status: 400 });

  let d;
  try {
    d = lerNotaOriginal(await arquivo.text()).destinatario;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "XML inválido." }, { status: 400 });
  }
  if (await prisma.emissorLoja.findUnique({ where: { cnpj: d.cnpj }, select: { cnpj: true } }))
    return NextResponse.json({ error: "Esta loja já está cadastrada." }, { status: 400 });

  const loja = await prisma.emissorLoja.create({
    data: {
      cnpj: d.cnpj, razaoSocial: d.nome, ie: d.ie, im: "ISENTO", cnae: "4781400", crt,
      logradouro: d.logradouro, numero: d.numero, complemento: d.complemento ?? null, bairro: d.bairro,
      codMunicipio: d.codMunicipio, municipio: d.municipio, uf: d.uf, cep: d.cep, fone: d.fone ?? null, serie,
    },
  });
  return NextResponse.json({ loja });
}
