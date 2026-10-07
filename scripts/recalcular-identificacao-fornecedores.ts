/**
 * Recalcula modeloIdentificado / referenciaFornecedorIdentificada /
 * referenciaComRegraEspecifica (e depois temCadastro) dos NotaItem JÁ
 * existentes de um conjunto de fornecedores — usado quando uma regra de
 * identificação nova/corrigida entra e os itens antigos precisam ser
 * reprocessados (eles foram calculados antes da regra existir).
 *
 * Escopo: só os emitentes da lista ALVOS abaixo. `informacoesComplementares`
 * é lido do XML da nota (Note.xmlCompleto), memoizado por nota — assim
 * recompomos exatamente como o popularNotaItens faria, mesmo pras regras que
 * usam infocompl (grupo Approve/R3, Outside/Core).
 *
 *   Dry-run (só conta):  npx tsx --env-file=.env scripts/recalcular-identificacao-fornecedores.ts
 *   Aplicar:             npx tsx --env-file=.env scripts/recalcular-identificacao-fornecedores.ts --apply
 */
import { prisma } from "../src/lib/db";
import {
  identificarModelo,
  identificarReferenciaFornecedor,
  EMPRESAS_THUG_DUBS,
} from "../src/lib/identificar-produto";
import { avaliarCadastroItens } from "../src/lib/popular-nota-itens";
import { parseNFeXml } from "../src/lib/parse-nfe-xml";

const APLICAR = process.argv.includes("--apply");

// Empresas que antes retornavam o Modelo genérico "Flamengo" e agora têm
// Modelo específico (ou null explícito). Reprocessadas junto.
const EMPRESAS_EX_FLAMENGO = [
  "M WILDNER ACESSORIOS LTDA",
  "SPORT BEL LTDA",
  "JTX COMERCIO DE PRESENTES E ARMARINHOS LTDA",
  "D L FERRARI PRODUTOS LICENCIADOS LTDA",
  "VIESS CALÇADOS E ARTIGOS ESPORTIVOS LTDA",
  "Ranc Confeccoes Ltda ME", // grafia real no banco (case-insensitive na regra, mas exata aqui pro filtro)
  "G. BLUES INDÚSTRIA E COMÉRCIO LTDA.",
  "CKS IMPORTACAO E EXPORTACAO DE MAQUINAS EIRELI",
  "BLUE OCEAN CONFECCOES S.A - FLEXCAP",
  "MILLED BRASIL DURGA COMERCIAL LTDA",
  "TSC MARKETING E LICENCIAMENTO LTDA",
  "MYFLAG IND. E CONFEC. EIRELI",
  "M&L SPORT INNOVATION MARKETING ESPORTIVO LTDA",
  "KIT CLUB DISTRIBUIDORA DE ARTIGOS ESPORTIVOS LTDA - ME",
  "BEL WATCH COMERCIAL IMPORTADORA E EXPORTADORA EIRELI", // grafia real no banco
  "1QA+ Confeccoes Eireli (Torcida Baby)",
  "ARELL IMPORTACAO E COMERCIO LTDA",
  "MALHARIA RIKAM LTDA",
  "VERON PRESENTES LTDA",
  "Torcida Baby do Brasil Ltda",
  "KRYSTALMIX COMERCIO E DISTRIBUIDORA DE PRODUTOS E UTENSILIOS",
  "V F FERRARI PRODUTOS LICENCIADOS LTDA",
  "Liga dos Mascotes Criacoes Digitais e Licenciamentos Ltda",
  "B. U. INDUSTRIA E COMERCIO DE VESTUARIO LTDA", // -> null
  "ROMANOS MALHARIA LTDA", // -> null
];

// Correções técnicas da auditoria (item 1: "" -> null; item 3: grafias;
// item 4: adidas as duas grafias).
const EMPRESAS_CORRECOES = [
  // "" -> null (regra de Modelo só) — casos onde a fonte antes gravava ""
  "BOARDRIDERS DO BRASIL COMERCIO DE ARTIGOS ESPORTIVOS LTDA",
  "Casio Brasil Comercio de Produtos Eletronicos Ltda",
  "CORE BRANDS MODA LTDA",
  "OUTSIDE CO LTDA",
  "NEORUBBER INDUSTRIA DE SANDALIAS LTDA",
  "SURF CO LTDA",
  "Parcel Sports Eireli",
  // grafias corrigidas (nome real no banco)
  "APPROVE STREET WEAR COMERCIAL LTDA",
  "ITF FERRARI PRODUTOS LICENCIADOS LTDA",
  // adidas — as duas grafias (só a minúscula existe no banco hoje, mas
  // deixamos as duas por garantia)
  "adidas do Brasil Ltda",
  "ADIDAS DO BRASIL LTDA",
];

// Regras novas de Modelo + Referência.
const EMPRESAS_NOVAS = [
  "NEXT ELEVEN CONFECCOES LTDA",
  "CROMOTRANSFER INDUSTRIA DE ESTAMPAS EM TRANSFER LTDA",
  "Maxima Apparel Brasil Importação e Comércio Ltda.",
  "EMC TRANSFERS IMPRESSOES LTDA",
  "BB INDUSTRIA E COMERCIO DE ARTIGOS DE USO PESSOAL LTDA",
  // leva 3: Modelo novo (+ referência "código puro" assumido, exceto ITF
  // Ferrari que mantém a referência da fórmula 3).
  "BM SPORT COMÉRCIO E CONFECÇÃO DE ROUPAS LTDA",
  "ITF FERRARI PRODUTOS LICENCIADOS LTDA",
  "TSC ESTADIOS COMERCIO DE ARTIGOS ESPORTIVOS LTDA",
  "TSC IDOLOS COMERCIO DE ARTIGOS ESPORTIVOS LTDA",
  "SEEDER CONFECCOES LTDA",
  "NUR DISTRIBUIDORA LTDA",
  "KIT CLUB HERMES DISTRIBUIDORA DE ARTIGOS ESPORTIVOS LTDA",
  "NATURAL COMPANY CONFECCOES LTDA",
  "GENIUS 1 PARTICIPACOES JOIAS E ARTIGOS DE LUXO LTDA",
  "AP OLD SCHOOL COM. ART. ESP. LTDA",
  // leva 4: Tecnovex (Modelo + referência código puro) / Lotus (só Modelo)
  "TECNOVEX INDUSTRIA DE BANDEIRAS LTDA",
  "LOTUS COM IMP, EXP DE ART DO VEST LTDA",
  // leva 5: só Modelo (referência fica no fallback, não confirmada)
  "DUALT INDUSTRIA DE ARTIGOS ESPORTIVOS LTDA",
  "DBB DISTRIBUIDORA DE PRODUTOS DE BELEZA LTDA",
  "COMPANHIA FABRIL LEPPER - FILIAL",
  "AURA COMERCIO DE ARTIGOS DO VESTUARIO LTDA",
  "TOREL COMERCIO DE ARTIGOS ESPORTIVOS LTDA ME",
  // leva 6: Brunx (Modelo dinâmico) + Referência do Fornecedor pra 22 empresas
  "BRUNX IND VESTUARIO LTDA",
  "MALHAS D ESTEFANO LTDA",
  "NEW BRASIL ARTIGOS ESPORTIVOS LTDA",
  "BC SARTORI ARTIGOS ESPORTIVOS ME",
  "PREMIER DIST DE VESTUARIOS CALCADOS EQUIPAMENTOS E ACESSORIO",
  // leva 7: TVB (Modelo fixo "TVB" + Referência = código puro). Grafia real no
  // banco (filtro `in` é exato), e a variante em maiúsculas por garantia.
  "Tvb Industria E Comercio Ltda",
  "TVB INDUSTRIA E COMERCIO LTDA",
  // leva 8: G.R.W Confecções (Modelo Approve + Referência sem o tamanho do fim)
  "G.R.W CONFECCOES LTDA",
  // leva 9: Superação (Modelo Cachecol Mania + Referência = código puro)
  "SUPERACAO COMERCIO DE ARTIGOS DO VESTUARIO LTDA",
  // leva 10: Blue Wave (Modelo Blue Wave + Referência = código puro)
  "BLUE WAVE IND E COM LTDA",
];

const ALVOS = [
  ...EMPRESAS_THUG_DUBS,
  "PCF IMPORTACAO EXPORTACAO E COMERCIO LTD",
  "VF FERRARI PRODUTOS LICENCIADOS",
  ...EMPRESAS_EX_FLAMENGO,
  ...EMPRESAS_CORRECOES,
  ...EMPRESAS_NOVAS,
];

async function main() {
  const itens = await prisma.notaItem.findMany({
    where: { note: { emitenteNome: { in: ALVOS } } },
    select: {
      id: true,
      noteId: true,
      codigoProduto: true,
      descricao: true,
      ean: true,
      modeloIdentificado: true,
      referenciaFornecedorIdentificada: true,
      referenciaComRegraEspecifica: true,
      temCadastro: true,
      note: { select: { emitenteNome: true, xmlCompleto: true } },
    },
  });
  console.log(`NotaItem dos fornecedores alvo: ${itens.length}\n`);

  // infocompl por nota (memoizado) — lido do XML como o popularNotaItens faz.
  const infCplPorNota = new Map<string, string>();
  const infCpl = (noteId: string, xml: string): string => {
    let v = infCplPorNota.get(noteId);
    if (v === undefined) {
      try {
        v = parseNFeXml(xml || "").informacoesComplementares || "";
      } catch {
        v = "";
      }
      infCplPorNota.set(noteId, v);
    }
    return v;
  };

  const recalc = itens.map((it) => {
    const emit = it.note.emitenteNome ?? "";
    const modelo = identificarModelo(emit, it.codigoProduto, it.descricao);
    const ref = identificarReferenciaFornecedor(
      emit,
      it.codigoProduto,
      it.descricao,
      infCpl(it.noteId, it.note.xmlCompleto)
    );
    return {
      it,
      emit,
      modelo,
      referencia: ref.valor,
      comRegra: ref.comRegraEspecifica,
    };
  });

  // temCadastro com a lógica nova (EAN / ref+modelo, sem preço, com exceção de prefixo)
  const flags = await avaliarCadastroItens(
    recalc.map((r) => ({
      ean: r.it.ean,
      referenciaFornecedor: r.referencia,
      modelo: r.modelo,
      emitente: r.emit,
    }))
  );

  // ---- Relatório por emitente ----
  const porEmit = new Map<
    string,
    { total: number; comModelo: number; comRegra: number; temCadastro: number; modeloNull: number }
  >();
  recalc.forEach((r, i) => {
    const k = r.emit || "(sem emitente)";
    const g = porEmit.get(k) ?? { total: 0, comModelo: 0, comRegra: 0, temCadastro: 0, modeloNull: 0 };
    g.total++;
    if (r.modelo != null) g.comModelo++;
    else g.modeloNull++;
    if (r.comRegra) g.comRegra++;
    if (flags[i]) g.temCadastro++;
    porEmit.set(k, g);
  });

  console.log("emitente".padEnd(42), "| itens | c/modelo | modelo=null | c/regra | temCadastro");
  for (const [k, g] of [...porEmit.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      k.slice(0, 42).padEnd(42),
      "|",
      String(g.total).padStart(5),
      "|",
      String(g.comModelo).padStart(8),
      "|",
      String(g.modeloNull).padStart(11),
      "|",
      String(g.comRegra).padStart(7),
      "|",
      String(g.temCadastro).padStart(11)
    );
  }

  // amostra dos que ficaram modelo=null (4º dígito fora de 1/2/8/9)
  const nulls = recalc.filter((r) => r.modelo == null);
  if (nulls.length) {
    console.log(`\n${nulls.length} itens com modelo=null. Amostra de códigos (8 primeiros dígitos):`);
    console.log(
      [...new Set(nulls.map((r) => r.it.codigoProduto.slice(0, 8)))].slice(0, 20).join("  ")
    );
  }

  if (!APLICAR) {
    console.log("\n[DRY-RUN] Nada gravado. Rode com --apply para atualizar.");
    await prisma.$disconnect();
    return;
  }

  let n = 0;
  for (let i = 0; i < recalc.length; i += 200) {
    const chunk = recalc.slice(i, i + 200);
    await prisma.$transaction(
      chunk.map((r, j) =>
        prisma.notaItem.update({
          where: { id: r.it.id },
          data: {
            modeloIdentificado: r.modelo,
            referenciaFornecedorIdentificada: r.referencia,
            referenciaComRegraEspecifica: r.comRegra,
            temCadastro: flags[i + j],
          },
        })
      )
    );
    n += chunk.length;
  }
  console.log(`\n[APPLY] ${n} NotaItem atualizados.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
