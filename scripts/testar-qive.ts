/**
 * Teste SOMENTE-LEITURA da API da Qive (não grava nada no banco, não imprime
 * credenciais). Valida o que o sync recorrente assume:
 *   1. notas por created_at com `to` aberto (2100-01-01)
 *   2. fila de eventos /v1/events/nfe com a mesma janela
 *   3. cursor andando entre páginas
 *
 * Rodar (na pasta do projeto, com o .env):
 *   npx tsx --env-file=.env scripts/testar-qive.ts
 */
import { buscarNfesRecebidasPorJanela, buscarEventosNfe } from "../src/lib/qive";

const dia = (d: Date) => d.toISOString().slice(0, 10);
const menosDias = (n: number) => dia(new Date(Date.now() - n * 86_400_000));

async function tenta<T>(nome: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const r = await fn();
    console.log(`OK    ${nome}`);
    return r;
  } catch (e: any) {
    // a mensagem inclui a URL (sem credenciais, que vão em header) e o início do corpo
    console.log(`ERRO  ${nome}: ${String(e?.message ?? e).slice(0, 300)}`);
    return null;
  }
}

async function main() {
  console.log("QIVE_API_ID presente:", !!process.env.QIVE_API_ID);
  console.log("QIVE_API_KEY presente:", !!process.env.QIVE_API_KEY);
  console.log("---");

  // 1) notas dos últimos 3 dias
  const desde = menosDias(3);
  const p1 = await tenta("notas created_at[from]=hoje-3d, to=amanhã, limit 5", () =>
    buscarNfesRecebidasPorJanela(desde, menosDias(-1), 0, 5)
  );
  if (p1) {
    console.log(`      recebidas: ${p1.notas.length}, count: ${p1.count}, proximoCursor: ${p1.proximoCursor}`);
    console.log(`      com xml: ${p1.notas.filter((n) => n.xml).length}/${p1.notas.length}`);
    if (p1.proximoCursor != null) {
      const p2 = await tenta("notas, 2ª página pelo cursor", () =>
        buscarNfesRecebidasPorJanela(desde, menosDias(-1), p1.proximoCursor!, 5)
      );
      if (p2) {
        const mesmas = p2.notas.filter((n) => p1.notas.some((m) => m.access_key === n.access_key)).length;
        console.log(`      2ª página: ${p2.notas.length} notas, repetidas da 1ª: ${mesmas} (esperado 0)`);
      }
    }
  }

  // 2) comparação com janela fechada (to = amanhã) para ver se `to` aberto muda algo
  const p3 = await tenta("notas com to fechado (amanhã), limit 5", () =>
    buscarNfesRecebidasPorJanela(desde, menosDias(-1), 0, 5)
  );
  if (p3 && p1) {
    console.log(`      repetido (mesma janela): count=${p1.count} e ${p3.count}`);
  }

  // 3) eventos dos últimos 90 dias
  const e1 = await tenta("eventos created_at[from]=hoje-90d, to=amanhã, limit 20", () =>
    buscarEventosNfe(menosDias(90), menosDias(-1), 0, 20)
  );
  if (e1) {
    const porTipo: Record<string, number> = {};
    for (const ev of e1.notas) porTipo[ev.type ?? "(sem type)"] = (porTipo[ev.type ?? "(sem type)"] ?? 0) + 1;
    console.log(`      eventos recebidos: ${e1.notas.length}, count: ${e1.count}, proximoCursor: ${e1.proximoCursor}`);
    console.log(`      por tipo:`, JSON.stringify(porTipo));
    console.log(`      com xml: ${e1.notas.filter((n) => n.xml).length}/${e1.notas.length}`);
  }

  console.log("---");
  console.log("Fim do teste. Nada foi gravado no banco.");
}

main().catch((e) => {
  console.error("Falhou:", String(e?.message ?? e).slice(0, 300));
  process.exit(1);
});
