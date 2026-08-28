import { Inngest, EventSchemas } from "inngest";

type Events = {
  "sefaz/certificate.sync": {
    data: { certificateId: string };
  };
  "sefaz/certificate.uploaded": {
    data: { certificateId: string };
  };
};

export const inngest = new Inngest({
  id: "sefaz-notas-app",
  schemas: new EventSchemas().fromRecord<Events>(),
});
