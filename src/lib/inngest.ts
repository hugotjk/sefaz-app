import { Inngest, EventSchemas } from "inngest";

type Events = {
  "sefaz/certificate.sync": {
    data: { certificateId: string };
  };
  "sefaz/certificate.uploaded": {
    data: { certificateId: string };
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
