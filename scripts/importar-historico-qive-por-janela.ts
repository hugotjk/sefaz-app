/**
 * Roda a importação do histórico da Qive PRIORIZANDO AS NOTAS MAIS RECENTES
 * primeiro (janelas de created_at: 30/90/180/365 dias, depois o resto).
 * Mesma lógica e MESMO cursor (SyncState "qive-import-janela:cursor") usados
 * pela função Inngest `importarHistoricoQivePorJanela`, disparada por
 * "qive/importar-por-janela.solicitado". Caminho SEPARADO do cursor posicional
 * puro (scripts/importar-historico-qive.ts / SyncState "qive-import:cursor"),
 * que continua intacto.
 *
 *   npx tsx --env-file=.env scripts/importar-historico-qive-por-janela.ts [--reset]
 */
import { prisma } from "../src/lib/db";
import { buscarNfesRecebidasPorJanela, importarLoteQive, QIVE_LIMIT_PAGINA } from "../src/lib/qive";

const RESET = process.argv.includes("--reset");
const PAUSA_MS = 1500;
const CHAVE_CURSOR = "qive-import-janela:cursor";

interface JanelaQive {
  chave: string;
  desde: string;
  ate: string;
}
function calcularJanelas(): JanelaQive[] {
  const hoje = new Date();
  const menos = (d: number) => new Date(hoje.getTime() - d * 86_400_000).toISOString().slice(0, 10);
  return [
    { chave: "0-30d", desde: menos(30), ate: menos(0) },
    { chave: "30-90d", desde: menos(90), ate: menos(30) },
    { chave: "90-180d", desde: menos(180), ate: menos(90) },
    { chave: "180-365d", desde: menos(365), ate: menos(180) },
    { chave: "365d-tudo", desde: "2000-01-01", ate: menos(365) },
  ];
}

interface Estado {
  janelaIndex: number;
  cursor: number;
  concluido: boolean;
  importadas: number;
  jaExistiam: number;
  semCertificado: number;
  erros: number;
  cnpjsSemCertificado: string[];
}
const INICIAL: Estado = {
  janelaIndex: 0,
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
  const janelas = calcularJanelas();
  const antes = await prisma.note.count();
  console.log(`Note no banco ANTES: ${antes}`);
  console.log("Janelas (mais recente -> mais antiga):", janelas.map((j) => j.chave).join(", "));

  const estado = RESET ? { ...INICIAL } : await lerEstado();
  if (RESET) {
    console.log("--reset: recomeçando da janela 0, cursor 0.");
    await salvarEstado(estado);
  } else {
    console.log(
      `Retomando: janela ${estado.janelaIndex} (${janelas[Math.min(estado.janelaIndex, janelas.length - 1)].chave}), cursor ${estado.cursor}, concluido=${estado.concluido}.`
    );
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
    const janela = janelas[estado.janelaIndex];
    let r;
    try {
      const pag = await buscarNfesRecebidasPorJanela(janela.desde, janela.ate, estado.cursor, QIVE_LIMIT_PAGINA);
      r = { ...(await importarLoteQive(pag.notas)), proximoCursor: pag.proximoCursor };
    } catch (e: any) {
      console.error(`  [janela ${janela.chave}, pagina ${pagina}, cursor ${estado.cursor}] ERRO: ${e?.message || e} — aguardando 10s e tentando de novo...`);
      await new Promise((res) => setTimeout(res, 10_000));
      continue;
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
      `  [${janela.chave}] pagina ${pagina} | cursor ${estado.cursor} -> ${r.proximoCursor} | recebidas ${r.recebidas} | ` +
        `importadas ${r.importadas} (semCert ${r.semCertificado}) | jaExistiam ${r.jaExistiam} | erros ${r.erros} | ` +
        `acumulado: importadas=${estado.importadas} jaExistiam=${estado.jaExistiam} semCert=${estado.semCertificado} erros=${estado.erros} | ${decorrido}s`
    );

    if (r.recebidas === 0 || r.proximoCursor == null || r.proximoCursor === estado.cursor) {
      if (estado.janelaIndex + 1 >= janelas.length) {
        estado.concluido = true;
      } else {
        estado.janelaIndex++;
        estado.cursor = 0;
        console.log(`  >>> janela ${janela.chave} esgotada, avançando para ${janelas[estado.janelaIndex].chave} <<<`);
      }
    } else {
      estado.cursor = r.proximoCursor;
    }
    await salvarEstado(estado);

    if (!estado.concluido) await new Promise((res) => setTimeout(res, PAUSA_MS));
  }

  const depois = await prisma.note.count();
  console.log(`\n==== CONCLUÍDO (por janela) ====`);
  console.log("estado final:", JSON.stringify(estado, null, 1));
  console.log(`Note no banco: ${antes} -> ${depois} (delta ${depois - antes})`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
