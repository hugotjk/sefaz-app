import { normalizarCnpj, raizCnpj, razaoCurta, soDigitos } from "@/lib/lojas-docs";

export interface LojaMin {
  id: string;
  loja: string;
  razaoSocial: string | null;
  cnpj: string;
  ativa: boolean;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Tipo de documento pelas palavras do nome do arquivo (null se não der para saber). */
export function tipoPeloNome(nomeArquivo: string): string | null {
  const n = " " + norm(nomeArquivo.replace(/\.[^.]+$/, "")) + " ";
  if (/ alvara /.test(n)) return "alvara";
  if (/ (certificado|pfx|a1) /.test(n)) return "cert";
  if (/ (contrato|alteracao|aditivo|distrato|estatuto|ato constitutivo|requerimento de empresario) /.test(n)) return "contrato";
  if (/ (inscricao estadual|ie|insc est) /.test(n)) return "ie";
  if (/ (cartao cnpj|comprovante de inscricao|cnpj) /.test(n)) return "cnpj";
  return null;
}

/** CNPJ escrito no nome do arquivo (com ou sem pontuação), se existir entre as lojas cadastradas. */
export function cnpjPeloNome(nomeArquivo: string, lojas: LojaMin[]): string | null {
  const base = nomeArquivo.replace(/\.[^.]+$/, "");
  const achados = new Set<string>();
  for (const m of base.matchAll(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g)) {
    const c = normalizarCnpj(soDigitos(m[0]));
    if (c) achados.add(c);
  }
  const conhecidos = new Set(lojas.map((l) => l.cnpj).filter(Boolean));
  const validos = [...achados].filter((c) => conhecidos.has(c));
  return validos.length === 1 ? validos[0] : null;
}

/** Sem CNPJ no nome: casa pelo nome da loja (o mais longo contido no nome do arquivo); só vale se levar a um único CNPJ. */
export function cnpjPeloNomeDaLoja(nomeArquivo: string, lojas: LojaMin[]): string | null {
  const n = " " + norm(nomeArquivo.replace(/\.[^.]+$/, "")) + " ";
  let melhor = 0;
  let cnpjs = new Set<string>();
  for (const l of lojas) {
    if (!l.cnpj || !l.ativa) continue;
    const ln = norm(l.loja);
    if (ln.length < 4 || !n.includes(" " + ln + " ")) continue;
    if (ln.length > melhor) {
      melhor = ln.length;
      cnpjs = new Set([l.cnpj]);
    } else if (ln.length === melhor) cnpjs.add(l.cnpj);
  }
  return cnpjs.size === 1 ? [...cnpjs][0] : null;
}

/** CNPJs conhecidos citados num texto (PDF), do mais citado para o menos citado. */
export function cnpjsNoTexto(texto: string, lojas: LojaMin[]): { cnpj: string; vezes: number }[] {
  const conhecidos = new Set(lojas.map((l) => l.cnpj).filter(Boolean));
  const cont = new Map<string, number>();
  for (const m of texto.matchAll(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g)) {
    const c = normalizarCnpj(soDigitos(m[0]));
    if (c && conhecidos.has(c)) cont.set(c, (cont.get(c) ?? 0) + 1);
  }
  return [...cont.entries()].map(([cnpj, vezes]) => ({ cnpj, vezes })).sort((a, b) => b.vezes - a.vezes);
}

/** Pela razão social curta escrita no nome do arquivo: CNPJs da empresa (só lojas ativas, se houver). */
export function cnpjsPelaRazao(nomeArquivo: string, lojas: LojaMin[]): string[] {
  const n = " " + norm(nomeArquivo.replace(/\.[^.]+$/, "")) + " ";
  let melhor = 0;
  let raizes = new Map<string, LojaMin[]>();
  for (const l of lojas) {
    if (!l.cnpj || !l.razaoSocial) continue;
    const rn = norm(razaoCurta(l.razaoSocial));
    if (rn.length < 4 || !n.includes(" " + rn + " ")) continue;
    if (rn.length > melhor) {
      melhor = rn.length;
      raizes = new Map();
    }
    if (rn.length === melhor) {
      const r = raizCnpj(l.cnpj);
      raizes.set(r, [...(raizes.get(r) ?? []), l]);
    }
  }
  if (raizes.size !== 1) return [];
  const ls = [...raizes.values()][0];
  const ativos = ls.filter((l) => l.ativa);
  return [...new Set((ativos.length ? ativos : ls).map((l) => l.cnpj))].sort();
}

export interface Identificacao {
  tipo: string | null;
  cnpj: string | null;
  todosCnpjs: boolean;
  origem: string;
  aviso?: string;
}

const fmt = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

/**
 * Ordem: 1) CNPJ no nome do arquivo ou dentro do PDF; 2) razão social no nome; 3) nome da loja.
 * Se o CNPJ do PDF e o do nome do arquivo divergirem, devolve aviso (o arquivo vai para a fila).
 */
export function identificar(nomeArquivo: string, lojas: LojaMin[], textoPdf = ""): Identificacao {
  let tipo = tipoPeloNome(nomeArquivo);
  if (!tipo && textoPdf) tipo = tipoPeloNome(textoPdf.slice(0, 1500));

  const doNome = cnpjPeloNome(nomeArquivo, lojas);
  const doPdf = cnpjsNoTexto(textoPdf, lojas);
  const topo = doPdf[0];
  const pdfCnpj = topo && (doPdf.length === 1 || topo.vezes > doPdf[1].vezes) ? topo.cnpj : null;

  if (doNome && pdfCnpj && doNome !== pdfCnpj) {
    return { tipo, cnpj: null, todosCnpjs: false, origem: "conflito", aviso: `o nome do arquivo cita ${fmt(doNome)} e o PDF é do CNPJ ${fmt(pdfCnpj)}` };
  }
  if (doNome) return { tipo, cnpj: doNome, todosCnpjs: false, origem: "CNPJ no nome" };
  if (pdfCnpj) return { tipo, cnpj: pdfCnpj, todosCnpjs: false, origem: "CNPJ dentro do PDF" };

  const cs = cnpjsPelaRazao(nomeArquivo, lojas);
  if (cs.length === 1) return { tipo, cnpj: cs[0], todosCnpjs: false, origem: "razão social no nome" };
  if (cs.length > 1 && tipo === "contrato") return { tipo, cnpj: cs[0], todosCnpjs: true, origem: "razão social no nome" };

  const loja = cnpjPeloNomeDaLoja(nomeArquivo, lojas);
  return { tipo, cnpj: loja, todosCnpjs: false, origem: loja ? "nome da loja" : "" };
}
