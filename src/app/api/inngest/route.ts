import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { cronHorario, sincronizarCertificado, iniciarBackfillAoValidar } from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [cronHorario, sincronizarCertificado, iniciarBackfillAoValidar],
});
