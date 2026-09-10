import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import {
  cronHorario,
  sincronizarCertificado,
  sincronizarCertificadoBatch,
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
  enriquecerVariacoes,
  reavaliarCadastroNotaItens,
} from "@/inngest/functions";

// Vercel: dá mais folga pras funções serverless que servem os steps do Inngest.
// O plano Hobby suporta até 300s com Fluid Compute.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    cronHorario,
    sincronizarCertificado,
    sincronizarCertificadoBatch,
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
    enriquecerVariacoes,
    reavaliarCadastroNotaItens,
  ],
});
