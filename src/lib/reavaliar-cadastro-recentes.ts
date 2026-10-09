import { prisma } from "@/lib/db";

/**
 * Marca `temCadastro = true` nos NotaItem que ainda estão "sem cadastro" mas
 * cujo produto foi cadastrado/alterado no PDV nos últimos `dias` dias.
 *
 * Um único UPDATE em SQL (sem trazer linhas pro Node). Só usa casamento
 * EXATO (case-insensitive, sem espaços nas pontas), que é um subconjunto da
 * regra de `avaliarCadastroItens` — nunca marca algo que a regra completa
 * rejeitaria. Casa por:
 *  - referência identificada + modelo identificado = Produto.referenciaFornecedor + modeloNome;
 *  - ou EAN do item = EAN de variação de produto alterado no período.
 * Os demais casos (prefixo Thug/Dubs etc.) continuam com a reavaliação diária.
 */
export async function reavaliarCadastroRecentes(dias = 3): Promise<number> {
  // Dois UPDATEs com JOIN (hash join) em vez de EXISTS correlacionado, que
  // ficava lento por comparar item a item contra a tabela inteira.
  const porRefModelo = await prisma.$executeRawUnsafe(
    `
    UPDATE "NotaItem" AS ni
       SET "temCadastro" = true
      FROM (
        SELECT DISTINCT upper(trim(p."referenciaFornecedor")) AS ref,
                        upper(trim(p."modeloNome")) AS modelo
          FROM "Produto" p
         WHERE p."updatedAt" > now() - ($1::int * interval '1 day')
           AND p."referenciaFornecedor" IS NOT NULL
           AND p."modeloNome" IS NOT NULL
      ) r
     WHERE ni."temCadastro" = false
       AND ni."referenciaFornecedorIdentificada" IS NOT NULL
       AND ni."modeloIdentificado" IS NOT NULL
       AND upper(trim(ni."referenciaFornecedorIdentificada")) = r.ref
       AND upper(trim(ni."modeloIdentificado")) = r.modelo
    `,
    dias
  );
  const porEan = await prisma.$executeRawUnsafe(
    `
    UPDATE "NotaItem" AS ni
       SET "temCadastro" = true
      FROM (
        SELECT DISTINCT v."ean" AS ean
          FROM "VariacaoProduto" v
          JOIN "Produto" p ON p."id" = v."produtoId"
         WHERE p."updatedAt" > now() - ($1::int * interval '1 day')
           AND v."ean" IS NOT NULL AND v."ean" <> ''
      ) e
     WHERE ni."temCadastro" = false
       AND ni."ean" = e.ean
    `,
    dias
  );
  return Number(porRefModelo) + Number(porEan);
}

/**
 * Vincula NA HORA: dado um conjunto de produtos que acabou de entrar/mudar no
 * banco, marca `temCadastro = true` nos NotaItem sem cadastro que casam com
 * eles (referência+modelo, ou EAN das variações). Mesmo critério exato da
 * função acima, mas restrito aos `produtoIds` (UPDATE barato, usa índices).
 */
export async function vincularCadastroDeProdutos(produtoIds: string[]): Promise<number> {
  if (produtoIds.length === 0) return 0;
  const n = await prisma.$executeRawUnsafe(
    `
    UPDATE "NotaItem" AS ni
       SET "temCadastro" = true
     WHERE ni."temCadastro" = false
       AND (
         (
           ni."referenciaFornecedorIdentificada" IS NOT NULL
           AND ni."modeloIdentificado" IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM "Produto" p
              WHERE p."id" = ANY($1::text[])
                AND upper(trim(p."referenciaFornecedor")) = upper(trim(ni."referenciaFornecedorIdentificada"))
                AND upper(trim(p."modeloNome")) = upper(trim(ni."modeloIdentificado"))
           )
         )
         OR (
           ni."ean" IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM "VariacaoProduto" v
              WHERE v."produtoId" = ANY($1::text[])
                AND v."ean" = ni."ean"
           )
         )
       )
    `,
    produtoIds
  );
  return Number(n);
}
