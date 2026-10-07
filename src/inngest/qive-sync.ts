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
const FIM_DOS_TEMPOS = "2100-01-01"; // created_at[to] "aberto"
const CHAVE = "qive-sync:estado";
const CHAVE_REDUNDANCIA = "qive-sync:certificados-redundantes";

interface EstadoQive {
  base: string; // AAAA-MM-DD: fronteira entre "passado" (backfill) e "daqui pra frente"
  notasCursor: number;
  backfillFase: number; // 0,1,2 = janelas; 3 = concluído
  backfillCursor: number;
  eventosCursor: number;
  ultimaExecucao: string | null;
  totais: { importadas: number; jaExistiam: number; eventos: number; erros: number };
}

const dia = (d: Date) => d.toISOString().slice(0, 10);
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

async function lerEstado(): Promise<EstadoQive> {
  const e = await ler<EstadoQive | null>(CHAVE, null);
  if (e) return e;
  return {
    base: dia(new Date()),
    notasCursor: 0,
    backfillFase: 0,
    backfillCursor: 0,
    eventosCursor: 0,
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
    const estado = await step.run("ler-estado", lerEstado);
    // 1ª execução: grava a fronteira `base` e já persiste.
    await step.run("garantir-estado", () => gravar(CHAVE, estado));

    // 1) notas novas ---------------------------------------------------------
    let importadas = 0;
    let jaExistiam = 0;
    for (let i = 0; i < PAGINAS_NOTAS_POR_EXECUCAO; i++) {
      const r = await step.run(`notas-${estado.notasCursor}`, async () => {
        const pag = await buscarNfesRecebidasPorJanela(
          estado.base,
          FIM_DOS_TEMPOS,
          estado.notasCursor,
          QIVE_LIMIT_PAGINA
        );
        const res = await importarLoteQive(pag.notas);
        await registrarRedundancia(res.redundantesPorCertificado);
        return { ...res, proximoCursor: pag.proximoCursor };
      });
      importadas += r.importadas;
      jaExistiam += r.jaExistiam;
      estado.totais.erros += r.erros;
      // chegou ao fim da fila: mantém o cursor atual (as notas novas aparecem
      // a partir dele na próxima execução).
      if (r.recebidas === 0 || r.proximoCursor == null || r.proximoCursor === estado.notasCursor) break;
      estado.notasCursor = r.proximoCursor;
      await step.run(`salvar-notas-${estado.notasCursor}`, () => gravar(CHAVE, estado));
    }

    // 2) eventos (só depois do backfill, senão cancelamento de nota ainda não
    //    importada seria perdido) ---------------------------------------------
    let eventosAplicados = 0;
    if (estado.backfillFase >= 3) {
      const desde = menosDias(estado.base, DIAS_RETENCAO);
      for (let i = 0; i < PAGINAS_EVENTOS_POR_EXECUCAO; i++) {
        const r = await step.run(`eventos-${estado.eventosCursor}`, async () => {
          const pag = await buscarEventosNfe(desde, FIM_DOS_TEMPOS, estado.eventosCursor);
          const res = await aplicarEventosQive(pag.notas);
          return { ...res, proximoCursor: pag.proximoCursor };
        });
        eventosAplicados += r.aplicados;
        estado.totais.erros += r.erros;
        if (r.recebidos === 0 || r.proximoCursor == null || r.proximoCursor === estado.eventosCursor) break;
        estado.eventosCursor = r.proximoCursor;
        await step.run(`salvar-eventos-${estado.eventosCursor}`, () => gravar(CHAVE, estado));
      }
    }

    estado.totais.importadas += importadas;
    estado.totais.jaExistiam += jaExistiam;
    estado.totais.eventos += eventosAplicados;
    estado.ultimaExecucao = new Date().toISOString();
    await step.run("salvar-final", () => gravar(CHAVE, estado));

    return { importadas, jaExistiam, eventosAplicados, backfillFase: estado.backfillFase };
  }
);

// ---------------------------------------------------------------------------
export const qiveBackfill = inngest.createFunction(
  { id: "qive-backfill-90d", concurrency: [{ limit: 1 }], retries: 2 },
  { cron: CRON_QIVE },
  async ({ step }) => {
    const estado = await step.run("ler-estado", lerEstado);
    if (estado.backfillFase >= 3) return { concluido: true };

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
