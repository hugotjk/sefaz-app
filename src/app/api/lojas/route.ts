import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listarLojas } from "@/lib/pdvapi";
import type { LojaConfig } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [lojasPdv, configs] = await Promise.all([
      listarLojas(),
      prisma.lojaConfig.findMany(),
    ]);

    const configPorId = new Map<number, LojaConfig>(configs.map((c: LojaConfig) => [c.lojaId, c]));

    const lojas = lojasPdv.map((l) => ({
      id: l.Id,
      nome: l.NomeFantasia,
      razaoSocial: l.RazaoSocial,
      cnpj: l.CNPJ,
      inativa: l.Inativa,
      gestor: configPorId.get(l.Id)?.gestor ?? "",
      tipoLoja: configPorId.get(l.Id)?.tipoLoja ?? "",
    }));

    return NextResponse.json({ lojas });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro ao consultar a API do PDV." }, { status: 500 });
  }
}
