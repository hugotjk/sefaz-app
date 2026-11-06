import { NextResponse } from "next/server";
import { limparDuplicados } from "@/lib/docs-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    return NextResponse.json(await limparDuplicados());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao limpar." }, { status: 500 });
  }
}
