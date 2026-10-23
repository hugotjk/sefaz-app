/**
 * Diagnóstico SOMENTE LEITURA: verifica se a Qive entrega eventos de ENTREGA
 * (110130 comprovante, 110131 cancelamento do comprovante, 110192 insucesso)
 * e quais outros tipos de evento existem na conta. Não grava nada.
 *
 * Uso: npx tsx --env-file=.env scripts\diagnostico-eventos-entrega.ts [DIAS] [FORNECEDOR]
 *   DIAS        janela de created_at (padrão 30)
 *   FORNECEDOR  trecho do nome do emitente a destacar (padrão ADIDAS)
 */
import { PrismaClient } from "@prisma/client";
import { buscarEventosNfe } from "../src/lib/qive";

const prisma = new PrismaClient();
const LOGISTICA = new Set([
  "110130", "110131", "110192", "110193",
  "610130", "610131", "610600", "610601", "610614", "610615",
]);

const NOMES: Record<string, string> = {
  "110110": "Carta de correção",
  "110111": "Cancelamento",
  "110112": "Cancelamento por substituição",
  "110130": "Comprovante de entrega",
  "110131": "Cancelamento do comprovante de entrega",
  "110192": "Insucesso na entrega",
  "110193": "Cancelamento do insucesso na entrega",
  "610600": "CT-e autorizado para a NF-e",
  "610601": "CT-e cancelado para a NF-e",
  "610610": "MDF-e autorizado",
  "610614": "MDF-e autorizado com CT-e",
  "610615": "MDF-e cancelado (com CT-e)",
  "610130": "Comprovante de entrega do CT-e",
  "610131": "Cancelamento do comprovante de entrega do CT-e",
  "510630": "Registro de passagem (MDF-e)",
  "610500": "Registro de passagem (autorização)",
  "610514": "Registro de passagem propagado (MDF-e/CT-e)",
  "210200": "Confirmação da operação",
  "210210": "Ciência da operação",
  "210220": "Desconhecimento da operação",
  "210240": "Operação não realizada",
};

function tag(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}>([\\s\\S]*?)</(?:\\w+:)?${nome}>`));
  return m ? m[1].trim() : null;
}

function dia(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const dias = parseInt(process.argv[2] ?? "30", 10) || 30;
  const forn = (process.argv[3] ?? "ADIDAS").toUpperCase();
  const desde = dia(new Date(Date.now() - dias * 86_400_000));
  const ate = dia(new Date(Date.now() + 86_400_000));
  console.log(`Eventos da Qive com created_at de ${desde} a ${ate} (máx. 60 páginas de 50)...\n`);

  const porTipo = new Map<string, number>();
  const entrega: { chave: string; tipo: string; data: string | null; texto: string | null; xml: string }[] = [];
  let total = 0;
  let cursor = 0;
  // 1 amostra de cada tipo fora da tabela NOMES (para descobrir o que é).
  const amostras = new Map<string, { chave: string; xml: string }>();

  for (let i = 0; i < 60; i++) {
    const pag = await buscarEventosNfe(desde, ate, cursor);
    for (const ev of pag.notas) {
      total++;
      const xml = Buffer.from(ev.xml ?? "", "base64").toString("utf8");
      const cod = ev.type || tag(xml, "tpEvento") || "?";
      porTipo.set(cod, (porTipo.get(cod) ?? 0) + 1);
      if (!NOMES[cod] && !amostras.has(cod)) amostras.set(cod, { chave: ev.access_key, xml });
      if (LOGISTICA.has(cod)) {
        entrega.push({
          xml,
          chave: ev.access_key,
          tipo: cod,
          data: tag(xml, "dhEvento"),
          texto:
            tag(xml, "xJust") ||
            tag(xml, "xMotivo") ||
            tag(xml, "xObs") ||
            tag(xml, "tpMotivo") ||
            tag(xml, "descEvento"),
        });
      }
    }
    if (pag.notas.length === 0 || pag.proximoCursor == null || pag.proximoCursor === cursor) break;
    cursor = pag.proximoCursor;
    if ((i + 1) % 10 === 0) console.log(`  ... ${total} eventos lidos`);
  }

  console.log(`\nTotal de eventos lidos: ${total}`);
  console.log("\n=== Eventos por tipo ===");
  [...porTipo.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([c, n]) => console.log(`${c}  ${(NOMES[c] ?? "(outro)").padEnd(40)} ${n}`));

  console.log("\n=== Amostra de cada tipo desconhecido ===");
  for (const [cod, a] of amostras) {
    const modelo = a.chave.slice(20, 22); // 55 = NF-e, 57 = CT-e, 58 = MDF-e
    const campos = ["descEvento", "xEvento", "xJust", "xObs", "dhEvento", "tpEvento", "nProt"]
      .map((t) => [t, tag(a.xml, t)] as const)
      .filter(([, v]) => v)
      .map(([t, v]) => `${t}=${String(v).slice(0, 90)}`)
      .join(" | ");
    console.log(`\n[${cod}] modelo da chave: ${modelo} | chave: ${a.chave}`);
    console.log(`   ${campos || "(sem campos conhecidos)"}`);
    console.log(`   XML (início): ${a.xml.replace(/\s+/g, " ").slice(0, 500)}`);
  }

  console.log(`\n=== Eventos de LOGÍSTICA (CT-e, MDF-e, entrega): ${entrega.length} ===`);
  if (entrega.length === 0) {
    console.log("Nenhum nesta janela.");
    return;
  }

  // Datas dos eventos (para saber se são recentes).
  const datas = entrega.map((e) => e.data).filter(Boolean).sort() as string[];
  console.log(`Datas dos eventos: de ${datas[0]} até ${datas[datas.length - 1]}`);

  // Detalhe de um comprovante de entrega (campos úteis: data, recebedor...).
  const ex = entrega.find((e) => e.tipo === "610130");
  if (ex) {
    const det = ex.xml.match(/<detEvento[\s\S]*?<\/detEvento>/);
    console.log("\nDetalhe de um 610130 (comprovante de entrega do CT-e):");
    console.log("  " + (det ? det[0] : ex.xml).replace(/\s+/g, " ").slice(0, 1200));
  }

  // Agrupa por nota e cruza com o banco.
  const porNotaEv = new Map<string, Set<string>>();
  for (const e of entrega) {
    if (!porNotaEv.has(e.chave)) porNotaEv.set(e.chave, new Set());
    porNotaEv.get(e.chave)!.add(e.tipo);
  }
  const chaves = [...porNotaEv.keys()];
  const notasEv: any[] = [];
  for (let k = 0; k < chaves.length; k += 2000) {
    notasEv.push(
      ...(await prisma.note.findMany({
        where: { chaveAcesso: { in: chaves.slice(k, k + 2000) } },
        select: { chaveAcesso: true, numero: true, emitenteNome: true },
      }))
    );
  }
  console.log(`\nNotas com evento de logística: ${chaves.length} | dessas, no nosso banco: ${notasEv.length}`);

  // Funil das notas do fornecedor em foco (emitidas nos últimos `dias` dias).
  const doForn = await prisma.note.findMany({
    where: {
      emitenteNome: { contains: forn, mode: "insensitive" },
      dataEmissao: { gte: new Date(Date.now() - dias * 86_400_000) },
    },
    select: { chaveAcesso: true, numero: true, dataEmissao: true },
    orderBy: { dataEmissao: "desc" },
  });
  let comCte = 0, comMdfe = 0, entregues = 0;
  for (const n of doForn) {
    const t = porNotaEv.get(n.chaveAcesso);
    if (!t) continue;
    if (t.has("610600")) comCte++;
    if (t.has("610614")) comMdfe++;
    if (t.has("610130") && !t.has("610131")) entregues++;
  }
  console.log(`\n=== Notas "${forn}" emitidas nos últimos ${dias} dias: ${doForn.length} ===`);
  console.log(`  com CT-e autorizado (610600):        ${comCte}`);
  console.log(`  com MDF-e (em transporte) (610614):   ${comMdfe}`);
  console.log(`  com comprovante de entrega (610130):  ${entregues}`);
  console.log("\nExemplos (as 15 mais recentes):");
  for (const n of doForn.slice(0, 15)) {
    const t = [...(porNotaEv.get(n.chaveAcesso) ?? [])].map((c) => NOMES[c] ?? c).join("; ");
    console.log(`  NF ${n.numero} | ${n.dataEmissao?.toISOString().slice(0, 10)} | ${t || "(sem eventos de logística)"}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
