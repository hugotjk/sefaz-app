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
 *  - ou EAN do item = VariacaoProduto.ean de variação alterada no período.
 * Os demais casos (prefixo Thug/Dubs etc.) continuam com a reavaliação diária.
 */
export async function reavaliarCadastroRecentes(dias = 3): Promise<number> {
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
              WHERE p."updatedAt" > now() - ($1::int * interval '1 day')
                AND upper(trim(p."referenciaFornecedor")) = upper(trim(ni."referenciaFornecedorIdentificada"))
                AND upper(trim(p."modeloNome")) = upper(trim(ni."modeloIdentificado"))
           )
         )
         OR (
           ni."ean" IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM "VariacaoProduto" v
              WHERE v."updatedAt" > now() - ($1::int * interval '1 day')
                AND v."ean" = ni."ean"
           )
         )
       )
    `,
    dias
  );
  return Number(n);
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
