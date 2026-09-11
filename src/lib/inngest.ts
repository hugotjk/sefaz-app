import { Inngest, EventSchemas } from "inngest";

type Events = {
  "sefaz/certificate.sync": {
    data: { certificateId: string };
  };
  // Sincronização em LOTE: um evento processa vários certificados numa única
  // execução do Inngest (reduz drasticamente o nº de runs/executions). O
  // caminho antigo ("sefaz/certificate.sync", 1 evento por certificado)
  // continua existindo pra rollback via flag SEFAZ_CERT_SYNC_EM_LOTE=0.
  "sefaz/certificate.sync.batch": {
    data: { batchId: string; certificateIds: string[] };
  };
  "sefaz/certificate.uploaded": {
    data: { certificateId: string };
  };
  // Importação ÚNICA (backfill) do histórico de notas que a Qive já capturou.
  // Disparado MANUALMENTE (não tem cron). Reenviar continua de onde parou
  // (cursor salvo em SyncState "qive-import:cursor"); `reset: true` recomeça
  // do zero.
  "qive/importar.solicitado": {
    data: { reset?: boolean };
  };
  // Variante que prioriza as notas MAIS RECENTES primeiro (janelas de
  // created_at: 30/90/180/365 dias, depois o resto) — ver
  // importarHistoricoQivePorJanela. Caminho separado do de cima (cursor
  // posicional puro), que continua existindo como fallback.
  "qive/importar-por-janela.solicitado": {
    data: { reset?: boolean };
  };
  // Evento fictício, NUNCA disparado. Serve como "trigger nulo" para funções
  // de sync que ficaram suspensas (ver comentários "SUSPENSO" em
  // src/inngest/functions.ts). Reativar = devolver o `cron` original à função.
  "pdv/suspenso": {
    data: Record<string, never>;
  };
};

export const inngest = new Inngest({
  id: "sefaz-notas-app",
  schemas: new EventSchemas().fromRecord<Events>(),
});
