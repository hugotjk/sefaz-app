import { inngest } from "@/lib/inngest";
import { prisma } from "@/lib/db";
import { decryptCertificate } from "@/lib/crypto";
import { consultarDistribuicaoDFe } from "@/lib/sefaz";
import { parseDocumento } from "@/lib/parse-documento";
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
      certificados.map((c: { id: string }) => ({
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

    if (certificado.validUntil && new Date(certificado.validUntil) < new Date()) {
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

      const chegouNoFim =
        BigInt(ultNSU || "0") >= BigInt(resultado.maxNSU || "0") || resultado.semDocumentosNovos;
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

// ===========================================================================
// SINCRONIZAÇÃO DA API DO PDV (Fase 1 do relatório de Movimentação Resumida)
//
// Nada disso tem relação com a SEFAZ / Notas Fiscais. Traz catálogo, vendas e
// estoque do PDV pro nosso banco pra que o relatório (Fase 2) consulte só o
// banco. Mesmo padrão de durabilidade das funções acima: cada lote é um
// `step.run`, com `step.sleep` entre lotes e um cursor salvo em SyncState pra
// retomar de onde parou na próxima execução do cron.
// ===========================================================================

// A API do PDV limita TamanhoPagina a 50 (rejeita acima disso).
const PDV_TAM_PAGINA = 50;
// Tetos de segurança por execução — o cron continua na próxima rodada usando
// o cursor salvo em SyncState. Como cada página traz só 50 itens, os tetos
// precisam ser altos pra o backfill inicial não levar semanas.
const MAX_PAGINAS_PRODUTOS_POR_EXECUCAO = 200; // ~10k produtos/execução
const MAX_PRODUTOS_BUSCAR_VARIACOES_POR_EXECUCAO = 400;
const MAX_PAGINAS_VENDAS_POR_EXECUCAO = 300; // ~15k vendas/execução
const PDV_PAUSA_ENTRE_LOTES_MS = 1_000;
// Quanto de histórico de vendas puxar na primeiríssima execução do sync horário.
const VENDAS_JANELA_INICIAL_DIAS = 7;
// Data bem antiga = "traz o catálogo inteiro" no primeiro backfill de produtos.
const PRODUTOS_DATA_BACKFILL = "2000-01-01";

// --- estoque (agora orientado pelo nosso catálogo) ---
const ESTOQUE_VARIACOES_POR_EXECUCAO = 100; // variações consultadas por hora
const ESTOQUE_VARIACOES_POR_LOTE = 20; // por step.run
// --- filiais ---
const FILIAIS_POR_EXECUCAO = 300; // lojas processadas por execução diária
const FILIAIS_POR_LOTE = 20; // por step.run
// --- preços ---
const MAX_PAGINAS_PRECOS_POR_EXECUCAO = 1000; // ~50k preços/execução
const PDV_TABELA_PRECO_VAREJO_FALLBACK = 3; // "3 VAREJO" (confirmado na API)
// --- vendas: detalhe recente x resumo mensal ---
const VENDAS_MESES_DETALHE = 12; // mantém 12 meses em VendaItemSync
const MAX_MESES_CONSOLIDAR_POR_EXECUCAO = 3;
const MAX_MESES_BACKFILL_POR_EXECUCAO = 1;
const MAX_PAGINAS_MES_BACKFILL = 3000; // ~150k vendas/mês

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
  { id: "pdv-sync-produtos", concurrency: { limit: 1 }, retries: 3 },
  { cron: "30 */2 * * *" },
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
      const aPartirDe = cursor.lastSync
        ? cursor.lastSync.slice(0, 10)
        : PRODUTOS_DATA_BACKFILL;

      let pagina = cursor.pagina > 0 ? cursor.pagina : 1;
      let paginasNestaExec = 0;
      let produtosSalvos = 0;
      let variacoesSalvas = 0;
      let concluiu = false;
      const execIniciadaEm = isoAgora();
      // Produtos sem lista de variações embutida — buscamos à parte, com teto.
      const produtosSemVariacaoEmbutida: string[] = [];

      while (paginasNestaExec < MAX_PAGINAS_PRODUTOS_POR_EXECUCAO) {
        paginasNestaExec++;
        const paginaAtual = pagina;

        const lote = await step.run(`produtos-r${rede.id}-p${paginaAtual}`, async () => {
          const { registros, paginacao } = await listarProdutos({
            redeId: rede.id,
            aPartirDe: aPartirDe,
            pagina: paginaAtual,
            tamanhoPagina: PDV_TAM_PAGINA,
          });

          let salvos = 0;
          let vars = 0;
          const semEmbutida: string[] = [];

          for (const p of registros) {
            await prisma.produto.upsert({
              where: { id: p.Id },
              create: {
                id: p.Id,
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
              },
              update: {
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
              },
            });
            salvos++;

            const embutidas = p.Variacoes ?? [];
            if (embutidas.length > 0) {
              for (const v of embutidas) {
                await prisma.variacaoProduto.upsert({
                  where: { id: v.Id },
                  create: { id: v.Id, produtoId: p.Id, redeId: p.RedeId ?? rede.id },
                  update: { produtoId: p.Id, redeId: p.RedeId ?? rede.id },
                });
                vars++;
              }
            } else {
              const jaTem = await prisma.variacaoProduto.count({ where: { produtoId: p.Id } });
              if (jaTem === 0) semEmbutida.push(p.Id);
            }
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
          concluiu = true;
          break;
        }

        await gravarSyncState(chave, { lastSync: cursor.lastSync, pagina });
        await step.sleep(`pausa-produtos-r${rede.id}-p${paginaAtual}`, PDV_PAUSA_ENTRE_LOTES_MS);
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
          await step.sleep(`pausa-variacoes-r${rede.id}-${i}`, PDV_PAUSA_ENTRE_LOTES_MS);
        }
      }

      // Atualiza o cursor: se terminou de varrer, volta pro modo incremental
      // (lastSync = agora, página 1); senão, guarda a página pra retomar.
      if (concluiu) {
        await gravarSyncState(chave, { lastSync: execIniciadaEm, pagina: 1 });
      } else {
        await gravarSyncState(chave, { lastSync: cursor.lastSync, pagina });
      }

      resumo[rede.nome || `rede ${rede.id}`] = {
        produtosSalvos,
        variacoesSalvas,
        concluiu,
        proximaPagina: concluiu ? 1 : pagina,
      };
    }

    return { redes: redes.length, resumo };
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
  { id: "pdv-sync-vendas", concurrency: { limit: 1 }, retries: 3 },
  { cron: "5 * * * *" },
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
      if (lote.maxDH && lote.maxDH > maiorDataHora) maiorDataHora = lote.maxDH;
      pagina = paginaAtual + 1;

      if (!lote.temProxima) {
        concluiu = true;
        break;
      }
      await step.sleep(`pausa-vendas-p${paginaAtual}`, PDV_PAUSA_ENTRE_LOTES_MS);
    }

    // Avança o cursor pra maior DataHora processada. Se sobrou página (não
    // concluiu), a próxima execução repete a janela a partir daqui — como o id
    // é determinístico, o reprocesso não duplica.
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
  { id: "pdv-sync-estoque", concurrency: { limit: 1 }, retries: 3 },
  { cron: "15 * * * *" },
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

      const salvos = await step.run(`estoque-lote-${cursor.ultimoId || "ini"}-${i}`, async () => {
        let n = 0;
        for (const variacaoId of lote) {
          const linhas = await listarEstoqueDaVariacao(variacaoId);
          for (const e of linhas) {
            await prisma.estoqueVariacaoSync.upsert({
              where: {
                variacaoId_lojaId: { variacaoId: String(e.VariacaoId), lojaId: e.LojaId },
              },
              create: {
                variacaoId: String(e.VariacaoId),
                lojaId: e.LojaId,
                quantidade: Number(e.Quantidade ?? 0),
              },
              update: { quantidade: Number(e.Quantidade ?? 0) },
            });
            n++;
          }
        }
        return n;
      });

      linhasSalvas += salvos;
      await gravarSyncState("estoque:cursor", { ultimoId: lote[lote.length - 1] });
      await step.sleep(`pausa-estoque-${cursor.ultimoId || "ini"}-${i}`, PDV_PAUSA_ENTRE_LOTES_MS);
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
  { id: "pdv-sync-redes", concurrency: { limit: 1 }, retries: 3 },
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
  { id: "pdv-sync-filiais", concurrency: { limit: 1 }, retries: 3 },
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
            await prisma.filialSync.upsert({
              where: { lojaId: loja.id },
              create: {
                lojaId: loja.id,
                nome: loja.nome ?? filial.RazaoSocial ?? null,
                empresaId: filial.Empresa ?? null,
                grupoId: filial.Grupo ?? null,
                supervisor: filial.Supervisor ?? null,
              },
              update: {
                nome: loja.nome ?? filial.RazaoSocial ?? null,
                empresaId: filial.Empresa ?? null,
                grupoId: filial.Grupo ?? null,
                supervisor: filial.Supervisor ?? null,
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
      await step.sleep(`pausa-filiais-${cursor.ultimoLojaId}-${i}`, PDV_PAUSA_ENTRE_LOTES_MS);
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
  { id: "pdv-sync-precos", concurrency: { limit: 1 }, retries: 3 },
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
      await step.sleep(`pausa-precos-p${paginaAtual}`, PDV_PAUSA_ENTRE_LOTES_MS);
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
// ---------------------------------------------------------------------------

const CONSOLIDAR_LINHAS_POR_STEP = 2000;

export const consolidarVendasAntigas = inngest.createFunction(
  { id: "pdv-consolidar-vendas-antigas", concurrency: { limit: 1 }, retries: 3 },
  { cron: "20 3 * * *" },
  async ({ step }) => {
    const corte = anoMesCorteDetalhe(); // meses < corte viram resumo
    const limiteData = primeiroInstanteDoMes(corte);

    let totalLinhas = 0;
    let totalGrupos = 0;
    let lotes = 0;

    // Cada iteração processa um lote de linhas antigas; para quando não há mais.
    for (let guarda = 0; guarda < 500; guarda++) {
      const resultado = await step.run(`consolidar-lote-${guarda}`, async () => {
        return prisma.$transaction(
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

const BACKFILL_PAGINAS_POR_STEP = 20;

export const backfillVendasHistorico = inngest.createFunction(
  { id: "pdv-backfill-vendas-historico", concurrency: { limit: 1 }, retries: 3 },
  { cron: "0 */2 * * *" },
  async ({ step }) => {
    const cursor = await step.run("cursor-backfill", () =>
      lerSyncState<CursorBackfillVendas>("vendas-backfill:cursor", { mes: null, done: false })
    );
    if (cursor.done) return { done: true };

    const agora = new Date();
    const corte = anoMesCorteDetalhe(agora);

    let mesesProcessados = 0;
    let mesAlvo = cursor.mes ? mesAnterior(cursor.mes) : anoMesDe(agora);

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
        await step.sleep(`pausa-backfill-${mesAlvo}-${paginaInicial}`, PDV_PAUSA_ENTRE_LOTES_MS);
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
      if (vazioLogo && vendasNoMes === 0) {
        await gravarSyncState("vendas-backfill:cursor", { mes: mesAlvo, done: true });
        return { mesAlvo, done: true, mesesProcessados };
      }
      await gravarSyncState("vendas-backfill:cursor", { mes: mesAlvo, done: false });

      mesAlvo = mesAnterior(mesAlvo);
      await step.sleep(`pausa-mes-${i}`, PDV_PAUSA_ENTRE_LOTES_MS);
    }

    return { proximoMes: mesAlvo, mesesProcessados };
  }
);
