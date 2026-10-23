/**
 * Diagnóstico SOMENTE LEITURA: por que algumas notas que o Arquivei mostra não
 * existem no app? Faz duas verificações:
 *  A) para 6 chaves que faltam, pergunta direto à API da Qive se ela devolve a
 *     nota e confere se ela está no nosso banco;
 *  B) varre as notas que a Qive criou nos últimos N dias e conta quantas são
 *     dos 51 CNPJs que não aparecem no app, e quantas já estão no banco.
 *
 * Uso: npx tsx --env-file=.env scripts\diagnostico-qive-chaves.ts [DIAS]
 */
import { PrismaClient } from "@prisma/client";
import { buscarNfesRecebidasPorJanela } from "../src/lib/qive";

const prisma = new PrismaClient();

const CHAVES = [
  "29261045075049000303550010006643951344298441", // NEW BRASIL ARTIGOS ESPORT 23/10
  "35261030126886000185550010000019191270428241", // LM PRODUTOS LICENCIADOS L 23/10
  "31261042274696009574550010005310891151368235", // adidas do Brasil Ltda 23/10
  "35261018130395000374550010001422811417092634", // NTK CONFECCOES LTDA 23/10
  "35261018130395000374550010001422821422863861", // NTK CONFECCOES LTDA 23/10
  "31261055380250000277550040000213441108359828", // JCP FASHION COMPANY LTDA 23/10
];
const CNPJS_AUSENTES = new Set(["18351537000161","18351537000404","36623945000107","40002900000192","50260604000226","52348093000224","55294116000172","57748564000124","58599699000138","59027598000155","59240611000150","59270317000271","59340038000156","59402584000174","59474154000168","59535896000156","59757439000106","59842533000163","60025340000107","61271371000100","61577459000147","61985306000139","62352498000109","62353323000116","62914052000120","63326867000151","63530344000122","63543422000123","63588316000166","64435343000161","64479490000133","64665925000134","64675089000179","64761404000180","64894387000150","64917369000146","64990549000153","65068515000179","65346291000110","65846166000179","66007130000164","66733721000119","66768704000117","66792103000140","66831746000155","66840197000185","67741046000132","67741217000123","67746952000120","67937517000182","69165569000103"]);

const dia = (d: Date) => d.toISOString().slice(0, 10);

async function qiveChave(chave: string) {
  const url = `https://api.arquivei.com.br/v1/nfe/received?access_key[]=${chave}&limit=1`;
  const res = await fetch(url, {
    headers: {
      "X-API-ID": process.env.QIVE_API_ID ?? "",
      "X-API-KEY": process.env.QIVE_API_KEY ?? "",
      Accept: "application/json",
    },
  });
  const txt = await res.text();
  let n = -1;
  try {
    const j = JSON.parse(txt);
    n = Array.isArray(j.data) ? j.data.length : -1;
  } catch {}
  return { status: res.status, n, trecho: txt.slice(0, 160) };
}

async function pagina(desde: string, ate: string, cursor: number) {
  let ultimo: unknown;
  for (let t = 1; t <= 5; t++) {
    try {
      return await buscarNfesRecebidasPorJanela(desde, ate, cursor);
    } catch (e) {
      ultimo = e;
      await new Promise((r) => setTimeout(r, 2000 * t));
    }
  }
  throw ultimo;
}

async function main() {
  console.log("=== A) Chaves que faltam no app ===");
  for (const ch of CHAVES) {
    const noBanco = await prisma.note.findUnique({ where: { chaveAcesso: ch }, select: { id: true } });
    const q = await qiveChave(ch);
    console.log(
      `${ch.slice(-12)} | no banco: ${noBanco ? "SIM" : "não"} | Qive: HTTP ${q.status}, ${q.n < 0 ? "resposta inesperada: " + q.trecho : q.n + " nota(s) devolvida(s)"}`
    );
  }

  const dias = parseInt(process.argv[2] ?? "2", 10) || 2;
  const desde = dia(new Date(Date.now() - dias * 86_400_000));
  const ate = dia(new Date(Date.now() + 86_400_000));
  console.log(`\n=== B) Notas que a Qive criou de ${desde} a ${ate} ===`);
  let cursor = 0, lidas = 0, doAusentes = 0, doAusentesNoBanco = 0, noBancoTotal = 0;
  const porCnpj = new Map<string, number>();
  for (let i = 0; i < 80; i++) {
    const pag = await pagina(desde, ate, cursor);
    const chaves = pag.notas.map((n) => n.access_key);
    const existentes = new Set(
      (await prisma.note.findMany({ where: { chaveAcesso: { in: chaves } }, select: { chaveAcesso: true } })).map((n) => n.chaveAcesso)
    );
    for (const n of pag.notas) {
      lidas++;
      const xml = Buffer.from(n.xml ?? "", "base64").toString("utf8");
      const m = /<dest>[\s\S]*?<CNPJ>(\d{14})<\/CNPJ>/.exec(xml);
      const cnpj = m?.[1] ?? "";
      const noBanco = existentes.has(n.access_key);
      if (noBanco) noBancoTotal++;
      if (CNPJS_AUSENTES.has(cnpj)) {
        doAusentes++;
        if (noBanco) doAusentesNoBanco++;
        porCnpj.set(cnpj, (porCnpj.get(cnpj) ?? 0) + 1);
      }
    }
    if (!pag.notas.length || pag.proximoCursor == null || pag.proximoCursor === cursor) break;
    cursor = pag.proximoCursor;
    if ((i + 1) % 10 === 0) console.log(`  ... ${lidas} notas lidas`);
  }
  console.log(`Notas devolvidas pela Qive: ${lidas} | já no banco: ${noBancoTotal}`);
  console.log(`Dos 51 CNPJs ausentes: ${doAusentes} notas devolvidas pela Qive, ${doAusentesNoBanco} já no banco`);
  [...porCnpj.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([c, q]) => console.log(`  ${c}: ${q}`));
  if (doAusentes === 0) console.log("→ A Qive NÃO devolve notas desses CNPJs para a nossa chave de API.");
  else if (doAusentesNoBanco < doAusentes) console.log("→ A Qive devolve, mas o app ainda não importou (problema da sincronização).");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
