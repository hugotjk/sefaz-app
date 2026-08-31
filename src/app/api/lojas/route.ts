import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listarLojas, obterFilial } from "@/lib/pdvapi";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Carrega as duas tabelas de tradução inteiras de uma vez (código -> nome),
    // pra não fazer uma query por loja dentro do loop.
    const [lojasPdv, empresas, grupos] = await Promise.all([
      listarLojas(),
      prisma.empresaLoja.findMany(),
      prisma.grupoLoja.findMany(),
    ]);

    const nomeEmpresa = new Map(empresas.map((e) => [e.codigo, e.nome]));
    const nomeGrupo = new Map(grupos.map((g) => [g.codigo, g.nome]));

    // A API do PDV não traz Empresa/Grupo na listagem de lojas — só na filial,
    // e por código. Uma chamada HTTP por loja, disparadas em paralelo.
    const lojas = await Promise.all(
      lojasPdv.map(async (l) => {
        let tipoLoja = "";
        let grupoLoja = "";

        try {
          const filial = await obterFilial(l.Id);
          const codEmpresa = filial.Empresa;
          const codGrupo = filial.Grupo;
          tipoLoja = nomeEmpresa.get(codEmpresa) ?? `Empresa ${codEmpresa}`;
          grupoLoja = nomeGrupo.get(codGrupo) ?? `Grupo ${codGrupo}`;
        } catch {
          // Se a filial dessa loja não puder ser lida, segue sem os nomes em
          // vez de derrubar a rota inteira.
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
      })
    );

    return NextResponse.json({ lojas });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro ao consultar a API do PDV." }, { status: 500 });
  }
}
