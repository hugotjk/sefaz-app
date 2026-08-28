import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { lojaId, nome, gestor, tipoLoja } = body;

  if (typeof lojaId !== "number") {
    return NextResponse.json({ error: "lojaId é obrigatório e deve ser número." }, { status: 400 });
  }

  const salvo = await prisma.lojaConfig.upsert({
    where: { lojaId },
    create: { lojaId, nome, gestor, tipoLoja },
    update: { nome, gestor, tipoLoja },
  });

  return NextResponse.json({ salvo });
}
