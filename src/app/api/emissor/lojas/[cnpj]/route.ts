import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Edita série própria, próximo número e CRT de uma loja. */
export async function PATCH(req: NextRequest, { params }: { params: { cnpj: string } }) {
  const body = await req.json().catch(() => ({}));
  const data: { serie?: number | null; proximoNumero?: number; crt?: number } = {};

  if ("serie" in body) {
    if (body.serie === null || body.serie === "") data.serie = null;
    else {
      const s = Number(body.serie);
      if (!Number.isInteger(s) || s < 0 || s > 999)
        return NextResponse.json({ error: "Série deve ser um inteiro entre 0 e 999." }, { status: 400 });
      data.serie = s;
    }
  }
  if ("proximoNumero" in body) {
    const n = Number(body.proximoNumero);
    if (!Number.isInteger(n) || n < 1 || n > 999_999_999)
      return NextResponse.json({ error: "Próximo número inválido." }, { status: 400 });
    data.proximoNumero = n;
  }
  if ("crt" in body) {
    const c = Number(body.crt);
    if (![1, 2, 3].includes(c))
      return NextResponse.json({ error: "CRT deve ser 1, 2 ou 3." }, { status: 400 });
    data.crt = c;
  }

  const existe = await prisma.emissorLoja.findUnique({ where: { cnpj: params.cnpj }, select: { cnpj: true } });
  if (!existe) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });

  const loja = await prisma.emissorLoja.update({ where: { cnpj: params.cnpj }, data });
  return NextResponse.json({ loja });
}
