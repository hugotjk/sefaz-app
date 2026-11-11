/**
 * Compara o XML gerado por montarDevolucao com devoluções JÁ AUTORIZADAS.
 * Uso: npx tsx scripts/testar-devolucao-nfe.ts <pasta-com-xmls>
 * (a pasta deve ter as devoluções procNFe e as notas originais da Adidas)
 */
import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";
import { lerNotaOriginal, montarDevolucao, textoInfCpl } from "../src/lib/nfe-devolucao";
import emissor from "./data/emissor-lojas.json";

const dir = process.argv[2];
if (!dir) throw new Error("Informe a pasta dos XMLs.");
const p = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, isArray: (n) => n === "det" });

function achata(o: any, pre = "", out: Record<string, string> = {}) {
  if (Array.isArray(o)) o.forEach((x, i) => achata(x, `${pre}[${i}]`, out));
  else if (o && typeof o === "object") for (const k of Object.keys(o)) achata(o[k], pre ? `${pre}.${k}` : k, out);
  else out[pre] = String(o);
  return out;
}

const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith(".xml"));
const originais = new Map<string, ReturnType<typeof lerNotaOriginal>>();
const aceitas: { f: string; j: any; xml: string }[] = [];
for (const f of arquivos) {
  const xml = fs.readFileSync(path.join(dir, f), "utf8");
  let j: any;
  try { j = p.parse(xml); } catch { continue; }
  const inf = j?.nfeProc?.NFe?.infNFe;
  if (!inf) continue;
  if (inf.ide.finNFe === "4") aceitas.push({ f, j, xml });
  else originais.set(String(inf["@_Id"]).slice(3), lerNotaOriginal(xml));
}

// Diferenças conhecidas e aceitas: o sistema antigo variava as unidades (PC/UN) e usava origem 0
// mesmo em itens importados (orig 1 na original); aqui seguimos a nota original.
const IGNORAR = [/\.uCom$/, /\.uTrib$/, /ICMSSN900\.orig$/, /ICMS90\.orig$/, /verProc/, /xFant/, /xPais/, /xNome$/, /xMun$/, /\.dest\.enderDest\.xPais/, /Signature/, /protNFe/, /@_/, /ide\.dhSaiEnt$/, /ide\.cNF$/, /ide\.cDV$/];
let ok = 0, comDif = 0, semOriginal = 0;
for (const a of aceitas) {
  const inf = a.j.nfeProc.NFe.infNFe;
  const ref = inf.ide.NFref.refNFe;
  const orig = originais.get(ref);
  if (!orig) { semOriginal++; continue; }
  const loja = (emissor as any[]).find((l) => l.cnpj === inf.emit.CNPJ);
  const selecao = inf.det.map((d: any) => {
    const it = orig.itens.find((x) => x.ean === d.prod.cEAN && x.cProd === d.prod.cProd);
    return { nItem: it?.nItem ?? -1, qtd: Number(d.prod.qCom) };
  });
  // itens do aceito na ordem da original (o sistema antigo ordenava diferente)
  selecao.sort((x: any, y: any) => x.nItem - y.nItem);
  const caso = /CASE:\s*(\d+)/.exec(inf.infAdic?.infCpl ?? "")?.[1] ?? "";
  const r = montarDevolucao({
    loja: { ...loja, fone: loja.fone ?? null, complemento: loja.complemento ?? null },
    original: orig, selecao, serie: Number(inf.ide.serie), numero: Number(inf.ide.nNF),
    infCpl: inf.infAdic ? textoInfCpl(loja, orig.numero, caso) : "",
    contadorCnpj: inf.autXML ? inf.autXML.CNPJ : null,
    dataEmissao: new Date(inf.ide.dhEmi), cNF: inf.ide.cNF,
  });
  const g = achata(p.parse(r.xml).NFe.infNFe);
  // aceito: ordenar det por EAN p/ comparar
  const infA = { ...inf, det: [...inf.det].sort((x: any, y: any) => orig.itens.findIndex((i) => i.ean === x.prod.cEAN) - orig.itens.findIndex((i) => i.ean === y.prod.cEAN)) };
  const e = achata(infA);
  const difs: string[] = [];
  for (const k of new Set([...Object.keys(g), ...Object.keys(e)])) {
    if (IGNORAR.some((re) => re.test(k))) continue;
    if (/vICMS$/.test(k) && Math.abs(Number(g[k]) - Number(e[k])) <= 0.011) continue; // o sistema antigo truncava 1 centavo em alguns itens
    if (g[k] !== e[k]) difs.push(`${k}: gerado=${g[k]} aceito=${e[k]}`);
  }
  const chaveOk = r.chave === inf["@_Id"].slice(3);
  if (!difs.length && chaveOk) ok++; else { comDif++; console.log(`\n${a.f.slice(0, 70)} chaveOk=${chaveOk}`); difs.slice(0, 8).forEach((d) => console.log("  ", d)); }
}
console.log(`\nIdênticas: ${ok} | com diferença: ${comDif} | sem original aqui: ${semOriginal}`);
