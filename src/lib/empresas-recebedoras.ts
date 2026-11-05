import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface EmpresaRecebedora {
  id: string; // = cnpj (o filtro é por Note.cnpjDestino)
  cnpj: string;
  razaoSocial: string | null;
}

/**
 * Razão social "do lado do cliente" lida do XML: se o CNPJ da empresa é o emitente da nota
 * (nota de saída), usa <emit>; senão usa <dest>.
 */
export const SQL_NOME_EMPRESA_XML = Prisma.sql`
  NULLIF(BTRIM(CASE
    WHEN regexp_replace(COALESCE(n."emitenteCnpj", ''), '\\D', '', 'g') = regexp_replace(n."cnpjDestino", '\\D', '', 'g')
      THEN substring(n."xmlCompleto" from '<emit>.*?<xNome>([^<]*)</xNome>')
    ELSE substring(n."xmlCompleto" from '<dest>.*?<xNome>([^<]*)</xNome>')
  END), '')`;

let cache: { em: number; lista: EmpresaRecebedora[] } | null = null;
const TTL_MS = 30 * 60 * 1000;

/** Todas as empresas (CNPJs) que têm nota no banco, com certificado ou não. */
export async function listarEmpresasRecebedoras(): Promise<EmpresaRecebedora[]> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.lista;
  const certs = await prisma.certificate.findMany({ select: { cnpj: true, razaoSocial: true } });
  const nomeCert = new Map(certs.map((c) => [c.cnpj.replace(/\D/g, ""), c.razaoSocial?.trim() || null]));

  const rows = await prisma.$queryRaw<{ cnpj: string; nome: string | null }[]>(Prisma.sql`
    SELECT d.cnpj, x.nome
    FROM (SELECT DISTINCT "cnpjDestino" AS cnpj FROM "Note") d
    LEFT JOIN LATERAL (
      SELECT ${SQL_NOME_EMPRESA_XML} AS nome
      FROM "Note" n
      WHERE n."cnpjDestino" = d.cnpj AND n."xmlCompleto" <> ''
      ORDER BY n."dataEmissao" DESC NULLS LAST
      LIMIT 1
    ) x ON true
  `);
  const lista = rows
    .map((r) => ({
      id: r.cnpj,
      cnpj: r.cnpj,
      razaoSocial: nomeCert.get(r.cnpj.replace(/\D/g, "")) ?? r.nome ?? null,
    }))
    .sort((a, b) => (a.razaoSocial || a.cnpj).localeCompare(b.razaoSocial || b.cnpj, "pt-BR"));
  cache = { em: Date.now(), lista };
  return lista;
}
