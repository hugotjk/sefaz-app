/**
 * Diagnóstico SOMENTE LEITURA da API v2 da Qive (POST /v2/dfe/nfe).
 * Não grava nada no banco. Mostra se a v2 devolve notas de um CNPJ (inclusive antigas)
 * e como é o formato da resposta.
 *
 * Uso: npx tsx --env-file=.env scripts\diagnostico-qive-v2.ts <CNPJ só números> [de AAAA-MM-DD] [até AAAA-MM-DD]
 * Opcional: --modo=receiver | emitter | owner-todos
 * Ex.:  npx tsx --env-file=.env scripts\diagnostico-qive-v2.ts 12345678000190 2025-01-01 2025-12-31
 */
const QIVE_BASE = "https://api.arquivei.com.br";

async function chamar(corpo: unknown) {
  const id = process.env.QIVE_API_ID ?? "";
  const key = process.env.QIVE_API_KEY ?? "";
  if (!id || !key) throw new Error("Credenciais da Qive não encontradas no .env (veja src/lib/qive.ts).");
  const res = await fetch(`${QIVE_BASE}/v2/dfe/nfe`, {
    method: "POST",
    headers: {
      "X-API-ID": id,
      "X-API-KEY": key,
      "X-Use-ApiGateway": "always",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(60_000),
  });
  const txt = await res.text();
  return { status: res.status, txt };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const modo = process.argv.find((a) => a.startsWith("--modo="))?.slice(7) ?? "owner";
  const [cnpj, de, ate] = args;
  if (!cnpj) throw new Error("Informe o CNPJ (só números).");
  // modos: owner (padrão) | receiver (ReceiverCnpj) | emitter (EmitterCnpj) | owner-todos (Owners sem filtro de papel)
  const filtros: any =
    modo === "receiver" ? { ReceiverCnpj: [cnpj] }
    : modo === "emitter" ? { EmitterCnpj: [cnpj] }
    : modo === "owner-todos" ? { Owners: [cnpj] }
    : { Owners: [cnpj], OwnerRoles: ["received"] };
  if (de || ate) {
    filtros.EmissionDate = {
      From: `${de ?? "2000-01-01"}T00:00:00Z`,
      To: `${ate ?? new Date().toISOString().slice(0, 10)}T23:59:59Z`,
    };
  }
  const corpo = { Fields: ["AccessKey", "EmissionDate", "CreatedAt", "Number", "Status"], Filters: filtros, Limit: 5 };
  console.log("Pedido:", JSON.stringify(corpo));
  const r = await chamar(corpo);
  console.log(`HTTP ${r.status}`);
  try {
    const j = JSON.parse(r.txt);
    console.log("Chaves da resposta:", Object.keys(j).join(", "));
    const lista = (j.Nfes ?? j.Data ?? j.data ?? []) as any[];
    console.log(`Itens nesta página: ${Array.isArray(lista) ? lista.length : 0} | Total no filtro: ${j.Total}`);
    console.log("Resposta (início):", JSON.stringify(j).slice(0, 1500));
  } catch {
    console.log("Resposta (texto):", r.txt.slice(0, 800));
  }
}
main().catch((e) => console.error(e.message));
