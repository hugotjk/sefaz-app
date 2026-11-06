import { prisma } from "@/lib/db";
import { b2Delete, b2Get, b2List, b2Put, contentTypePorNome } from "@/lib/b2";
import { TIPOS_DOC, nomeArquivoDoc, nomePastaCnpj, raizCnpj } from "@/lib/lojas-docs";

export interface GuardadoRes {
  id: string;
  nomeArquivo: string;
  jaExistia?: boolean;
}

export interface GuardarArgs {
  buffer: Buffer;
  nomeOriginal: string;
  tipo: string;
  cnpj?: string; // tipos de escopo CNPJ
  lojaId?: string; // fotos
  validade?: Date | null;
  todosCnpjsDaEmpresa?: boolean; // grava uma cópia para cada CNPJ da mesma raiz
}

const extensaoDe = (n: string) => {
  const m = /\.[A-Za-z0-9]{1,5}$/.exec(n);
  return m ? m[0].toLowerCase() : "";
};
const hoje = () => new Date().toISOString().slice(0, 10);

/** Dados da unidade: razão social e nome da loja (só se houver um nome de loja único para o CNPJ). */
async function dadosCnpj(cnpj: string) {
  const lojas = await prisma.lojaCadastro.findMany({ where: { cnpj } });
  const razao = lojas.find((l) => l.razaoSocial)?.razaoSocial ?? null;
  const ativas = lojas.filter((l) => l.ativa);
  const nomes = [...new Set((ativas.length ? ativas : lojas).map((l) => l.loja))];
  return { razao, loja: nomes.length === 1 ? nomes[0] : "" };
}

async function gravarUm(
  buffer: Buffer,
  nomeOriginal: string,
  tipo: string,
  escopo: "CNPJ" | "LOJA",
  chave: string,
  cnpj: string,
  loja: string,
  razao: string | null,
  validade: Date | null | undefined
): Promise<GuardadoRes> {
  const ext = extensaoDe(nomeOriginal);
  // mesmo arquivo (mesmo tamanho e mesmo conteúdo) já guardado neste tipo/chave: não grava de novo
  const candidatos = await prisma.documentoLoja.findMany({ where: { escopo, chave, tipo, tamanho: buffer.length } });
  for (const c of candidatos) {
    if (!c.driveItemId) continue;
    try {
      if ((await b2Get(c.driveItemId)).equals(buffer)) return { id: c.id, nomeArquivo: c.nomeArquivo, jaExistia: true } as GuardadoRes;
    } catch {
      /* arquivo sumiu do armazenamento: segue e grava */
    }
  }
  const pasta = nomePastaCnpj(cnpj, razao);
  let nome = nomeArquivoDoc({ tipo, razao, loja, cnpj, extensao: ext });
  const jaTem = await prisma.documentoLoja.findMany({ where: { escopo, chave, tipo }, select: { nomeArquivo: true } });
  const usados = new Set(jaTem.map((d) => d.nomeArquivo));
  if (usados.has(nome) || tipo === "foto") {
    const base = nome.slice(0, nome.length - ext.length);
    nome = `${base} (${hoje()})${ext}`;
    let i = 2;
    while (usados.has(nome)) nome = `${base} (${hoje()}) (${i++})${ext}`;
  }
  const key = `${pasta}/${nome}`;
  await b2Put(key, buffer, contentTypePorNome(nome));
  const doc = await prisma.documentoLoja.create({
    data: { escopo, chave, tipo, nomeArquivo: nome, driveItemId: key, tamanho: buffer.length, validade: validade ?? null },
  });
  return { id: doc.id, nomeArquivo: nome } as GuardadoRes;
}

export async function guardarDocumento(a: GuardarArgs) {
  const t = TIPOS_DOC.find((x) => x.id === a.tipo);
  if (!t) throw new Error("Tipo de documento inválido.");

  if (t.escopo === "LOJA") {
    if (!a.lojaId) throw new Error("Escolha a loja para guardar a foto.");
    const l = await prisma.lojaCadastro.findUnique({ where: { id: a.lojaId } });
    if (!l || !l.cnpj) throw new Error("Loja não encontrada ou sem CNPJ.");
    return [await gravarUm(a.buffer, a.nomeOriginal, a.tipo, "LOJA", l.id, l.cnpj, l.loja, l.razaoSocial, null)];
  }

  if (!a.cnpj) throw new Error("Escolha o CNPJ para guardar o documento.");
  let cnpjs = [a.cnpj];
  if (a.todosCnpjsDaEmpresa) {
    const raiz = raizCnpj(a.cnpj);
    const todas = await prisma.lojaCadastro.findMany({ where: { cnpj: { startsWith: raiz } }, select: { cnpj: true, ativa: true } });
    cnpjs = [...new Set(todas.filter((l) => l.cnpj.length === 14 && (l.ativa || l.cnpj === a.cnpj)).map((l) => l.cnpj))];
    if (!cnpjs.includes(a.cnpj)) cnpjs.push(a.cnpj);
  }
  const out: GuardadoRes[] = [];
  for (const c of cnpjs) {
    const d = await dadosCnpj(c);
    out.push(await gravarUm(a.buffer, a.nomeOriginal, a.tipo, "CNPJ", c, c, d.loja, d.razao, a.validade));
  }
  return out;
}

const PREFIXO_FILA = "_nao-identificados/";

/** Coloca na fila de não identificados, sem repetir o mesmo arquivo (mesmo nome, tamanho e conteúdo). */
export async function guardarNaFila(buffer: Buffer, nome: string, contentType: string): Promise<{ jaEstava: boolean }> {
  const limpo = nome.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const itens = await b2List(PREFIXO_FILA);
  for (const i of itens) {
    if (i.size !== buffer.length || !i.key.endsWith(`__${limpo}`)) continue;
    if ((await b2Get(i.key)).equals(buffer)) return { jaEstava: true };
  }
  await b2Put(`${PREFIXO_FILA}${Date.now()}__${limpo}`, buffer, contentType);
  return { jaEstava: false };
}

/** Apaga cópias idênticas (mantém a mais antiga) nos documentos guardados e na fila. */
export async function limparDuplicados() {
  let docsRemovidos = 0;
  let filaRemovidos = 0;

  const docs = await prisma.documentoLoja.findMany({ orderBy: { enviadoEm: "asc" } });
  const grupos = new Map<string, typeof docs>();
  for (const d of docs) {
    if (!d.driveItemId || d.tamanho == null) continue;
    const k = `${d.escopo}|${d.chave}|${d.tipo}|${d.tamanho}`;
    grupos.set(k, [...(grupos.get(k) ?? []), d]);
  }
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    const mantidos: { d: (typeof g)[number]; buf: Buffer }[] = [];
    for (const d of g) {
      const buf = await b2Get(d.driveItemId!);
      if (mantidos.some((m) => m.buf.equals(buf))) {
        await b2Delete(d.driveItemId!);
        await prisma.documentoLoja.delete({ where: { id: d.id } });
        docsRemovidos++;
      } else mantidos.push({ d, buf });
    }
  }

  const fila = (await b2List(PREFIXO_FILA)).filter((i) => i.key !== PREFIXO_FILA).sort((a, b) => a.key.localeCompare(b.key));
  const porNome = new Map<string, { key: string; size: number }[]>();
  for (const i of fila) {
    const k = `${i.key.replace(/^.*?__/, "")}|${i.size}`;
    porNome.set(k, [...(porNome.get(k) ?? []), i]);
  }
  for (const g of porNome.values()) {
    if (g.length < 2) continue;
    const base = await b2Get(g[0].key);
    for (const extra of g.slice(1)) {
      if ((await b2Get(extra.key)).equals(base)) {
        await b2Delete(extra.key);
        filaRemovidos++;
      }
    }
  }
  return { docsRemovidos, filaRemovidos };
}
