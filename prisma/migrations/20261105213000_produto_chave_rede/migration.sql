-- O código do produto só é único dentro da rede: a chave passa a ser "redeId:codigo".

-- 1) Sem FK entre variação e produto (a ligação passa a ser só pela chave; variações de
--    produtos que ainda não foram recarregados ficam órfãs por um tempo).
ALTER TABLE "VariacaoProduto" DROP CONSTRAINT IF EXISTS "VariacaoProduto_produtoId_fkey";

-- 2) Colunas novas
ALTER TABLE "Produto" ADD COLUMN "dataAtualizacaoPdv" TIMESTAMP(3);
ALTER TABLE "PrecoVariacao" ADD COLUMN "precoPromocional" DECIMAL(14,2);

-- 3) Chave nova. Variações primeiro: usam a rede da PRÓPRIA variação (que é a certa).
UPDATE "VariacaoProduto" SET "produtoId" = "redeId"::text || ':' || "produtoId"
 WHERE position(':' in "produtoId") = 0;
UPDATE "Produto" SET "id" = "redeId"::text || ':' || "id"
 WHERE position(':' in "id") = 0;
