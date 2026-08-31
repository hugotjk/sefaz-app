import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listarLojas } from "@/lib/pdvapi";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Tudo em poucas queries — nada de chamar a API do PDV por loja. Os dados
    // de filial (Empresa/Grupo) vêm de FilialSync, populado pelo job syncFiliais.
    const [lojasPdv, empresas, grupos, filiais] = await Promise.all([
      listarLojas(),
      prisma.empresaLoja.findMany(),
      prisma.grupoLoja.findMany(),
      prisma.filialSync.findMany(),
    ]);

    const nomeEmpresa = new Map(empresas.map((e) => [e.codigo, e.nome]));
    const nomeGrupo = new Map(grupos.map((g) => [g.codigo, g.nome]));
    const filialPorLoja = new Map(filiais.map((f) => [f.lojaId, f]));

    const lojas = lojasPdv.map((l) => {
      const filial = filialPorLoja.get(l.Id);

      let tipoLoja: string;
      let grupoLoja: string;
      if (!filial) {
        // syncFiliais ainda não chegou nesta loja.
        tipoLoja = "Sincronizando...";
        grupoLoja = "Sincronizando...";
      } else {
        tipoLoja =
          filial.empresaId == null
            ? ""
            : nomeEmpresa.get(filial.empresaId) ?? `Empresa ${filial.empresaId}`;
        grupoLoja =
          filial.grupoId == null
            ? ""
            : nomeGrupo.get(filial.grupoId) ?? `Grupo ${filial.grupoId}`;
      }

      return {
        id: l.Id,
        nome: l.NomeFantasia,
        razaoSocial: l.RazaoSocial,
        cnpj: l.CNPJ,
        inativa: l.Inativa,
        grupoLoja,
        tipoLoja,
      };
    });

    return NextResponse.json({ lojas });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro ao consultar a API do PDV." }, { status: 500 });
  }
}
