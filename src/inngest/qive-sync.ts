/**
 * Sync RECORRENTE da Qive (substitui o uso da importação única como fonte
 * principal de notas).
 *
 *  qiveSync      cron 6h–20h (America/Sao_Paulo), de hora em hora:
 *                  1. notas novas  (cursor posicional numa janela created_at
 *                     fixa que começa em `base` e vai até 2100 -> o cursor só
 *                     anda pra frente e "segue" as notas novas);
 *                  2. eventos      (cancelamento, carta de correção...) da fila
 *                     /v1/events/nfe, aplicados às notas que já temos.
 *  qiveBackfill  cron 6h–20h: carrega o passado em 3 janelas (0-30, 30-60,
 *                60-90 dias antes de `base`), uma por vez, do mais recente pro
 *                mais antigo. Quando termina, vira no-op (1 leitura no banco).
 *  qiveLimpeza   cron diário 03:30: apaga notas emitidas há mais de 90 dias.
 *
 * Estado em SyncState "qive-sync:estado". Tudo é idempotente (chaveAcesso).
 */
import { inngest } from "@/lib/inngest";
import { prisma } from "@/lib/db";
import {
  buscarNfesRecebidasPorJanela,
  buscarEventosNfe,
  aplicarEventosQive,
  importarLoteQive,
  QIVE_LIMIT_PAGINA,
} from "@/lib/qive";

// Mude aqui pra 2 em 2 horas: "TZ=America/Sao_Paulo 0 6-20/2 * * *"
const CRON_QIVE = "TZ=America/Sao_Paulo 0 6-20 * * *";
const DIAS_RETENCAO = 90;
const PAGINAS_NOTAS_POR_EXECUCAO = 8; // 8 * 50 = 400 notas
const PAGINAS_EVENTOS_POR_EXECUCAO = 8;
const PAGINAS_BACKFILL_POR_EXECUCAO = 8;
const CHAVE = "qive-sync:estado";
const CHAVE_REDUNDANCIA = "qive-sync:certificados-redundantes";

interface JanelaPendente {
  desde: string;
  ate: string;
  cursor: number;
}

interface EstadoQive {
  base: string; // AAAA-MM-DD: fronteira entre "passado" (backfill) e "daqui pra frente"
  /** janela de notas novas em andamento (cursor só vale dentro da mesma janela). */
  pendente: JanelaPendente | null;
  /** quando a última varredura de notas novas terminou por completo. */
  ultimaVarreduraOk: string | null;
  eventosBackfillFeito: boolean;
  backfillFase: number; // 0,1,2 = janelas; 3 = concluído
  backfillCursor: number;
  ultimaExecucao: string | null;
  totais: { importadas: number; jaExistiam: number; eventos: number; erros: number };
}

const dia = (d: Date) => d.toISOString().slice(0, 10);
// A Qive NÃO aceita created_at[to] no futuro distante (testado: 2100-01-01 devolve 0
// notas). "Amanhã" funciona e cobre tudo que existe até agora.
const amanha = () => dia(new Date(Date.now() + 86_400_000));
const menosDias = (base: string, n: number) =>
  dia(new Date(new Date(base + "T00:00:00Z").getTime() - n * 86_400_000));

async function ler<T>(chave: string, fallback: T): Promise<T> {
  const row = await prisma.syncState.findUnique({ where: { chave } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.valor) as T;
  } catch {
    return fallback;
  }
}
async function gravar(chave: string, valor: unknown): Promise<void> {
  const str = JSON.stringify(valor);
  await prisma.syncState.upsert({
    where: { chave },
    create: { chave, valor: str },
    update: { valor: str },
  });
}

// Trava de segurança: o Aiven gratuito tem 1 GB e vira somente-leitura ao encher.
// Acima deste limite o sync da Qive pausa (não importa nada). Ajustável por env.
const LIMITE_BANCO_MB = Number(process.env.QIVE_LIMITE_BANCO_MB || 850);

async function bancoCheio(): Promise<{ cheio: boolean; mb: number }> {
  const rows = await prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`;
  const mb = Math.round(Number(rows[0]?.bytes ?? 0) / (1024 * 1024));
  return { cheio: mb > LIMITE_BANCO_MB, mb };
}

async function lerEstado(): Promise<EstadoQive> {
  const e = await ler<EstadoQive | null>(CHAVE, null);
  if (e) return e;
  return {
    base: dia(new Date()),
    pendente: null,
    ultimaVarreduraOk: null,
    eventosBackfillFeito: false,
    backfillFase: 0,
    backfillCursor: 0,
    ultimaExecucao: null,
    totais: { importadas: 0, jaExistiam: 0, eventos: 0, erros: 0 },
  };
}

/** Soma, por certificado, quantas notas a Qive trouxe que já tínhamos via SEFAZ. */
async function registrarRedundancia(porCert: Record<string, number>) {
  if (Object.keys(porCert).length === 0) return;
  const atual = await ler<Record<string, number>>(CHAVE_REDUNDANCIA, {});
  for (const [id, n] of Object.entries(porCert)) atual[id] = (atual[id] ?? 0) + n;
  await gravar(CHAVE_REDUNDANCIA, atual);
}

// ---------------------------------------------------------------------------
export const qiveSync = inngest.createFunction(
  { id: "qive-sync", concurrency: [{ limit: 1 }], retries: 2 },
  { cron: CRON_QIVE },
  async ({ step }) => {
    const trava = await step.run("checar-tamanho-banco", bancoCheio);
    if (trava.cheio) return { pausado: true, motivo: `banco com ${trava.mb} MB (limite ${LIMITE_BANCO_MB})` };

    const estado = await step.run("ler-estado", lerEstado);
    await step.run("garantir-estado", () => gravar(CHAVE, estado));

    // 1) notas novas ---------------------------------------------------------
    // Janela curta [ontem da última varredura OK, amanhã], cursor 0 e pagina
    // até acabar. Notas já existentes são puladas (idempotente). Se estourar o
    // limite de páginas, a MESMA janela continua na próxima execução.
    if (!estado.pendente) {
      const desde = estado.ultimaVarreduraOk
        ? dia(new Date(new Date(estado.ultimaVarreduraOk).getTime() - 86_400_000))
        : estado.base;
      estado.pendente = { desde, ate: amanha(), cursor: 0 };
    }
    let importadas = 0;
    let jaExistiam = 0;
    let terminou = false;
    for (let i = 0; i < PAGINAS_NOTAS_POR_EXECUCAO && !terminou; i++) {
      const janela = estado.pendente!;
      const r = await step.run(`notas-${janela.desde}-${janela.cursor}`, async () => {
        const pag = await buscarNfesRecebidasPorJanela(janela.desde, janela.ate, janela.cursor, QIVE_LIMIT_PAGINA);
        const res = await importarLoteQive(pag.notas);
        await registrarRedundancia(res.redundantesPorCertificado);
        return { ...res, proximoCursor: pag.proximoCursor };
      });
      importadas += r.importadas;
      jaExistiam += r.jaExistiam;
      estado.totais.erros += r.erros;
      if (r.recebidas === 0 || r.proximoCursor == null || r.proximoCursor === janela.cursor) {
        terminou = true;
      } else {
        janela.cursor = r.proximoCursor;
        await step.run(`salvar-notas-${janela.cursor}`, () => gravar(CHAVE, estado));
      }
    }
    if (terminou) {
      estado.pendente = null;
      estado.ultimaVarreduraOk = new Date().toISOString();
    }

    // 2) eventos (só depois do backfill de notas) ---------------------------
    let eventosAplicados = 0;
    if (estado.backfillFase >= 3) {
      // 1ª vez: 90 dias inteiros (poucos eventos). Depois: janela curta.
      const desde = estado.eventosBackfillFeito
        ? dia(new Date(Date.now() - 2 * 86_400_000))
        : menosDias(estado.base, DIAS_RETENCAO);
      let cursor = 0;
      for (let i = 0; i < PAGINAS_EVENTOS_POR_EXECUCAO; i++) {
        const r = await step.run(`eventos-${desde}-${cursor}`, async () => {
          const pag = await buscarEventosNfe(desde, amanha(), cursor);
          const res = await aplicarEventosQive(pag.notas);
          return { ...res, proximoCursor: pag.proximoCursor };
        });
        eventosAplicados += r.aplicados;
        estado.totais.erros += r.erros;
        if (r.recebidos === 0 || r.proximoCursor == null || r.proximoCursor === cursor) {
          estado.eventosBackfillFeito = true;
          break;
        }
        cursor = r.proximoCursor;
      }
    }

    estado.totais.importadas += importadas;
    estado.totais.jaExistiam += jaExistiam;
    estado.totais.eventos += eventosAplicados;
    estado.ultimaExecucao = new Date().toISOString();
    await step.run("salvar-final", async () => {
      // não pisa no progresso do backfill, que roda em outra função
      const atual = await lerEstado();
      atual.pendente = estado.pendente;
      atual.ultimaVarreduraOk = estado.ultimaVarreduraOk;
      atual.eventosBackfillFeito = estado.eventosBackfillFeito;
      atual.ultimaExecucao = estado.ultimaExecucao;
      atual.totais.eventos = estado.totais.eventos;
      atual.totais.jaExistiam = estado.totais.jaExistiam;
      await gravar(CHAVE, atual);
    });

    return { importadas, jaExistiam, eventosAplicados, backfillFase: estado.backfillFase, terminou };
  }
);

// ---------------------------------------------------------------------------
export const qiveBackfill = inngest.createFunction(
  { id: "qive-backfill-90d", concurrency: [{ limit: 1 }], retries: 2 },
  { cron: CRON_QIVE },
  async ({ step }) => {
    const estado = await step.run("ler-estado", lerEstado);
    if (estado.backfillFase >= 3) return { concluido: true };
    const trava = await step.run("checar-tamanho-banco", bancoCheio);
    if (trava.cheio) return { pausado: true, motivo: `banco com ${trava.mb} MB (limite ${LIMITE_BANCO_MB})` };

    let importadas = 0;
    let paginas = 0;
    while (paginas < PAGINAS_BACKFILL_POR_EXECUCAO && estado.backfillFase < 3) {
      const fase = estado.backfillFase;
      // fase 0: [base-30, base]   fase 1: [base-60, base-30]   fase 2: [base-90, base-60]
      const ate = menosDias(estado.base, fase * 30);
      const desde = menosDias(estado.base, (fase + 1) * 30);
      const r = await step.run(`fase-${fase}-pag-${estado.backfillCursor}`, async () => {
        const pag = await buscarNfesRecebidasPorJanela(desde, ate, estado.backfillCursor, QIVE_LIMIT_PAGINA);
        const res = await importarLoteQive(pag.notas);
        await registrarRedundancia(res.redundantesPorCertificado);
        return { ...res, proximoCursor: pag.proximoCursor };
      });
      importadas += r.importadas;
      estado.totais.erros += r.erros;
      paginas++;
      if (r.recebidas === 0 || r.proximoCursor == null || r.proximoCursor === estado.backfillCursor) {
        estado.backfillFase++; // janela esgotada -> próxima
        estado.backfillCursor = 0;
      } else {
        estado.backfillCursor = r.proximoCursor;
      }
      // grava só campos do backfill pra não pisar no cursor de notas do qiveSync
      await step.run(`salvar-fase-${estado.backfillFase}-${estado.backfillCursor}`, async () => {
        const atual = await lerEstado();
        atual.backfillFase = estado.backfillFase;
        atual.backfillCursor = estado.backfillCursor;
        atual.totais.importadas += r.importadas;
        await gravar(CHAVE, atual);
      });
    }
    return { importadas, backfillFase: estado.backfillFase, concluido: estado.backfillFase >= 3 };
  }
);

// ---------------------------------------------------------------------------
export const qiveLimpeza = inngest.createFunction(
  { id: "qive-limpeza-90d", concurrency: [{ limit: 1 }], retries: 1 },
  { cron: "TZ=America/Sao_Paulo 30 3 * * *" },
  async ({ step }) => {
    const corte = new Date(Date.now() - DIAS_RETENCAO * 86_400_000);
    let apagadas = 0;
    for (let lote = 0; lote < 40; lote++) {
      const n = await step.run(`apagar-lote-${lote}`, async () => {
        const ids = (
          await prisma.note.findMany({
            where: { dataEmissao: { lt: corte } },
            select: { id: true },
            take: 500,
          })
        ).map((x) => x.id);
        if (ids.length === 0) return 0;
        await prisma.$transaction([
          prisma.notaItem.deleteMany({ where: { noteId: { in: ids } } }),
          prisma.notaDuplicata.deleteMany({ where: { noteId: { in: ids } } }),
          prisma.noteEvent.deleteMany({ where: { noteId: { in: ids } } }),
          prisma.note.deleteMany({ where: { id: { in: ids } } }),
        ]);
        return ids.length;
      });
      apagadas += n;
      if (n < 500) break;
    }
    return { apagadas, corte: corte.toISOString() };
  }
);
