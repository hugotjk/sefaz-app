/**
 * Cliente da API da Qive (antiga Arquivei) — usado APENAS na importação única
 * de histórico de notas (não é sincronização recorrente; o cliente vai parar
 * de usar a Qive em breve).
 *
 * Endpoint que funciona com as nossas credenciais (descoberto por tentativa +
 * o swagger público https://docs.arquivei.com.br/arquivei-apis-swagger/dfe-api.json):
 *
 *   GET https://api.arquivei.com.br/v1/nfe/received?limit=50&cursor=<N>
 *   headers: X-API-ID, X-API-KEY   (as nossas QIVE_API_ID / QIVE_API_KEY)
 *   resposta: { status:{code,message}, data:[{access_key, xml}], page:{next,previous}, count }
 *     - `xml` vem em Base64 e é o nfeProc COMPLETO (mesmo formato da SEFAZ).
 *     - `page.next` é a URL completa da próxima página, com `?cursor=N` embutido.
 *     - `limit` máximo é 50. `cursor` posicional; `cursor=0` reprocessa do início.
 *
 * (O endpoint "API 2.0" POST /v2/dfe/nfe existe no swagger mas devolve 404 com
 *  as nossas credenciais — provavelmente não habilitado pra esta conta. O v1
 *  entrega tudo que precisamos: chave de acesso + XML completo.)
 *
 * Duas estratégias de paginação, ambas sobre o MESMO endpoint v1:
 *  - `buscarNfesRecebidas` — cursor posicional puro, sem filtro. Varre o
 *    histórico na ordem que a Qive devolve (empiricamente: do mais ANTIGO pro
 *    mais recente). É o caminho ORIGINAL, usado por `importarHistoricoQive`.
 *  - `buscarNfesRecebidasPorJanela` — mesmo cursor, mas dentro de uma janela
 *    de `created_at`, pra priorizar as notas mais recentes primeiro. Usado
 *    por `importarHistoricoQivePorJanela` (ver src/inngest/functions.ts).
 */
import { prisma } from "@/lib/db";
import { parseNFeXml } from "@/lib/parse-nfe-xml";
import { popularNotaItens } from "@/lib/popular-nota-itens";

const QIVE_BASE = "https://api.arquivei.com.br";
/** Máximo aceito pelo endpoint v1. */
export const QIVE_LIMIT_PAGINA = 50;

export interface QiveNfe {
  access_key: string;
  xml: string; // Base64 do nfeProc completo (ou do evento, em /v1/events/nfe)
  /** só em /v1/events/nfe: código de 6 dígitos do evento (ex.: 110111). */
  type?: string;
}

export interface QivePagina {
  notas: QiveNfe[];
  /** cursor da próxima página, ou null se acabou. */
  proximoCursor: number | null;
  count: number;
}

function credenciais(): { id: string; key: string } {
  const id = process.env.QIVE_API_ID;
  const key = process.env.QIVE_API_KEY;
  if (!id || !key) {
    throw new Error("QIVE_API_ID / QIVE_API_KEY não configurados no ambiente.");
  }
  return { id, key };
}

async function chamarReceived(query: string, caminho = "/v1/nfe/received"): Promise<QivePagina> {
  const { id, key } = credenciais();
  const url = `${QIVE_BASE}${caminho}?${query}`;
  const res = await fetch(url, {
    headers: { "X-API-ID": id, "X-API-KEY": key, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`Qive HTTP ${res.status} em ${url} :: ${txt.slice(0, 300)}`);
  }
  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error(`Qive devolveu resposta não-JSON (HTTP ${res.status}): ${txt.slice(0, 200)}`);
  }

  const notas: QiveNfe[] = Array.isArray(json.data) ? json.data : [];
  const nextUrl: string | undefined = json.page?.next;
  let proximoCursor: number | null = null;
  if (nextUrl) {
    const m = String(nextUrl).match(/[?&]cursor=(\d+)/);
    if (m) proximoCursor = Number(m[1]);
  }
  return { notas, proximoCursor, count: Number(json.count ?? notas.length) };
}

/** Busca uma página de NF-e RECEBIDAS a partir de um cursor posicional. */
export async function buscarNfesRecebidas(
  cursor: number,
  limit: number = QIVE_LIMIT_PAGINA
): Promise<QivePagina> {
  return chamarReceived(`limit=${limit}&cursor=${cursor}`);
}

/**
 * Busca uma página de NF-e RECEBIDAS dentro de uma JANELA de `created_at`
 * (data em que a Qive CRIOU/ingeriu o registro — não é `dhEmi`/data de
 * emissão da NFe. A API v1 não tem filtro por data de emissão; só a v2, que
 * devolve 404 com as nossas credenciais). Testado empiricamente: pra esta
 * conta, `created_at` acompanha de perto a emissão (a Qive parece captar as
 * notas perto da emissão, não só num backfill único) — por isso serve como
 * proxy razoável pra priorizar as notas mais recentes primeiro.
 *
 * O cursor é ESCOPADO à janela (cursor=0 com um filtro de data dá a nota MAIS
 * ANTIGA daquela janela, não a mais antiga do histórico todo) — por isso cada
 * janela precisa do seu próprio cursor, salvo separadamente.
 *
 * `desde`/`ate` no formato "AAAA-MM-DD". A API exige os dois juntos.
 */
export async function buscarNfesRecebidasPorJanela(
  desde: string,
  ate: string,
  cursor: number,
  limit: number = QIVE_LIMIT_PAGINA
): Promise<QivePagina> {
  const params = new URLSearchParams({
    limit: String(limit),
    cursor: String(cursor),
    "created_at[from]": desde,
    "created_at[to]": ate,
  });
  return chamarReceived(params.toString());
}

/**
 * Fila de EVENTOS da conta (cancelamento 110111, carta de correção 110110,
 * manifestação etc.). Cursor posicional: consumir a próxima página já "dá o
 * ack" da anterior. Mesma janela `created_at` (from obrigatório com to).
 */
export async function buscarEventosNfe(
  desde: string,
  ate: string,
  cursor: number,
  limit: number = QIVE_LIMIT_PAGINA
): Promise<QivePagina> {
  const params = new URLSearchParams({
    limit: String(limit),
    cursor: String(cursor),
    "created_at[from]": desde,
    "created_at[to]": ate,
  });
  return chamarReceived(params.toString(), "/v1/events/nfe");
}

// Só gravamos o que muda a nota. Manifestação (2102xx) e os códigos internos
// 5106xx/6106xx que a Qive entrega na fila são ignorados (não enchem o banco).
const TIPO_EVENTO: Record<string, "CARTA_CORRECAO" | "CANCELAMENTO"> = {
  "110110": "CARTA_CORRECAO",
  "110111": "CANCELAMENTO",
  "110112": "CANCELAMENTO", // cancelamento por substituição
};

function tag(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}>([\\s\\S]*?)</(?:\\w+:)?${nome}>`));
  return m ? m[1].trim() : null;
}

export interface ResultadoEventos {
  recebidos: number;
  aplicados: number;
  semNota: number; // nota não está no nosso banco (ex.: > 90 dias) -> ignorado
  jaExistiam: number;
  erros: number;
}

/**
 * Aplica eventos da Qive às notas que já temos: grava NoteEvent (sem
 * duplicar) e, no caso de cancelamento, marca Note.status = CANCELADA.
 */
export async function aplicarEventosQive(eventos: QiveNfe[]): Promise<ResultadoEventos> {
  const r: ResultadoEventos = { recebidos: eventos.length, aplicados: 0, semNota: 0, jaExistiam: 0, erros: 0 };
  for (const ev of eventos) {
    try {
      const xml = Buffer.from(ev.xml ?? "", "base64").toString("utf8");
      const codigo = ev.type || tag(xml, "tpEvento") || "";
      if (!TIPO_EVENTO[codigo]) {
        r.jaExistiam++; // tipo que não nos interessa
        continue;
      }
      const nota = await prisma.note.findUnique({
        where: { chaveAcesso: ev.access_key },
        select: { id: true },
      });
      if (!nota) {
        r.semNota++;
        continue;
      }
      const tipo = TIPO_EVENTO[codigo];
      if (!tipo) {
        r.jaExistiam++; // ignorado de propósito
        continue;
      }
      const dh = tag(xml, "dhEvento");
      const dup = await prisma.noteEvent.findFirst({
        where: { noteId: nota.id, tipo, xmlEvento: xml },
        select: { id: true },
      });
      if (dup) {
        r.jaExistiam++;
        continue;
      }
      await prisma.noteEvent.create({
        data: {
          noteId: nota.id,
          tipo,
          descricao: tag(xml, "xCorrecao") || tag(xml, "xJust") || tag(xml, "descEvento"),
          xmlEvento: xml,
          nsu: "qive",
          dataEvento: dh ? new Date(dh) : null,
        },
      });
      if (tipo === "CANCELAMENTO") {
        await prisma.note.update({ where: { id: nota.id }, data: { status: "CANCELADA" } });
      }
      r.aplicados++;
    } catch {
      r.erros++;
    }
  }
  return r;
}

export interface ResultadoImportacaoLote {
  recebidas: number;
  /** inclui as importadas com certificateId = null (ver semCertificado). */
  importadas: number;
  jaExistiam: number;
  /** dentro de `importadas`: quantas ficaram com certificateId = null. */
  semCertificado: number;
  erros: number;
  /**
   * Notas que a Qive trouxe e que JÁ existiam por um certificado SEFAZ:
   * certificateId -> quantidade. Se um certificado só aparece aqui, a Qive já
   * cobre ele e o certificado é redundante.
   */
  redundantesPorCertificado: Record<string, number>;
  /** notas existentes só com resumo (xmlCompleto vazio) que a Qive completou. */
  xmlCompletados: number;
  /** CNPJs de destinatário sem Certificate cadastrado (amostra, únicos). */
  cnpjsSemCertificado: string[];
}

/** cStat de cancelamento/denegação no protocolo da NFe. */
function statusDoXml(xml: string): "AUTORIZADA" | "CANCELADA" | "DENEGADA" {
  // pega o ÚLTIMO <cStat> (o do protNFe fica perto do fim)
  const todos = [...xml.matchAll(/<(?:\w+:)?cStat>(\d+)<\/(?:\w+:)?cStat>/g)];
  const c = todos.length ? todos[todos.length - 1][1] : "";
  if (["101", "151", "135", "155"].includes(c)) return "CANCELADA";
  if (["110", "301", "302", "303"].includes(c)) return "DENEGADA";
  return "AUTORIZADA";
}

function soDigitos(v: string): string {
  return (v || "").replace(/\D/g, "");
}
function limpo(v: string): string | null {
  const s = (v ?? "").trim();
  return s && s !== "0" ? s : null;
}

/**
 * Importa um lote de notas da Qive para o nosso banco (Note + NotaItem +
 * NotaDuplicata). Idempotente:
 *  - se a `chaveAcesso` já existe -> PULA (não sobrescreve nota da SEFAZ).
 *  - se o `Note.create` colidir (P2002, ex. retry ou corrida com a sync SEFAZ)
 *    -> trata como "já existia" e ainda assim (re)popula os itens.
 *
 * `certificateId` é OPCIONAL no schema (ver migration note_certificate_id_nullable).
 * Casamos pelo CNPJ do destinatário do XML; nota cujo destinatário não tem
 * Certificate cadastrado é IMPORTADA MESMO ASSIM, com `certificateId = null`
 * (e contabilizada em `semCertificado`/`cnpjsSemCertificado` — a tela de
 * Certificados tem um botão "Lojas sem certificado" que lista esses CNPJs).
 */
export async function importarLoteQive(
  notas: QiveNfe[]
): Promise<ResultadoImportacaoLote> {
  const r: ResultadoImportacaoLote = {
    recebidas: notas.length,
    importadas: 0,
    jaExistiam: 0,
    semCertificado: 0,
    erros: 0,
    redundantesPorCertificado: {},
    xmlCompletados: 0,
    cnpjsSemCertificado: [],
  };
  if (notas.length === 0) return r;

  const chaves = notas.map((n) => n.access_key).filter(Boolean);
  const existentes = await prisma.note.findMany({
    where: { chaveAcesso: { in: chaves } },
    select: { id: true, chaveAcesso: true, certificateId: true, nsu: true, xmlCompleto: true },
  });
  const jaTemos = new Set(existentes.map((x) => x.chaveAcesso));
  const porChave = new Map(existentes.map((x) => [x.chaveAcesso, x]));

  // cache CNPJ destinatário -> certificateId | null (evita N queries repetidas)
  const certPorCnpj = new Map<string, string | null>();
  const semCert = new Set<string>();

  for (const nfe of notas) {
    try {
      if (!nfe.access_key || jaTemos.has(nfe.access_key)) {
        r.jaExistiam++;
        const ex = porChave.get(nfe.access_key);
        if (ex) {
          // veio por certificado SEFAZ (nsu real) -> a Qive também cobre.
          if (ex.certificateId && ex.nsu !== "") {
            r.redundantesPorCertificado[ex.certificateId] =
              (r.redundantesPorCertificado[ex.certificateId] ?? 0) + 1;
          }
          // nota só com resumo: completa com o XML da Qive.
          if (!ex.xmlCompleto && nfe.xml) {
            try {
              const xmlQ = Buffer.from(nfe.xml, "base64").toString("utf8");
              await prisma.note.update({ where: { id: ex.id }, data: { xmlCompleto: xmlQ } });
              await popularNotaItens(ex.id, xmlQ);
              r.xmlCompletados++;
            } catch {
              /* completarXmlNotas tenta depois */
            }
          }
        }
        continue;
      }

      const xml = Buffer.from(nfe.xml ?? "", "base64").toString("utf8");
      let parsed;
      try {
        parsed = parseNFeXml(xml);
      } catch {
        r.erros++;
        continue;
      }

      const cnpjDest = soDigitos(parsed.destinatario.cnpjCpf);
      if (!cnpjDest) {
        r.erros++;
        continue;
      }
      let certificateId = certPorCnpj.get(cnpjDest);
      if (certificateId === undefined) {
        const c = await prisma.certificate.findUnique({
          where: { cnpj: cnpjDest },
          select: { id: true },
        });
        certificateId = c?.id ?? null;
        certPorCnpj.set(cnpjDest, certificateId);
      }
      if (!certificateId) {
        r.semCertificado++;
        semCert.add(cnpjDest);
        // segue e importa mesmo assim, com certificateId = null.
      }

      const tp = parsed.tipoOperacao; // "0 - Entrada" | "1 - Saída" | ""
      const tipoOperacao = tp.startsWith("0")
        ? "Entrada"
        : tp.startsWith("1")
          ? "Saída"
          : null;

      try {
        const nova = await prisma.note.create({
          data: {
            chaveAcesso: nfe.access_key,
            cnpjDestino: cnpjDest,
            certificateId,
            numero: limpo(parsed.numero),
            serie: limpo(parsed.serie),
            tipoOperacao,
            emitenteCnpj: soDigitos(parsed.emitente.cnpj) || null,
            emitenteNome: limpo(parsed.emitente.nome),
            valorTotal: limpo(parsed.totais.valorTotalNota),
            dataEmissao: limpo(parsed.dataEmissao)
              ? new Date(parsed.dataEmissao)
              : null,
            status: statusDoXml(xml),
            xmlCompleto: xml,
            nsu: "", // não vem da Qive; NSU é conceito da distribuição SEFAZ
          },
          select: { id: true },
        });
        await popularNotaItens(nova.id, xml);
        r.importadas++;
      } catch (e: any) {
        if (e?.code === "P2002") {
          // criada num retry anterior ou por corrida com a sync SEFAZ.
          const ex = await prisma.note.findUnique({
            where: { chaveAcesso: nfe.access_key },
            select: { id: true },
          });
          if (ex) {
            try {
              await popularNotaItens(ex.id, xml);
            } catch {
              /* itens ficam pra próxima */
            }
          }
          r.jaExistiam++;
        } else {
          r.erros++;
        }
      }
    } catch {
      r.erros++;
    }
  }

  r.cnpjsSemCertificado = [...semCert].slice(0, 50);
  return r;
}
