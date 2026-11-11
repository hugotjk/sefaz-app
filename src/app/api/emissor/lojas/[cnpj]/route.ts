import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Edita série própria, próximo número e CRT de uma loja. */
export async function PATCH(req: NextRequest, { params }: { params: { cnpj: string } }) {
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

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

  // endereço do emitente (aparece no XML e no DANFE)
  for (const campo of ["logradouro", "numero", "complemento", "bairro", "cep", "fone"] as const) {
    if (!(campo in body)) continue;
    let v = String(body[campo] ?? "").trim();
    if (campo === "cep" || campo === "fone") v = v.replace(/\D/g, "");
    if (campo === "cep" && v.length !== 8) return NextResponse.json({ error: "CEP deve ter 8 dígitos." }, { status: 400 });
    if (campo === "fone" && v && (v.length < 6 || v.length > 14))
      return NextResponse.json({ error: "Telefone deve ter de 6 a 14 dígitos." }, { status: 400 });
    if (["logradouro", "numero", "bairro"].includes(campo) && !v)
      return NextResponse.json({ error: `Preencha ${campo}.` }, { status: 400 });
    if (v.length > 60) return NextResponse.json({ error: `${campo} muito longo (máx. 60).` }, { status: 400 });
    data[campo] = v === "" ? null : v;
  }

  const existe = await prisma.emissorLoja.findUnique({ where: { cnpj: params.cnpj }, select: { cnpj: true } });
  if (!existe) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });

  const loja = await prisma.emissorLoja.update({ where: { cnpj: params.cnpj }, data });
  return NextResponse.json({ loja });
}
