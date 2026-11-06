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

/** Sem CNPJ nem nome de loja: casa pela razão social curta (a empresa). Devolve os CNPJs da empresa, se for uma só. */
export function cnpjsPelaRazao(nomeArquivo: string, lojas: LojaMin[]): string[] {
  const n = " " + norm(nomeArquivo.replace(/\.[^.]+$/, "")) + " ";
  let melhor = 0;
  let raizes = new Map<string, Set<string>>();
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
      raizes.set(r, (raizes.get(r) ?? new Set()).add(l.cnpj));
    }
  }
  if (raizes.size !== 1) return [];
  return [...[...raizes.values()][0]].sort();
}

export function identificar(nomeArquivo: string, lojas: LojaMin[]) {
  const tipo = tipoPeloNome(nomeArquivo);
  let cnpj = cnpjPeloNome(nomeArquivo, lojas) ?? cnpjPeloNomeDaLoja(nomeArquivo, lojas);
  let todosCnpjs = false;
  if (!cnpj) {
    const cs = cnpjsPelaRazao(nomeArquivo, lojas);
    if (cs.length === 1) cnpj = cs[0];
    else if (cs.length > 1 && tipo === "contrato") {
      cnpj = cs[0]; // contrato da empresa: uma cópia para cada CNPJ dela
      todosCnpjs = true;
    }
  }
  return { tipo, cnpj, todosCnpjs };
}
