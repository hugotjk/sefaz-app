import { PrismaClient, Prisma } from "@prisma/client";
import { inngest } from "@/lib/inngest";
import { prisma } from "@/lib/db";
import { decryptCertificate } from "@/lib/crypto";
import { consultarDistribuicaoDFe } from "@/lib/sefaz";
import { parseDocumento } from "@/lib/parse-documento";
import { obterXmlNota } from "@/lib/obter-xml-nota";
import { LIMITE_TENTATIVAS_XML, DIAS_NOTA_RECENTE } from "@/lib/nota-xml-status";
import { classificarTipoLoja } from "@/lib/classificar-tipo-loja";
import { popularNotaItens, avaliarCadastroItens } from "@/lib/popular-nota-itens";
import { reavaliarCadastroRecentes } from "@/lib/reavaliar-cadastro-recentes";
import { upsertEstoqueBulk } from "@/lib/bulk-upsert-estoque";
import {
  buscarNfesRecebidas,
  buscarNfesRecebidasPorJanela,
  importarLoteQive,
  QIVE_LIMIT_PAGINA,
} from "@/lib/qive";
import {
  listarRedes,
  listarLojas,
  obterFilial,
  listarProdutos,
  listarVariacoesProduto,
  listarVendas,
  listarEstoqueDaVariacao,
  listarTabelasPreco,
  listarPrecos,
} from "@/lib/pdvapi";

// Intervalo mínimo entre chamadas consecutivas ao MESMO certificado, pra não
// tomar bloqueio da SEFAZ (cStat 656 - "Rejeição: Consumo Indevido"). Ajuste
// se o manual da sua UF/ambiente nacional recomendar outro valor.
const INTERVALO_ENTRE_CHAMADAS_MS = 25_000;
// Limite de segurança de iterações por execução PARA UM CERTIFICADO (o loop
// continua na próxima chamada do cron caso não termine - graças ao ultNSU
// salvo no banco).
const MAX_ITERACOES_POR_EXECUCAO = 40;

// ---------------------------------------------------------------------------
// Sincronização de certificados EM LOTE (reduz nº de runs/executions do Inngest)
//
// Antes: cronHorario mandava 1 evento por certificado -> 1 run por certificado
// por hora (~98k runs/mês, 76% do consumo). Agora: cronHorario agrupa os
// certificados ACTIVE em lotes determinísticos e manda 1 evento por LOTE;
// `sincronizarCertificadoBatch` processa o lote inteiro numa run só, isolando
// erro por certificado com try/catch e mantendo a durabilidade via `step.run`
// namespaced por certificateId.
//
// O caminho antigo (`sincronizarCertificado`, 1 evento por certificado) continua
// registrado e funcional; a flag SEFAZ_CERT_SYNC_EM_LOTE controla qual o
// cronHorario usa. Rollback = setar SEFAZ_CERT_SYNC_EM_LOTE=0 e redeploy.
// ---------------------------------------------------------------------------

// Lote dos certificados JÁ com backfill concluído (caminho comum: 1 página só
// por certificado, ~1 step cada). 10 -> ~14 lotes.
const TAMANHO_LOTE_CERT = 10;
// Lote dos certificados AINDA em backfill: menor, porque cada um pode paginar
// muitas vezes (até MAX_ITERACOES_POR_EXECUCAO) e isso multiplica os steps.
// 3 certificados * 40 iterações * (1 step + 1 sleep) = 240 steps, longe do
// teto de ~1000 steps/run do Inngest.
const TAMANHO_LOTE_CERT_BACKFILL = 3;
// Orçamento de iterações (páginas SEFAZ) compartilhado por TODOS os
// certificados de um lote. Impede que um lote com vários certificados "com
// fome" (muita nota nova acumulada) estoure o teto de steps do Inngest. O que
// não couber neste ciclo continua no próximo (ultNSU salvo no banco).
const ORCAMENTO_ITERACOES_LOTE = 250;

/** Flag de rollout: `false` volta ao caminho antigo (1 evento por certificado). */
function certSyncEmLote(): boolean {
  return process.env.SEFAZ_CERT_SYNC_EM_LOTE !== "0";
}

/**
 * Particiona os certificados ACTIVE em lotes DETERMINÍSTICOS: separa os que
 * ainda estão em backfill (lotes menores) dos incrementais, ordena por id e
 * fatia. Ordem estável => um certificado cai sempre no mesmo lote, então o
 * `concurrency` por `batchId` já garante que ele nunca roda 2x em paralelo.
 */
export function montarLotesCertificados(
  certs: { id: string; backfillDone: boolean }[]
): { batchId: string; certificateIds: string[] }[] {
  const incrementais = certs.filter((c) => c.backfillDone).map((c) => c.id).sort();
  const emBackfill = certs.filter((c) => !c.backfillDone).map((c) => c.id).sort();

  const fatiar = (ids: string[], tam: number, prefixo: string) => {
    const lotes: { batchId: string; certificateIds: string[] }[] = [];
    for (let i = 0; i < ids.length; i += tam) {
      lotes.push({
        batchId: `${prefixo}-${Math.floor(i / tam)}`,
        certificateIds: ids.slice(i, i + tam),
      });
    }
    return lotes;
  };

  return [
    ...fatiar(incrementais, TAMANHO_LOTE_CERT, "inc"),
    ...fatiar(emBackfill, TAMANHO_LOTE_CERT_BACKFILL, "bf"),
  ];
}

interface ResultadoProcessarCertificado {
  pulado?: boolean;
  motivo?: string;
  iteracoes?: number;
  notasSalvas?: number;
  eventosSalvos?: number;
  ultNSU?: string;
  ultimoStatus?: string;
  ultimoMotivo?: string;
}

/**
 * NÚCLEO da sincronização de UM certificado. Compartilhado entre o caminho
 * antigo (`sincronizarCertificado`, 1 evento por certificado) e o novo em lote
 * (`sincronizarCertificadoBatch`). Cada página da SEFAZ é UM `step.run` durável
 * — consulta + gravação do lote + avanço do ultNSU MESCLADOS num único step
 * (antes eram 3), o que corta ~3x os "executions" no caminho comum. O `step`
 * é o do run atual; os ids de step são namespaced por `certificateId` pra não
 * colidir quando vários certificados rodam no mesmo run.
 *
 * `orcamento.restante` é decrementado a cada página; ao zerar, o certificado
 * para e retoma no próximo ciclo do cron.
 */
async function processarCertificado(
  certificateId: string,
  step: any,
  orcamento: { restante: number }
): Promise<ResultadoProcessarCertificado> {
  // Carrega o certificado FORA de um step (economiza 1 execution/certificado).
  // Em retry do run isso re-executa, mas é um findUnique barato e idempotente;
  // as páginas já processadas continuam memoizadas nos step.run abaixo.
  const certificado = await prisma.certificate.findUniqueOrThrow({
    where: { id: certificateId },
  });

  if (certificado.status !== "ACTIVE") {
    return { pulado: true, motivo: `status = ${certificado.status}` };
  }

  if (certificado.validUntil && new Date(certificado.validUntil) < new Date()) {
    await step.run(`cert-${certificateId}-marcar-vencido`, async () => {
      await prisma.certificate.update({
        where: { id: certificateId },
        data: {
          status: "EXPIRED",
          lastError: "Certificado venceu (data de validade ultrapassada).",
        },
      });
    });
    return { pulado: true, motivo: "certificado vencido" };
  }

  let ultNSU = certificado.ultNSU;
  let iteracoes = 0;
  let notasSalvas = 0;
  let eventosSalvos = 0;
  let ultimoStatus = "";
  let ultimoMotivo = "";

  while (iteracoes < MAX_ITERACOES_POR_EXECUCAO && orcamento.restante > 0) {
    iteracoes++;
    orcamento.restante--;
    const nsuAtual = ultNSU;

    // 1 step = consultar SEFAZ + gravar o lote + avançar ultNSU + (talvez)
    // marcar backfill concluído. Idempotente: consultar com um ultNSU fixo
    // devolve sempre a mesma página, e as gravações são upsert.
    const r: {
      respostaOk: boolean;
      statusCode: string;
      motivo: string;
      notasSalvas: number;
      eventosSalvos: number;
      novoUltNSU: string;
      semDocumentosNovos: boolean;
    } = await step.run(`cert-${certificateId}-pagina-${iteracoes}`, async () => {
      const { pfxBase64, password } = decryptCertificate(certificado);
      const pfxBuffer = Buffer.from(pfxBase64, "base64");

      let resultado;
      try {
        resultado = await consultarDistribuicaoDFe({
          cnpj: certificado.cnpj,
          ultNSU: nsuAtual,
          pfxBuffer,
          senha: password,
        });
      } catch (err: any) {
        if (err?.message?.includes("SSL") || err?.message?.includes("decrypt")) {
          await prisma.certificate.update({
            where: { id: certificateId },
            data: { status: "PASSWORD_ERROR", lastError: "Falha ao abrir o certificado (TLS)." },
          });
        } else if (err?.message?.includes("HTTP 403")) {
          await prisma.certificate.update({
            where: { id: certificateId },
            data: {
              status: "EXPIRED",
              lastError:
                "SEFAZ recusou o certificado (HTTP 403). Verifique se está vencido, revogado, ou se o CNPJ está credenciado para distribuição de NFe.",
            },
          });
        }
        throw err;
      }

      // cStat de SUCESSO: 138 (veio lote) / 137 (nenhum documento). Qualquer
      // outro (ex.: 656 rate limit da SEFAZ) chega DENTRO de um HTTP 200: é
      // recuperável, não tocamos em ultNSU/maxNSU/backfillDone e paramos aqui.
      const respostaOk =
        resultado.statusCode === "138" || resultado.statusCode === "137";
      if (!respostaOk) {
        return {
          respostaOk: false,
          statusCode: resultado.statusCode,
          motivo: resultado.motivo,
          notasSalvas: 0,
          eventosSalvos: 0,
          novoUltNSU: nsuAtual,
          semDocumentosNovos: false,
        };
      }

      let ns = 0;
      let es = 0;
      for (const doc of resultado.documentos) {
        const item = parseDocumento(doc);
        if (!item) continue;

        if (item.tipo === "nota") {
          await prisma.note.upsert({
            where: { chaveAcesso: item.chaveAcesso },
            create: {
              chaveAcesso: item.chaveAcesso,
              cnpjDestino: certificado.cnpj,
              certificateId: certificado.id,
              numero: item.numero,
              serie: item.serie,
              tipoOperacao: item.tipoOperacao,
              emitenteCnpj: item.emitenteCnpj,
              emitenteNome: item.emitenteNome,
              valorTotal: item.valorTotal,
              dataEmissao: new Date(item.dataEmissao),
              status: item.status,
              xmlCompleto: "",
              nsu: item.nsu,
            },
            update: { status: item.status },
          });
          ns++;
        } else {
          const nota = await prisma.note.findUnique({
            where: { chaveAcesso: item.chaveAcesso },
          });
          if (!nota) continue;

          await prisma.noteEvent.create({
            data: {
              noteId: nota.id,
              tipo: item.tipoEvento as any,
              descricao: item.descricao,
              xmlEvento: "",
              nsu: item.nsu,
              dataEvento: item.dataEvento ? new Date(item.dataEvento) : null,
            },
          });

          if (item.tipoEvento === "CANCELAMENTO") {
            await prisma.note.update({ where: { id: nota.id }, data: { status: "CANCELADA" } });
          }
          es++;
        }
      }

      await prisma.certificate.update({
        where: { id: certificateId },
        data: { ultNSU: resultado.ultNSU, maxNSU: resultado.maxNSU },
      });

      if (resultado.semDocumentosNovos && !certificado.backfillDone) {
        await prisma.certificate.update({
          where: { id: certificateId },
          data: { backfillDone: true },
        });
      }

      return {
        respostaOk: true,
        statusCode: resultado.statusCode,
        motivo: resultado.motivo,
        notasSalvas: ns,
        eventosSalvos: es,
        novoUltNSU: resultado.ultNSU,
        semDocumentosNovos: resultado.semDocumentosNovos,
      };
    });

    ultimoStatus = r.statusCode;
    ultimoMotivo = r.motivo;
    if (!r.respostaOk) break;

    notasSalvas += r.notasSalvas;
    eventosSalvos += r.eventosSalvos;
    ultNSU = r.novoUltNSU;
    if (r.semDocumentosNovos) break;

    // Respeita o intervalo mínimo entre chamadas ao MESMO certificado.
    await step.sleep(
      `cert-${certificateId}-aguardar-${iteracoes}`,
      INTERVALO_ENTRE_CHAMADAS_MS
    );
  }

  return { iteracoes, notasSalvas, eventosSalvos, ultNSU, ultimoStatus, ultimoMotivo };
}

/**
 * 1) Cron principal da sincronização SEFAZ. Roda a cada 2h SÓ das 6h às 20h de
 *    Brasília (pausa 20h–6h — o Brasil não tem mais horário de verão desde
 *    2019, então America/Sao_Paulo = UTC-3 fixo; equivale a "0 9-23/2 * * *"
 *    em UTC). Agrupa os certificados ACTIVE em lotes determinísticos e dispara
 *    1 evento POR LOTE (`sefaz/certificate.sync.batch`). Com a flag
 *    SEFAZ_CERT_SYNC_EM_LOTE=0 volta ao comportamento antigo (1 evento por
 *    certificado) — só pra rollback.
 */
export const cronHorario = inngest.createFunction(
  {
    id: "cron-sincronizacao-horaria",
    concurrency: [{ scope: "account", key: '"sefaz-pdv-sync"', limit: 3 }],
  },
  // 06,08,10,12,14,16,18,20 BRT (8x/dia). Era "0 */2 * * *" (o dia todo, 12x).
  { cron: "TZ=America/Sao_Paulo 0 6-20/2 * * *" },
  async ({ step }) => {
    // Marca como EXPIRED quem passou da validade — evita gastar uma chamada
    // na SEFAZ pra um certificado que já sabemos que vai ser rejeitado.
    await step.run("marcar-certificados-vencidos", async () => {
      await prisma.certificate.updateMany({
        where: { status: "ACTIVE", validUntil: { lt: new Date() } },
        data: { status: "EXPIRED", lastError: "Certificado venceu (data de validade ultrapassada)." },
      });
    });

    const certificados = await step.run("buscar-certificados-ativos", async () => {
      return prisma.certificate.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, backfillDone: true },
      });
    });

    if (certificados.length === 0) return { disparados: 0 };

    if (!certSyncEmLote()) {
      // Caminho ANTIGO (rollback): 1 evento por certificado.
      await step.sendEvent(
        "disparar-sync-por-certificado",
        certificados.map((c) => ({
          name: "sefaz/certificate.sync" as const,
          data: { certificateId: c.id },
        }))
      );
      return { modo: "individual", disparados: certificados.length };
    }

    // Caminho NOVO: 1 evento por LOTE determinístico.
    const lotes = montarLotesCertificados(certificados);
    await step.sendEvent(
      "disparar-sync-em-lote",
      lotes.map((l) => ({
        name: "sefaz/certificate.sync.batch" as const,
        data: { batchId: l.batchId, certificateIds: l.certificateIds },
      }))
    );

    return { modo: "lote", lotes: lotes.length, certificados: certificados.length };
  }
);

/**
 * 2a) Caminho ANTIGO — 1 evento = 1 certificado. Mantido REGISTRADO e funcional
 *     só para rollback (a flag SEFAZ_CERT_SYNC_EM_LOTE=0 faz o cronHorario
 *     voltar a disparar `sefaz/certificate.sync`). Hoje é um wrapper fino sobre
 *     `processarCertificado` — o núcleo é o mesmo do caminho em lote, pra não
 *     divergir a lógica crítica.
 */
export const sincronizarCertificado = inngest.createFunction(
  {
    id: "sincronizar-certificado",
    concurrency: [
      { scope: "account", key: '"sefaz-pdv-sync"', limit: 3 },
      { limit: 1, key: "event.data.certificateId" }, // nunca 2 sync do mesmo cert em paralelo
    ],
    retries: 3,
  },
  { event: "sefaz/certificate.sync" },
  async ({ event, step }) => {
    const orcamento = { restante: MAX_ITERACOES_POR_EXECUCAO };
    return processarCertificado(event.data.certificateId, step, orcamento);
  }
);

/**
 * 2b) Caminho NOVO — 1 evento = 1 LOTE de certificados, processados numa run só.
 *     - Cada certificado roda dentro de um try/catch: se o 3º de 10 estourar
 *       (ex.: TLS/403), os outros 9 continuam.
 *     - Durabilidade preservada: `processarCertificado` usa `step.run`
 *       namespaced por certificateId, então retry do run re-executa só o step
 *       que falhou, do certificado que falhou.
 *     - `orcamento` de páginas é COMPARTILHADO pelo lote inteiro pra não
 *       estourar o teto de ~1000 steps/run do Inngest. O que não couber
 *       continua no próximo ciclo do cron.
 *     - Concorrência: `limit 1` por `batchId` (um lote nunca roda sobreposto a
 *       si mesmo) + teto global 3 do balde "sefaz-pdv-sync". Como o
 *       particionamento é determinístico, um certificado cai sempre no mesmo
 *       lote => nunca roda 2x em paralelo.
 */
export const sincronizarCertificadoBatch = inngest.createFunction(
  {
    id: "sincronizar-certificado-lote",
    concurrency: [
      { scope: "account", key: '"sefaz-pdv-sync"', limit: 3 },
      { limit: 1, key: "event.data.batchId" },
    ],
    retries: 2,
  },
  { event: "sefaz/certificate.sync.batch" },
  async ({ event, step }) => {
    const { batchId, certificateIds } = event.data;
    const orcamento = { restante: ORCAMENTO_ITERACOES_LOTE };
    const resultados: Array<Record<string, unknown>> = [];

    let comErro = 0;
    for (const certificateId of certificateIds) {
      try {
        const r = await processarCertificado(certificateId, step, orcamento);
        resultados.push({ certificateId, ok: true, ...r });
      } catch (err: any) {
        comErro++;
        const msg = String(err?.message ?? err);
        console.error(`[sync-cert-lote ${batchId}] certificado ${certificateId} falhou: ${msg}`);
        resultados.push({ certificateId, ok: false, erro: msg });
      }
      if (orcamento.restante <= 0) {
        // Estourou o orçamento de páginas do lote: o resto dos certificados
        // fica pro próximo ciclo do cron (ultNSU salvo garante a retomada).
        break;
      }
    }

    return {
      batchId,
      certificados: certificateIds.length,
      processados: resultados.length,
      comErro,
      orcamentoRestante: orcamento.restante,
      resultados,
    };
  }
);

/**
 * Disparado assim que um certificado novo é validado.
 *
 * - Modo LOTE (padrão): NÃO dispara nada. O próximo ciclo do `cronHorario`
 *   (até 2h) inclui o certificado novo no lote determinístico dele. Isso
 *   elimina de vez qualquer janela de corrida (o mesmo certificado nunca
 *   roda por dois caminhos ao mesmo tempo), ao custo de até 2h de latência
 *   no 1º sync — aceitável pra um certificado recém-cadastrado.
 * - Modo ROLLBACK (SEFAZ_CERT_SYNC_EM_LOTE=0): comportamento antigo, dispara
 *   `sefaz/certificate.sync` na hora (esse caminho tem o lock por
 *   `event.data.certificateId` que serializa com o cron).
 */
export const iniciarBackfillAoValidar = inngest.createFunction(
  {
    id: "iniciar-backfill-ao-validar",
    concurrency: [{ scope: "account", key: '"sefaz-pdv-sync"', limit: 3 }],
  },
  { event: "sefaz/certificate.uploaded" },
  async ({ event, step }) => {
    if (certSyncEmLote()) {
      // Sem disparo imediato — o cronHorario pega no próximo ciclo.
      return { agendado: "proximo-cron" };
    }
    await step.sendEvent("disparar-primeira-sync", {
      name: "sefaz/certificate.sync",
      data: { certificateId: event.data.certificateId },
    });
    return { agendado: "imediato" };
  }
);

// ===========================================================================
// SINCRONIZAÇÃO DA API DO PDV (Fase 1 do relatório de Movimentação Resumida)
//
// Nada disso tem relação com a SEFAZ / Notas Fiscais. Traz catálogo, vendas e
// estoque do PDV pro nosso banco pra que o relatório (Fase 2) consulte só o
// banco. Mesmo padrão de durabilidade das funções acima: cada lote/página é um
// `step.run` e um cursor salvo em SyncState a cada página pra retomar de onde
// parou na próxima execução do cron. Sem `step.sleep` entre páginas (dobrava o
// nº de steps e estourava o teto de 1000 da Inngest).
// ===========================================================================

// A API do PDV limita TamanhoPagina a 50 (rejeita acima disso).
const PDV_TAM_PAGINA = 50;
// Tetos de segurança por execução — o cron continua na próxima rodada usando
// o cursor salvo em SyncState. O limite REAL aqui não é tempo (cada `step.run`
// é uma invocação serverless separada, maxDuration=300s), e sim o teto da
// Inngest de 1000 steps por run. Depois de tirar o `step.sleep` entre páginas,
// cada página = 1 step, então: steps ≈ (páginas) + setup (~2) + fallback de
// variações (~60 no pior caso). Mantemos ~350–400 páginas/disparo pra ficar
// com folga larga abaixo de 1000.
const MAX_PAGINAS_PRODUTOS_POR_EXECUCAO = 350; // ~17,5k produtos/disparo (~412 steps c/ fallback)
const MAX_PRODUTOS_BUSCAR_VARIACOES_POR_EXECUCAO = 1200; // 1200/20 = até 60 steps de fallback
const MAX_PAGINAS_VENDAS_POR_EXECUCAO = 400; // ~20k vendas/disparo (~401 steps)
// Pausa entre lotes/páginas. NÃO é mais um `step.sleep` nos loops paginados do
// PDV (produtos/vendas/preços/estoque/filiais/backfill-histórico) — isso dobrava
// o nº de steps e estourava o teto de 1000. Usada ainda por consolidar e
// enriquecer (loops curtos, ~9 iterações).
const PDV_PAUSA_ENTRE_LOTES_MS = 500;
// Quanto de histórico de vendas puxar na primeiríssima execução do sync horário.
const VENDAS_JANELA_INICIAL_DIAS = 7;
// Data bem antiga = "traz o catálogo inteiro" no primeiro backfill de produtos.
const PRODUTOS_DATA_BACKFILL = "2000-01-01";
// Janelas do backfill INICIAL de produtos (dias atrás; null = sem filtro de
// data = catálogo inteiro). A API do PDV (/api/public/produtos/{redeId}) NÃO
// tem parâmetro de ordenação — só o filtro `aPartirDe`. Então, enquanto a rede
// nunca terminou o 1º backfill, varremos por janelas da MAIS RECENTE pra mais
// antiga: assim os produtos que aparecem nas notas fiscais recentes (o que o
// relatório de conferência analisa) ficam catalogados em ~1 disparo, sem
// esperar os ~130k produtos inteiros. A sobreposição entre janelas é
// deduplicada pelo upsert; a janela em andamento fica no SyncState.
const JANELAS_BACKFILL_PRODUTOS_DIAS: (number | null)[] = [30, 90, 180, 365, null];

// --- estoque (orientado pelo nosso catálogo) ---
// ATENÇÃO: `listarEstoqueDaVariacao` de UMA variação traz MILHARES de linhas
// (~2k, loja a loja) e leva ~5s. Com upsert em massa (upsertEstoqueBulk) a
// escrita fica barata, mas o fetch continua caro -> lote pequeno por step.run
// pra não estourar os 300s.
const ESTOQUE_VARIACOES_POR_EXECUCAO = 80; // variações por disparo
const ESTOQUE_VARIACOES_POR_LOTE = 6; // por step.run (~6 x 6s = ~40s)
// --- filiais ---
const FILIAIS_POR_EXECUCAO = 600; // lojas processadas por disparo diário
const FILIAIS_POR_LOTE = 30; // por step.run
// --- preços ---
const MAX_PAGINAS_PRECOS_POR_EXECUCAO = 400; // ~20k preços/disparo (~402 steps)
const PDV_TABELA_PRECO_VAREJO_FALLBACK = 3; // "3 VAREJO" (confirmado na API)
// --- vendas: detalhe recente x resumo mensal ---
const VENDAS_MESES_DETALHE = 12; // mantém 12 meses em VendaItemSync
const MAX_MESES_CONSOLIDAR_POR_EXECUCAO = 3;
const MAX_MESES_BACKFILL_POR_EXECUCAO = 1;
// Teto de páginas de API por disparo do backfill de 1 mês. Cada `step.run`
// engole BACKFILL_PAGINAS_POR_STEP páginas, então steps ≈ teto / lote-por-step.
// 1200 / 10 = ~120 steps/disparo (limite Inngest = 1000). Sem `step.sleep`.
// Um mês grande (>60k vendas) leva alguns disparos; o cursor por mês
// (`vendas-backfill:mes-atual`) já guarda a página a cada lote.
const MAX_PAGINAS_MES_BACKFILL = 1200; // ~60k vendas/disparo

async function lerSyncState<T>(chave: string, fallback: T): Promise<T> {
  const row = await prisma.syncState.findUnique({ where: { chave } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.valor) as T;
  } catch {
    return fallback;
  }
}

async function gravarSyncState(chave: string, valor: unknown): Promise<void> {
  const str = JSON.stringify(valor);
  await prisma.syncState.upsert({
    where: { chave },
    create: { chave, valor: str },
    update: { valor: str },
  });
}

function isoAgora(): string {
  return new Date().toISOString();
}

// --- helpers de mês (tudo em UTC, formato "YYYY-MM") ---
function anoMesDe(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function primeiroInstanteDoMes(anoMes: string): Date {
  const [a, m] = anoMes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 1, 0, 0, 0));
}
function primeiroInstanteDoMesSeguinte(anoMes: string): Date {
  const [a, m] = anoMes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 1, 0, 0, 0));
}
function mesAnterior(anoMes: string): string {
  const [a, m] = anoMes.split("-").map(Number);
  return anoMesDe(new Date(Date.UTC(a, m - 2, 1)));
}
/**
 * Primeiro mês (YYYY-MM) que ainda conta como "detalhe". Meses estritamente
 * anteriores a este vão pro resumo mensal.
 */
function anoMesCorteDetalhe(agora = new Date()): string {
  return anoMesDe(
    new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - VENDAS_MESES_DETALHE, 1))
  );
}

interface CursorProdutos {
  lastSync: string | null; // ISO da última sincronização concluída (incremental)
  pagina: number; // página em andamento (backfill retomável)
  // Índice em JANELAS_BACKFILL_PRODUTOS_DIAS da janela de data em andamento.
  // Só existe durante o backfill inicial (lastSync === null). Ausente = ainda
  // não migrou pro backfill por janelas -> começa da janela 0.
  janela?: number;
}

/**
 * "Posição" do cursor de produtos como tupla comparável lexicograficamente:
 *   [fase, marco, pagina]
 *   - fase: 0 = backfill (por janelas), 1 = incremental (1º backfill já
 *     terminou). Incremental está sempre à frente de qualquer backfill.
 *   - marco: índice da janela (no backfill) ou timestamp do lastSync (no
 *     incremental) — nos dois casos, "maior" = mais adiantado.
 *   - pagina: página em andamento dentro da fase/marco.
 */
function rankCursorProdutos(c: CursorProdutos): [number, number, number] {
  if (c.lastSync === null) return [0, c.janela ?? 0, c.pagina ?? 1];
  return [1, Date.parse(c.lastSync) || 0, c.pagina ?? 1];
}

/**
 * Grava o cursor de produtos SÓ se ele avançar. Relê o valor salvo primeiro e
 * ignora regravações que fiquem "atrás" ou iguais — blindagem contra um run
 * atrasado ou um replay que tente reescrever uma página antiga e fazer o
 * cursor regredir (o sintoma que víamos no MULTI). O `singleton` da função já
 * evita a sobreposição; isto é o cinto de segurança da gravação em si.
 */
async function gravarCursorProdutos(chave: string, valor: CursorProdutos): Promise<void> {
  const atual = await lerSyncState<CursorProdutos>(chave, { lastSync: null, pagina: 1 });
  const [fa, ma, pa] = rankCursorProdutos(valor);
  const [fb, mb, pb] = rankCursorProdutos(atual);
  const avancou = fa !== fb ? fa > fb : ma !== mb ? ma > mb : pa > pb;
  if (!avancou) return;
  await gravarSyncState(chave, valor);
}

/**
 * syncProdutos — 1x por dia (produtos mudam pouco).
 * Para cada rede ativa: pagina `listarProdutos({ redeId, aPartirDe })` a partir
 * do cursor salvo, faz upsert em Produto e salva as variações. As variações já
 * vêm embutidas no payload do produto (`Variacoes: [{ Id }]`); como o modelo
 * VariacaoProduto só guarda id/produtoId/redeId, usamos isso direto e só
 * chamamos `listarVariacoesProduto` como fallback quando o produto não trouxe
 * a lista embutida.
 */
export const syncProdutos = inngest.createFunction(
  {
    id: "pdv-sync-produtos",
    // Balde de concorrência PRÓPRIO (mesmo padrão do completarXmlNotas): não
    // disputa mais as 4 vagas do pool "sefaz-pdv-sync" com sincronizar-certificado.
    // Aproveitando a suspensão de Venda/Estoque pra acelerar o catálogo.
    concurrency: [{ scope: "account", key: '"sync-produtos"', limit: 1 }],
    // `concurrency: limit 1` só ENFILEIRA o disparo sobreposto — ele ainda
    // entra, relê o cursor no meio e faz a página regredir (o que estávamos
    // vendo no MULTI). `singleton` DESCARTA o disparo novo enquanto um run já
    // está ativo (mode "skip"): uma execução leva ~55min e nunca pode haver
    // duas mexendo no mesmo cursor. Exige Apps → Resync no painel do Inngest
    // pra valer.
    singleton: { mode: "skip" },
    retries: 3,
  },
  // A cada 2h SÓ das 6h às 20h de Brasília (pausa à noite) — 06,08,…,20 BRT,
  // 8x/dia. Era "0 */2 * * *" (o dia todo). Brasil sem horário de verão desde
  // 2019 => America/Sao_Paulo = UTC-3 fixo (equivale a "0 9-23/2 * * *" UTC).
  // Uma execução leva ~55min; com o `singleton` acima, disparo sobreposto é
  // descartado em vez de enfileirado.
  { cron: "TZ=America/Sao_Paulo 0 6-20/2 * * *" },
  async ({ step }) => {
    const redes = await step.run("listar-redes-ativas", async () => {
      const todas = await listarRedes();
      return todas.filter((r) => !r.Inativa).map((r) => ({ id: r.Id, nome: r.Nome }));
    });

    const resumo: Record<string, unknown> = {};

    for (const rede of redes) {
      const chave = `produtos:rede:${rede.id}`;
      // Lê o cursor dentro de um step pra fixá-lo entre replays da função.
      const cursor = await step.run(`cursor-produtos-r${rede.id}`, () =>
        lerSyncState<CursorProdutos>(chave, { lastSync: null, pagina: 1 })
      );
      // Modo backfill inicial (lastSync === null) = varre por janelas de data,
      // da mais recente pra mais antiga. Modo incremental = 1 sweep só, a
      // partir da última sincronização.
      const emBackfill = cursor.lastSync === null;
      // `janela` ausente + backfill = 1ª vez no modo por janelas (ou migração
      // do backfill antigo sem janela) -> recomeça da janela 0, página 1. Os
      // produtos já baixados não se perdem (estão no banco); o upsert só
      // re-grava, agora priorizando os recentes.
      let janelaIdx =
        emBackfill && cursor.janela != null
          ? Math.min(cursor.janela, JANELAS_BACKFILL_PRODUTOS_DIAS.length - 1)
          : 0;
      let pagina =
        emBackfill && cursor.janela == null
          ? 1
          : cursor.pagina > 0
          ? cursor.pagina
          : 1;

      // aPartirDe da janela/sweep atual. No backfill, é a data da janela
      // (null = catálogo inteiro). No incremental, é a última sincronização.
      const aPartirDeAtual = (idx: number): string => {
        if (!emBackfill) return cursor.lastSync!.slice(0, 10);
        const dias = JANELAS_BACKFILL_PRODUTOS_DIAS[idx];
        if (dias == null) return PRODUTOS_DATA_BACKFILL;
        return new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
      };

      let paginasNestaExec = 0;
      let produtosSalvos = 0;
      let variacoesSalvas = 0;
      // `concluiu` só vira true quando a ÚLTIMA janela (ou o sweep incremental)
      // esgota — aí o cursor volta pro modo incremental.
      let concluiu = false;
      const execIniciadaEm = isoAgora();
      // Produtos sem lista de variações embutida — buscamos à parte, com teto.
      const produtosSemVariacaoEmbutida: string[] = [];

      while (paginasNestaExec < MAX_PAGINAS_PRODUTOS_POR_EXECUCAO) {
        paginasNestaExec++;
        const paginaAtual = pagina;
        const janelaAtual = janelaIdx;
        const aPartirDe = aPartirDeAtual(janelaAtual);

        // step id inclui a janela: página 1 da janela 30d != página 1 da 90d.
        const lote = await step.run(
          `produtos-r${rede.id}-w${janelaAtual}-p${paginaAtual}`,
          async () => {
          const { registros, paginacao } = await listarProdutos({
            redeId: rede.id,
            aPartirDe: aPartirDe,
            pagina: paginaAtual,
            tamanhoPagina: PDV_TAM_PAGINA,
          });

          // Monta as operações e executa TUDO num $transaction em lote (array):
          // 1 round-trip em vez de N upserts sequenciais (~80ms cada).
          const ops: Prisma.PrismaPromise<unknown>[] = [];
          let vars = 0;
          const semEmbutidaCandidatos: string[] = [];

          for (const p of registros) {
            const campos = {
              redeId: p.RedeId ?? rede.id,
              nome: p.Nome || null,
              referenciaFornecedor: p.ReferenciaProdutoFornecedor || null,
              fornecedorId: p.FornecedorId || null,
              fornecedorNome: p.Fornecedor || null,
              modeloId: p.ModeloId != null ? String(p.ModeloId) : null,
              modeloNome: p.Modelo || null,
              colecaoId: p.ColecaoId ?? null,
              colecaoNome: p.Colecao || null,
              grupoId: p.GrupoId ?? null,
              grupoNome: p.Grupo || null,
              compradorId: p.CompradorId != null ? String(p.CompradorId) : null,
              compradorNome: p.Comprador || null,
            };
            ops.push(
              prisma.produto.upsert({
                where: { id: p.Id },
                create: { id: p.Id, ...campos },
                update: campos,
              })
            );

            const embutidas = p.Variacoes ?? [];
            if (embutidas.length > 0) {
              for (const v of embutidas) {
                ops.push(
                  prisma.variacaoProduto.upsert({
                    where: { id: v.Id },
                    create: { id: v.Id, produtoId: p.Id, redeId: p.RedeId ?? rede.id },
                    update: { produtoId: p.Id, redeId: p.RedeId ?? rede.id },
                  })
                );
                vars++;
              }
            } else {
              semEmbutidaCandidatos.push(p.Id);
            }
          }

          if (ops.length > 0) await prisma.$transaction(ops);
          const salvos = registros.length;

          // Produtos sem variação embutida que AINDA não têm nenhuma variação
          // salva — numa query só, em vez de um count por produto.
          let semEmbutida: string[] = [];
          if (semEmbutidaCandidatos.length > 0) {
            const jaComVariacao = new Set(
              (
                await prisma.variacaoProduto.findMany({
                  where: { produtoId: { in: semEmbutidaCandidatos } },
                  select: { produtoId: true },
                  distinct: ["produtoId"],
                })
              ).map((r) => r.produtoId)
            );
            semEmbutida = semEmbutidaCandidatos.filter((id) => !jaComVariacao.has(id));
          }

          return {
            salvos,
            vars,
            semEmbutida,
            temProxima: paginacao?.TemProximaPagina ?? registros.length > 0,
            totalPaginas: paginacao?.TotalPaginas ?? null,
          };
        });

        produtosSalvos += lote.salvos;
        variacoesSalvas += lote.vars;
        for (const id of lote.semEmbutida) {
          if (produtosSemVariacaoEmbutida.length < MAX_PRODUTOS_BUSCAR_VARIACOES_POR_EXECUCAO) {
            produtosSemVariacaoEmbutida.push(id);
          }
        }

        pagina = paginaAtual + 1;

        if (!lote.temProxima) {
          // Esgotou a janela/sweep atual.
          if (emBackfill && janelaIdx < JANELAS_BACKFILL_PRODUTOS_DIAS.length - 1) {
            // Ainda há janelas mais antigas -> passa pra próxima e continua na
            // MESMA execução (uma janela recente é pequena; cabem várias no
            // teto de páginas por disparo).
            janelaIdx++;
            pagina = 1;
            await gravarCursorProdutos(chave, { lastSync: null, pagina: 1, janela: janelaIdx });
            continue;
          }
          // Última janela (ou sweep incremental) -> catálogo completo.
          concluiu = true;
          break;
        }

        await gravarCursorProdutos(chave, {
          lastSync: cursor.lastSync,
          pagina,
          ...(emBackfill ? { janela: janelaIdx } : {}),
        });
      }

      // Fallback: produtos sem variação embutida — busca no endpoint dedicado.
      if (produtosSemVariacaoEmbutida.length > 0) {
        const chunk = 20;
        for (let i = 0; i < produtosSemVariacaoEmbutida.length; i += chunk) {
          const ids = produtosSemVariacaoEmbutida.slice(i, i + chunk);
          const n = await step.run(`variacoes-r${rede.id}-${i}`, async () => {
            let vars = 0;
            for (const produtoId of ids) {
              const lista = await listarVariacoesProduto(rede.id, produtoId);
              for (const v of lista) {
                await prisma.variacaoProduto.upsert({
                  where: { id: v.Id },
                  create: { id: v.Id, produtoId, redeId: v.RedeId ?? rede.id },
                  update: { produtoId, redeId: v.RedeId ?? rede.id },
                });
                vars++;
              }
            }
            return vars;
          });
          variacoesSalvas += n;
        }
      }

      // Atualiza o cursor final:
      //  - concluiu (última janela ou sweep incremental terminou) -> modo
      //    incremental (lastSync = agora, página 1, sem janela).
      //  - ainda no backfill -> guarda janela + página pra retomar.
      //  - incremental sem terminar -> guarda a página.
      if (concluiu) {
        await gravarCursorProdutos(chave, { lastSync: execIniciadaEm, pagina: 1 });
      } else if (emBackfill) {
        await gravarCursorProdutos(chave, { lastSync: null, pagina, janela: janelaIdx });
      } else {
        await gravarCursorProdutos(chave, { lastSync: cursor.lastSync, pagina });
      }

      resumo[rede.nome || `rede ${rede.id}`] = {
        produtosSalvos,
        variacoesSalvas,
        concluiu,
        modo: emBackfill
          ? `backfill (janela ${janelaIdx}/${JANELAS_BACKFILL_PRODUTOS_DIAS.length - 1})`
          : "incremental",
        proximaPagina: concluiu ? 1 : pagina,
      };
    }

    // Produtos recém-cadastrados/alterados no PDV: já libera o "sem cadastro"
    // dos itens de nota correspondentes (1 UPDATE em SQL, sem esperar a
    // reavaliação diária, que só processa 2.500 itens/dia).
    const liberados = await step.run("reavaliar-cadastro-recentes", () =>
      reavaliarCadastroRecentes(3)
    );

    return { redes: redes.length, resumo, itensComCadastroLiberado: liberados };
  }
);

interface CursorVendas {
  desde: string; // ISO — início da próxima janela (= maior DataHora já processada)
}

/**
 * syncVendas — a cada hora.
 * Janela [desde, agora]; primeira execução usa os últimos VENDAS_JANELA_INICIAL_DIAS
 * dias. Cada item de cada venda vira uma linha em VendaItemSync com id
 * determinístico `${VendaId}-${SequencialItem}` (idempotente — reprocessar a
 * mesma janela não duplica).
 */
export const syncVendas = inngest.createFunction(
  {
    id: "pdv-sync-vendas",
    concurrency: [
      { scope: "account", key: '"sefaz-pdv-sync"', limit: 4 },
      { limit: 1 },
    ],
    retries: 3,
  },
  // SUSPENSO em 2026-09-09 — sincronização de Venda pausada. Para reativar,
  // troque a linha abaixo de volta por: { cron: "5 * * * *" }
  // e faça Apps → Resync no painel do Inngest.
  { event: "pdv/suspenso" },
  async ({ step }) => {
    const agora = new Date();
    const desdePadrao = new Date(
      agora.getTime() - VENDAS_JANELA_INICIAL_DIAS * 864e5
    ).toISOString();
    const cursor = await step.run("cursor-vendas", () =>
      lerSyncState<CursorVendas>("vendas", { desde: desdePadrao })
    );
    const inicio = cursor.desde;
    const fim = agora.toISOString();

    let pagina = 1;
    let paginasNestaExec = 0;
    let itensSalvos = 0;
    let vendasLidas = 0;
    let maiorDataHora = cursor.desde;
    let concluiu = false;

    while (paginasNestaExec < MAX_PAGINAS_VENDAS_POR_EXECUCAO) {
      paginasNestaExec++;
      const paginaAtual = pagina;

      const lote = await step.run(`vendas-p${paginaAtual}-${inicio.slice(0, 13)}`, async () => {
        const { registros, paginacao } = await listarVendas({
          inicio,
          fim,
          pagina: paginaAtual,
          tamanhoPagina: PDV_TAM_PAGINA,
        });

        let itens = 0;
        let maxDH = "";
        for (const venda of registros) {
          if (venda.Inativa) continue;
          const dataHoraVenda = venda.DataHora;
          if (dataHoraVenda && dataHoraVenda > maxDH) maxDH = dataHoraVenda;

          for (const item of venda.Itens ?? []) {
            const vendaId = String(item.VendaId ?? venda.Id).trim();
            const id = `${vendaId}-${item.SequencialItem}`;
            const quantidade = Number(item.Quantidade ?? 0);
            const preco = Number(item.Preco ?? item.PrecoLiquido ?? 0);
            const valor =
              preco * quantidade -
              Number(item.ValorDesconto ?? 0) +
              Number(item.ValorAcrescimo ?? 0);

            await prisma.vendaItemSync.upsert({
              where: { id },
              create: {
                id,
                variacaoId: String(item.VariacaoId),
                lojaId: item.FilialId ?? venda.LojaId,
                dataHora: new Date(dataHoraVenda),
                quantidade,
                valor,
              },
              update: {
                variacaoId: String(item.VariacaoId),
                lojaId: item.FilialId ?? venda.LojaId,
                dataHora: new Date(dataHoraVenda),
                quantidade,
                valor,
              },
            });
            itens++;
          }
        }

        return {
          itens,
          vendas: registros.length,
          maxDH,
          temProxima: paginacao?.TemProximaPagina ?? registros.length > 0,
          totalPaginas: paginacao?.TotalPaginas ?? null,
        };
      });

      itensSalvos += lote.itens;
      vendasLidas += lote.vendas;
      pagina = paginaAtual + 1;

      // Salva o cursor A CADA página (mesmo padrão de produtos/preços): se a
      // execução morrer no meio, a próxima continua da maior DataHora já
      // gravada em vez de reiniciar a janela padrão do zero. Como o `id` de
      // VendaItemSync é determinístico, reprocessar a página de fronteira não
      // duplica.
      if (lote.maxDH && lote.maxDH > maiorDataHora) {
        maiorDataHora = lote.maxDH;
        await gravarSyncState("vendas", { desde: maiorDataHora });
      }

      if (!lote.temProxima) {
        concluiu = true;
        break;
      }
    }

    // Garante o cursor salvo mesmo quando nenhuma página moveu o maxDH.
    await gravarSyncState("vendas", { desde: maiorDataHora });

    return { janela: { inicio, fim }, vendasLidas, itensSalvos, concluiu, proximoDesde: maiorDataHora };
  }
);

interface CursorEstoque {
  ultimoId: string; // último VariacaoProduto.id já processado ("" = começar do início)
}

/**
 * syncEstoque — a cada hora. Foto atual do estoque, upsert por (variacaoId, lojaId).
 *
 * Em vez de varrer `estoque/variacao` sem filtro (~104 milhões de linhas),
 * percorre só as variações que JÁ temos em VariacaoProduto e consulta o estoque
 * filtrando por `variacaoId` (o endpoint aceita esse filtro e devolve ~1 linha
 * por loja). Processa ESTOQUE_VARIACOES_POR_EXECUCAO variações por hora,
 * continuando de onde parou via SyncState "estoque:cursor".
 */
export const syncEstoque = inngest.createFunction(
  {
    id: "pdv-sync-estoque",
    concurrency: [
      { scope: "account", key: '"sefaz-pdv-sync"', limit: 4 },
      { limit: 1 },
    ],
    retries: 3,
  },
  // SUSPENSO em 2026-09-09 — sincronização de Estoque pausada. Para reativar,
  // troque a linha abaixo de volta por: { cron: "15 * * * *" }
  // e faça Apps → Resync no painel do Inngest.
  { event: "pdv/suspenso" },
  async ({ step }) => {
    const cursor = await step.run("cursor-estoque", () =>
      lerSyncState<CursorEstoque>("estoque:cursor", { ultimoId: "" })
    );

    const variacoes = await step.run("proximas-variacoes", () =>
      prisma.variacaoProduto.findMany({
        where: { id: { gt: cursor.ultimoId } },
        orderBy: { id: "asc" },
        take: ESTOQUE_VARIACOES_POR_EXECUCAO,
        select: { id: true },
      })
    );

    if (variacoes.length === 0) {
      // Chegou ao fim do catálogo — recomeça do zero na próxima execução.
      await gravarSyncState("estoque:cursor", { ultimoId: "" });
      return { fim: true, variacoesProcessadas: 0 };
    }

    let linhasSalvas = 0;
    const ids = variacoes.map((v) => v.id);

    for (let i = 0; i < ids.length; i += ESTOQUE_VARIACOES_POR_LOTE) {
      const lote = ids.slice(i, i + ESTOQUE_VARIACOES_POR_LOTE);

      const res = await step.run(`estoque-lote-${cursor.ultimoId || "ini"}-${i}`, async () => {
        const t0 = Date.now();
        let n = 0;
        for (const variacaoId of lote) {
          const linhas = await listarEstoqueDaVariacao(variacaoId);
          n += await upsertEstoqueBulk(
            linhas.map((e) => ({
              variacaoId: String(e.VariacaoId),
              lojaId: e.LojaId,
              quantidade: Number(e.Quantidade ?? 0),
            }))
          );
        }
        return { linhas: n, ms: Date.now() - t0 };
      });

      linhasSalvas += res.linhas;
      // log de calibragem: quanto tempo o step levou
      console.log(`[syncEstoque] lote ${i / ESTOQUE_VARIACOES_POR_LOTE}: ${lote.length} variações, ${res.linhas} linhas, ${res.ms}ms`);
      await gravarSyncState("estoque:cursor", { ultimoId: lote[lote.length - 1] });
    }

    // Se veio menos que o lote cheio, terminamos a volta pelo catálogo.
    if (variacoes.length < ESTOQUE_VARIACOES_POR_EXECUCAO) {
      await gravarSyncState("estoque:cursor", { ultimoId: "" });
    }

    return {
      variacoesProcessadas: ids.length,
      linhasSalvas,
      proximoCursor: variacoes.length < ESTOQUE_VARIACOES_POR_EXECUCAO ? "" : ids[ids.length - 1],
    };
  }
);

// ---------------------------------------------------------------------------
// syncRedes — 1x por dia. Só ~17 redes; guarda id -> nome pra o relatório
// mostrar o nome da rede em vez de "Rede {id}".
// ---------------------------------------------------------------------------

export const syncRedes = inngest.createFunction(
  {
    id: "pdv-sync-redes",
    concurrency: [
      { scope: "account", key: '"sefaz-pdv-sync"', limit: 4 },
      { limit: 1 },
    ],
    retries: 3,
  },
  { cron: "0 4 * * *" },
  async ({ step }) => {
    const salvas = await step.run("sync-redes", async () => {
      const redes = await listarRedes();
      let n = 0;
      for (const r of redes) {
        if (r.Id == null) continue;
        await prisma.redeSync.upsert({
          where: { id: r.Id },
          create: { id: r.Id, nome: r.Nome ?? `Rede ${r.Id}` },
          update: { nome: r.Nome ?? `Rede ${r.Id}` },
        });
        n++;
      }
      return n;
    });
    return { redesSalvas: salvas };
  }
);

// ---------------------------------------------------------------------------
// syncFiliais — 1x por dia (junto com syncProdutos). Sincroniza Empresa/Grupo/
// Supervisor de cada loja pro nosso banco, pra rota /api/lojas não precisar
// chamar obterFilial() ~860 vezes ao vivo. Percorre em lotes com cursor
// (SyncState "filiais:cursor"); a primeira volta leva algumas execuções.
// ---------------------------------------------------------------------------

interface CursorFiliais {
  ultimoLojaId: number; // maior lojaId já processado (0 = começar do início)
}

export const syncFiliais = inngest.createFunction(
  {
    id: "pdv-sync-filiais",
    concurrency: [
      { scope: "account", key: '"sefaz-pdv-sync"', limit: 4 },
      { limit: 1 },
    ],
    retries: 3,
  },
  { cron: "0 4 * * *" },
  async ({ step }) => {
    const todasLojas = await step.run("listar-lojas", async () => {
      const lojas = await listarLojas();
      return lojas
        .map((l) => ({ id: l.Id, nome: l.NomeFantasia }))
        .sort((a, b) => a.id - b.id);
    });
    if (todasLojas.length === 0) return { lojas: 0 };

    const cursor = await step.run("cursor-filiais", () =>
      lerSyncState<CursorFiliais>("filiais:cursor", { ultimoLojaId: 0 })
    );

    const pendentes = todasLojas.filter((l) => l.id > cursor.ultimoLojaId);
    if (pendentes.length === 0) {
      // Deu a volta em todas — recomeça na próxima execução (atualiza dados).
      await gravarSyncState("filiais:cursor", { ultimoLojaId: 0 });
      return { fim: true, filiaisSalvas: 0 };
    }

    const alvo = pendentes.slice(0, FILIAIS_POR_EXECUCAO);
    let filiaisSalvas = 0;

    for (let i = 0; i < alvo.length; i += FILIAIS_POR_LOTE) {
      const lote = alvo.slice(i, i + FILIAIS_POR_LOTE);

      const salvos = await step.run(`filiais-lote-${cursor.ultimoLojaId}-${i}`, async () => {
        let n = 0;
        for (const loja of lote) {
          try {
            const filial = await obterFilial(loja.id);
            const nome = loja.nome ?? filial.RazaoSocial ?? null;
            const tipoLoja = classificarTipoLoja(loja.id, loja.nome ?? "");
            await prisma.filialSync.upsert({
              where: { lojaId: loja.id },
              create: {
                lojaId: loja.id,
                nome,
                empresaId: filial.Empresa ?? null,
                grupoId: filial.Grupo ?? null,
                supervisor: filial.Supervisor ?? null,
                tipoLoja,
              },
              update: {
                nome,
                empresaId: filial.Empresa ?? null,
                grupoId: filial.Grupo ?? null,
                supervisor: filial.Supervisor ?? null,
                tipoLoja,
              },
            });
            n++;
          } catch {
            // Filial que não abre — pula; tenta de novo no próximo ciclo.
          }
        }
        return n;
      });

      filiaisSalvas += salvos;
      await gravarSyncState("filiais:cursor", { ultimoLojaId: lote[lote.length - 1].id });
    }

    const terminou = alvo.length === pendentes.length;
    if (terminou) await gravarSyncState("filiais:cursor", { ultimoLojaId: 0 });

    return {
      totalLojas: todasLojas.length,
      processadasNestaExec: alvo.length,
      filiaisSalvas,
      proximoCursor: terminou ? 0 : alvo[alvo.length - 1].id,
    };
  }
);

// ---------------------------------------------------------------------------
// syncPrecos — 1x por dia. Varre a tabela de preço "VAREJO" inteira (não tem
// filtro incremental) por cursor de página e faz upsert em PrecoVariacao.
// ---------------------------------------------------------------------------

interface CursorPrecos {
  pagina: number;
}

async function descobrirTabelaVarejo(): Promise<number> {
  try {
    // O endpoint é praticamente igual pra qualquer filial; usamos uma fixa.
    const tabelas = await listarTabelasPreco(1);
    const varejo = tabelas.find(
      (t) => t.Descricao?.replace(/^[\d\s]+/, "").trim().toUpperCase() === "VAREJO"
    );
    return varejo?.Codigo ?? PDV_TABELA_PRECO_VAREJO_FALLBACK;
  } catch {
    return PDV_TABELA_PRECO_VAREJO_FALLBACK;
  }
}

export const syncPrecos = inngest.createFunction(
  {
    id: "pdv-sync-precos",
    concurrency: [
      { scope: "account", key: '"sefaz-pdv-sync"', limit: 4 },
      { limit: 1 },
    ],
    retries: 3,
  },
  { cron: "45 3 * * *" },
  async ({ step }) => {
    const tabelaId = await step.run("descobrir-tabela-varejo", descobrirTabelaVarejo);

    const cursor = await step.run("cursor-precos", () =>
      lerSyncState<CursorPrecos>("precos:cursor", { pagina: 1 })
    );

    let pagina = cursor.pagina > 0 ? cursor.pagina : 1;
    let paginasNestaExec = 0;
    let precosSalvos = 0;
    let concluiu = false;

    while (paginasNestaExec < MAX_PAGINAS_PRECOS_POR_EXECUCAO) {
      paginasNestaExec++;
      const paginaAtual = pagina;

      const lote = await step.run(`precos-t${tabelaId}-p${paginaAtual}`, async () => {
        const { registros, paginacao } = await listarPrecos(tabelaId, {
          pagina: paginaAtual,
          tamanhoPagina: PDV_TAM_PAGINA,
        });
        let salvos = 0;
        for (const p of registros) {
          const preco = Number(p.PrecoOriginal ?? 0);
          await prisma.precoVariacao.upsert({
            where: { variacaoId: String(p.VariacaoId) },
            create: { variacaoId: String(p.VariacaoId), preco },
            update: { preco },
          });
          salvos++;
        }
        return {
          salvos,
          temProxima: paginacao?.TemProximaPagina ?? registros.length > 0,
        };
      });

      precosSalvos += lote.salvos;
      pagina = paginaAtual + 1;

      if (!lote.temProxima) {
        concluiu = true;
        break;
      }
      await gravarSyncState("precos:cursor", { pagina });
    }

    // Terminou a tabela -> recomeça na próxima execução diária.
    await gravarSyncState("precos:cursor", { pagina: concluiu ? 1 : pagina });

    return { tabelaId, precosSalvos, concluiu, proximaPagina: concluiu ? 1 : pagina };
  }
);

// ---------------------------------------------------------------------------
// consolidarVendasAntigas — 1x por dia. Move o que passou de VENDAS_MESES_DETALHE
// meses de VendaItemSync para VendaResumoMensal (soma por variacao x loja x mês)
// e apaga o detalhe. Feito em lotes numa transação (ler -> somar -> incrementar
// -> apagar as MESMAS linhas), então reexecução não duplica.
//
// Transação INTERATIVA do Prisma exige conexão em modo SESSÃO — o
// DATABASE_URL padrão aponta pro Transaction Pooler (6543), que não suporta.
// Por isso esta função usa um PrismaClient próprio apontado pro DIRECT_URL
// (Session Pooler / conexão direta, 5432) e o fecha no final.
// ---------------------------------------------------------------------------

const CONSOLIDAR_LINHAS_POR_STEP = 2000;

export const consolidarVendasAntigas = inngest.createFunction(
  {
    id: "pdv-consolidar-vendas-antigas",
    concurrency: [
      { scope: "account", key: '"sefaz-pdv-sync"', limit: 4 },
      { limit: 1 },
    ],
    retries: 3,
  },
  // SUSPENSO em 2026-09-09 — consolidação de vendas antigas pausada (só faz
  // sentido com a sync de Venda rodando). Para reativar, troque a linha abaixo
  // de volta por: { cron: "20 3 * * *" } e faça Apps → Resync no Inngest.
  { event: "pdv/suspenso" },
  async ({ step }) => {
    const corte = anoMesCorteDetalhe(); // meses < corte viram resumo
    const limiteData = primeiroInstanteDoMes(corte);

    const dbSessao = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

    let totalLinhas = 0;
    let totalGrupos = 0;
    let lotes = 0;

    try {
      // Cada iteração processa um lote de linhas antigas; para quando não há mais.
      for (let guarda = 0; guarda < 500; guarda++) {
        const resultado = await step.run(`consolidar-lote-${guarda}`, async () => {
          return dbSessao.$transaction(
            async (tx) => {
              const linhas = await tx.vendaItemSync.findMany({
                where: { dataHora: { lt: limiteData } },
                orderBy: { id: "asc" },
                take: CONSOLIDAR_LINHAS_POR_STEP,
              });
              if (linhas.length === 0) return { linhas: 0, grupos: 0 };

              // Agrega em memória por (variacaoId, lojaId, anoMes).
              const agg = new Map<string, { v: string; l: number; m: string; q: number; val: number }>();
              for (const r of linhas) {
                const m = anoMesDe(new Date(r.dataHora));
                const k = `${r.variacaoId}|${r.lojaId}|${m}`;
                const cur = agg.get(k) ?? { v: r.variacaoId, l: r.lojaId, m, q: 0, val: 0 };
                cur.q += Number(r.quantidade);
                cur.val += Number(r.valor);
                agg.set(k, cur);
              }

              for (const g of agg.values()) {
                await tx.vendaResumoMensal.upsert({
                  where: {
                    variacaoId_lojaId_anoMes: { variacaoId: g.v, lojaId: g.l, anoMes: g.m },
                  },
                  create: {
                    variacaoId: g.v,
                    lojaId: g.l,
                    anoMes: g.m,
                    quantidadeTotal: g.q,
                    valorTotal: g.val,
                  },
                  update: {
                    quantidadeTotal: { increment: g.q },
                    valorTotal: { increment: g.val },
                  },
                });
              }

              await tx.vendaItemSync.deleteMany({ where: { id: { in: linhas.map((r) => r.id) } } });
              return { linhas: linhas.length, grupos: agg.size };
            },
            { timeout: 120_000 }
          );
        });

        totalLinhas += resultado.linhas;
        totalGrupos += resultado.grupos;
        if (resultado.linhas === 0) break;
        lotes++;
        await step.sleep(`pausa-consolidar-${guarda}`, PDV_PAUSA_ENTRE_LOTES_MS);
      }
    } finally {
      await dbSessao.$disconnect();
    }

    return { corte, lotes, linhasConsolidadas: totalLinhas, gruposAfetados: totalGrupos };
  }
);

// ---------------------------------------------------------------------------
// backfillVendasHistorico — cron separado (a cada 2h). Caminha PRA TRÁS no
// tempo, um mês por execução:
//   - mês dentro dos últimos VENDAS_MESES_DETALHE meses -> grava em VendaItemSync
//   - mês mais antigo -> agrega em memória (via SyncState, incrementando por
//     lote de páginas) e grava direto em VendaResumoMensal
// Para quando um mês vem sem nenhuma venda (marca done e passa a não fazer nada).
// ---------------------------------------------------------------------------

interface CursorBackfillVendas {
  mes: string | null; // mês mais antigo já concluído
  done: boolean;
}
interface EstadoMesBackfill {
  mes: string;
  pagina: number;
  // agregado parcial (só usado quando o mês é "profundo"): "vid|lid" -> [q, val]
  agg: Record<string, [number, number]>;
}

// Páginas de API processadas dentro de um único `step.run`. Cada página de
// vendas leva ~10-15s de I/O, então 10 páginas ≈ 100-150s — folga confortável
// abaixo do maxDuration de 300s (antes eram 20, ~260s, encostando no teto).
const BACKFILL_PAGINAS_POR_STEP = 10;

export const backfillVendasHistorico = inngest.createFunction(
  {
    id: "pdv-backfill-vendas-historico",
    concurrency: [
      { scope: "account", key: '"sefaz-pdv-sync"', limit: 4 },
      { limit: 1 },
    ],
    retries: 3,
  },
  // SUSPENSO em 2026-09-09 — backfill do histórico de vendas pausado. Para
  // reativar, troque a linha abaixo de volta por: { cron: "0 */2 * * *" }
  // e faça Apps → Resync no painel do Inngest.
  { event: "pdv/suspenso" },
  async ({ step }) => {
    const cursor = await step.run("cursor-backfill", () =>
      lerSyncState<CursorBackfillVendas>("vendas-backfill:cursor", { mes: null, done: false })
    );
    if (cursor.done) return { done: true };

    const agora = new Date();
    const corte = anoMesCorteDetalhe(agora);
    const mesCorrente = anoMesDe(agora);
    // Um mês vazio só conta como "fim do histórico" se estiver pelo menos 2
    // meses atrás do corrente — assim o mês em andamento (parcial por natureza,
    // pode estar recém-começado e sem vendas) e o anterior nunca desligam o
    // backfill por engano. Formato "YYYY-MM" compara certo como string.
    const limiteMesVazio = mesAnterior(mesAnterior(mesCorrente));

    let mesesProcessados = 0;
    let mesAlvo = cursor.mes ? mesAnterior(cursor.mes) : mesCorrente;

    for (let i = 0; i < MAX_MESES_BACKFILL_POR_EXECUCAO; i++) {
      const ini = primeiroInstanteDoMes(mesAlvo).toISOString();
      const fim = primeiroInstanteDoMesSeguinte(mesAlvo).toISOString();
      const profundo = mesAlvo < corte;
      const chaveMes = "vendas-backfill:mes-atual";

      let estado = await step.run(`estado-mes-${mesAlvo}`, () =>
        lerSyncState<EstadoMesBackfill>(chaveMes, { mes: mesAlvo, pagina: 1, agg: {} })
      );
      if (estado.mes !== mesAlvo) estado = { mes: mesAlvo, pagina: 1, agg: {} };

      let pagina = estado.pagina;
      let agg = estado.agg;
      let vendasNoMes = 0;
      let itensNoMes = 0;
      let acabou = false;
      let vazioLogo = false;

      while (pagina <= MAX_PAGINAS_MES_BACKFILL) {
        const paginaInicial = pagina;
        const resultado = await step.run(`backfill-${mesAlvo}-p${paginaInicial}`, async () => {
          const aggLocal: Record<string, [number, number]> = {};
          let vendas = 0;
          let itens = 0;
          let temProxima = true;
          let vazioNaPrimeira = false;

          for (let k = 0; k < BACKFILL_PAGINAS_POR_STEP; k++) {
            const p = paginaInicial + k;
            const { registros, paginacao } = await listarVendas({
              inicio: ini,
              fim,
              pagina: p,
              tamanhoPagina: PDV_TAM_PAGINA,
            });
            if (p === 1 && registros.length === 0) vazioNaPrimeira = true;
            vendas += registros.length;

            for (const venda of registros) {
              if (venda.Inativa) continue;
              for (const item of venda.Itens ?? []) {
                const vendaId = String(item.VendaId ?? venda.Id).trim();
                const variacaoId = String(item.VariacaoId);
                const lojaId = item.FilialId ?? venda.LojaId;
                const quantidade = Number(item.Quantidade ?? 0);
                const preco = Number(item.Preco ?? item.PrecoLiquido ?? 0);
                const valor =
                  preco * quantidade -
                  Number(item.ValorDesconto ?? 0) +
                  Number(item.ValorAcrescimo ?? 0);

                if (profundo) {
                  const key = `${variacaoId}|${lojaId}`;
                  const cur = aggLocal[key] ?? [0, 0];
                  cur[0] += quantidade;
                  cur[1] += valor;
                  aggLocal[key] = cur;
                } else {
                  const id = `${vendaId}-${item.SequencialItem}`;
                  await prisma.vendaItemSync.upsert({
                    where: { id },
                    create: { id, variacaoId, lojaId, dataHora: new Date(venda.DataHora), quantidade, valor },
                    update: { variacaoId, lojaId, dataHora: new Date(venda.DataHora), quantidade, valor },
                  });
                }
                itens++;
              }
            }

            if (!(paginacao?.TemProximaPagina ?? registros.length > 0)) {
              temProxima = false;
              break;
            }
          }

          return { aggLocal, vendas, itens, temProxima, vazioNaPrimeira };
        });

        vendasNoMes += resultado.vendas;
        itensNoMes += resultado.itens;
        if (resultado.vazioNaPrimeira) vazioLogo = true;

        // Funde o agregado parcial (mês profundo) e persiste estado+página juntos.
        if (profundo) {
          for (const [key, [q, v]] of Object.entries(resultado.aggLocal)) {
            const cur = agg[key] ?? [0, 0];
            cur[0] += q;
            cur[1] += v;
            agg[key] = cur;
          }
        }
        pagina = paginaInicial + BACKFILL_PAGINAS_POR_STEP;
        await gravarSyncState(chaveMes, { mes: mesAlvo, pagina, agg: profundo ? agg : {} });

        if (!resultado.temProxima) {
          acabou = true;
          break;
        }
      }

      // Mês profundo concluído -> grava o resumo (valores absolutos) e limpa.
      if (profundo && acabou) {
        await step.run(`flush-resumo-${mesAlvo}`, async () => {
          for (const [key, [q, v]] of Object.entries(agg)) {
            const [variacaoId, lojaStr] = key.split("|");
            await prisma.vendaResumoMensal.upsert({
              where: {
                variacaoId_lojaId_anoMes: { variacaoId, lojaId: Number(lojaStr), anoMes: mesAlvo },
              },
              create: { variacaoId, lojaId: Number(lojaStr), anoMes: mesAlvo, quantidadeTotal: q, valorTotal: v },
              update: { quantidadeTotal: q, valorTotal: v },
            });
          }
        });
      }

      // Limpa o estado do mês e avança o cursor principal.
      await gravarSyncState(chaveMes, { mes: "", pagina: 1, agg: {} });

      mesesProcessados++;
      // "Fim do histórico" só quando um mês PASSADO inteiro (varrido desde a
      // página 1 -> `vazioLogo`) veio sem nenhuma venda. Nunca pelo mês
      // corrente nem pelo anterior (ver `limiteMesVazio`).
      const mesPassadoInteiroVazio =
        mesAlvo <= limiteMesVazio && vazioLogo && vendasNoMes === 0;
      if (mesPassadoInteiroVazio) {
        await gravarSyncState("vendas-backfill:cursor", { mes: mesAlvo, done: true });
        return { mesAlvo, done: true, mesesProcessados };
      }
      await gravarSyncState("vendas-backfill:cursor", { mes: mesAlvo, done: false });

      mesAlvo = mesAnterior(mesAlvo);
    }

    return { proximoMes: mesAlvo, mesesProcessados };
  }
);

// ---------------------------------------------------------------------------
// completarXmlNotas — a cada 30 min. Tenta preencher o XML completo (procNFe)
// das notas que ainda só têm o resumo (`xmlCompleto = ""`), usando a mesma
// lógica de `obterXmlNota` que a abertura manual da nota usa. Ao conseguir,
// número/série também são atualizados (dentro de obterXmlNota).
//
// - No máximo MAX_NOTAS_COMPLETAR_XML notas por execução, mais antigas /
//   sem tentativa recente primeiro (campo `ultimaTentativaXml`).
// - Só re-tenta uma nota se já faz >= COMPLETAR_XML_REPETIR_APOS_H horas.
// - O intervalo de 22s (INTERVALO_COMPLETAR_XML_MS) só é necessário ENTRE notas
//   do MESMO certificado — o rate limit da SEFAZ (cStat 656 / "consumo
//   indevido") é por-CNPJ. As notas são agrupadas por certificado e
//   intercaladas (round-robin): com muitos certs na fila, a espera de 22s
//   some, porque entre duas notas do mesmo cert já passaram várias notas de
//   outros. Um 656 num cert só bloqueia esse cert nesta execução, não aborta.
// - DESISTE de uma nota (ignora nas próximas buscas) quando ela já teve
//   LIMITE_TENTATIVAS_XML tentativas E foi emitida há mais de
//   DIAS_NOTA_RECENTE dias — nesse ponto a SEFAZ provavelmente não vai mais
//   disponibilizar o XML completo. Notas recentes continuam sendo tentadas.
// ---------------------------------------------------------------------------

// Teto de notas por execução. Custo real por nota ≈ 1 consulta SOAP mTLS à
// SEFAZ (~3-6s) + upsert dos itens/duplicatas. As esperas de 22s são
// `step.sleep` (offloaded pela Inngest, não contam no maxDuration de 300s), e
// a Inngest quebra a execução em várias invocações se precisar — então 100
// notas cabem com folga.
const MAX_NOTAS_COMPLETAR_XML = 100;
// Não deixa um único certificado (ex.: GAVEA com 165 notas pendentes) dominar
// a fila e virar uma corrente serial de 22s.
const MAX_NOTAS_POR_CERT_POR_EXECUCAO = 10;
// Quantas notas trazer do banco pra depois agrupar/intercalar por certificado.
const COMPLETAR_XML_CANDIDATOS = 600;
const COMPLETAR_XML_REPETIR_APOS_H = 6;
// Espera entre duas notas do MESMO certificado (evita o 656 da SEFAZ).
const INTERVALO_COMPLETAR_XML_MS = 22_000;
// Quantas notas de OUTROS certificados equivalem, na prática, aos 22s de
// espera. Se pelo menos isso passou desde a última nota de um cert, não
// esperamos (a rotação já espaçou o suficiente). Determinístico -> replay-safe.
const NOTAS_ENTRE_MESMO_CERT = 12;

export const completarXmlNotas = inngest.createFunction(
  {
    id: "completar-xml-notas",
    // Balde de concorrência PRÓPRIO: `key` diferente do "sefaz-pdv-sync" que as
    // syncs de PDV/certificado usam -> pool independente, não disputa as 4
    // vagas gerais (que ficam dominadas pelos backfills longos de certificado).
    concurrency: [{ scope: "account", key: '"completar-xml-notas"', limit: 1 }],
    retries: 2,
  },
  { cron: "TZ=America/Sao_Paulo 0 6-20 * * *" },
  async ({ step }) => {
    const limite = new Date(Date.now() - COMPLETAR_XML_REPETIR_APOS_H * 3_600_000);
    const trintaDiasAtras = new Date(Date.now() - DIAS_NOTA_RECENTE * 86_400_000);

    const candidatasBrutas = await step.run("buscar-notas-pendentes", () =>
      prisma.note.findMany({
        where: {
          xmlCompleto: "",
          // Nota importada do histórico da Qive (certificateId null) sempre
          // chega com xmlCompleto já preenchido, então nunca deveria cair
          // aqui — mas exclui explicitamente: sem Certificate não tem como
          // reconsultar a SEFAZ.
          certificateId: { not: null },
          OR: [{ ultimaTentativaXml: null }, { ultimaTentativaXml: { lt: limite } }],
          // Não desistiu ainda: poucas tentativas OU nota ainda recente
          // (sem data de emissão contamos como "ainda pode aparecer").
          NOT: {
            AND: [
              { tentativasXml: { gte: LIMITE_TENTATIVAS_XML } },
              { dataEmissao: { lt: trintaDiasAtras } },
            ],
          },
        },
        orderBy: [
          { ultimaTentativaXml: { sort: "asc", nulls: "first" } },
          { createdAt: "asc" },
        ],
        take: COMPLETAR_XML_CANDIDATOS,
        select: { chaveAcesso: true, certificateId: true },
      })
    );
    // Type narrowing: o `where` acima já garante isso em runtime.
    const candidatas = candidatasBrutas.filter(
      (n): n is { chaveAcesso: string; certificateId: string } => n.certificateId != null
    );

    if (candidatas.length === 0) return { pendentes: 0 };

    // Agrupa por certificado (mantendo a ordem de prioridade), limita quantas
    // notas de cada cert entram nesta execução e depois intercala os grupos.
    const grupos = new Map<string, string[]>();
    for (const n of candidatas) {
      const arr = grupos.get(n.certificateId) ?? [];
      if (arr.length < MAX_NOTAS_POR_CERT_POR_EXECUCAO) {
        arr.push(n.chaveAcesso);
        grupos.set(n.certificateId, arr);
      }
    }
    const listas = [...grupos.entries()];
    const fila: { chave: string; certId: string }[] = [];
    for (let rodada = 0; fila.length < MAX_NOTAS_COMPLETAR_XML; rodada++) {
      let adicionou = false;
      for (const [certId, chaves] of listas) {
        if (chaves.length > rodada) {
          fila.push({ chave: chaves[rodada], certId });
          adicionou = true;
          if (fila.length >= MAX_NOTAS_COMPLETAR_XML) break;
        }
      }
      if (!adicionou) break;
    }

    let completadas = 0;
    let aindaResumo = 0;
    let erros = 0;
    const certsBloqueados = new Set<string>(); // pegaram 656 nesta execução
    // certId -> nº de notas (de qualquer cert) processadas desde a última desse
    // cert. Reconstruído igual em todo replay -> não usa Date.now().
    const desdeUltima = new Map<string, number>();

    for (let i = 0; i < fila.length; i++) {
      const { chave, certId } = fila[i];
      if (certsBloqueados.has(certId)) continue; // 656 nesse cert -> pula o resto dele

      const gap = desdeUltima.get(certId);
      if (gap !== undefined && gap < NOTAS_ENTRE_MESMO_CERT) {
        // Ainda não passaram notas de outros certs suficientes pra cobrir os
        // 22s -> espera o intervalo cheio.
        await step.sleep(`aguardar-${certId}-${i}`, INTERVALO_COMPLETAR_XML_MS);
      }

      const r = await step.run(`completar-${chave}`, async () => {
        const res = await obterXmlNota(chave);

        let estado: "ok" | "ratelimit" | "resumo" | "erro";
        if (!("erro" in res)) estado = "ok";
        else if (/cstat\s*656|consumo\s+indevido/i.test(res.erro)) estado = "ratelimit";
        else if (res.status === 409) estado = "resumo";
        else estado = "erro";

        const nota = await prisma.note.update({
          where: { chaveAcesso: chave },
          data: {
            ultimaTentativaXml: new Date(),
            // Só conta como "tentativa gasta" quando a SEFAZ realmente só tinha
            // o resumo (não em rate limit nem erro passageiro).
            ...(estado === "resumo" ? { tentativasXml: { increment: 1 } } : {}),
          },
          select: { id: true },
        });

        // XML completo obtido -> (re)popula itens e duplicatas da nota.
        let itensGravados = 0;
        let duplicatasGravadas = 0;
        if (estado === "ok" && !("erro" in res)) {
          const p = await popularNotaItens(nota.id, res.xml);
          itensGravados = p.itens;
          duplicatasGravadas = p.duplicatas;
        }

        return {
          estado,
          itensGravados,
          duplicatasGravadas,
          erro: "erro" in res ? res.erro : undefined,
        };
      });

      // essa nota "zera" o contador do seu cert; +1 nos demais
      for (const [c, v] of desdeUltima) desdeUltima.set(c, v + 1);
      desdeUltima.set(certId, 0);

      if (r.estado === "ok") completadas++;
      else if (r.estado === "resumo") aindaResumo++;
      else if (r.estado === "ratelimit") certsBloqueados.add(certId); // 656 é por-CNPJ
      else erros++;
    }

    return {
      processadas: fila.length,
      completadas,
      aindaResumo,
      erros,
      certsBloqueados: certsBloqueados.size,
    };
  }
);

// ---------------------------------------------------------------------------
// enriquecerVariacoes — a cada 3h. Preenche ean/cor/tamanho das
// VariacaoProduto aos poucos (o sync normal do catálogo só traz o Id da
// variação). Pega até ENRIQUECER_VARIACOES_POR_EXECUCAO variações ainda sem
// `ean`, agrupa por produtoId (1 chamada listarVariacoesProduto por produto)
// e salva. Cursor em SyncState "enriquecer-variacoes:cursor".
// ---------------------------------------------------------------------------

// Subiu de 90 -> 300 aproveitando a suspensão de Venda/Estoque: cada lote de
// ENRIQUECER_PRODUTOS_POR_LOTE produtos é um step.run separado (~10-15s cada),
// então 300 variações ≈ 30 steps — folga larga abaixo do teto de 1000 steps
// da Inngest e dos 300s por step. É o gargalo nº 1 do "temCadastro" da
// Conferência de Produtos (cobertura de EAN estava em ~0,2%).
const ENRIQUECER_VARIACOES_POR_EXECUCAO = 300;
const ENRIQUECER_PRODUTOS_POR_LOTE = 10;

interface CursorEnriquecer {
  ultimoId: string;
}

export const enriquecerVariacoes = inngest.createFunction(
  {
    id: "pdv-enriquecer-variacoes",
    // Balde de concorrência PRÓPRIO — não disputa o pool "sefaz-pdv-sync".
    concurrency: [{ scope: "account", key: '"enriquecer-variacoes"', limit: 1 }],
    retries: 3,
  },
  { cron: "TZ=America/Sao_Paulo 10 6-20/2 * * *" }, // de 2 em 2h (6h-20h), deslocado de syncProdutos (que roda no minuto 0). Era "10,40 * * * *".
  async ({ step }) => {
    const cursor = await step.run("cursor-enriquecer", () =>
      lerSyncState<CursorEnriquecer>("enriquecer-variacoes:cursor", { ultimoId: "" })
    );

    // PRIORIDADE: variações (ean null) de produtos cuja referência bate com a de
    // itens de notas recebidas que ainda estão sem cadastro e têm EAN — são as
    // que destravam o "tem cadastro" primeiro. Quem já foi enriquecido sai da
    // fila sozinho (ean deixa de ser null); os que o PDV não devolve são
    // "tocados" (updatedAt) no fim para irem pro fim da fila e não travá-la.
    const prioritarias = await step.run("variacoes-prioritarias", () =>
      prisma.$queryRaw<{ id: string; produtoId: string; redeId: number }[]>(Prisma.sql`
        SELECT v.id, v."produtoId", v."redeId"
        FROM "VariacaoProduto" v
        JOIN "Produto" p ON p.id = v."produtoId"
        WHERE v.ean IS NULL
          AND upper(trim(p."referenciaFornecedor")) IN (
            SELECT DISTINCT upper(trim("referenciaFornecedorIdentificada"))
            FROM "NotaItem"
            WHERE "temCadastro" = false
              AND ean IS NOT NULL AND ean <> ''
              AND "referenciaFornecedorIdentificada" IS NOT NULL
          )
        ORDER BY v."updatedAt" ASC
        LIMIT ${ENRIQUECER_VARIACOES_POR_EXECUCAO}
      `)
    );

    // Restante da cota: varredura normal por id (cursor), como antes.
    const restante = ENRIQUECER_VARIACOES_POR_EXECUCAO - prioritarias.length;
    const varridas =
      restante > 0
        ? await step.run("proximas-variacoes-sem-ean", () =>
            prisma.variacaoProduto.findMany({
              where: {
                ean: null,
                id: { gt: cursor.ultimoId, notIn: prioritarias.map((v) => v.id) },
              },
              orderBy: { id: "asc" },
              take: restante,
              select: { id: true, produtoId: true, redeId: true },
            })
          )
        : [];
    const variacoes = [...prioritarias, ...varridas];

    if (variacoes.length === 0) {
      await gravarSyncState("enriquecer-variacoes:cursor", { ultimoId: "" });
      return { fim: true, variacoesProcessadas: 0 };
    }

    // Produtos distintos a consultar (redeId de qualquer variação do produto).
    const produtos = [
      ...new Map(variacoes.map((v) => [v.produtoId, v.redeId])).entries(),
    ].map(([produtoId, redeId]) => ({ produtoId, redeId }));

    let variacoesAtualizadas = 0;

    for (let i = 0; i < produtos.length; i += ENRIQUECER_PRODUTOS_POR_LOTE) {
      const lote = produtos.slice(i, i + ENRIQUECER_PRODUTOS_POR_LOTE);

      const n = await step.run(`enriquecer-lote-${cursor.ultimoId || "ini"}-${i}`, async () => {
        let atualizadas = 0;
        for (const { produtoId, redeId } of lote) {
          let lista;
          try {
            lista = await listarVariacoesProduto(redeId, produtoId);
          } catch {
            continue; // produto que não responde — pula, cursor segue em frente
          }
          for (const v of lista) {
            await prisma.variacaoProduto.updateMany({
              where: { id: String(v.Id) },
              data: {
                // "" quando o PDV não tem EAN -> não re-seleciona essa variação.
                ean: (v.EAN ?? "").trim(),
                cor: v.Cor || null,
                tamanho: v.Tamanho || null,
              },
            });
            atualizadas++;
          }
        }
        // Quem continua sem ean (produto não respondeu / variação ausente na
        // resposta) vai pro fim da fila de prioridade (ordenada por updatedAt).
        await prisma.variacaoProduto.updateMany({
          where: { produtoId: { in: lote.map((l) => l.produtoId) }, ean: null },
          data: { updatedAt: new Date() },
        });
        return atualizadas;
      });

      variacoesAtualizadas += n;
      await step.sleep(`pausa-enriquecer-${cursor.ultimoId || "ini"}-${i}`, PDV_PAUSA_ENTRE_LOTES_MS);
    }

    // Avança o cursor só pela varredura normal (a fila de prioridade não usa cursor).
    let proximoCursor = cursor.ultimoId;
    if (restante > 0) {
      proximoCursor = varridas.length < restante ? "" : varridas[varridas.length - 1].id;
      await gravarSyncState("enriquecer-variacoes:cursor", { ultimoId: proximoCursor });
    }

    return {
      lidas: variacoes.length,
      prioritarias: prioritarias.length,
      produtosConsultados: produtos.length,
      variacoesAtualizadas,
      proximoCursor,
    };
  }
);

// ---------------------------------------------------------------------------
// reavaliarCadastroNotaItens — 1x por dia (madrugada). O `temCadastro` do
// NotaItem (achou o produto no catálogo) é decidido no momento em
// que o item é criado. Mas o catálogo (VariacaoProduto.ean, Produto) é
// preenchido aos poucos (syncProdutos + enriquecerVariacoes), então muitos
// itens ficam `temCadastro=false` só porque o catálogo ainda não tinha sido
// sincronizado quando o item foi criado.
// Esta função re-checa os itens `false` contra o catálogo ATUAL com a MESMA
// regra de popular-nota-itens.ts (`avaliarCadastroItens`: EAN ou ref+modelo,
// SEM checagem de preço) e vira `temCadastro=true` nos que agora batem. Não
// toca nos que já são `true` — uma vez catalogado, continua. Processa em lotes
// (step.run) até REAVALIAR_NOTA_ITENS_POR_EXECUCAO por disparo; cursor em
// SyncState pra continuar no dia seguinte se sobrar. Quando varre a lista
// inteira, o cursor zera e no próximo dia re-checa todos os `false` de novo.
// ---------------------------------------------------------------------------

const REAVALIAR_NOTA_ITENS_POR_LOTE = 500;
const REAVALIAR_NOTA_ITENS_POR_EXECUCAO = 2500; // 5 lotes de 500

interface CursorReavaliar {
  ultimoId: string; // último NotaItem.id processado ("" = começar do início)
}

export const reavaliarCadastroNotaItens = inngest.createFunction(
  {
    id: "reavaliar-cadastro-nota-itens",
    concurrency: [
      { scope: "account", key: '"sefaz-pdv-sync"', limit: 4 },
      { limit: 1 },
    ],
    retries: 3,
  },
  { cron: "40 3 * * *" }, // 03:40 — madrugada, fora dos picos dos outros syncs
  async ({ step }) => {
    const cursor = await step.run("cursor-reavaliar", () =>
      lerSyncState<CursorReavaliar>("reavaliar-cadastro:cursor", { ultimoId: "" })
    );

    let ultimoId = cursor.ultimoId;
    let vistos = 0;
    let atualizados = 0;
    let fim = false;

    const LOTES = Math.ceil(
      REAVALIAR_NOTA_ITENS_POR_EXECUCAO / REAVALIAR_NOTA_ITENS_POR_LOTE
    );
    for (let lote = 0; lote < LOTES; lote++) {
      const r = await step.run(
        `reavaliar-lote-${cursor.ultimoId || "ini"}-${lote}`,
        async () => {
          // Só itens que PODEM virar true: sem cadastro E com algo pra casar
          // (EAN, ou referência+modelo identificados).
          const itens = await prisma.notaItem.findMany({
            where: {
              temCadastro: false,
              id: { gt: ultimoId },
              OR: [
                { ean: { not: null } },
                {
                  AND: [
                    { referenciaFornecedorIdentificada: { not: null } },
                    { modeloIdentificado: { not: null } },
                  ],
                },
              ],
            },
            orderBy: { id: "asc" },
            take: REAVALIAR_NOTA_ITENS_POR_LOTE,
            select: {
              id: true,
              ean: true,
              referenciaFornecedorIdentificada: true,
              modeloIdentificado: true,
              note: { select: { emitenteNome: true } },
            },
          });
          if (itens.length === 0) {
            return { vistos: 0, atualizados: 0, ultimoId, fim: true };
          }

          const flags = await avaliarCadastroItens(
            itens.map((i) => ({
              ean: i.ean,
              referenciaFornecedor: i.referenciaFornecedorIdentificada,
              modelo: i.modeloIdentificado,
              emitente: i.note.emitenteNome,
            }))
          );
          const idsQueBatem = itens.filter((_, idx) => flags[idx]).map((i) => i.id);

          if (idsQueBatem.length > 0) {
            await prisma.notaItem.updateMany({
              where: { id: { in: idsQueBatem } },
              data: { temCadastro: true },
            });
          }

          return {
            vistos: itens.length,
            atualizados: idsQueBatem.length,
            ultimoId: itens[itens.length - 1].id,
            fim: itens.length < REAVALIAR_NOTA_ITENS_POR_LOTE,
          };
        }
      );

      vistos += r.vistos;
      atualizados += r.atualizados;
      ultimoId = r.ultimoId;
      await gravarSyncState("reavaliar-cadastro:cursor", { ultimoId });
      if (r.fim) {
        fim = true;
        break;
      }
    }

    // Chegou ao fim da lista -> zera o cursor pra re-checar tudo no próximo dia.
    if (fim) {
      await gravarSyncState("reavaliar-cadastro:cursor", { ultimoId: "" });
    }

    return { vistos, atualizados, terminou: fim, proximoCursor: fim ? "" : ultimoId };
  }
);

// ---------------------------------------------------------------------------
// importarHistoricoQive — IMPORTAÇÃO ÚNICA (backfill) do histórico de notas que
// a Qive (antiga Arquivei) já capturou, pra enriquecer o nosso banco
// (Note/NotaItem/NotaDuplicata). NÃO tem cron: é disparada MANUALMENTE pelo
// evento "qive/importar.solicitado". Cada disparo processa um bloco de páginas
// e salva o cursor da Qive em SyncState ("qive-import:cursor"); reenviar o
// evento continua de onde parou. `data.reset = true` recomeça do cursor 0.
//
// Regras (ver src/lib/qive.ts):
//  - só notas RECEBIDAS (/v1/nfe/received);
//  - nota cuja chaveAcesso já existe no nosso banco é PULADA (não sobrescreve);
//  - `certificateId` casado pelo CNPJ do destinatário; sem Certificate -> a
//    nota é contabilizada em `semCertificado` e PULADA (ver decisão no PR);
//  - itens/duplicatas preenchidos por `popularNotaItens`, igual às notas SEFAZ.
// ---------------------------------------------------------------------------

const QIVE_PAGINAS_POR_EXECUCAO = 8; // 8 * 50 = 400 notas/disparo
const QIVE_PAUSA_ENTRE_PAGINAS_MS = 1500; // folga p/ o rate limit (300/janela)

interface CursorImportacaoQive {
  cursor: number;
  concluido: boolean;
  // acumulados entre disparos
  importadas: number;
  jaExistiam: number;
  semCertificado: number;
  erros: number;
  cnpjsSemCertificado: string[];
}

const ESTADO_QIVE_INICIAL: CursorImportacaoQive = {
  cursor: 0,
  concluido: false,
  importadas: 0,
  jaExistiam: 0,
  semCertificado: 0,
  erros: 0,
  cnpjsSemCertificado: [],
};

export const importarHistoricoQive = inngest.createFunction(
  {
    id: "importar-historico-qive",
    concurrency: [{ limit: 1 }], // uma importação por vez
    retries: 2,
  },
  { event: "qive/importar.solicitado" },
  async ({ event, step }) => {
    const estado = await step.run("ler-cursor", () =>
      lerSyncState<CursorImportacaoQive>("qive-import:cursor", ESTADO_QIVE_INICIAL)
    );

    if (event.data?.reset) {
      Object.assign(estado, ESTADO_QIVE_INICIAL, { cnpjsSemCertificado: [] });
      await step.run("resetar-cursor", () =>
        gravarSyncState("qive-import:cursor", estado)
      );
    }

    if (estado.concluido) {
      return {
        jaConcluido: true,
        dica: 'dispare com { "reset": true } pra reimportar do zero',
        totais: estado,
      };
    }

    let cursor = estado.cursor;
    let paginasNesteDisparo = 0;
    let notasVistasNesteDisparo = 0;
    let importadasNesteDisparo = 0;
    let fim = false;

    while (paginasNesteDisparo < QIVE_PAGINAS_POR_EXECUCAO && !fim) {
      const r = await step.run(`pagina-${cursor}`, async () => {
        const pag = await buscarNfesRecebidas(cursor, QIVE_LIMIT_PAGINA);
        const res = await importarLoteQive(pag.notas);
        return { ...res, proximoCursor: pag.proximoCursor };
      });

      estado.importadas += r.importadas;
      estado.jaExistiam += r.jaExistiam;
      estado.semCertificado += r.semCertificado;
      estado.erros += r.erros;
      for (const c of r.cnpjsSemCertificado) {
        if (!estado.cnpjsSemCertificado.includes(c) && estado.cnpjsSemCertificado.length < 200) {
          estado.cnpjsSemCertificado.push(c);
        }
      }
      paginasNesteDisparo++;
      notasVistasNesteDisparo += r.recebidas;
      importadasNesteDisparo += r.importadas;

      // Fim do histórico: página vazia, sem próximo cursor, ou cursor não andou.
      if (r.recebidas === 0 || r.proximoCursor == null || r.proximoCursor === cursor) {
        fim = true;
        estado.concluido = true;
      } else {
        cursor = r.proximoCursor;
        estado.cursor = cursor;
      }

      await step.run(`salvar-cursor-${cursor}`, () =>
        gravarSyncState("qive-import:cursor", estado)
      );

      if (!fim) {
        await step.sleep(`pausa-${cursor}`, QIVE_PAUSA_ENTRE_PAGINAS_MS);
      }
    }

    return {
      concluido: estado.concluido,
      cursorAtual: estado.cursor,
      disparo: {
        paginas: paginasNesteDisparo,
        notasVistas: notasVistasNesteDisparo,
        importadas: importadasNesteDisparo,
      },
      totaisAcumulados: {
        importadas: estado.importadas,
        jaExistiam: estado.jaExistiam,
        semCertificado: estado.semCertificado,
        erros: estado.erros,
        cnpjsSemCertificado: estado.cnpjsSemCertificado.length,
      },
      dica: estado.concluido
        ? "histórico da Qive todo varrido"
        : "dispare qive/importar.solicitado de novo pra continuar",
    };
  }
);

// ---------------------------------------------------------------------------
// importarHistoricoQivePorJanela — MESMO objetivo do importarHistoricoQive
// acima (backfill único, disparo manual), mas prioriza as notas MAIS RECENTES
// primeiro. Caminho SEPARADO e coexistente: não mexe no cursor nem no
// SyncState do importarHistoricoQive original, que continua funcionando como
// fallback/rollback (mesmo padrão de coexistência usado pra sincronizarCertificado).
//
// A API v1 da Qive não tem filtro por data de EMISSÃO da nota — só por
// `created_at` (data em que a Qive ingeriu o registro). Testado empiricamente
// pra esta conta: `created_at` acompanha de perto a emissão (ver
// src/lib/qive.ts), então serve como proxy pra varrer do mais recente pro
// mais antigo em JANELAS, mesmo padrão do backfill de Produtos (30/90/180/365
// dias, depois o resto). O cursor é ESCOPADO por janela — cada uma tem seu
// próprio cursor, guardado junto no mesmo estado.
// ---------------------------------------------------------------------------

interface JanelaQive {
  chave: string; // só pra log/observabilidade
  desde: string; // created_at[from], "AAAA-MM-DD"
  ate: string; // created_at[to], "AAAA-MM-DD"
}

/** Janelas calculadas em relação a HOJE, da mais recente pra mais antiga. */
function calcularJanelasQive(): JanelaQive[] {
  const hoje = new Date();
  const menosDias = (dias: number) =>
    new Date(hoje.getTime() - dias * 86_400_000).toISOString().slice(0, 10);
  return [
    { chave: "0-30d", desde: menosDias(30), ate: menosDias(0) },
    { chave: "30-90d", desde: menosDias(90), ate: menosDias(30) },
    { chave: "90-180d", desde: menosDias(180), ate: menosDias(90) },
    { chave: "180-365d", desde: menosDias(365), ate: menosDias(180) },
    // sentinela bem antiga pra cobrir "tudo antes de 365 dias atrás" — a API
    // exige created_at[from] sempre que created_at[to] é usado.
    { chave: "365d-tudo", desde: "2000-01-01", ate: menosDias(365) },
  ];
}

interface CursorImportacaoQivePorJanela {
  janelaIndex: number; // índice em calcularJanelasQive() da janela atual
  cursor: number; // cursor DENTRO da janela atual
  concluido: boolean; // varreu todas as janelas
  importadas: number;
  jaExistiam: number;
  semCertificado: number;
  erros: number;
  cnpjsSemCertificado: string[];
}

const ESTADO_QIVE_JANELA_INICIAL: CursorImportacaoQivePorJanela = {
  janelaIndex: 0,
  cursor: 0,
  concluido: false,
  importadas: 0,
  jaExistiam: 0,
  semCertificado: 0,
  erros: 0,
  cnpjsSemCertificado: [],
};

export const importarHistoricoQivePorJanela = inngest.createFunction(
  {
    id: "importar-historico-qive-por-janela",
    concurrency: [{ limit: 1 }],
    retries: 2,
  },
  { event: "qive/importar-por-janela.solicitado" },
  async ({ event, step }) => {
    const CHAVE_ESTADO = "qive-import-janela:cursor";
    const janelas = calcularJanelasQive();

    const estado = await step.run("ler-cursor-janela", () =>
      lerSyncState<CursorImportacaoQivePorJanela>(CHAVE_ESTADO, ESTADO_QIVE_JANELA_INICIAL)
    );

    if (event.data?.reset) {
      Object.assign(estado, ESTADO_QIVE_JANELA_INICIAL, { cnpjsSemCertificado: [] });
      await step.run("resetar-cursor-janela", () => gravarSyncState(CHAVE_ESTADO, estado));
    }

    if (estado.concluido) {
      return {
        jaConcluido: true,
        dica: 'dispare com { "reset": true } pra reimportar do zero',
        totais: estado,
      };
    }

    let paginasNesteDisparo = 0;
    let notasVistasNesteDisparo = 0;
    let importadasNesteDisparo = 0;

    while (paginasNesteDisparo < QIVE_PAGINAS_POR_EXECUCAO && !estado.concluido) {
      const janela = janelas[estado.janelaIndex];

      const r = await step.run(
        `janela-${janela.chave}-pagina-${estado.cursor}`,
        async () => {
          const pag = await buscarNfesRecebidasPorJanela(
            janela.desde,
            janela.ate,
            estado.cursor,
            QIVE_LIMIT_PAGINA
          );
          const res = await importarLoteQive(pag.notas);
          return { ...res, proximoCursor: pag.proximoCursor };
        }
      );

      estado.importadas += r.importadas;
      estado.jaExistiam += r.jaExistiam;
      estado.semCertificado += r.semCertificado;
      estado.erros += r.erros;
      for (const c of r.cnpjsSemCertificado) {
        if (!estado.cnpjsSemCertificado.includes(c) && estado.cnpjsSemCertificado.length < 200) {
          estado.cnpjsSemCertificado.push(c);
        }
      }
      paginasNesteDisparo++;
      notasVistasNesteDisparo += r.recebidas;
      importadasNesteDisparo += r.importadas;

      if (r.recebidas === 0 || r.proximoCursor == null || r.proximoCursor === estado.cursor) {
        // Esgotou esta janela -> avança pra próxima (ou termina, se era a última).
        if (estado.janelaIndex + 1 >= janelas.length) {
          estado.concluido = true;
        } else {
          estado.janelaIndex++;
          estado.cursor = 0;
        }
      } else {
        estado.cursor = r.proximoCursor;
      }

      await step.run(`salvar-cursor-janela-${janela.chave}-${estado.cursor}`, () =>
        gravarSyncState(CHAVE_ESTADO, estado)
      );
    }

    return {
      concluido: estado.concluido,
      janelaAtual: janelas[Math.min(estado.janelaIndex, janelas.length - 1)].chave,
      cursorAtual: estado.cursor,
      disparo: {
        paginas: paginasNesteDisparo,
        notasVistas: notasVistasNesteDisparo,
        importadas: importadasNesteDisparo,
      },
      totaisAcumulados: {
        importadas: estado.importadas,
        jaExistiam: estado.jaExistiam,
        semCertificado: estado.semCertificado,
        erros: estado.erros,
        cnpjsSemCertificado: estado.cnpjsSemCertificado.length,
      },
      dica: estado.concluido
        ? "histórico da Qive todo varrido (por janela)"
        : "dispare qive/importar-por-janela.solicitado de novo pra continuar",
    };
  }
);
