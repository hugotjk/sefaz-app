-- CreateIndex
CREATE INDEX "FilialSync_empresaId_idx" ON "FilialSync"("empresaId");

-- CreateIndex
CREATE INDEX "FilialSync_grupoId_idx" ON "FilialSync"("grupoId");

-- CreateIndex
CREATE INDEX "Produto_grupoNome_idx" ON "Produto"("grupoNome");

-- CreateIndex
CREATE INDEX "Produto_colecaoNome_idx" ON "Produto"("colecaoNome");

-- CreateIndex
CREATE INDEX "Produto_compradorNome_idx" ON "Produto"("compradorNome");

-- CreateIndex
CREATE INDEX "Produto_fornecedorNome_idx" ON "Produto"("fornecedorNome");

-- CreateIndex
CREATE INDEX "Produto_modeloNome_idx" ON "Produto"("modeloNome");

-- CreateIndex
CREATE INDEX "VendaItemSync_dataHora_variacaoId_idx" ON "VendaItemSync"("dataHora", "variacaoId");

-- CreateIndex
CREATE INDEX "VendaResumoMensal_anoMes_variacaoId_idx" ON "VendaResumoMensal"("anoMes", "variacaoId");
