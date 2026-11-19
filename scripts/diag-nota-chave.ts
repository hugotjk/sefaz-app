/**
 * SOMENTE LEITURA. Por que uma nota (pela chave de acesso) não está no banco do app?
 * Confere: (1) se a nota está no banco; (2) se o CNPJ do destinatário está na lista que o app consulta na Qive
 * (lojas ativas, certificados com consulta ativa, CNPJs que já têm nota); (3) se a Qive lista a chave para esse
 * CNPJ na data de emissão; (4) se o XML veio completo e lê.
 *
 *   npx tsx --env-file=.env scripts/diag-nota-chave.ts --chave=35260904692027001034550050109808971019524031 --cnpj=13802917000151
 */
import { prisma } from "../src/lib/db";
import { listarChavesV2, buscarNfesV2 } from "../src/lib/qive";
import { parseNFeXml } from "../src/lib/parse-nfe-xml";

const arg = (n: string) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);
const dig = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const dia = (d: Date) => d.toISOString().slice(0, 10);
const somaDias = (iso: string, n: number) => dia(new Date(new Date(iso + "T00:00:00Z").getTime() + n * 86_400_000));

async function main() {
  const chave = dig(arg("chave"));
  const cnpj = dig(arg("cnpj"));
  if (chave.length !== 44 || cnpj.length !== 14) throw new Error("use --chave=(44 dígitos) --cnpj=(14 dígitos do destinatário)");
  const aamm = chave.slice(2, 6);
  const emissaoMes = `20${aamm.slice(0, 2)}-${aamm.slice(2, 4)}`;
  console.log(`Chave ${chave}\n  emitente (da chave): ${chave.slice(6, 20)} | série ${Number(chave.slice(22, 25))} | número ${Number(chave.slice(25, 34))} | mês de emissão ${emissaoMes}`);

  // 1) no banco?
  const n = await prisma.note.findUnique({ where: { chaveAcesso: chave }, select: { id: true, status: true, cnpjDestino: true, dataEmissao: true } });
  console.log(`\n1) Nota no banco: ${n ? `SIM (${JSON.stringify(n)})` : "NÃO"}`);

  // 2) CNPJ na lista consultada?
  const loja = await prisma.lojaCadastro.findMany({ where: { cnpj }, select: { cnpj: true, ativa: true } });
  const cert = await prisma.certificate.findMany({ where: { cnpj }, select: { cnpj: true, consultaAtiva: true } });
  const nNotas = await prisma.note.count({ where: { cnpjDestino: cnpj } });
  console.log(`\n2) CNPJ ${cnpj} na lista de consulta da Qive:`);
  console.log(`   lojaCadastro: ${loja.length ? JSON.stringify(loja) : "NÃO CADASTRADO"}`);
  console.log(`   certificados: ${cert.length ? JSON.stringify(cert) : "nenhum"}`);
  console.log(`   notas já no banco com esse destinatário: ${nNotas}`);
  const entra = loja.some((l: any) => l.ativa) || cert.some((c: any) => c.consultaAtiva) || nNotas > 0;
  console.log(`   => ${entra ? "o app CONSULTA este CNPJ" : "o app NÃO consulta este CNPJ (não está em nenhuma das 3 listas)"}`);

  // 3) Qive lista a chave?
  const de = somaDias(`${emissaoMes}-01`, -2);
  const ate = somaDias(`${emissaoMes}-28`, 6);
  console.log(`\n3) Qive v2, CNPJ ${cnpj}, emissão de ${de} a ${ate}:`);
  let ks: { chave: string; emissao: string }[] = [];
  try {
    ks = await listarChavesV2(cnpj, de, ate);
    console.log(`   Qive devolveu ${ks.length} chaves; a chave procurada ${ks.some((k) => k.chave === chave) ? "ESTÁ na lista" : "NÃO está na lista"}`);
  } catch (e: any) {
    console.log(`   erro ao listar na Qive: ${String(e?.message).slice(0, 200)}`);
  }

  // 4) XML
  if (ks.some((k) => k.chave === chave)) {
    const notas = await buscarNfesV2(cnpj, de, ate).catch((e: any) => { console.log(`   erro ao baixar XML: ${String(e?.message).slice(0, 200)}`); return []; });
    const nfe: any = notas.find((x: any) => x.access_key === chave);
    console.log(`\n4) XML: ${nfe ? "veio" : "a Qive NÃO devolveu o XML desta nota"}`);
    if (nfe) {
      const xml = Buffer.from(nfe.xml ?? "", "base64").toString("utf8");
      console.log(`   ${xml.length} caracteres`);
      try {
        const p: any = parseNFeXml(xml);
        console.log(`   lê OK: emitente ${p.emitente?.nome} | destinatário "${p.destinatario?.cnpjCpf}" | nº ${p.numero} série ${p.serie} | valor ${p.totais?.valorTotalNota} | ${p.tipoOperacao} | itens ${p.itens?.length}`);
      } catch (e: any) {
        console.log(`   XML NÃO LÊ: ${String(e?.message).slice(0, 160)}`);
      }
    }
  }
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
