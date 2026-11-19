/**
 * Puxa as notas de UM certificado direto da SEFAZ (distribuição DF-e), no seu PC, sem Inngest.
 * Faz o mesmo que a função de sincronização do app: consulta a partir do ultNSU salvo, grava as notas
 * (resumo), avança o ultNSU e marca o backfill como concluído quando a SEFAZ diz que não há mais nada.
 * Depois (com --xml) busca o XML completo das notas pendentes e popula os itens, como o job completarXmlNotas.
 *
 *   Simulação (1 consulta à SEFAZ, não grava):  npx tsx --env-file=.env scripts/sincronizar-sefaz-certificado.ts --cnpj=55294116000172
 *   Gravar o histórico:                          npx tsx --env-file=.env scripts/sincronizar-sefaz-certificado.ts --cnpj=55294116000172 --apply
 *   Gravar + XML completo e itens:               npx tsx --env-file=.env scripts/sincronizar-sefaz-certificado.ts --cnpj=55294116000172 --apply --xml
 *
 * Opções: --max-paginas=200 (páginas de até 50 docs; padrão 200)  --intervalo=25 (segundos entre consultas ao mesmo CNPJ)
 * Se a SEFAZ responder cStat 656 (consumo indevido) o script PARA: espere cerca de 1 hora e rode de novo (retoma do ultNSU).
 * Seguro para repetir/interromper (Ctrl+C): o ultNSU só avança depois de gravar cada página.
 */
import { prisma } from "../src/lib/db";
import { decryptCertificate } from "../src/lib/crypto";
import { consultarDistribuicaoDFe } from "../src/lib/sefaz";
import { parseDocumento } from "../src/lib/parse-documento";
import { obterXmlNota } from "../src/lib/obter-xml-nota";
import { popularNotaItens } from "../src/lib/popular-nota-itens";

const arg = (n: string) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);
const APLICAR = process.argv.includes("--apply");
const COM_XML = process.argv.includes("--xml");
const CNPJ = (arg("cnpj") ?? "").replace(/\D/g, "");
const MAX_PAGINAS = Number(arg("max-paginas") ?? 200);
const INTERVALO_MS = Number(arg("intervalo") ?? 25) * 1000;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (CNPJ.length !== 14) throw new Error("use --cnpj=(14 dígitos)");
  const cert = await prisma.certificate.findUnique({ where: { cnpj: CNPJ } });
  if (!cert) throw new Error(`Certificado do CNPJ ${CNPJ} não está cadastrado no app.`);
  console.log(`${APLICAR ? "[APPLY]" : "[SIMULAÇÃO]"} ${cert.razaoSocial ?? ""} (${CNPJ}) | status ${cert.status} | consultaAtiva ${cert.consultaAtiva} | backfillDone ${cert.backfillDone} | ultNSU ${cert.ultNSU} | maxNSU ${cert.maxNSU} | válido até ${cert.validUntil?.toISOString().slice(0, 10) ?? "?"}`);
  if (cert.status !== "ACTIVE") throw new Error(`Certificado com status ${cert.status} (${cert.lastError ?? "sem detalhe"}). Corrija no app antes.`);
  if (!cert.consultaAtiva) throw new Error("Consulta pausada para este certificado (consultaAtiva = false).");
  if (cert.validUntil && cert.validUntil < new Date()) throw new Error("Certificado vencido.");

  const { pfxBase64, password } = decryptCertificate(cert);
  const pfxBuffer = Buffer.from(pfxBase64, "base64");
  let ultNSU = cert.ultNSU;
  let notas = 0, eventos = 0, paginas = 0, concluido = false, parouPor = "";
  const novasChaves: string[] = [];

  while (paginas < MAX_PAGINAS) {
    paginas++;
    const r = await consultarDistribuicaoDFe({ cnpj: CNPJ, ultNSU, pfxBuffer, senha: password });
    console.log(`  página ${paginas}: cStat ${r.statusCode} (${r.motivo}) | ${r.documentos.length} docs | ultNSU ${r.ultNSU} / maxNSU ${r.maxNSU}`);
    if (r.statusCode !== "138" && r.statusCode !== "137") {
      parouPor = `cStat ${r.statusCode}: ${r.motivo}${r.statusCode === "656" ? " — consumo indevido: espere ~1 hora e rode de novo" : ""}`;
      break;
    }
    if (!APLICAR) {
      const resumo = r.documentos.map((d) => parseDocumento(d)).filter(Boolean) as any[];
      console.log(`  (simulação) ${resumo.filter((x) => x.tipo === "nota").length} notas e ${resumo.filter((x) => x.tipo !== "nota").length} eventos nesta página; nada gravado.`);
      parouPor = "simulação (1 página)";
      break;
    }
    for (const doc of r.documentos) {
      const item = parseDocumento(doc);
      if (!item) continue;
      if (item.tipo === "nota") {
        const existia = await prisma.note.findUnique({ where: { chaveAcesso: item.chaveAcesso }, select: { id: true } });
        await prisma.note.upsert({
          where: { chaveAcesso: item.chaveAcesso },
          create: {
            chaveAcesso: item.chaveAcesso, cnpjDestino: cert.cnpj, certificateId: cert.id, numero: item.numero, serie: item.serie,
            tipoOperacao: item.tipoOperacao, emitenteCnpj: item.emitenteCnpj, emitenteNome: item.emitenteNome, valorTotal: item.valorTotal,
            dataEmissao: new Date(item.dataEmissao), status: item.status, xmlCompleto: "", nsu: item.nsu,
          },
          update: { status: item.status },
        });
        if (!existia) { notas++; novasChaves.push(item.chaveAcesso); }
      } else {
        const nota = await prisma.note.findUnique({ where: { chaveAcesso: item.chaveAcesso } });
        if (!nota) continue;
        await prisma.noteEvent.create({
          data: { noteId: nota.id, tipo: item.tipoEvento as any, descricao: item.descricao, xmlEvento: "", nsu: item.nsu, dataEvento: item.dataEvento ? new Date(item.dataEvento) : null },
        });
        if (item.tipoEvento === "CANCELAMENTO") await prisma.note.update({ where: { id: nota.id }, data: { status: "CANCELADA" } });
        eventos++;
      }
    }
    await prisma.certificate.update({ where: { id: cert.id }, data: { ultNSU: r.ultNSU, maxNSU: r.maxNSU } });
    ultNSU = r.ultNSU;
    if (r.semDocumentosNovos) {
      if (!cert.backfillDone) await prisma.certificate.update({ where: { id: cert.id }, data: { backfillDone: true } });
      concluido = true;
      break;
    }
    await dormir(INTERVALO_MS);
  }

  console.log(`\n=== NOTAS (SEFAZ) === páginas: ${paginas} | notas novas gravadas: ${notas} | eventos: ${eventos} | ultNSU ${ultNSU} | histórico concluído: ${concluido ? "SIM" : "não"}${parouPor ? ` | parou por: ${parouPor}` : ""}`);
  if (!APLICAR) { console.log("Nada foi gravado (simulação). Rode com --apply."); return; }
  if (!concluido && !parouPor) console.log(`Chegou no limite de ${MAX_PAGINAS} páginas: rode de novo para continuar do ultNSU salvo.`);

  if (COM_XML) {
    const pend = await prisma.note.findMany({ where: { cnpjDestino: CNPJ, certificateId: cert.id, xmlCompleto: "" }, select: { chaveAcesso: true, id: true }, orderBy: { dataEmissao: "desc" } });
    console.log(`\nXML completo: ${pend.length} notas pendentes deste CNPJ`);
    let ok = 0, resumo = 0, erro = 0;
    for (let i = 0; i < pend.length; i++) {
      const res = await obterXmlNota(pend[i].chaveAcesso);
      if (!("erro" in res)) {
        await popularNotaItens(pend[i].id, res.xml);
        ok++;
      } else if (/cstat\s*656|consumo\s+indevido/i.test(res.erro)) {
        console.log("  cStat 656 (consumo indevido) no XML: parando. Espere ~1 hora e rode de novo com --xml.");
        break;
      } else if (res.status === 409) resumo++;
      else { erro++; console.log(`  ! ${pend[i].chaveAcesso}: ${res.erro.slice(0, 100)}`); }
      if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${pend.length} | ok ${ok} | só resumo ${resumo} | erros ${erro}`);
      await dormir(INTERVALO_MS);
    }
    console.log(`\n=== XML === completas: ${ok} | ainda só resumo: ${resumo} | erros: ${erro}`);
  } else {
    console.log("\nObs.: as notas entram só com o resumo. Rode de novo com --xml (ou abra a nota no app) para trazer o XML completo e os itens.");
  }
}
main().catch((e) => console.error(String(e?.message ?? e))).finally(() => prisma.$disconnect());
