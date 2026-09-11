/**
 * Roda a importação COMPLETA do histórico da Qive localmente (mesma lógica e
 * o MESMO cursor — SyncState "qive-import:cursor" — usados pela função
 * Inngest `importarHistoricoQive`, disparada por "qive/importar.solicitado").
 * Continua de onde parou se for interrompido/re-executado; use --reset pra
 * recomeçar do zero.
 *
 *   npx tsx --env-file=.env scripts/importar-historico-qive.ts [--reset]
 */
import { prisma } from "../src/lib/db";
import { buscarNfesRecebidas, importarLoteQive, QIVE_LIMIT_PAGINA } from "../src/lib/qive";

const RESET = process.argv.includes("--reset");
const PAUSA_MS = 1500;
const CHAVE_CURSOR = "qive-import:cursor";

interface Estado {
  cursor: number;
  concluido: boolean;
  importadas: number;
  jaExistiam: number;
  semCertificado: number;
  erros: number;
  cnpjsSemCertificado: string[];
}

const INICIAL: Estado = {
  cursor: 0,
  concluido: false,
  importadas: 0,
  jaExistiam: 0,
  semCertificado: 0,
  erros: 0,
  cnpjsSemCertificado: [],
};

async function lerEstado(): Promise<Estado> {
  const row = await prisma.syncState.findUnique({ where: { chave: CHAVE_CURSOR } });
  if (!row) return { ...INICIAL };
  try {
    return { ...INICIAL, ...JSON.parse(row.valor) };
  } catch {
    return { ...INICIAL };
  }
}

async function salvarEstado(e: Estado) {
  const valor = JSON.stringify(e);
  await prisma.syncState.upsert({
    where: { chave: CHAVE_CURSOR },
    create: { chave: CHAVE_CURSOR, valor },
    update: { valor },
  });
}

async function main() {
  const antes = await prisma.note.count();
  console.log(`Note no banco ANTES: ${antes}`);

  const estado = RESET ? { ...INICIAL } : await lerEstado();
  if (RESET) {
    console.log("--reset: recomeçando do cursor 0.");
    await salvarEstado(estado);
  } else {
    console.log(`Retomando do cursor ${estado.cursor} (concluido=${estado.concluido}).`);
  }

  if (estado.concluido) {
    console.log("Já estava concluído. Rode com --reset pra reimportar do zero.");
    await prisma.$disconnect();
    return;
  }

  let pagina = 0;
  const inicioExec = Date.now();

  while (!estado.concluido) {
    pagina++;
    let r;
    try {
      const pag = await buscarNfesRecebidas(estado.cursor, QIVE_LIMIT_PAGINA);
      r = { ...(await importarLoteQive(pag.notas)), proximoCursor: pag.proximoCursor };
    } catch (e: any) {
      console.error(`  [pagina ${pagina}, cursor ${estado.cursor}] ERRO: ${e?.message || e} — aguardando 10s e tentando de novo...`);
      await new Promise((res) => setTimeout(res, 10_000));
      continue; // tenta de novo o MESMO cursor
    }

    estado.importadas += r.importadas;
    estado.jaExistiam += r.jaExistiam;
    estado.semCertificado += r.semCertificado;
    estado.erros += r.erros;
    for (const c of r.cnpjsSemCertificado) {
      if (!estado.cnpjsSemCertificado.includes(c)) estado.cnpjsSemCertificado.push(c);
    }

    const decorrido = ((Date.now() - inicioExec) / 1000).toFixed(0);
    console.log(
      `  pagina ${pagina} | cursor ${estado.cursor} -> ${r.proximoCursor} | recebidas ${r.recebidas} | ` +
        `importadas ${r.importadas} (semCert ${r.semCertificado}) | jaExistiam ${r.jaExistiam} | erros ${r.erros} | ` +
        `acumulado: importadas=${estado.importadas} jaExistiam=${estado.jaExistiam} semCert=${estado.semCertificado} erros=${estado.erros} | ${decorrido}s`
    );

    if (r.recebidas === 0 || r.proximoCursor == null || r.proximoCursor === estado.cursor) {
      estado.concluido = true;
    } else {
      estado.cursor = r.proximoCursor;
    }
    await salvarEstado(estado);

    if (!estado.concluido) await new Promise((res) => setTimeout(res, PAUSA_MS));
  }

  const depois = await prisma.note.count();
  console.log(`\n==== CONCLUÍDO ====`);
  console.log("estado final:", JSON.stringify(estado, null, 1));
  console.log(`Note no banco: ${antes} -> ${depois} (delta ${depois - antes})`);
  console.log(`CNPJs distintos sem certificado: ${estado.cnpjsSemCertificado.length}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
