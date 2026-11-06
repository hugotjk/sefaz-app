/** Regras compartilhadas da tela de Documentações das lojas. */

export type EscopoDoc = "EMPRESA" | "CNPJ" | "LOJA";

export interface TipoDoc {
  id: string;
  nome: string;
  curto: string;
  escopo: EscopoDoc; // EMPRESA = vale para todos os CNPJs da raiz; CNPJ = de cada CNPJ; LOJA = de cada loja
  obrigatorio: boolean;
}

export const TIPOS_DOC: TipoDoc[] = [
  { id: "contrato", nome: "Contrato / alteração contratual", curto: "Contrato", escopo: "CNPJ", obrigatorio: true },
  { id: "cnpj", nome: "Cartão CNPJ", curto: "Cartão CNPJ", escopo: "CNPJ", obrigatorio: true },
  { id: "ie", nome: "Inscrição estadual", curto: "IE", escopo: "CNPJ", obrigatorio: true },
  { id: "cert", nome: "Certificado digital", curto: "Certificado", escopo: "CNPJ", obrigatorio: true },
  { id: "alvara", nome: "Alvará", curto: "Alvará", escopo: "CNPJ", obrigatorio: true },
  { id: "foto", nome: "Fotos", curto: "Fotos", escopo: "LOJA", obrigatorio: false },
];

export const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** CNPJ só com dígitos; completa com zeros à esquerda se o Excel comeu (12-13 dígitos). */
export function normalizarCnpj(v: unknown): string {
  let d = soDigitos(v);
  if (d.length >= 12 && d.length < 14) d = d.padStart(14, "0");
  return d.length === 14 ? d : "";
}

export const raizCnpj = (cnpj: string) => cnpj.slice(0, 8);

/** 0001 = Matriz; 0002 em diante = Filial 01, 02, 03... */
export function tipoUnidade(cnpj: string): string {
  if (cnpj.length !== 14) return "";
  const ordem = parseInt(cnpj.slice(8, 12), 10);
  if (!Number.isFinite(ordem) || ordem <= 0) return "";
  if (ordem === 1) return "Matriz";
  return `Filial ${String(ordem - 1).padStart(2, "0")}`;
}

const PALAVRAS_GENERICAS = new Set([
  "ARTIGOS", "ARTIGO", "ART", "ARTS", "COMERCIO", "COM", "COMERCIAL", "VESTUARIO", "VEST", "ROUPAS",
  "ESPORTES", "ESPORTIVOS", "ACESSORIOS", "ACES", "LTDA", "EIRELI", "ME", "EPP", "DE", "DO", "DA", "E",
  "VAREJISTA", "SA", "CONFECCOES", "MATERIAL",
]);

/** Razão social curta: primeiras palavras até uma palavra genérica (máx. 4). Ex.: "GARDA ARTIGOS..." -> "GARDA". */
export function razaoCurta(razao: string | null | undefined): string {
  const sem = String(razao ?? "").replace(/^\s*\d+\s*-\s*/, "").toUpperCase();
  const toks = sem
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const t of toks) {
    if (PALAVRAS_GENERICAS.has(t)) break;
    out.push(t);
    if (out.length === 4) break;
  }
  return out.length ? out.join(" ") : toks.slice(0, 2).join(" ");
}

/** Pasta do CNPJ no OneDrive: "<cnpj> - <curta>". */
export function nomePastaCnpj(cnpj: string, razao: string | null | undefined) {
  return `${cnpj} - ${razaoCurta(razao)}`.replace(/[\\/:*?"<>|]+/g, " ").trim();
}

/**
 * Nome do arquivo: "Tipo - RAZÃO CURTA - LOJA - Matriz/Filial NN".
 * Se o nome da loja começa com a razão curta ("GARDA NA FLA"), tira essa parte da loja para não repetir:
 * "Cartão CNPJ - GARDA - NA FLA - Filial 01.pdf".
 */
export function nomeArquivoDoc(args: {
  tipo: string;
  razao: string | null | undefined;
  loja: string;
  cnpj: string;
  extensao: string;
}) {
  const t = TIPOS_DOC.find((x) => x.id === args.tipo);
  const curta = razaoCurta(args.razao);
  let loja = args.loja.trim();
  if (curta && loja.toUpperCase().startsWith(curta + " ")) loja = loja.slice(curta.length).trim();
  else if (curta && loja.toUpperCase() === curta) loja = "";
  const partes = [t?.curto ?? args.tipo];
  if (curta) partes.push(curta);
  if (loja) partes.push(loja);
  const un = tipoUnidade(args.cnpj);
  if (un) partes.push(un);
  const nome = partes.join(" - ").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${nome.slice(0, 150)}${args.extensao}`;
}

/** Loja com NRN no NOME da loja fica de fora (NRN só na razão social entra). */
export const lojaEhNrn = (loja: string) => /NRN/i.test(loja);
