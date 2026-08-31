import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import {
  cronHorario,
  sincronizarCertificado,
  iniciarBackfillAoValidar,
  completarXmlNotas,
  syncProdutos,
  syncFiliais,
  syncRedes,
  syncVendas,
  syncEstoque,
  syncPrecos,
  consolidarVendasAntigas,
  backfillVendasHistorico,
} from "@/inngest/functions";

// Vercel: dá mais folga pras funções serverless que servem os steps do Inngest.
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    cronHorario,
    sincronizarCertificado,
    iniciarBackfillAoValidar,
    completarXmlNotas,
    syncProdutos,
    syncFiliais,
    syncRedes,
    syncVendas,
    syncEstoque,
    syncPrecos,
    consolidarVendasAntigas,
    backfillVendasHistorico,
  ],
});
