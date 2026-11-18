/**
 * Sincroniza AGORA, no seu PC (sem Inngest), as notas recebidas da Qive (API v2, por CNPJ)
 * e os eventos (cancelamento, carta de correção...). Mesma lógica do `qiveSync`
 * (src/inngest/qive-sync.ts), mas sem limite de steps. Idempotente: só baixa o que falta.
 *
 *   Simulação (lista o que faltaria, não grava):  npx tsx --env-file=.env scripts/sincronizar-qive-manual.ts
 *   Gravar:                                       npx tsx --env-file=.env scripts/sincronizar-qive-manual.ts --apply
 *
 * Opções: --dias=10 (janela de emissão; padrão 10)  --sem-eventos  --cnpj=00000000000000 (só 1 CNPJ)
 *   --parte=1/3 (divide os CNPJs em 3 partes para rodar em janelas paralelas; rode 1/3, 2/3 e 3/3).
 *   Os eventos (cancelamento etc.) só rodam na parte 1.
 */
import { prisma } from "../src/lib/db";
import {
  listarChavesV2,
  buscarNfesV2,
  buscarEventosNfe,
  aplicarEventosQive,
  importarLoteQive,
} from "../src/lib/qive";

const APLICAR = process.argv.includes("--apply");
const SEM_EVENTOS = process.argv.includes("--sem-eventos");
const arg = (n: string) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);
const DIAS = Number(arg("dias") ?? 10);
const SO_CNPJ = arg("cnpj")?.replace(/\D/g, "");
const [PARTE, DE_PARTES] = (arg("parte") ?? "1/1").split("/").map(Number);
const LIMITE_BANCO_MB = Number(process.env.QIVE_LIMITE_BANCO_MB || 700);
const CHAVE_REDUNDANCIA = "qive-sync:certificados-redundantes";

const dia = (d: Date) => d.toISOString().slice(0, 10);
const menosDias = (base: string, n: number) =>
  dia(new Date(new Date(base + "T00:00:00Z").getTime() - n * 86_400_000));
const amanha = () => dia(new Date(Date.now() + 86_400_000));

async function registrarRedundancia(porCert: Record<string, number>) {
  if (Object.keys(porCert).length === 0) return;
  const row = await prisma.syncState.findUnique({ where: { chave: CHAVE_REDUNDANCIA } });
  let atual: Record<string, number> = {};
  try { atual = row ? JSON.parse(row.valor) : {}; } catch { atual = {}; }
  for (const [id, n] of Object.entries(porCert)) atual[id] = (atual[id] ?? 0) + n;
  const str = JSON.stringify(atual);
  await prisma.syncState.upsert({ where: { chave: CHAVE_REDUNDANCIA }, create: { chave: CHAVE_REDUNDANCIA, valor: str }, update: { valor: str } });
}

async function cnpjsDaConta(): Promise<string[]> {
  const lojas = await prisma.lojaCadastro.findMany({ where: { ativa: true }, select: { cnpj: true } });
  const certs = await prisma.certificate.findMany({ where: { consultaAtiva: true }, select: { cnpj: true } });
  const notas = await prisma.$queryRaw<{ c: string }[]>`SELECT DISTINCT "cnpjDestino" AS c FROM "Note" WHERE "cnpjDestino" IS NOT NULL`;
  const set = new Set<string>();
  for (const x of [...lojas.map((l: any) => l.cnpj), ...certs.map((c: any) => c.cnpj), ...notas.map((n) => n.c)]) {
    const d = String(x ?? "").replace(/\D/g, "");
    if (d.length === 14) set.add(d);
  }
  return [...set];
}

async function main() {
  const rows = await prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`;
  const mb = Math.round(Number(rows[0]?.bytes ?? 0) / (1024 * 1024));
  if (APLICAR && mb > LIMITE_BANCO_MB) {
    console.log(`Banco com ${mb} MB (limite ${LIMITE_BANCO_MB} MB): não importo nada para não encher o Aiven.`);
    return;
  }

  const hoje = dia(new Date());
  const de = menosDias(hoje, DIAS - 1);
  let cnpjs = await cnpjsDaConta();
  if (SO_CNPJ) cnpjs = cnpjs.filter((c) => c === SO_CNPJ);
  cnpjs.sort();
  if (DE_PARTES > 1) cnpjs = cnpjs.filter((_, i) => i % DE_PARTES === PARTE - 1);
  console.log(`${APLICAR ? "[APPLY]" : "[SIMULAÇÃO]"} Qive v2 (parte ${PARTE}/${DE_PARTES}): ${cnpjs.length} CNPJs | emissão de ${de} a ${hoje}`);

  let faltariam = 0, importadas = 0, jaExistiam = 0, erros = 0;
  const falhas: string[] = [];
  const t0 = Date.now();
  for (let i = 0; i < cnpjs.length; i++) {
    const cnpj = cnpjs[i];
    try {
      const lista = await listarChavesV2(cnpj, de, hoje);
      if (lista.length > 0) {
        const chaves = lista.map((x) => x.chave);
        const tem = new Set(
          (await prisma.note.findMany({ where: { chaveAcesso: { in: chaves } }, select: { chaveAcesso: true } })).map((n: any) => n.chaveAcesso)
        );
        const faltam = lista.filter((x) => !tem.has(x.chave));
        jaExistiam += lista.length - faltam.length;
        faltariam += faltam.length;
        if (faltam.length > 0) {
          console.log(`  ${cnpj}: ${faltam.length} nota(s) nova(s)`);
          if (APLICAR) {
            const datas = faltam.map((x) => x.emissao.slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
            const d1 = datas.length ? menosDias(datas[0], 1) : de;
            const d2 = datas.length ? menosDias(datas[datas.length - 1], -1) : hoje;
            const notas = await buscarNfesV2(cnpj, d1 < de ? de : d1, d2 > hoje ? hoje : d2);
            const falt = new Set(faltam.map((x) => x.chave));
            const res = await importarLoteQive(notas.filter((n: any) => falt.has(n.access_key)));
            await registrarRedundancia(res.redundantesPorCertificado);
            importadas += res.importadas;
            erros += res.erros;
          }
        }
      }
    } catch (e: any) {
      falhas.push(cnpj);
      console.log(`  ! ${cnpj}: ${String(e?.message ?? e).slice(0, 80)}`);
    }
    if ((i + 1) % 25 === 0 || i + 1 === cnpjs.length) {
      console.log(`  CNPJ ${i + 1}/${cnpjs.length} | novas ${faltariam} | importadas ${importadas} | ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    }
  }

  let eventosAplicados = 0;
  if (APLICAR && !SEM_EVENTOS && PARTE === 1) {
    const desde = dia(new Date(Date.now() - 2 * 86_400_000));
    let cursor = 0;
    for (let p = 0; p < 50; p++) {
      const pag = await buscarEventosNfe(desde, amanha(), cursor);
      const r = await aplicarEventosQive(pag.notas);
      eventosAplicados += r.aplicados;
      if (r.recebidos === 0 || pag.proximoCursor == null || pag.proximoCursor === cursor) break;
      cursor = pag.proximoCursor;
    }
    console.log(`Eventos aplicados: ${eventosAplicados}`);
  }

  console.log(`\n=== RESUMO ===`);
  console.log(`CNPJs: ${cnpjs.length} | notas que já tínhamos: ${jaExistiam} | notas novas na Qive: ${faltariam}`);
  if (APLICAR) console.log(`Importadas: ${importadas} | erros: ${erros}`);
  else console.log(`Nada foi gravado (simulação). Rode com --apply para importar.`);
  if (falhas.length) console.log(`CNPJs com falha (rode de novo): ${falhas.join(", ")}`);
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
