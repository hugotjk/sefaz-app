/**
 * Diagnóstico SOMENTE LEITURA de uma nota: transportadora, volumes, eventos já
 * gravados e (opcional) eventos de logística na fila da Qive.
 *
 * Uso: npx tsx --env-file=.env scripts\diagnostico-nota-logistica.ts NUMERO [FORNECEDOR] [--qive]
 *   NUMERO      número da NF (ex.: 494802)
 *   FORNECEDOR  trecho do emitente (padrão ADIDAS)
 *   --qive      também varre a fila de eventos da Qive atrás dessa nota (demora)
 */
import { PrismaClient } from "@prisma/client";
import { buscarEventosNfe } from "../src/lib/qive";

const prisma = new PrismaClient();

function tag(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}>([\\s\\S]*?)</(?:\\w+:)?${nome}>`));
  return m ? m[1].trim() : null;
}
function bloco(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}[ >][\\s\\S]*?</(?:\\w+:)?${nome}>`));
  return m ? m[0] : null;
}
const dia = (d: Date) => d.toISOString().slice(0, 10);

// Repete a chamada quando a conexão cai (ECONNRESET etc.).
async function eventosComRetry(desde: string, ate: string, cursor: number) {
  let ultimo: unknown;
  for (let t = 1; t <= 6; t++) {
    try {
      return await buscarEventosNfe(desde, ate, cursor);
    } catch (e) {
      ultimo = e;
      await new Promise((r) => setTimeout(r, 2000 * t));
    }
  }
  throw ultimo;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const qive = process.argv.includes("--qive");
  const numero = args[0];
  const forn = (args[1] ?? "ADIDAS").toUpperCase();
  if (!numero) throw new Error("Informe o número da NF.");

  const notas = await prisma.note.findMany({
    where: {
      numero: { in: [numero, numero.replace(/^0+/, "")] },
      emitenteNome: { contains: forn, mode: "insensitive" },
    },
    select: {
      id: true, chaveAcesso: true, numero: true, emitenteNome: true,
      dataEmissao: true, valorTotal: true, status: true, xmlCompleto: true,
    },
  });
  if (!notas.length) {
    console.log(`Nenhuma nota ${numero} de "${forn}" no banco (guardamos só 90 dias).`);
    return;
  }

  for (const n of notas) {
    console.log("\n=========================================");
    console.log(`NF ${n.numero} | ${n.emitenteNome} | emissão ${n.dataEmissao?.toISOString().slice(0, 10)} | valor ${n.valorTotal} | ${n.status}`);
    console.log(`Chave: ${n.chaveAcesso}`);
    const xml = n.xmlCompleto ?? "";
    if (!xml) {
      console.log("(sem XML completo gravado)");
    } else {
      const transp = bloco(xml, "transp");
      if (transp) {
        const t = bloco(transp, "transporta");
        console.log("\n--- Transporte (no XML da nota) ---");
        console.log(`  modalidade do frete (modFrete): ${tag(transp, "modFrete")}  (0=emitente, 1=destinatário, 9=sem frete)`);
        if (t) {
          console.log(`  transportadora: ${tag(t, "xNome")} | CNPJ ${tag(t, "CNPJ") ?? tag(t, "CPF")} | UF ${tag(t, "UF")}`);
        } else {
          console.log("  transportadora: (não informada na nota)");
        }
        console.log(`  volumes: ${tag(transp, "qVol")} | espécie: ${tag(transp, "esp")} | peso bruto: ${tag(transp, "pesoB")}`);
        console.log(`  placa: ${tag(transp, "placa")}`);
      }
      const inf = tag(xml, "infCpl");
      if (inf) console.log(`\n--- Informações complementares ---\n  ${inf.replace(/\s+/g, " ").slice(0, 600)}`);
    }

    const evs = await prisma.noteEvent.findMany({
      where: { noteId: n.id },
      select: { tipo: true, descricao: true, dataEvento: true },
      orderBy: { dataEvento: "asc" },
    });
    console.log(`\n--- Eventos já gravados no app: ${evs.length} ---`);
    evs.forEach((e) => console.log(`  ${e.dataEvento?.toISOString() ?? ""} | ${e.tipo} | ${e.descricao ?? ""}`));
    console.log("  (o app só grava cancelamento, carta de correção e manifestação; CT-e/MDF-e/entrega não)");

    if (qive) {
      console.log("\n--- Varrendo a fila de eventos da Qive (pode demorar) ---");
      // começa na data de emissão (os eventos de logística vêm depois dela)
      const base = n.dataEmissao ? n.dataEmissao.getTime() : Date.now() - 90 * 86_400_000;
      const desde = dia(new Date(base - 86_400_000));
      const ate = dia(new Date(Date.now() + 86_400_000));
      let cursor = Number((process.argv.find((a) => a.startsWith("--cursor=")) ?? "--cursor=0").split("=")[1]) || 0;
      let lidos = 0, achou = 0, fim = false;
      console.log(`  janela created_at: ${desde} a ${ate}, cursor inicial ${cursor}`);
      for (let i = 0; i < 3000; i++) {
        const pag = await eventosComRetry(desde, ate, cursor);
        for (const ev of pag.notas) {
          lidos++;
          if (ev.access_key !== n.chaveAcesso) continue;
          achou++;
          const x = Buffer.from(ev.xml ?? "", "base64").toString("utf8");
          console.log(
            `  ${tag(x, "dhEvento")} | ${ev.type ?? tag(x, "tpEvento")} | ${tag(x, "descEvento") ?? tag(x, "xEvento")}` +
              (tag(x, "dhEntrega") ? ` | entregue em ${tag(x, "dhEntrega")} recebedor ${tag(x, "xNome") ?? ""}` : "")
          );
        }
        if (!pag.notas.length || pag.proximoCursor == null || pag.proximoCursor === cursor) { fim = true; break; }
        cursor = pag.proximoCursor;
        if ((i + 1) % 25 === 0) console.log(`  ... ${lidos} eventos lidos, ${achou} desta nota (cursor ${cursor})`);
      }
      console.log(`  Total lidos: ${lidos} | eventos desta nota: ${achou} | ${fim ? "fila lida até o fim" : "parou no limite"}`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
