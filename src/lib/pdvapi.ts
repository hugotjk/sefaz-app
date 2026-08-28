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

async function login(): Promise<string> {
  checarConfiguracao();
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
  return data.Token as string;
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
    throw new Error(`Erro na API do PDV (HTTP ${res.status}) em ${path}: ${trecho}`);
  }

  return res.json();
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
  const data = await chamarApi<{ Data?: LojaPdv[] } | LojaPdv[]>("/api/public/lojas");
  // A API pode devolver a lista direto ou dentro de um envelope { Data: [...] }
  return Array.isArray(data) ? data : (data as any).Data ?? [];
}

export interface RedePdv {
  Id: number;
  Nome: string;
  Inativa: boolean;
}

export async function listarRedes(): Promise<RedePdv[]> {
  const data = await chamarApi<{ Data?: RedePdv[] } | RedePdv[]>("/api/public/redes");
  return Array.isArray(data) ? data : (data as any).Data ?? [];
}

export interface EmpresaPdv {
  Codigo: number;
  Razaosocial: string;
  Inativa: boolean;
}

export async function listarEmpresas(): Promise<EmpresaPdv[]> {
  const data = await chamarApi<{ Data?: EmpresaPdv[] } | EmpresaPdv[]>(
    "/api/public/RecursoInicial/Empresas"
  );
  return Array.isArray(data) ? data : (data as any).Data ?? [data as any];
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
