import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseNFeXml } from "@/lib/parse-nfe-xml";
import {
  identificarModelo,
  identificarReferenciaFornecedor,
  EMPRESAS_THUG_DUBS,
} from "@/lib/identificar-produto";

export interface ResultadoPopularNota {
  itens: number;
  duplicatas: number;
}

export interface ItemParaAvaliar {
  ean: string | null | undefined;
  /** = NotaItem.referenciaFornecedorIdentificada (regra 2/3) */
  referenciaFornecedor: string | null | undefined;
  /** = NotaItem.modeloIdentificado (regra 1) */
  modelo: string | null | undefined;
  /** = Note.emitenteNome — decide igualdade x prefixo na comparação de referência */
  emitente?: string | null;
}

// Emitentes cuja referência no catálogo é "8dígitos-2dígitos" (ex "80405235-03")
// mas na nota só traz os 8 primeiros ("80405235"): a comparação de referência
// é por PREFIXO (primeiros 8 dígitos), não igualdade. Os 8 dígitos são únicos
// por produto, então não há ambiguidade.
const EMPRESAS_REF_PREFIXO = new Set(
  EMPRESAS_THUG_DUBS.map((n) => n.toUpperCase())
);

/**
 * Decide `temCadastro` de cada item seguindo o processo manual do cliente.
 * NÃO exige preço: o produto pode já existir no sistema do cliente e o
 * `PrecoVariacao` chegar só depois (sync de preços é um processo à parte, bem
 * mais lento). Não achar preço NUNCA indica "sem cadastro".
 *
 *   Path A (atalho): existe uma `VariacaoProduto` cujo `ean` bate com o EAN do
 *      item? => Cadastrado.
 *   Path B (critério principal): existe um `Produto` cujo `referenciaFornecedor`
 *      bate (case-insensitive/trim) com a referência do fornecedor identificada
 *      E cujo `modeloNome` bate com o modelo identificado? => Cadastrado.
 *      Referência: case-insensitive IGUAL, exceto para o grupo
 *      EMPRESAS_REF_PREFIXO (Thug Nine/Dubs/Brotherhood), onde casa por
 *      PREFIXO de 8 dígitos (o catálogo guarda "8díg-2díg" e a nota só os 8).
 *   Nenhum dos dois achou => Sem Cadastro.
 *
 * SIMPLIFICAÇÃO TEMPORÁRIA: a busca por referência+modelo NÃO filtra por Rede.
 * O cliente cruza Referência+Modelo+Rede no Excel dele, mas não há hoje uma
 * ponte confiável entre `LojaReferencia.rede` (nomes: "MULTI"/"FLUMINENSE"/…)
 * e `Produto.redeId` (números): a tabela `RedeSync` tem nomes duplicados
 * (FLUMINENSE = id 9 e 10; LACOSTE = 15 e 16) e há valores de
 * `LojaReferencia.rede` sem nenhuma entrada em `RedeSync` (MARACANA,
 * ESCRITORIO, NUVEM, …). Na prática 98%+ dos itens são da rede MULTI e o
 * catálogo é 94% MULTI, então o risco de falso-positivo por omitir a rede é
 * baixo. Reavaliar quando/se a fonte da Rede ficar confiável.
 *
 * Compartilhada entre a criação do item (`popularNotaItens`) e a reavaliação
 * periódica (`reavaliarCadastroNotaItens` no Inngest). Retorna um boolean por
 * item, na MESMA ordem da entrada.
 */
export async function avaliarCadastroItens(
  itens: ItemParaAvaliar[]
): Promise<boolean[]> {
  // ---- Path A: EAN -> VariacaoProduto (basta EXISTIR; preço é processo à parte) ----
  const eans = [...new Set(itens.map((i) => i.ean).filter((e): e is string => !!e))];
  const eansOk = new Set(
    eans.length
      ? (
          await prisma.variacaoProduto.findMany({
            where: { ean: { in: eans } },
            select: { ean: true },
          })
        )
          .map((v) => v.ean!)
          .filter(Boolean)
      : []
  );

  // ---- Path B: (referência + modelo) -> Produto ----
  // Regra geral: referência case-insensitive IGUAL. Exceção (grupo
  // EMPRESAS_REF_PREFIXO): referência casa por PREFIXO de 8 dígitos.
  const norm = (v: string | null | undefined) => v?.trim().toUpperCase() || "";
  const digitos8 = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(0, 8);
  const usaPrefixo = (emit: string | null | undefined) =>
    !!emit && EMPRESAS_REF_PREFIXO.has(emit.trim().toUpperCase());

  // Modelos (upper/trim) aceitos como match para um item. Normalmente é só o
  // modelo identificado; a Braziline é a exceção: parte dos produtos dela está
  // cadastrada no catálogo do cliente sob Modelo "FLAMENGO" (não "Braziline"),
  // então os dois valem.
  const modelosAceitos = (i: ItemParaAvaliar): string[] => {
    const base = norm(i.modelo);
    if (!base) return [];
    if (
      base === "BRAZILINE" &&
      norm(i.emitente) === "BRAZILINE INDUSTRIA E COMERCIO LTDA"
    ) {
      return [base, "FLAMENGO"];
    }
    return [base];
  };

  const modsU = [...new Set(itens.flatMap((i) => modelosAceitos(i)))];
  const refsExato = [
    ...new Set(
      itens.filter((i) => !usaPrefixo(i.emitente)).map((i) => norm(i.referenciaFornecedor)).filter(Boolean)
    ),
  ];
  const refsPrefixo = [
    ...new Set(
      itens.filter((i) => usaPrefixo(i.emitente)).map((i) => digitos8(i.referenciaFornecedor)).filter(Boolean)
    ),
  ];

  // chave = JSON(["EXACT"|"PREFIX", <ref>, <modelo>]) dos pares que existem no
  // catálogo (Produto). Basta existir o Produto — sem checagem de preço.
  const paresOk = new Set<string>();

  if (modsU.length && refsExato.length) {
    const r = await prisma.$queryRaw<{ ref: string; modelo: string }[]>(Prisma.sql`
      SELECT DISTINCT
             upper(trim("referenciaFornecedor")) AS ref,
             upper(trim("modeloNome"))           AS modelo
      FROM "Produto"
      WHERE upper(trim("referenciaFornecedor")) IN (${Prisma.join(refsExato)})
        AND upper(trim("modeloNome"))           IN (${Prisma.join(modsU)})
    `);
    for (const p of r) paresOk.add(JSON.stringify(["EXACT", p.ref, p.modelo]));
  }
  if (modsU.length && refsPrefixo.length) {
    const r = await prisma.$queryRaw<{ pref: string; modelo: string }[]>(Prisma.sql`
      SELECT DISTINCT
             left(regexp_replace("referenciaFornecedor", '[^0-9]', '', 'g'), 8) AS pref,
             upper(trim("modeloNome"))                                          AS modelo
      FROM "Produto"
      WHERE left(regexp_replace("referenciaFornecedor", '[^0-9]', '', 'g'), 8) IN (${Prisma.join(refsPrefixo)})
        AND upper(trim("modeloNome"))                                          IN (${Prisma.join(modsU)})
    `);
    for (const p of r) paresOk.add(JSON.stringify(["PREFIX", p.pref, p.modelo]));
  }

  return itens.map((i) => {
    if (i.ean && eansOk.has(i.ean)) return true;
    const mods = modelosAceitos(i);
    if (!mods.length) return false;
    if (usaPrefixo(i.emitente)) {
      const pref = digitos8(i.referenciaFornecedor);
      return !!pref && mods.some((m) => paresOk.has(JSON.stringify(["PREFIX", pref, m])));
    }
    const ref = norm(i.referenciaFornecedor);
    return !!ref && mods.some((m) => paresOk.has(JSON.stringify(["EXACT", ref, m])));
  });
}

/**
 * A partir do XML completo de uma nota, (re)cria as linhas `NotaItem` E
 * `NotaDuplicata`: apaga as existentes daquela nota e insere de novo.
 * NotaItem já vem com `modelo`, `referenciaFornecedor` e `temCadastro`.
 *
 * Retorna a contagem de itens e duplicatas gravados (ambos 0 se o XML não
 * for interpretável).
 */
export async function popularNotaItens(
  noteId: string,
  xml: string
): Promise<ResultadoPopularNota> {
  let nfe;
  try {
    nfe = parseNFeXml(xml);
  } catch {
    return { itens: 0, duplicatas: 0 };
  }

  const emitente = nfe.emitente.nome || "";
  const infCpl = nfe.informacoesComplementares || "";
  const itens = nfe.itens;

  // ---- Duplicatas ----
  const dups = (nfe.duplicatas ?? [])
    .map((d) => {
      const venc = new Date(d.vencimento);
      return {
        numero: String(d.numero ?? ""),
        vencimento: venc,
        valor: d.valor && d.valor !== "" ? d.valor : "0",
        _ok: !isNaN(venc.getTime()),
      };
    })
    .filter((d) => d._ok)
    .map(({ _ok, ...rest }) => ({ noteId, ...rest }));

  // ---- Itens ----
  if (itens.length === 0) {
    await prisma.$transaction([
      prisma.notaItem.deleteMany({ where: { noteId } }),
      prisma.notaDuplicata.deleteMany({ where: { noteId } }),
      ...(dups.length ? [prisma.notaDuplicata.createMany({ data: dups })] : []),
    ]);
    return { itens: 0, duplicatas: dups.length };
  }

  const dados = itens.map((it) => {
    const modelo = identificarModelo(emitente, it.codigo, it.descricao);
    const ref = identificarReferenciaFornecedor(emitente, it.codigo, it.descricao, infCpl);
    return {
      noteId,
      codigoProduto: it.codigo,
      descricao: it.descricao,
      ean: it.ean || null,
      ncm: it.ncm || null,
      cfop: it.cfop || null,
      quantidade: it.quantidade || "0",
      valorUnitario: it.valorUnitario || "0",
      valorTotal: it.valorTotal || "0",
      modeloIdentificado: modelo,
      referenciaFornecedorIdentificada: ref.valor,
      referenciaComRegraEspecifica: ref.comRegraEspecifica,
      temCadastro: false, // preenchido logo abaixo (EAN ou ref+modelo, sem preço)
    };
  });

  // temCadastro: EAN OU (referência + modelo). Sem checagem de preço.
  const flags = await avaliarCadastroItens(
    dados.map((d) => ({
      ean: d.ean,
      referenciaFornecedor: d.referenciaFornecedorIdentificada,
      modelo: d.modeloIdentificado,
      emitente,
    }))
  );
  dados.forEach((d, i) => {
    d.temCadastro = flags[i];
  });

  await prisma.$transaction([
    prisma.notaItem.deleteMany({ where: { noteId } }),
    prisma.notaDuplicata.deleteMany({ where: { noteId } }),
    prisma.notaItem.createMany({ data: dados }),
    ...(dups.length ? [prisma.notaDuplicata.createMany({ data: dups })] : []),
  ]);

  return { itens: dados.length, duplicatas: dups.length };
}
