/**
 * Chave do produto no app = "redeId:código da API". O código do produto só é único DENTRO
 * da rede (o mesmo 64335 existe na Fluminense e na Futtebol), então a rede entra na chave.
 * As variações têm código próprio e único (VariacaoProduto.id), e guardam a chave do
 * produto em `produtoId`.
 */
export function chaveProduto(redeId: number | string, idApi: string): string {
  return `${redeId}:${idApi}`;
}

/** Código do produto como a API do PDV conhece (sem o prefixo da rede). */
export function idApiDoProduto(chave: string): string {
  const i = chave.indexOf(":");
  return i >= 0 ? chave.slice(i + 1) : chave;
}
