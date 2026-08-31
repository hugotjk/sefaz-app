/**
 * Script one-off: popula as tabelas de tradução código -> nome
 * (EmpresaLoja = "Tipo Loja", GrupoLoja = "Grupo Loja").
 *
 * A API do PDV só devolve o código numérico desses campos na filial, sem os
 * nomes. Rode uma vez (e de novo quando a lista mudar):
 *
 *   npx tsx scripts/seed-empresa-grupo.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EMPRESAS: Array<[number, string]> = [
  [2, "FLAMENGO"],
  [3, "WQSURF"],
  [4, "BOARD SESSION"],
  [5, "55RJ"],
  [6, "ACTITUD"],
  [7, "FLUMINENSE"],
  [8, "ESCRITORIO"],
  [9, "MARACANÃ"],
  [10, "LACOSTE"],
  [11, "STANCE"],
  [12, "EPLAI"],
  [13, "SANDALS & CO"],
  [14, "FUTTEBOL"],
  [15, "LACOSTE INATIVA"],
  [16, "VASCO"],
];

const GRUPOS: Array<[number, string]> = [
  [4, "TONY WQS"],
  [6, "MAURICIO WQS"],
  [7, "MAURÍCIO FLA"],
  [8, "TONY FLA"],
  [9, "FRANQUIAS"],
  [11, "ESCRITÓRIO"],
  [12, "ESCRITÓRIO FLA"],
  [14, "BN FLA"],
  [15, "BN WQS"],
  [16, "FORA DO GRUPO"],
  [17, "TIM/GUGU FLA"],
  [20, "TIM/GUGU WQS"],
  [21, "MF FLA"],
  [22, "MF WQS"],
  [23, "AUGUSTO"],
  [24, "FRANQUIA NRN"],
  [25, "MAX WQS"],
  [26, "MAX FLA"],
  [27, "MF 55"],
  [28, "TONY 55"],
  [36, "FECHADAS"],
  [37, "GRINGO WQS"],
  [38, "GRINGO FLA"],
  [39, "GRINGO 55"],
  [40, "DEFEITOS"],
  [41, "VIRTUAL FLA"],
  [42, "WQS VIRTUAL"],
  [43, "PEZAO"],
  [44, "BELLUCO"],
  [45, "GUGA"],
  [47, "BOMBA"],
  [48, "MAURICIO 55RJ"],
  [49, "BINHO"],
  [51, "PETER"],
  [52, "DUDA"],
  [53, "MAX 55"],
  [54, "DRN"],
  [55, "DRN FLA"],
  [56, "DRN FLU"],
  [57, "FRANQUIA FLU"],
  [58, "MF LCT"],
  [59, "DANIEL 55"],
  [60, "TIM/GUGU LCT"],
  [61, "MAURICIO LCT"],
  [62, "FLY FLU"],
  [63, "MARCIO FLU"],
  [64, "MYLENA FLU"],
  [65, "RICARDO FLU"],
  [66, "GERALDO FLU"],
  [67, "FLAVIO ITAGUAI"],
  [68, "RAFA GOL"],
  [69, "MF FLU"],
  [70, "MAURICIO FUT"],
  [71, "FRANQUIA FUT"],
  [72, "MF FUT"],
  [73, "BRUNO"],
  [74, "FRANQUIA 55RJ"],
  [75, "RICARDO FLA"],
  [76, "MAURICIO FLU"],
  [77, "WILLIAM"],
  [78, "BERNARDO"],
  [79, "DIOGO FLA"],
  [80, "SANDRO"],
  [81, "DIOGO MULTI"],
  [82, "MAX FUT"],
];

async function main() {
  for (const [codigo, nome] of EMPRESAS) {
    await prisma.empresaLoja.upsert({
      where: { codigo },
      create: { codigo, nome },
      update: { nome },
    });
  }
  for (const [codigo, nome] of GRUPOS) {
    await prisma.grupoLoja.upsert({
      where: { codigo },
      create: { codigo, nome },
      update: { nome },
    });
  }
  console.log(`EmpresaLoja: ${EMPRESAS.length} linhas | GrupoLoja: ${GRUPOS.length} linhas`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
