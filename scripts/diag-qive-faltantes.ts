/**
 * SOMENTE LEITURA (não grava nada). Explica por que notas novas da Qive não entram:
 * lista as notas que faltam no banco (últimos N dias), baixa o XML e, para cada uma, mostra
 * se o XML lê, quais campos vêm e se o INSERT da nota funcionaria (teste dentro de uma
 * transação que sempre desfaz).
 *
 *   npx tsx --env-file=.env scripts/diag-qive-faltantes.ts [--dias=10]
 */
import { prisma } from "../src/lib/db";
import { listarChavesV2, buscarNfesV2 } from "../src/lib/qive";
import { parseNFeXml } from "../src/lib/parse-nfe-xml";

const arg = (n: string) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);
const DIAS = Number(arg("dias") ?? 10);
const dia = (d: Date) => d.toISOString().slice(0, 10);
const menosDias = (base: string, n: number) => dia(new Date(new Date(base + "T00:00:00Z").getTime() - n * 86_400_000));
const dig = (v: string) => (v || "").replace(/\D/g, "");

async function cnpjs(): Promise<string[]> {
  const lojas = await prisma.lojaCadastro.findMany({ where: { ativa: true }, select: { cnpj: true } });
  const certs = await prisma.certificate.findMany({ where: { consultaAtiva: true }, select: { cnpj: true } });
  const notas = await prisma.$queryRaw<{ c: string }[]>`SELECT DISTINCT "cnpjDestino" AS c FROM "Note" WHERE "cnpjDestino" IS NOT NULL`;
  const set = new Set<string>();
  for (const x of [...lojas.map((l: any) => l.cnpj), ...certs.map((c: any) => c.cnpj), ...notas.map((n) => n.c)]) {
    const d = dig(String(x ?? ""));
    if (d.length === 14) set.add(d);
  }
  return [...set].sort();
}

async function main() {
  const hoje = dia(new Date());
  const de = menosDias(hoje, DIAS - 1);
  const lista = await cnpjs();
  console.log(`Procurando notas que faltam: ${lista.length} CNPJs, emissão de ${de} a ${hoje}\n`);
  let achadas = 0;
  const causas = new Map<string, number>();

  for (const cnpj of lista) {
    let ks: { chave: string; emissao: string }[] = [];
    try { ks = await listarChavesV2(cnpj, de, hoje); } catch { continue; }
    if (ks.length === 0) continue;
    const tem = new Set(
      (await prisma.note.findMany({ where: { chaveAcesso: { in: ks.map((k) => k.chave) } }, select: { chaveAcesso: true } })).map((n: any) => n.chaveAcesso)
    );
    const faltam = ks.filter((k) => !tem.has(k.chave));
    if (faltam.length === 0) continue;
    const notas = await buscarNfesV2(cnpj, de, hoje).catch((e: any) => { console.log(`  ! ${cnpj}: erro ao baixar XML: ${String(e?.message).slice(0, 100)}`); return []; });
    const porChave = new Map(notas.map((n: any) => [n.access_key, n]));
    for (const f of faltam) {
      achadas++;
      const nfe: any = porChave.get(f.chave);
      console.log(`\n[${achadas}] CNPJ destino ${cnpj} | chave ${f.chave} | emissão ${f.emissao.slice(0, 10)}`);
      if (!nfe) { console.log("   -> a Qive NÃO devolveu o XML desta nota (só a chave)."); causas.set("sem XML na Qive", (causas.get("sem XML na Qive") ?? 0) + 1); continue; }
      const xml = Buffer.from(nfe.xml ?? "", "base64").toString("utf8");
      console.log(`   XML: ${xml.length} caracteres`);
      let p: any;
      try { p = parseNFeXml(xml); } catch (e: any) {
        console.log(`   -> XML NÃO LÊ: ${String(e?.message).slice(0, 120)}`);
        causas.set("XML não lê", (causas.get("XML não lê") ?? 0) + 1);
        continue;
      }
      console.log(`   emitente: ${p.emitente?.nome} (${p.emitente?.cnpj}) | destinatário doc: "${p.destinatario?.cnpjCpf}" | nº ${p.numero} série ${p.serie} | valor ${p.totais?.valorTotalNota} | data ${p.dataEmissao} | ${p.tipoOperacao} | itens ${p.itens?.length ?? "?"}`);
      if (!dig(p.destinatario?.cnpjCpf)) { causas.set("sem CNPJ/CPF do destinatário", (causas.get("sem CNPJ/CPF do destinatário") ?? 0) + 1); console.log("   -> SEM documento do destinatário"); continue; }
      try {
        await prisma.$transaction(async (tx) => {
          await tx.note.create({
            data: {
              chaveAcesso: f.chave,
              cnpjDestino: dig(p.destinatario.cnpjCpf),
              certificateId: null,
              numero: p.numero || null,
              serie: p.serie || null,
              emitenteCnpj: dig(p.emitente?.cnpj) || null,
              emitenteNome: p.emitente?.nome || null,
              valorTotal: p.totais?.valorTotalNota || null,
              dataEmissao: p.dataEmissao ? new Date(p.dataEmissao) : null,
              status: "AUTORIZADA",
              xmlCompleto: xml,
              nsu: "",
            } as any,
          });
          throw new Error("__DESFAZ__");
        });
      } catch (e: any) {
        if (e?.message === "__DESFAZ__") { console.log("   INSERT da nota: OK (teste desfeito). Se mesmo assim falha, o problema é ao gravar os ITENS."); causas.set("insert ok (problema nos itens?)", (causas.get("insert ok (problema nos itens?)") ?? 0) + 1); }
        else { console.log(`   -> INSERT FALHA: ${e?.code ?? ""} ${String(e?.message).split("\n").slice(-3).join(" ").slice(0, 300)}`); causas.set(`insert falha ${e?.code ?? ""}`, (causas.get(`insert falha ${e?.code ?? ""}`) ?? 0) + 1); }
      }
    }
  }
  console.log(`\n=== RESUMO === notas que faltam: ${achadas}`);
  for (const [k, n] of causas) console.log(`  ${n} x ${k}`);
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
