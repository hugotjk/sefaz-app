import { inngest } from "@/lib/inngest";
import { prisma } from "@/lib/db";
import { decryptCertificate } from "@/lib/crypto";
import { consultarDistribuicaoDFe } from "@/lib/sefaz";
import { parseDocumento } from "@/lib/parse-documento";

// Intervalo mínimo entre chamadas consecutivas ao MESMO certificado, pra não
// tomar bloqueio da SEFAZ (cStat 656 - "Rejeição: Consumo Indevido"). Ajuste
// se o manual da sua UF/ambiente nacional recomendar outro valor.
const INTERVALO_ENTRE_CHAMADAS_MS = 25_000;
// Limite de segurança de iterações por execução (o loop continua na próxima
// chamada horária caso não termine - graças ao ultNSU salvo no banco).
const MAX_ITERACOES_POR_EXECUCAO = 40;

/**
 * 1) Roda de hora em hora (cron nativo do Inngest, funciona no plano free).
 *    Dispara um evento de sincronização para cada certificado ativo.
 */
export const cronHorario = inngest.createFunction(
  { id: "cron-sincronizacao-horaria" },
  { cron: "0 * * * *" }, // todo início de hora
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
        select: { id: true },
      });
    });

    if (certificados.length === 0) return { disparados: 0 };

    await step.sendEvent(
      "disparar-sync-por-certificado",
      certificados.map((c) => ({
        name: "sefaz/certificate.sync" as const,
        data: { certificateId: c.id },
      }))
    );

    return { disparados: certificados.length };
  }
);

/**
 * 2) Sincroniza UM certificado: consulta a SEFAZ em loop paginado por NSU.
 *    - Na primeira vez (backfillDone = false), varre tudo que existe.
 *    - Depois, cada execução horária só busca o que é novo (ultNSU salvo).
 *    Cada chamada à SEFAZ é um `step.run` isolado e durável: se cair no meio
 *    de um backfill grande, retoma exatamente de onde parou.
 */
export const sincronizarCertificado = inngest.createFunction(
  {
    id: "sincronizar-certificado",
    concurrency: { limit: 1, key: "event.data.certificateId" }, // nunca 2 sync do mesmo cert em paralelo
    retries: 3,
  },
  { event: "sefaz/certificate.sync" },
  async ({ event, step }) => {
    const { certificateId } = event.data;

    const certificado = await step.run("carregar-certificado", async () => {
      return prisma.certificate.findUniqueOrThrow({ where: { id: certificateId } });
    });

    if (certificado.status !== "ACTIVE") {
      return { pulado: true, motivo: `status = ${certificado.status}` };
    }

    if (certificado.validUntil && certificado.validUntil < new Date()) {
      await step.run("marcar-vencido", async () => {
        await prisma.certificate.update({
          where: { id: certificateId },
          data: { status: "EXPIRED", lastError: "Certificado venceu (data de validade ultrapassada)." },
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

    while (iteracoes < MAX_ITERACOES_POR_EXECUCAO) {
      iteracoes++;

      const resultado = await step.run(`consultar-sefaz-${iteracoes}`, async () => {
        const { pfxBase64, password } = decryptCertificate(certificado);
        const pfxBuffer = Buffer.from(pfxBase64, "base64");

        try {
          return await consultarDistribuicaoDFe({
            cnpj: certificado.cnpj,
            ultNSU,
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
            // 403 nesse ponto normalmente significa que a SEFAZ rejeitou o
            // certificado na conexão (vencido, não credenciado, ou revogado).
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
      });

      // Salva os documentos deste lote (nota a nota / evento a evento)
      await step.run(`salvar-lote-${iteracoes}`, async () => {
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
                xmlCompleto: "", // preenchido sob demanda (ver rota /api/notas/[id]/xml)
                nsu: item.nsu,
              },
              update: {
                status: item.status,
              },
            });
            notasSalvas++;
          } else {
            const nota = await prisma.note.findUnique({ where: { chaveAcesso: item.chaveAcesso } });
            if (!nota) continue; // evento de uma nota que ainda não vimos - ignora por ora

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
            eventosSalvos++;
          }
        }
      });

      ultNSU = resultado.ultNSU;
      ultimoStatus = resultado.statusCode;
      ultimoMotivo = resultado.motivo;

      await step.run(`atualizar-ultnsu-${iteracoes}`, async () => {
        await prisma.certificate.update({
          where: { id: certificateId },
          data: { ultNSU, maxNSU: resultado.maxNSU },
        });
      });

      const chegouNoFim = ultNSU >= resultado.maxNSU || resultado.semDocumentosNovos;
      if (chegouNoFim) {
        if (!certificado.backfillDone) {
          await step.run("marcar-backfill-concluido", async () => {
            await prisma.certificate.update({
              where: { id: certificateId },
              data: { backfillDone: true },
            });
          });
        }
        break;
      }

      // Respeita o intervalo mínimo entre chamadas antes da próxima página
      await step.sleep(`aguardar-proxima-pagina-${iteracoes}`, INTERVALO_ENTRE_CHAMADAS_MS);
    }

    return { iteracoes, notasSalvas, eventosSalvos, ultNSU, ultimoStatus, ultimoMotivo };
  }
);

/** Disparado assim que um certificado novo é validado, pra já começar o backfill. */
export const iniciarBackfillAoValidar = inngest.createFunction(
  { id: "iniciar-backfill-ao-validar" },
  { event: "sefaz/certificate.uploaded" },
  async ({ event, step }) => {
    await step.sendEvent("disparar-primeira-sync", {
      name: "sefaz/certificate.sync",
      data: { certificateId: event.data.certificateId },
    });
  }
);
