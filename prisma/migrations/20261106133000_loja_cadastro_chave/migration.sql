-- A mesma loja pode estar nas duas planilhas (LOJAS e LOJAS_MFPLAI): a chave passa a ser CNPJ + nome da loja.
-- Remove duplicatas (mantém a mais recente) antes de criar o índice único.
DELETE FROM "LojaCadastro" a
USING "LojaCadastro" b
WHERE a."cnpj" = b."cnpj" AND a."loja" = b."loja"
  AND (a."updatedAt" < b."updatedAt" OR (a."updatedAt" = b."updatedAt" AND a."id" < b."id"));
DROP INDEX "LojaCadastro_origem_cnpj_loja_key";
CREATE UNIQUE INDEX "LojaCadastro_cnpj_loja_key" ON "LojaCadastro"("cnpj", "loja");
