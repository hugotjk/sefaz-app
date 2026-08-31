/**
 * Cliente da API do PDV (Swagger 2.0, host próprio do cliente via DNS
 * dinâmico). Uso: somente leitura (GET) — nada aqui grava dados no PDV.
 *
 * Autenticação: POST /api/public/login com { Usuario, Senha } -> { Token }.
 * O token vai no header Authorization: Bearer <token> nas chamadas seguintes.
 * Por simplicidade, fazemos login a cada request em vez de cachear o token
 * entre execuções serverless (evita lidar com expiração em ambiente stateless).
 */

const BASE_URL = process.env.PDVAPI_BASE_URL; // ex: http://host:65000/pdvapi
const USUARIO = process.env.PDVAPI_USUARIO;
const SENHA = process.env.PDVAPI_SENHA;

function checarConfiguracao() {
  if (!BASE_URL || !USUARIO || !SENHA) {
    throw new Error(
      "PDVAPI_BASE_URL, PDVAPI_USUARIO e PDVAPI_SENHA precisam estar configurados no .env"
    );
  }
}

// Cache do token em memória. O login por request é barato pra 1-2 chamadas,
// mas as syncs paginadas (produtos/vendas/estoque) fazem centenas de GETs por
// execução — sem cache seriam centenas de logins. TTL curto e conservador.
let tokenCache: { token: string; expiraEm: number } | null = null;
const TOKEN_TTL_MS = 50 * 60_000; // ~50 min

async function login(): Promise<string> {
  checarConfiguracao();
  if (tokenCache && Date.now() < tokenCache.expiraEm) {
    return tokenCache.token;
  }
  const res = await fetch(`${BASE_URL}/api/public/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Usuario: USUARIO, Senha: SENHA }),
  });
  if (!res.ok) {
    throw new Error(`Falha no login da API do PDV: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.Token) {
    throw new Error("Login na API do PDV não retornou um Token.");
  }
  tokenCache = { token: data.Token as string, expiraEm: Date.now() + TOKEN_TTL_MS };
  return tokenCache.token;
}

export class PdvHttpError extends Error {
  constructor(public status: number, public path: string, public corpo: string) {
    super(`Erro na API do PDV (HTTP ${status}) em ${path}: ${corpo}`);
    this.name = "PdvHttpError";
  }
}

async function chamarApi<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const token = await login();
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const trecho = (await res.text()).slice(0, 300);
    throw new PdvHttpError(res.status, path, trecho);
  }

  return res.json();
}

// A API do PDV devolve listas em envelopes diferentes conforme o endpoint:
//   - { Registros: [...], PaginacaoInfo: {...} }  (produtos, vendas, estoque, redes...)
//   - { Data: [...] }
//   - o array direto
// Esse helper normaliza os três casos.
function extrairLista<T>(data: any): T[] {
  if (Array.isArray(data)) return data;
  return data?.Registros ?? data?.Data ?? [];
}

export interface PaginacaoInfo {
  PaginaAtual: number;
  TamanhoPagina: number;
  TotalPaginas: number;
  TotalRegistros: number;
  TemProximaPagina: boolean;
  TemPaginaAnterior: boolean;
}

export interface RespostaPaginada<T> {
  registros: T[];
  paginacao: PaginacaoInfo | null;
}

// A API do PDV rejeita (HTTP 500 "O tamanho da página não pode ser maior que
// 50.") qualquer TamanhoPagina acima disso.
export const PDV_MAX_TAM_PAGINA = 50;

/** GET que sabe ler o envelope { Registros, PaginacaoInfo } da API do PDV. */
async function chamarApiPaginado<T>(
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<RespostaPaginada<T>> {
  const limpos: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    limpos[k] = k === "TamanhoPagina" ? Math.min(Number(v), PDV_MAX_TAM_PAGINA) : v;
  }

  let data: any;
  try {
    data = await chamarApi<any>(path, limpos);
  } catch (err) {
    // BUG conhecido da API do PDV: endpoints paginados anunciam
    // TemProximaPagina=true na penúltima página e devolvem HTTP 404 na última
    // (PaginaAtual == TotalPaginas). Também dá 404 quando a janela não tem
    // nenhum registro. Em chamadas paginadas tratamos 404 como "sem registros"
    // em vez de erro (o loop de paginação para sozinho).
    if (err instanceof PdvHttpError && err.status === 404 && limpos.Pagina !== undefined) {
      return { registros: [], paginacao: null };
    }
    throw err;
  }

  return {
    registros: extrairLista<T>(data),
    paginacao: (data && typeof data === "object" && data.PaginacaoInfo) || null,
  };
}

// Teto de segurança pra não entrar em loop infinito se a API sempre disser
// TemProximaPagina = true.
const MAX_PAGINAS_LISTA_COMPLETA = 2000;

/**
 * Percorre TODAS as páginas de um endpoint paginado e devolve tudo junto.
 * Use só onde o total é pequeno/médio (redes, lojas) — não pra catálogo.
 */
async function chamarApiListaCompleta<T>(
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<T[]> {
  const todos: T[] = [];
  let pagina = 1;
  while (pagina <= MAX_PAGINAS_LISTA_COMPLETA) {
    const { registros, paginacao } = await chamarApiPaginado<T>(path, {
      ...params,
      Pagina: pagina,
      TamanhoPagina: PDV_MAX_TAM_PAGINA,
    });
    todos.push(...registros);
    if (registros.length === 0) break;
    if (!paginacao?.TemProximaPagina) break;
    if (paginacao.PaginaAtual >= paginacao.TotalPaginas) break;
    pagina++;
  }
  return todos;
}

export interface LojaPdv {
  Id: number;
  NomeFantasia: string;
  RazaoSocial: string;
  CNPJ: string;
  RedeId: number;
  Inativa: boolean;
}

export async function listarLojas(): Promise<LojaPdv[]> {
  // ~900 lojas em ~19 páginas — precisa percorrer todas.
  return chamarApiListaCompleta<LojaPdv>("/api/public/lojas");
}

export interface RedePdv {
  Id: number;
  Nome: string;
  Inativa: boolean;
}

export async function listarRedes(): Promise<RedePdv[]> {
  // Envelope real: { Registros: [...], PaginacaoInfo: {...} }
  return chamarApiListaCompleta<RedePdv>("/api/public/redes");
}

export interface EmpresaPdv {
  Codigo: number;
  Razaosocial: string;
  Inativa: boolean;
}

export async function listarEmpresas(): Promise<EmpresaPdv[]> {
  // Envelope real deste endpoint: { Empresas: [...], Filiais: [...] } — sem
  // paginação (não tem PaginacaoInfo).
  const data = await chamarApi<any>("/api/public/RecursoInicial/Empresas");
  if (Array.isArray(data?.Empresas)) return data.Empresas;
  const lista = extrairLista<EmpresaPdv>(data);
  return lista.length ? lista : data && typeof data === "object" ? [data as EmpresaPdv] : [];
}

export interface FilialPdv {
  Codigo: number;
  RazaoSocial: string;
  Prefixo: string;
  Empresa: number;
  Grupo: number;
  Supervisor: number;
  UFFilial: string;
  CidadeFilial: string;
}

export async function obterFilial(codigoFilial: number): Promise<FilialPdv> {
  const data = await chamarApi<{ Filial: FilialPdv }>(
    `/api/public/RecursoInicial/Filial/${codigoFilial}`
  );
  return data.Filial;
}

export interface PedidoFornecedorPdv {
  codigo_pedido: string;
  fornecedor_fantasia: string;
  fornecedor_razao_social: string;
  fornecedor_doc: string;
  filial: string;
  filial_doc: string;
  status_pedido: string;
  data_cadastro: string;
  valor_total_itens: number;
  pedido_itens: Array<{
    referencia: string;
    referencia_fornecedor: string;
    descricao: string;
    quantidade_pedida: number;
    quantidade_entregue: number;
    valor: number;
  }>;
}

export async function listarPedidosFornecedor(params: {
  data1?: string; // formato aceito pela API, ex: AAAA-MM-DD (confirmar no uso real)
  data2?: string;
  filial?: number;
  pagina?: number;
  tamanho_pagina?: number;
}): Promise<{
  pedidos: PedidoFornecedorPdv[];
  total_de_paginas: number;
  pagina: number;
}> {
  return chamarApi("/api/public/pedidofornecedor/consultarlista", params as any);
}

// ===========================================================================
// Catálogo / vendas / estoque — usados pela sincronização da Fase 1 do
// relatório de Movimentação Resumida (src/inngest/functions.ts).
//
// Paginação (confirmado em chamadas reais): todos aceitam `Pagina` e
// `TamanhoPagina` (PascalCase — variações minúsculas são ignoradas) e devolvem
//   { Registros: [...], PaginacaoInfo: { PaginaAtual, TotalPaginas,
//     TotalRegistros, TemProximaPagina, ... } }
// ===========================================================================

export interface ProdutoVariacaoRef {
  Id: string;
}

export interface ProdutoPdv {
  Id: string;
  RedeId: number;
  Rede?: string;
  Nome?: string;
  ReferenciaProdutoFornecedor?: string;
  FornecedorId?: string;
  Fornecedor?: string;
  ModeloId?: number;
  Modelo?: string;
  ColecaoId?: number;
  Colecao?: string;
  GrupoId?: number;
  Grupo?: string;
  CompradorId?: number;
  Comprador?: string;
  DataAtualizacao?: string;
  Inativo?: boolean;
  Variacoes?: ProdutoVariacaoRef[];
}

/**
 * GET /api/public/produtos/{redeId}
 * `aPartirDe` (enviado como `ApartirDe=YYYY-MM-DD`) filtra só o que mudou
 * desde a data — confirmado: reduz o total de ~129k para algumas centenas.
 * Os outros filtros (grupoId/colecaoId/fornecedorId) são opcionais.
 */
export async function listarProdutos(params: {
  redeId: number;
  grupoId?: number;
  colecaoId?: number;
  fornecedorId?: string;
  aPartirDe?: string;
  pagina?: number;
  tamanhoPagina?: number;
}): Promise<RespostaPaginada<ProdutoPdv>> {
  const { redeId, grupoId, colecaoId, fornecedorId, aPartirDe, pagina, tamanhoPagina } = params;
  return chamarApiPaginado<ProdutoPdv>(`/api/public/produtos/${redeId}`, {
    ApartirDe: aPartirDe,
    GrupoId: grupoId,
    ColecaoId: colecaoId,
    FornecedorId: fornecedorId,
    Pagina: pagina,
    TamanhoPagina: tamanhoPagina,
  });
}

export interface VariacaoProdutoPdv {
  Id: string;
  ProdutoId: string;
  RedeId: number;
  CorId?: number;
  Cor?: string;
  TamanhoId?: number;
  Tamanho?: string;
  EAN?: string;
  Inativo?: boolean;
  DataAtualizacao?: string;
}

/** GET /api/public/produtos/{redeId}/{produtoId}/variacoes (poucas por produto, sem paginar na prática). */
export async function listarVariacoesProduto(
  redeId: number,
  produtoId: string
): Promise<VariacaoProdutoPdv[]> {
  const todas: VariacaoProdutoPdv[] = [];
  let pagina = 1;
  // Normalmente 1 página só; o loop existe por segurança.
  while (true) {
    const { registros, paginacao } = await chamarApiPaginado<VariacaoProdutoPdv>(
      `/api/public/produtos/${redeId}/${produtoId}/variacoes`,
      { Pagina: pagina, TamanhoPagina: PDV_MAX_TAM_PAGINA }
    );
    todas.push(...registros);
    if (!paginacao?.TemProximaPagina || registros.length === 0) break;
    pagina++;
  }
  return todas;
}

export interface VendaItemPdv {
  VendaId: string; // pode vir com espaços em branco no fim — sempre .trim()
  SequencialItem: number;
  VariacaoId: string;
  Quantidade: number;
  Preco: number;
  PrecoLiquido?: number;
  PrecoTabela?: number;
  ValorDesconto?: number;
  ValorAcrescimo?: number;
  FilialId: number; // mesmo conceito de lojaId
}

export interface VendaPdv {
  Id: string;
  LojaId: number;
  DataHora: string;
  Inativa?: boolean;
  Itens: VendaItemPdv[];
}

/**
 * GET /api/public/vendas — os parâmetros de janela são `Inicio` e `Fim`
 * (aceitam `YYYY-MM-DD` ou ISO com hora). Sem eles a API ignora o filtro e
 * devolve o histórico inteiro (~9M) com `Itens` vazios, então a janela é
 * obrigatória na prática.
 */
export async function listarVendas(params: {
  inicio?: string;
  fim?: string;
  pagina?: number;
  tamanhoPagina?: number;
}): Promise<RespostaPaginada<VendaPdv>> {
  const { inicio, fim, pagina, tamanhoPagina } = params;
  return chamarApiPaginado<VendaPdv>("/api/public/vendas", {
    Inicio: inicio,
    Fim: fim,
    Pagina: pagina,
    TamanhoPagina: tamanhoPagina,
  });
}

export interface EstoqueVariacaoPdv {
  VariacaoId: string;
  LojaId: number;
  Quantidade: number;
  DataAtualizacao?: string;
}

/**
 * GET /api/public/estoque/variacao — foto atual do estoque.
 * ATENÇÃO: sem filtro são ~104 MILHÕES de linhas (variação x loja x histórico).
 * Filtrando por `variacaoId` cai pra ~algumas centenas (1 linha por loja que
 * já teve essa variação). A sync passa sempre `variacaoId`.
 */
export async function listarEstoqueVariacao(params: {
  variacaoId?: string;
  lojaId?: number;
  colecaoId?: number;
  grupoId?: number;
  pagina?: number;
  tamanhoPagina?: number;
}): Promise<RespostaPaginada<EstoqueVariacaoPdv>> {
  const { variacaoId, lojaId, colecaoId, grupoId, pagina, tamanhoPagina } = params;
  return chamarApiPaginado<EstoqueVariacaoPdv>("/api/public/estoque/variacao", {
    VariacaoId: variacaoId,
    LojaId: lojaId,
    ColecaoId: colecaoId,
    GrupoId: grupoId,
    Pagina: pagina,
    TamanhoPagina: tamanhoPagina,
  });
}

/** Todas as linhas de estoque (todas as lojas) de UMA variação, paginando. */
export async function listarEstoqueDaVariacao(
  variacaoId: string
): Promise<EstoqueVariacaoPdv[]> {
  const todos: EstoqueVariacaoPdv[] = [];
  let pagina = 1;
  while (pagina <= MAX_PAGINAS_LISTA_COMPLETA) {
    const { registros, paginacao } = await listarEstoqueVariacao({
      variacaoId,
      pagina,
      tamanhoPagina: PDV_MAX_TAM_PAGINA,
    });
    todos.push(...registros);
    if (!paginacao?.TemProximaPagina || registros.length === 0) break;
    pagina++;
  }
  return todos;
}

// ===========================================================================
// Preços — tabelas de preço e o preço de varejo por variação.
// ===========================================================================

export interface TabelaPrecoPdv {
  Codigo: number;
  Descricao: string;
  Tipo: number;
  Descricaofranquia?: string;
}

/**
 * GET /api/public/RecursoInicial/TabelasPreco/{codigoFilial}
 * Devolve um array puro de tabelas de preço. A de varejo é a que tem
 * `Descricao` "VAREJO" (ex.: "3 VAREJO").
 */
export async function listarTabelasPreco(codigoFilial: number): Promise<TabelaPrecoPdv[]> {
  const data = await chamarApi<any>(`/api/public/RecursoInicial/TabelasPreco/${codigoFilial}`);
  return Array.isArray(data) ? data : extrairLista<TabelaPrecoPdv>(data);
}

export interface PrecoPdv {
  VariacaoId: string;
  PrecoOriginal: number;
  PrecoPromocional?: number;
  DataAtualizacao?: string;
}

/**
 * GET /api/public/precos/{tabelaId} — todos os preços de uma tabela, paginado
 * ({ Registros, PaginacaoInfo }). Não tem filtro incremental (testado), então
 * a sync varre a tabela inteira (~750k linhas) por cursor de página.
 */
export async function listarPrecos(
  tabelaId: number,
  params: { pagina?: number; tamanhoPagina?: number }
): Promise<RespostaPaginada<PrecoPdv>> {
  return chamarApiPaginado<PrecoPdv>(`/api/public/precos/${tabelaId}`, {
    Pagina: params.pagina,
    TamanhoPagina: params.tamanhoPagina,
  });
}
