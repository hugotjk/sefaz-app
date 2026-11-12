/**
 * Sync RECORRENTE da Qive (substitui o uso da importação única como fonte
 * principal de notas).
 *
 *  qiveSync      cron 6h–20h (America/Sao_Paulo), de hora em hora:
 *                  1. notas novas via API v2 (POST /v2/dfe/nfe) por CNPJ: lista as
 *                     chaves, compara com o banco e baixa o XML só das que faltam
 *                     (1ª vez 90 dias; depois 10 dias);
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
  listarChavesV2,
  buscarNfesV2,
  buscarEventosNfe,
  aplicarEventosQive,
  importarLoteQive,
} from "@/lib/qive";

// Mude aqui pra 2 em 2 horas: "TZ=America/Sao_Paulo 0 6-20/2 * * *"
const CRON_QIVE = "TZ=America/Sao_Paulo 0 6-20 * * *";
const DIAS_RETENCAO = 90;
const PAGINAS_EVENTOS_POR_EXECUCAO = 8;
const CHAVE = "qive-sync:estado";
const CHAVE_V2 = "qive-sync:v2";
const DIAS_JANELA_V2 = 10;
const CHAVE_REDUNDANCIA = "qive-sync:certificados-redundantes";

interface JanelaPendente {
  desde: string;
  ate: string;
  cursor: number;
}

interface EstadoV2 {
  /** quando a 1ª carga completa (90 dias) terminou sem falha. */
  completoEm: string | null;
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
// O painel da Aiven conta MAIS que pg_database_size (WAL/sistema: ~137 MB a mais
// com o banco em 123 MB), então 700 MB aqui ~ 840 MB no painel, de 1 GB.
const LIMITE_BANCO_MB = Number(process.env.QIVE_LIMITE_BANCO_MB || 700);

async function bancoCheio(): Promise<{ cheio: boolean; mb: number }> {
  const rows = await prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`;
  const mb = Math.round(Number(rows[0]?.bytes ?? 0) / (1024 * 1024));
  return { cheio: mb > LIMITE_BANCO_MB, mb };
}

/** CNPJs de destinatário a consultar: lojas ativas + certificados + destinatários já vistos nas notas. */
async function cnpjsDaConta(): Promise<string[]> {
  const lojas = await prisma.lojaCadastro.findMany({ where: { ativa: true }, select: { cnpj: true } });
  const certs = await prisma.certificate.findMany({ where: { consultaAtiva: true }, select: { cnpj: true } });
  const notas = await prisma.$queryRaw<{ c: string }[]>`SELECT DISTINCT "cnpjDestino" AS c FROM "Note" WHERE "cnpjDestino" IS NOT NULL`;
  const set = new Set<string>();
  for (const x of [...lojas.map((l) => l.cnpj), ...certs.map((c) => c.cnpj), ...notas.map((n) => n.c)]) {
    const d = String(x ?? "").replace(/\D/g, "");
    if (d.length === 14) set.add(d);
  }
  return [...set];
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

    // 1) notas novas (API v2, por CNPJ) --------------------------------------
    // 1ª execução: 90 dias de emissão. Depois: últimos 10 dias (pega nota que chega atrasada).
    // Por CNPJ: lista só as chaves, compara com o banco e baixa o XML apenas das que faltam.
    const v2 = await step.run("ler-estado-v2", () => ler<EstadoV2>(CHAVE_V2, { completoEm: null }));
    const dias = v2.completoEm ? DIAS_JANELA_V2 : DIAS_RETENCAO;
    const hoje = dia(new Date());
    const de = menosDias(hoje, dias - 1);
    const cnpjs = await step.run("cnpjs-da-conta", cnpjsDaConta);
    let importadas = 0;
    let jaExistiam = 0;
    let erros = 0;
    const falhas: string[] = [];
    for (const cnpj of cnpjs) {
      const r = await step.run(`v2-${cnpj}`, async () => {
        try {
          const lista = await listarChavesV2(cnpj, de, hoje);
          if (lista.length === 0) return { imp: 0, ja: 0, err: 0, falha: false };
          const chaves = lista.map((x) => x.chave);
          const tem = new Set(
            (await prisma.note.findMany({ where: { chaveAcesso: { in: chaves } }, select: { chaveAcesso: true } })).map(
              (n) => n.chaveAcesso
            )
          );
          const faltam = lista.filter((x) => !tem.has(x.chave));
          if (faltam.length === 0) return { imp: 0, ja: lista.length, err: 0, falha: false };
          const datas = faltam.map((x) => x.emissao.slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
          // janela mínima que cobre as faltantes (±1 dia por causa de fuso)
          const d1 = datas.length ? menosDias(datas[0], 1) : de;
          const d2 = datas.length ? menosDias(datas[datas.length - 1], -1) : hoje;
          const notas = await buscarNfesV2(cnpj, d1 < de ? de : d1, d2 > hoje ? hoje : d2);
          const falt = new Set(faltam.map((x) => x.chave));
          const res = await importarLoteQive(notas.filter((n) => falt.has(n.access_key)));
          await registrarRedundancia(res.redundantesPorCertificado);
          return { imp: res.importadas, ja: lista.length - faltam.length + res.jaExistiam, err: res.erros, falha: false };
        } catch {
          return { imp: 0, ja: 0, err: 1, falha: true };
        }
      });
      importadas += r.imp;
      jaExistiam += r.ja;
      erros += r.err;
      if (r.falha) falhas.push(cnpj);
    }
    estado.totais.erros += erros;
    const terminou = falhas.length === 0;
    if (terminou) {
      await step.run("salvar-v2", () => gravar(CHAVE_V2, { completoEm: new Date().toISOString() } satisfies EstadoV2));
      estado.ultimaVarreduraOk = new Date().toISOString();
    }

    // 2) eventos (só depois do backfill de notas) ---------------------------
    let eventosAplicados = 0;
    {
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

    return { importadas, jaExistiam, eventosAplicados, cnpjs: cnpjs.length, janelaDias: dias, falhas, terminou };
  }
);

// ---------------------------------------------------------------------------
export const qiveBackfill = inngest.createFunction(
  { id: "qive-backfill-90d", concurrency: [{ limit: 1 }], retries: 0 },
  { cron: CRON_QIVE },
  async () => {
    // Substituído pela carga de 90 dias do qiveSync (API v2). Mantido só para não mexer no registro das funções.
    return { concluido: true, motivo: "backfill agora é feito pelo qiveSync (v2)" };
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
