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

const NOMES: Record<string, string> = {
  "110110": "Carta de correção",
  "110111": "Cancelamento",
  "110112": "Cancelamento por substituição",
  "110130": "Comprovante de entrega",
  "110131": "Cancelamento do comprovante de entrega",
  "110192": "Insucesso na entrega",
  "110193": "Cancelamento do insucesso na entrega",
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
  const entrega: { chave: string; tipo: string; data: string | null; texto: string | null }[] = [];
  let total = 0;
  let cursor = 0;

  for (let i = 0; i < 60; i++) {
    const pag = await buscarEventosNfe(desde, ate, cursor);
    for (const ev of pag.notas) {
      total++;
      const xml = Buffer.from(ev.xml ?? "", "base64").toString("utf8");
      const cod = ev.type || tag(xml, "tpEvento") || "?";
      porTipo.set(cod, (porTipo.get(cod) ?? 0) + 1);
      if (["110130", "110131", "110192", "110193"].includes(cod)) {
        entrega.push({
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

  console.log(`\n=== Eventos de ENTREGA / INSUCESSO: ${entrega.length} ===`);
  if (entrega.length === 0) {
    console.log("Nenhum. A Qive não entregou eventos de entrega nesta janela.");
    return;
  }

  const chaves = [...new Set(entrega.map((e) => e.chave))];
  const notas = await prisma.note.findMany({
    where: { chaveAcesso: { in: chaves } },
    select: { chaveAcesso: true, numero: true, emitenteNome: true },
  });
  const porChave = new Map(notas.map((n) => [n.chaveAcesso, n]));

  const porEmitente = new Map<string, number>();
  for (const e of entrega) {
    const nome = porChave.get(e.chave)?.emitenteNome ?? "(nota fora do banco)";
    porEmitente.set(nome, (porEmitente.get(nome) ?? 0) + 1);
  }
  console.log("\nPor emitente:");
  [...porEmitente.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([n, q]) => console.log(`  ${String(q).padStart(5)}  ${n}`));

  console.log(`\nExemplos (destaque: emitente com "${forn}"):`);
  const destaque = entrega.filter((e) =>
    (porChave.get(e.chave)?.emitenteNome ?? "").toUpperCase().includes(forn)
  );
  const amostra = (destaque.length ? destaque : entrega).slice(0, 15);
  for (const e of amostra) {
    const n = porChave.get(e.chave);
    console.log(
      `  ${e.tipo} ${NOMES[e.tipo] ?? ""} | NF ${n?.numero ?? "?"} | ${n?.emitenteNome ?? "?"} | ${e.data ?? ""} | ${e.texto ?? ""}`
    );
  }
  if (!destaque.length) console.log(`\n(Nenhum evento de entrega de emitente com "${forn}".)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
