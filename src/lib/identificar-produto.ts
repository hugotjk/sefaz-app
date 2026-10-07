/**
 * Identificação de "Modelo" e "Referência Fornecedor" de um item de nota
 * fiscal, traduzido das planilhas do cliente (fórmulas Excel PT-BR).
 *
 * Convenções da tradução:
 *  - $A2 = razaoSocialEmitente — comparado case-INSENSITIVE (helper `igual`),
 *    como o `=` do Excel faz por padrão.
 *  - $G2 = codigoProduto,  $H2 = descricaoProduto,  $P2 = informacoesComplementares
 *  - LOCALIZAR (SEARCH) do Excel é case-INSENSITIVE -> `localizar()` idem.
 *  - Comparações de igualdade de texto que NÃO são de empresa (ex.
 *    ESQUERDA($G2;1)="J") foram traduzidas case-insensitive (comportamento do
 *    `=` do Excel).
 *  - Ramos que usavam `dbsleek(...)` foram totalmente removidos (não existe
 *    mais essa fonte). $BG2 é sempre "" e $AT2 == $G2 (codigoProduto puro).
 *  - Onde um LOCALIZAR não acha nada, ele retorna 0 aqui; expressões que
 *    subtraem/cortam a partir disso podem gerar string vazia — nesses casos o
 *    Excel daria #VALOR! e o SEERRO externo cairia no fallback. Aproximação
 *    aceitável; ver comentários `REVISAR`.
 */

// --------------------------------------------------------------------------
// Helpers (equivalentes das funções do Excel)
// --------------------------------------------------------------------------

export function ultimoNome(texto: string): string {
  const partes = texto.trim().split(/\s+/);
  return partes[partes.length - 1] ?? "";
}

/** 2ª palavra do texto (separado por espaço) — token logo após a 1ª palavra. */
function segundaPalavra(texto: string): string {
  return texto.trim().split(/\s+/)[1] ?? "";
}

const s = (v: unknown): string => (v == null ? "" : String(v));

/** ESQUERDA / LEFT */
function esquerda(t: string, n: number): string {
  return n <= 0 ? "" : t.slice(0, n);
}
/** DIREITA / RIGHT */
function direita(t: string, n: number): string {
  return n <= 0 ? "" : t.slice(-n);
}
/** LOCALIZAR / SEARCH — posição 1-indexed, 0 se não achar. Case-insensitive. */
function localizar(busca: string, texto: string): number {
  return texto.toUpperCase().indexOf(busca.toUpperCase()) + 1;
}
/** SUBSTITUIR / SUBSTITUTE (substitui TODAS as ocorrências) */
function substituir(t: string, antigo: string, novo: string): string {
  if (antigo === "") return t;
  return t.split(antigo).join(novo);
}
/** ARRUMAR / TRIM — tira pontas e colapsa espaços internos */
function arrumar(t: string): string {
  return t.trim().replace(/\s+/g, " ");
}
/** igualdade de texto do Excel (case-insensitive), para comparações não-empresa */
function eqi(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

/**
 * Comparação de $A2 (razão social do emitente) contra os nomes fixos das
 * regras. O Excel compara texto com "=" de forma INSENSÍVEL a maiúsc./minúsc.,
 * então "adidas do Brasil Ltda" e "ADIDAS DO BRASIL LTDA" batem.
 */
function igual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Palavras do nome do Modelo que NÃO seguem Title Case simples (siglas /
// grafias de marca). chave = forma minúscula; valor = grafia canônica.
const MODELO_PALAVRA_ESPECIAL: Record<string, string> = {
  tsc: "TSC",
  "m&l": "M&L",
  emc: "EMC",
  hd: "HD",
  rvca: "RVCA",
  mcd: "MCD",
  myflag: "MyFlag",
  tvb: "TVB",
};

// Conectivos que ficam em minúsculo quando NÃO são a primeira palavra
// (ex.: "Liga dos Mascotes", não "Liga Dos Mascotes").
const MODELO_CONECTIVO = new Set(["de", "do", "da", "dos", "das", "e"]);

/**
 * Padroniza o nome do Modelo para Title Case (primeira letra de cada palavra
 * em maiúscula, resto em minúscula), tratando hífens ("g-shock" -> "G-Shock"),
 * preservando siglas/grafias de marca (TSC, M&L, EMC, HD, RVCA, MCD, MyFlag) e
 * mantendo conectivos em minúsculo quando não são a 1ª palavra
 * ("Liga dos Mascotes").
 *
 * Aplicado no VALOR ARMAZENADO (não só na exibição): o mesmo Modelo vindo de
 * fornecedores diferentes ("cebola" / "CEBOLA" / "Cebola") passa a colapsar
 * num único grupo na Conferência de Produtos.
 */
export function normalizarNomeModelo(nome: string | null): string | null {
  if (nome == null) return null;
  const limpo = nome.trim().replace(/\s+/g, " ");
  if (limpo === "") return null;
  const titleCasePalavra = (w: string) =>
    w
      .split("-")
      .map((seg) => (seg === "" ? seg : seg[0].toUpperCase() + seg.slice(1).toLowerCase()))
      .join("-");
  return limpo
    .split(" ")
    .map((w, idx) => {
      const lower = w.toLowerCase();
      if (MODELO_PALAVRA_ESPECIAL[lower]) return MODELO_PALAVRA_ESPECIAL[lower];
      if (idx > 0 && MODELO_CONECTIVO.has(lower)) return lower;
      return titleCasePalavra(w);
    })
    .join(" ");
}

/**
 * Grupo "Thug Nine / Dubs" (marcas Thug Nine, Dubs, Brotherhood…). Compartilha
 * a mesma regra de Modelo (4º dígito do código) e de Referência (código puro).
 * Também é o grupo que, no cálculo de `temCadastro` (avaliarCadastroItens),
 * casa a referência por PREFIXO (8 dígitos) em vez de igualdade — a referência
 * no catálogo é "8dígitos-2dígitos" e na nota só vêm os 8 primeiros.
 */
export const EMPRESAS_THUG_DUBS = [
  "STASH HOUSE LTDA",
  "MADNESS COMERCIO DE ROUPAS LTDA",
  "INPU-IND NACIONAL DE POLIURETANOS EIRELI",
  "SOUTH CENTRAL COMERCIO DE ROUPAS LTDA",
  "THUG 09 COMERCIO DE ROUPAS LTDA",
  "UNDERDOG COMPANY LTDA",
  "MUGSHOT COMERCIO DE ROUPAS LTDA",
  "STREET FORCE",
  "THUG NINE COM RP CALC E ACESS LTDA",
  "URBAN STAR LTDA",
  "BROTHERHOOD COMERCIO DE ROUPAS LTDA", // razão social real do "BROTHERHOOD" nos NotaItem
] as const;

/**
 * Fornecedores "banidos" — não são produto de revenda de verdade (embalagens,
 * veículos, descartáveis, brindes genéricos…). Ficam FORA da Conferência de
 * Produtos: nem na lista principal, nem nos avisos de "sem regra". A tela tem
 * um popup pra revisar quem está aqui. Nomes exatos como aparecem em
 * `Note.emitenteNome`.
 */
export const EMPRESAS_BANIDAS: string[] = [
  "GLAYCE MENDES DE SOUSA 05687449779",
  "JAE ILHA DESCARTAVEIS E LIMPEZA LTDA",
  "TOP CESTA DE ALIMENTOS LTDA",
  "4MMD COMERCIO DE EMBALAGENS EIRELI",
  "PRINTMAX TECNOLOGIA LTDA",
  "WFR Moveis e Estruturas Metalicas Eirele",
  "PREMIUM RIO VEICULOS LTDA",
  "E-INFINITE SOLUTIONS CUSTOMIZACAO LTDA",
  "PRINTBAG EMBALAGENS LTDA",
  "ZAGAROLLO PAPEIS E EMBALAGENS LTDA - EPP",
  "CELSO FERREIRA 02377264751",
  "D D EMBALAGENS LTDA",
  "45.275.132 LEONARDO CORREA ANDRADE DUARTE",
  "Almap Mais Fibras E Acessorios Eireli",
  "ANDRILU COM. E DIST. DE PROD.TEXTIL LTDA-ME",
  "AQUARIUS BARRA COM. ELETR. E PURIF. DE AGUA LTDA.",
  "BIG ETIQUETAS LTDA",
  "ETIQUEJA COMERCIO DE ETIQUETAS LTDA",
  "FLORENCA BRINDES LTDA EPP",
  "GI SIGN COMERCIO DE MATERIAL GRAFICO",
  "Impallets produtos servicos importacao e exportacao ltd",
  "MAJ DISPLAYS INDUSTRIA E COMERCIO LTDA",
  "PH TECNICA COMERCIO E REPRESENTACOES LTDA",
  "RIQUENA NETO AR CONDICIONADO LTDA",
  "Sucesso Produtos Promocionais LTDA",
  "TALENT DISTRIBUIDORA DE MATERIAL DE LIMPEZA LTDA",
  "TARGET MULTICOISAS COM. IMP. E EXP. LTDA",
  "RTT COMERCIO E SERVICOS LTDA",
  "SUPERPEL COMERCIO DE PAPEIS EIRELI EPP",
  "MERITO COMERCIO DE EQUIPAMENTOS LIMITADA",
  "Talent Distribuidora de Material de Limpeza Ltda", // grafia em minúsculas/mistas no banco (o filtro é exato)
  "AFC COMERCIO VAREJISTA DE COMPONENTES ELETRONICOS LTDA",
  "A REDE ASSESS COML LTDA",
  "CLAUDIO TOSHIO OTSUKA PADOVAN LTDA",
  "MERCADO LIVRE BRASIL LTDA",
  "MTAG ETIQUETAS ACESSORIOS EM GERAL LTDA",
  "P D A COMERCIO PET E CINOFILIA",
  "SENSORBRASIL COMERCIO E LOCACAO LTDA",
  "VENDA MERC LTDA",
  "WWG EMBALAGENS LTDA",
];

// --------------------------------------------------------------------------
// FÓRMULA 1 — Modelo
// --------------------------------------------------------------------------

/**
 * Wrapper público: calcula o Modelo bruto (dezenas de ramos, cada um com sua
 * grafia própria) e devolve SEMPRE normalizado em Title Case via
 * `normalizarNomeModelo` — inclusive os valores dinâmicos (ex.: BRUNX =
 * primeira palavra da descrição). É o valor que vai pro banco.
 */
export function identificarModelo(
  razaoSocialEmitente: string,
  codigoProduto: string,
  descricaoProduto: string
): string | null {
  return normalizarNomeModelo(
    identificarModeloRaw(razaoSocialEmitente, codigoProduto, descricaoProduto)
  );
}

function identificarModeloRaw(
  razaoSocialEmitente: string,
  codigoProduto: string,
  descricaoProduto: string
): string | null {
  const A = razaoSocialEmitente;
  const G = s(codigoProduto);
  const H = s(descricaoProduto);
  const g1 = esquerda(G, 1);
  const h1 = esquerda(H, 1);
  const h3 = esquerda(H, 3);

  // Cada `if` = um ramo da cascata SES (primeiro que casar vence). $A2 é
  // comparado case-insensitive. `null` no fim = nenhum ramo casou (fallback
  // dbsleek removido).

  if (igual(A, "BETEL LTDA")) return "BETEL FLA";
  if (igual(A, "COIMBRA SP INDUSTRIA E COMERCIO LTDA")) return "COIMBRA";
  if (igual(A, "RIDE GROUP CALCADOS LTDA")) return "Ecko";
  if (igual(A, "STAR FLEX CALCADOS LTDA")) return "Ecko";
  if (igual(A, "WAB COMPANY LTDA")) return "Baw";
  if (igual(A, "DMF DISTRIBUIDORA LTDA")) return "Fuel";
  // NOTA: "BRAZILINE INDUSTRIA E COMERCIO LTDA" aparece 2x na fórmula; o
  // primeiro ramo (este) sempre vence -> o 2º ramo (SES FLA/FLU) é inalcançável.
  if (igual(A, "BRAZILINE INDUSTRIA E COMERCIO LTDA")) return "Braziline";
  if (igual(A, "BRAZILIAN COMERCIO DE MODA PRAIA LTDA.")) return "Blueman";
  if (igual(A, "Avacy Distribuidora e Comercio de Calcados Ltda")) return "HAVAIANAS";
  if (igual(A, "BR8 COMERCIO IMPORTACAO E EXPORTACAO LTDA")) return "Florence";
  if (igual(A, "PMI South America Consumer Goods Ltda")) return "Stanley";
  if (igual(A, "BRUNO SENA XAVIER")) return "Sufgang";
  if (igual(A, "HAF DISTRIBUIDOR LTDA")) return "Jordan";
  if (igual(A, "BRUNX IND VESTUARIO LTDA")) {
    // Modelo = primeira palavra da descrição do produto, dinâmico (na
    // prática só "SUFGANG" ou "WANTED", mas não fixamos o valor).
    // "SUFGAN" (sem o G) é truncamento na descrição da nota -> normaliza.
    const primeiraPalavra = H.trim().split(/\s+/)[0];
    if (!primeiraPalavra) return null;
    if (eqi(primeiraPalavra, "SUFGAN")) return "SUFGANG";
    return primeiraPalavra;
  }
  if (
    igual(A, "GRUPO INVENTI LTDA") ||
    igual(A, "R DOIS INJETADOS LTDA.") ||
    igual(A, "R DOIS INJETADOS NORDESTE LTDA") ||
    igual(A, "dmj textil ltda") ||
    igual(A, "R DOIS INJETADOS LTDA")
  )
    return "Reef";
  if (igual(A, "VEST SURF IND COM IMP E EXP DE ROUPAS LTDA."))
    return eqi(h3, "REF") ? "Reef" : "Redley";
  if (igual(A, "DASS NORDESTE CALCADOS E ARTIGOS ESPORTIVOS S.A.")) return "Umbro";
  if (igual(A, "XERYUS IMP. DISTRIB. DE ARTIGOS P/ VESTUARIO LTDA")) return "Xeryus Fla";
  if (igual(A, "ALPAR  DO BRASIL IND.COM.LTDA") || igual(A, "ALPAR DO BRASIL S/A")) return "NIKE"; // dois espaços em "ALPAR  DO" (grafia antiga)
  if (igual(A, "VIA COUNTRY IND E COM DE CALC LTDA") || igual(A, "NIRUT IND E COM CALC LTDA"))
    return "Farm";
  if (igual(A, "SAVE COMERCIAL E IMPORTADORA LTDA")) return "JANSPORT";
  if (
    igual(A, "VULCABRAS DISTRIBUIDORA DE ARTIGOS ESPORTIVOS LTDA") ||
    igual(A, "VULCABRAS BA CALCADOS E ARTIGOS ESPORTIVOS S.A.") ||
    igual(A, "VULCABRAS - CE CALCADOS E ARTIGOS ESPORTIVOS S/A")
  )
    return "Under Armour";
  if (
    igual(A, "PACIFIC IMPORTACAO E EXPORTACAO E COMERCIO LTDA") ||
    igual(A, "FILIAL SELL IN")
  )
    return localizar("FARM", H) > 0 ? "ME LEVA FARM" : "BAW";
  if (
    igual(A, "RGA IMPORTACAO EXPORTACAO E COMERCIO LTDA") ||
    igual(A, "CIDADE MARAVILHOSA INDUSTRIA E COMERCIO DE ROUPAS SA") ||
    igual(A, "AGK DESENVOLVIMENTO DE PRODUTOS LTDA") ||
    igual(A, "PCF IMPORTACAO EXPORTACAO E COMERCIO LTD") ||
    igual(A, "PACIFIC IMP EXP E COM LTDA") ||
    igual(A, "NIRUT IND E COM CALC EIRELI")
  )
    return "ME LEVA FARM";
  // Modelo fixo por empresa (sempre o mesmo valor). Comparação case-insensitive
  // (helper `igual`). As 23 primeiras vieram de um ramo genérico "Flamengo"
  // que foi quebrado em regras específicas.
  const MODELOS_POR_EMPRESA: [string, string][] = [
    ["M WILDNER ACESSORIOS LTDA", "Arena Couros"],
    ["SPORT BEL LTDA", "Bel Watch"],
    ["JTX COMERCIO DE PRESENTES E ARMARINHOS LTDA", "Brasfoot"],
    ["D L FERRARI PRODUTOS LICENCIADOS LTDA", "Cebola"],
    ["VIESS CALÇADOS E ARTIGOS ESPORTIVOS LTDA", "Viess Chuteiras"],
    ["RANC CONFECCOES LTDA ME", "Ranc"],
    ["G. BLUES INDÚSTRIA E COMÉRCIO LTDA.", "Gilson Martins"],
    ["CKS IMPORTACAO E EXPORTACAO DE MAQUINAS EIRELI", "Cavalinho Fla"],
    ["BLUE OCEAN CONFECCOES S.A - FLEXCAP", "Super Cap"],
    ["MILLED BRASIL DURGA COMERCIAL LTDA", "Milled"],
    ["TSC MARKETING E LICENCIAMENTO LTDA", "Copos TSC"],
    ["MYFLAG IND. E CONFEC. EIRELI", "MyFlag"],
    ["M&L SPORT INNOVATION MARKETING ESPORTIVO LTDA", "Copos M&L"],
    ["KIT CLUB DISTRIBUIDORA DE ARTIGOS ESPORTIVOS LTDA - ME", "Kit Club"],
    ["Bel Watch Comercial Importadora e Exportadora Eireli", "Bel Watch"],
    ["1QA+ Confeccoes Eireli (Torcida Baby)", "Torcida Baby"],
    ["ARELL IMPORTACAO E COMERCIO LTDA", "Arell"],
    ["MALHARIA RIKAM LTDA", "Rikam"],
    ["VERON PRESENTES LTDA", "Brasfoot"],
    ["Torcida Baby do Brasil Ltda", "Torcida Baby"],
    ["KRYSTALMIX COMERCIO E DISTRIBUIDORA DE PRODUTOS E UTENSILIOS", "Allmix"],
    ["V F FERRARI PRODUTOS LICENCIADOS LTDA", "Cebola"],
    ["Liga dos Mascotes Criacoes Digitais e Licenciamentos Ltda", "Liga dos Mascotes"],
    ["NEXT ELEVEN CONFECCOES LTDA", "Texneo+"],
    ["CROMOTRANSFER INDUSTRIA DE ESTAMPAS EM TRANSFER LTDA", "Cromotransfer"],
    ["Maxima Apparel Brasil Importação e Comércio Ltda.", "Pro Standard"],
    ["EMC TRANSFERS IMPRESSOES LTDA", "EMC"],
    ["BB INDUSTRIA E COMERCIO DE ARTIGOS DE USO PESSOAL LTDA", "Go Case"],
    ["BM SPORT COMÉRCIO E CONFECÇÃO DE ROUPAS LTDA", "beme"],
    ["ITF FERRARI PRODUTOS LICENCIADOS LTDA", "cebola"], // referência já vem da fórmula 3
    ["TSC ESTADIOS COMERCIO DE ARTIGOS ESPORTIVOS LTDA", "copos tsc"],
    ["TSC IDOLOS COMERCIO DE ARTIGOS ESPORTIVOS LTDA", "copos tsc"],
    ["SEEDER CONFECCOES LTDA", "gavea"],
    ["NUR DISTRIBUIDORA LTDA", "gluck"],
    ["KIT CLUB HERMES DISTRIBUIDORA DE ARTIGOS ESPORTIVOS LTDA", "kit club"],
    ["NATURAL COMPANY CONFECCOES LTDA", "natural company"],
    ["GENIUS 1 PARTICIPACOES JOIAS E ARTIGOS DE LUXO LTDA", "prata olam"],
    ["AP OLD SCHOOL COM. ART. ESP. LTDA", "liga retro"],
    ["TECNOVEX INDUSTRIA DE BANDEIRAS LTDA", "myflag"],
    ["LOTUS COM IMP, EXP DE ART DO VEST LTDA", "Champion"], // só Modelo; referência = fallback
    ["DUALT INDUSTRIA DE ARTIGOS ESPORTIVOS LTDA", "dualt"],
    ["DBB DISTRIBUIDORA DE PRODUTOS DE BELEZA LTDA", "lacoste"], // só Modelo; referência = fallback
    ["COMPANHIA FABRIL LEPPER - FILIAL", "lepper"],
    ["AURA COMERCIO DE ARTIGOS DO VESTUARIO LTDA", "n1"],
    ["TOREL COMERCIO DE ARTIGOS ESPORTIVOS LTDA ME", "torel fla"]
  ];
  const porEmpresa = MODELOS_POR_EMPRESA.find(([nome]) => igual(A, nome));
  if (porEmpresa) return porEmpresa[1];
  // Duas empresas do grupo antigo ainda sem informação pra definir o Modelo:
  // ficam SEM modelo (null) — não caem mais no genérico e não têm valor novo.
  if (
    igual(A, "B. U. INDUSTRIA E COMERCIO DE VESTUARIO LTDA") ||
    igual(A, "ROMANOS MALHARIA LTDA")
  )
    return null;
  if (
    [
      "MATMAMAT CONFECCOES LTDA",
      "R3 TECIDOS E CONFECCOES LTDA",
      "JUST BRANDS COMERCIAL E SERVICOS LTDA",
      "PROPARRA - CONFECCAO E COMERCIO DE ARTIGOS DO VESTUARIO LTDA",
      "SF7 COMERCIAL E SERVICOS LTDA",
      "L6 COMERCIAL DO VESTUARIO LTDA",
      "APPROVE STREET WEAR COMERCIAL LTDA",
    ].some((x) => igual(A, x))
  )
    return eqi(g1, "J") ? "JADE JADE" : "Approve";
  if (
    igual(A, "NEW BRASIL ARTIGOS ESPORTIVOS LTDA") ||
    igual(A, "NB BRASIL COMERCIO DE CALCADOS LTDA")
  )
    return "New Balance";
  if (igual(A, "adidas do Brasil Ltda"))
    return localizar("FLAMENGO", H) > 0 || localizar("CRF", H) > 0 ? "adidas Fla" : "adidas";
  if (
    igual(A, "Azzas 2154 S.A.") ||
    igual(A, "AZZAS 2154 S.A") ||
    igual(A, "AREZZO INDUSTRIA E COMERCIO S.A") ||
    igual(A, "AREZZO INDUSTRIA E COMERCIO S.A.")
  ) {
    if (eqi(g1, "V")) return "Vans";
    if (eqi(g1, "J")) return "Me Leva Farm";
    if (eqi(g1, "R")) return localizar("CRF", H) > 0 ? "Reserva FLA" : "Reserva";
    return "Baw";
  }
  if (igual(A, "BOARDRIDERS DO BRASIL COMERCIO DE ARTIGOS ESPORTIVOS LTDA")) {
    if (eqi(g1, "Q") || eqi(h1, "Q")) return "Quiksilver";
    if (eqi(g1, "B")) return "Billabong";
    if (eqi(g1, "R")) return "RVCA";
    return null; // SES sem default -> não identificado
  }
  if (igual(A, "BRAZIL TRADE EIRELI EPP")) return "Bully S";
  if (igual(A, "Casio Brasil Comercio de Produtos Eletronicos Ltda")) {
    if (["A", "M", "W", "C", "F", "B"].some((x) => eqi(g1, x))) return "Casio";
    if (["D", "G"].some((x) => eqi(g1, x))) return "G-Shock";
    if (eqi(g1, "L")) return "Casio";
    return null;
  }
  if (
    igual(A, "COOPERSHOES COOP.TRAB.IND.CAL.JOANETENSE LTDA") ||
    igual(A, "COOPERSHOES COOP.TRAB.IND.CAL.JOANETENSE LTD") ||
    igual(A, "COOPERSHOES COOP.TRAB.IND.CALC.JOANETENSE LTDA")
    // (a fórmula tinha um 4º ramo `"$A2"="..."` com $A2 literal entre aspas —
    //  sempre falso, ignorado)
  )
    return "Converse";
  if (igual(A, "COML EXP IMP E DIST MARC 4 LTDA") || igual(A, "NEW ERA BRASIL LTDA"))
    return "New Era";
  if (igual(A, "FILA BRASIL LTDA")) return "Fila";
  if (
    igual(A, "DEVANLAY VENTURES DO BRASIL COMERCIO, IMPORTACAO, EXPORTACAO") ||
    igual(A, "DEVANLAY VENTURES DO BRASIL COM. IMP. EXP. E PART. LTDA") ||
    igual(A, "DEVANLAY VENTURES DO BRASIL COM IMP EXP E PART LTDA")
  )
    return "Lacoste";
  if (igual(A, "DILLY NORDESTE INDUSTRIA DE CALCADOS LTDA")) return "Approve";
  if (igual(A, "EL FARO INDUSTRIA E COMERCIO LTDA")) return "Mormaii";
  if (igual(A, "TECHPRENE INDUSTRIA E COMERCIO LTDA")) return "Mormaii";
  if (igual(A, "SUGAR SHOES INDUSTRIA DE CALCADOS LTDA.")) return "Hurley";
  if (igual(A, "OUTSIDE CO LTDA") || igual(A, "CORE BRANDS MODA LTDA")) {
    if (eqi(g1, "1")) return "MCD";
    if (eqi(g1, "2")) return "Lost";
    if (eqi(g1, "M")) return "MCD";
    if (eqi(g1, "L")) return "Lost";
    return null;
  }
  if (igual(A, "High Company LTDA")) return "High";
  if (
    igual(A, "KENERSON IND E COM DE PROD OPTICOS") ||
    igual(A, "KENERSON IND E COM DE PROD OPTICOS LTDA")
  )
    return "Evoke";
  if (igual(A, "Laiouns Importacao e Exportacao Ltda")) return "Laiouns";
  if (igual(A, "LUXOTTICA BRASIL PRODUTOS OTICOS E ESPORTIVOS LTDA")) return "Oakley";
  if (igual(A, "MDCAMARGO COM. DE ARTIGOS ESP. EIRELI - EPP")) return "Dropboards";
  if (
    igual(A, "CHP BRANDS BRASIL LTDA") ||
    igual(A, "MOSCA NEGRA CONFECCOES E COMERCIO LTDA") ||
    igual(A, "Mosca Negra Confeccoes e Comercio Ltda.")
  )
    return "Champion";
  if (igual(A, "NEORUBBER INDUSTRIA DE SANDALIAS LTDA")) {
    if (localizar("HURLEY", H) > 0) return "Hurley";
    if (localizar("HU0", H) > 0) return "Hurley";
    if (localizar("HANG LOOSE", H) > 0) return "Hang Loose";
    if (localizar("COCA COLA", H) > 0) return "Coca-Cola";
    return null;
  }
  if (igual(A, "NTK CONFECCOES LTDA")) {
    const h2p = esquerda(H, 2);
    if (eqi(h2p, "1C")) return "Stance";
    if (eqi(h2p, "ST")) return "Starter Fla";
    if (eqi(h2p, "ON")) return "Oneill";
    if (eqi(h2p, "EK")) return "Ecko";
    if (eqi(h2p, "HD")) return "HD";
    if (eqi(h2p, "MT")) return "Mitchell & Ness";
    return "Starter Fla";
  }
  if (igual(A, "Parcel Sports Eireli")) return null;
  if (igual(A, "PUMA SPORTS LTDA")) return "Puma";
  if (igual(A, "RAZAO IMPORTADORA E DISTRIBUIDORA DE BIKE EIRELI - ME")) return "Two Dogs";
  if (igual(A, "RC BRAZIL LTDA")) return "Rip Curl";
  if (igual(A, "SIRENA IND. E COM. DE ARTIGOS ESPORTIVOS - EIRELI")) return "Mormaii";
  if (igual(A, "SURF CO LTDA")) {
    const g2p = esquerda(G, 2);
    if (eqi(g2p, "HL")) return "Hang Loose";
    if (eqi(g2p, "VL")) return "Volcom";
    if (eqi(g2p, "02")) return "Volcom";
    if (eqi(g2p, "HY")) return "Hurley";
    return null;
  }
  if (igual(A, "SurfRio Brasil Comercio de Roupas e Acessorios Esportivos Lt"))
    return "STICK BUMPS";
  // (TECHNOS DA AMAZONIA removido: o ramo original dependia da coluna AA2, que
  //  não temos. O cliente não fatura mais com esse fornecedor — sem regra,
  //  cai no fallback null.)
  if (igual(A, "TESS INDUSTRIA E COMERCIO LTDA"))
    return localizar("KENNER", H) > 0 ? "Kenner" : "Redley";
  if (igual(A, "VF FERRARI PRODUTOS LICENCIADOS")) return "CEBOLA";
  if (igual(A, "TVB INDUSTRIA E COMERCIO LTDA")) return "TVB";
  if (igual(A, "G.R.W CONFECCOES LTDA")) return "Approve";
  if (igual(A, "SUPERACAO COMERCIO DE ARTIGOS DO VESTUARIO LTDA")) return "CACHECOL MANIA";
  if (igual(A, "BLUE WAVE IND E COM LTDA")) return "BLUE WAVE";
  if (EMPRESAS_THUG_DUBS.some((x) => igual(A, x))) {
    // Grupo Thug Nine / Dubs / Brotherhood: 4º dígito dos 8 primeiros do
    // código do produto da nota. Ex.: "25097401-01" -> 8 primeiros "25097401"
    // -> 4º dígito "9".
    //   7, 8 ou 9 -> "DUBS"
    //   1, 2 ou 3 -> "THUG NINE"   (3 incluído em 2026-10: ex. 25030103 Raiders)
    //   qualquer outro -> null (não identificado)
    const quartoDigito = G.slice(0, 8).replace(/\D/g, "")[3];
    if (quartoDigito === "7" || quartoDigito === "8" || quartoDigito === "9") return "DUBS";
    if (quartoDigito === "1" || quartoDigito === "2" || quartoDigito === "3") return "THUG NINE";
    return null;
  }

  return null;
}

// --------------------------------------------------------------------------
// FÓRMULA 2 / 3 — Referência Fornecedor
// --------------------------------------------------------------------------

export interface ResultadoReferencia {
  valor: string;
  comRegraEspecifica: boolean;
}

/** Trecho reutilizado: os 3 caracteres após "COR: " em P2. */
function cor3(P: string): string {
  const loc = localizar("COR: ", P);
  return direita(esquerda(direita(P, P.length - loc), 7), 3);
}

/**
 * Extrai o código de cor (2-6 letras) do padrão "COR: XXX -" dentro de
 * `infAdProd` (det/infAdProd — info adicional DO ITEM, ex.: "EAN13:
 * 7908607724769 / COR: PPP - PRETO / TAM.: G"). "" se o padrão não existir.
 */
function corDeInfAdProd(Q: string): string {
  const m = /COR:\s*([A-Za-z]{2,6})\s*-/.exec(Q);
  return m ? m[1].toUpperCase() : "";
}

/**
 * Regra do grupo R3/Approve para o ramo não-"J": 4 chars a partir da 3ª
 * posição do código + "_" + a cor lida em infAdProd (info DO ITEM, padrão
 * "COR: XXX -"). Continua valendo para R3/JUST BRANDS/PROPARRA/SF7/L6 e para
 * a Approve quando o código NÃO é do formato REF-COR-TAM.
 *
 * Antes lia " Cor" em informacoesComplementares (info da NOTA inteira, não
 * do item) -- gerava o mesmo sufixo fixo/errado ("_O D") pra toda nota,
 * porque infAdic/infCpl não tem relação nenhuma com a cor de cada item.
 */
function refGrupoR3ComCor(G: string, Q: string): string {
  return direita(esquerda(G, 6), 4) + "_" + corDeInfAdProd(Q);
}

/**
 * Fórmula 2. Retorna a string calculada se a empresa casar com algum ramo,
 * ou `null` se nenhum ramo casar (aí tenta-se a Fórmula 3).
 */
function referenciaFormula2(A: string, G: string, H: string, P: string, Q: string): string | null {
  const g1 = esquerda(G, 1);

  if (igual(A, "RIDE GROUP CALCADOS LTDA")) return esquerda(G, 8);
  if (igual(A, "NTK CONFECCOES LTDA")) return G;
  if (igual(A, "PMI South America Consumer Goods Ltda")) return G;
  if (igual(A, "RGA IMPORTACAO EXPORTACAO E COMERCIO LTDA")) return G;
  if (igual(A, "CIDADE MARAVILHOSA INDUSTRIA E COMERCIO DE ROUPAS SA")) return G;
  if (igual(A, "AGK DESENVOLVIMENTO DE PRODUTOS LTDA")) return G;
  // adidas do Brasil (as duas grafias — `igual` é case-insensitive): código puro.
  if (igual(A, "adidas do Brasil Ltda")) return G;
  // Grupo Cebola (Ferrari): referência = código do produto SEM os zeros à
  // esquerda. "004011" -> "4011"; "004018" -> "4018". Unifica as 3 empresas
  // (D L / V F / VF Ferrari) nessa mesma lógica. NÃO inclui a ITF Ferrari, que
  // segue na fórmula 3. Código só de zeros -> mantém o código (cai no fallback).
  if (
    igual(A, "D L FERRARI PRODUTOS LICENCIADOS LTDA") ||
    igual(A, "V F FERRARI PRODUTOS LICENCIADOS LTDA") ||
    igual(A, "VF FERRARI PRODUTOS LICENCIADOS")
  ) {
    const semZeros = G.replace(/^0+/, "");
    return semZeros !== "" ? semZeros : G;
  }
  if (igual(A, "STAR FLEX CALCADOS LTDA")) {
    // REVISAR: ramo muito ambíguo. Original:
    //   ESQUERDA(DIREITA($H2; LEN($H2)-LOCALIZAR("REF:";$H2)-3); 4)
    //   & "_" & UltimoNome( <SUBSTITUIR triplo que remove os 2 últimos nomes> )
    const locRef = localizar("REF:", H);
    const parte1 = esquerda(direita(H, H.length - locRef - 3), 4);
    const norm = (t: string) => substituir(substituir(substituir(t, " - ", " "), "-", " "), "  ", " ");
    const base = norm(H);
    const w1 = ultimoNome(base);
    const m1 = substituir(base, " " + w1, "");
    const w2 = ultimoNome(m1);
    const m2 = substituir(m1, " " + w2, "");
    const parte2 = ultimoNome(m2);
    return parte1 + "_" + parte2;
  }
  if (igual(A, "GRUPO INVENTI LTDA")) return esquerda(G, 9);
  if (igual(A, "DMF DISTRIBUIDORA LTDA")) {
    // Fluminense/genérico (código começa "9"): referência = código puro
    // (confirmado batendo com o cadastro real: 91429, 91521, 91536...).
    if (eqi(g1, "9")) return G;
    // Flamengo (código começa "8"): referência = "<base>-<Cn>".
    // Descrição ESTRUTURADA traz os dois juntos: "FLA001.K C1 OCULOS...".
    // Descrição NÃO-ESTRUTURADA ("OCULOS ... G C1") não tem o <base> --
    // ele só existe em infAdProd, no formato "... Ref. FLA001.K"; o <Cn>
    // nesse caso é sempre o último token da descrição.
    if (eqi(g1, "8")) {
      const estruturado = /([A-Z0-9]+)\.K\s+(C\d+)/i.exec(H);
      if (estruturado) return `${estruturado[1].toUpperCase()}-${estruturado[2].toUpperCase()}`;
      const base = /Ref\.\s*([A-Z0-9]+)\.K/i.exec(Q);
      const corFinal = /\s(C\d+)\s*$/i.exec(H.trim());
      if (base && corFinal) return `${base[1].toUpperCase()}-${corFinal[1].toUpperCase()}`;
      return null; // sem info suficiente em nenhum lugar -> fallback genérico
    }
    return null;
  }
  if (igual(A, "Avacy Distribuidora e Comercio de Calcados Ltda")) return esquerda(G, 11);
  if (igual(A, "BR8 COMERCIO IMPORTACAO E EXPORTACAO LTDA")) return G;
  if (igual(A, "DILLY NORDESTE INDUSTRIA DE CALCADOS LTDA"))
    return G + "_" + esquerda(H, localizar(" ", H) - 1);
  if (
    igual(A, "R DOIS INJETADOS LTDA.") ||
    igual(A, "R DOIS INJETADOS NORDESTE LTDA") ||
    igual(A, "R DOIS INJETADOS LTDA")
  )
    return (
      G +
      "_" +
      direita(substituir(substituir(esquerda(H, localizar("-", H)), " ", ""), "-", ""), 3)
    );
  if (igual(A, "VEST SURF IND COM IMP E EXP DE ROUPAS LTDA."))
    return esquerda(H, localizar(" ", H) - 1);
  if (igual(A, "NIRUT IND E COM CALC LTDA")) return esquerda(G, localizar("-", G) - 1);
  if (igual(A, "OUTSIDE CO LTDA") || igual(A, "CORE BRANDS MODA LTDA")) {
    // Cor de 3-4 letras extraída de infAdProd ("COR: PPP - PRETO..."), não
    // de informacoesComplementares (que nunca tem "COR: " nessas notas --
    // era o que gerava o sufixo fixo/errado "GO " antes). Sem o padrão,
    // cai no código puro (confirma bater com o cadastro em ~83% dos casos
    // testados).
    const cor = corDeInfAdProd(Q);
    return cor ? G + cor : G;
  }
  if (
    igual(A, "VULCABRAS DISTRIBUIDORA DE ARTIGOS ESPORTIVOS LTDA") ||
    igual(A, "VULCABRAS BA CALCADOS E ARTIGOS ESPORTIVOS S.A.") ||
    igual(A, "VULCABRAS - CE CALCADOS E ARTIGOS ESPORTIVOS S/A")
  )
    return esquerda(G, G.length - ultimoNome(H).length - 1);
  if (igual(A, "PACIFIC IMPORTACAO E EXPORTACAO E COMERCIO LTDA"))
    return substituir(substituir(G, "U", ""), "M", "");
  if (igual(A, "B. U. INDUSTRIA E COMERCIO DE VESTUARIO LTDA"))
    return substituir(G, ultimoNome(H), "");
  if (
    igual(A, "Azzas 2154 S.A.") ||
    igual(A, "AZZAS 2154 S.A") ||
    igual(A, "AREZZO INDUSTRIA E COMERCIO S.A") ||
    igual(A, "AREZZO INDUSTRIA E COMERCIO S.A.")
  ) {
    if (eqi(g1, "V")) return ultimoNome(substituir(H, "-", " "));
    if (eqi(g1, "J")) return esquerda(G, 14);
    return esquerda(arrumar(G), 10);
  }
  if (igual(A, "PACIFIC IMP EXP E COM LTDA")) return esquerda(G, 8);
  if (igual(A, "NIRUT IND E COM CALC EIRELI")) return esquerda(G, localizar("-", G) - 1);
  if (igual(A, "SUGAR SHOES INDUSTRIA DE CALCADOS LTDA."))
    return substituir(G, "_" + ultimoNome(H), "");
  if (igual(A, "BOARDRIDERS DO BRASIL COMERCIO DE ARTIGOS ESPORTIVOS LTDA"))
    return esquerda(G, G.length - ultimoNome(H).length);
  if (igual(A, "BRAZIL TRADE EIRELI EPP")) return direita(G, 4);
  if (igual(A, "Casio Brasil Comercio de Produtos Eletronicos Ltda"))
    return substituir(substituir(G, "-SC", ""), "-", "");
  if (
    igual(A, "DEVANLAY VENTURES DO BRASIL COMERCIO, IMPORTACAO, EXPORTACAO") ||
    igual(A, "DEVANLAY VENTURES DO BRASIL COM. IMP. EXP. E PART. LTDA") ||
    igual(A, "DEVANLAY VENTURES DO BRASIL COM IMP EXP E PART LTDA")
  ) {
    // SEERRO(primario; fallback)
    try {
      const p = localizar("-", G) + 5;
      const pref = esquerda(G, p);
      const l3 = direita(pref, 3);
      const prim = substituir(pref, l3, "") + "." + l3;
      if (prim && prim !== ".") return prim;
    } catch {
      /* cai no fallback */
    }
    return ultimoNome(H) + "." + esquerda(substituir(G, ultimoNome(H), ""), 3);
  }
  // INPU-IND: código puro, igual às outras do grupo Thug/Dubs (tratado no
  // ramo EMPRESAS_THUG_DUBS mais abaixo). Antes transformava o código, o que
  // era inconsistente com a correspondência por prefixo do temCadastro.
  if (igual(A, "NTK CONFECCOES EIRELI")) {
    const h2p = esquerda(H, 2);
    if (eqi(h2p, "ON")) return esquerda(direita(G, 5), 4);
    if (eqi(h2p, "ST")) return direita(G, G.length - localizar("T", G) + 1);
    return ""; // SES sem default
  }
  if (igual(A, "RC BRAZIL LTDA")) return esquerda(G, G.length - ultimoNome(H).length);
  if (igual(A, "SIRENA IND. E COM. DE ARTIGOS ESPORTIVOS - EIRELI"))
    return esquerda(G, G.length - 2);
  if (igual(A, "SURF CO LTDA")) {
    const g2p = esquerda(G, 2);
    if (["HY", "HL", "VL", "02"].some((x) => eqi(g2p, x))) {
      // O código é "<base>.<2 dígitos><TAMANHO>" — ex. "HYBM03010302.00P",
      // "HYTS01096601.00GG", "HYTS010967G02.001X". A referência é a base + os
      // 2 dígitos: corta o TAMANHO logo depois do ".NN".
      // A regra antiga cortava LEN(última palavra da descrição), o que
      // quebrava quando o xProd da nota NÃO terminava no tamanho (ex.
      // "BERMUDA ELASTICO BLOCK" -> cortava "BLOCK", 5 chars -> lixo).
      const m = G.match(/^(.*\.\d{2})/);
      if (m) return m[1];
      return esquerda(G, G.length - ultimoNome(H).length); // sem ".NN": mantém o antigo
    }
    const semPonto = substituir(G, ".", "");
    return direita(esquerda(semPonto, 9), 1) === "G"
      ? esquerda(semPonto, 9)
      : esquerda(semPonto, 8);
  }
  if (igual(A, "TESS INDUSTRIA E COMERCIO LTDA")) return esquerda(H, localizar(" ", H) - 1);
  // Maxima Apparel: código sem o último trecho depois do último "-" (o tamanho).
  //   "FFL140001-RED-M" -> "FFL140001-RED"
  if (igual(A, "Maxima Apparel Brasil Importação e Comércio Ltda.")) {
    const i = G.lastIndexOf("-");
    return i > 0 ? G.slice(0, i) : G;
  }
  // BB Industria: código sem os 2 primeiros caracteres (sempre "00").
  //   "0087568000006" -> "87568000006"
  if (igual(A, "BB INDUSTRIA E COMERCIO DE ARTIGOS DE USO PESSOAL LTDA"))
    return G.slice(2);
  // Grupo Thug Nine / Dubs / Brotherhood + PCF + VF Ferrari + Blue Ocean /
  // TSC / M&L Sport + Next Eleven / Cromotransfer / EMC / Tecnovex:
  // referência do fornecedor = o próprio código do produto da nota, sem
  // transformação (comparação normal/igual, não prefixo — só o grupo
  // Thug/Dubs usa prefixo, tratado em avaliarCadastroItens).
  if (
    EMPRESAS_THUG_DUBS.some((x) => igual(A, x)) ||
    igual(A, "PCF IMPORTACAO EXPORTACAO E COMERCIO LTD") ||
    igual(A, "BLUE OCEAN CONFECCOES S.A - FLEXCAP") ||
    igual(A, "TSC MARKETING E LICENCIAMENTO LTDA") ||
    igual(A, "M&L SPORT INNOVATION MARKETING ESPORTIVO LTDA") ||
    igual(A, "NEXT ELEVEN CONFECCOES LTDA") ||
    igual(A, "CROMOTRANSFER INDUSTRIA DE ESTAMPAS EM TRANSFER LTDA") ||
    igual(A, "EMC TRANSFERS IMPRESSOES LTDA") ||
    igual(A, "TECNOVEX INDUSTRIA DE BANDEIRAS LTDA")
  )
    return G;
  // Leva de 19 empresas com Referência confirmada = código puro, sem
  // transformação.
  if (
    [
      "KRYSTALMIX COMERCIO E DISTRIBUIDORA DE PRODUTOS E UTENSILIOS",
      "KIT CLUB DISTRIBUIDORA DE ARTIGOS ESPORTIVOS LTDA - ME",
      "MALHAS D ESTEFANO LTDA",
      "SEEDER CONFECCOES LTDA",
      "TSC IDOLOS COMERCIO DE ARTIGOS ESPORTIVOS LTDA",
      "TSC ESTADIOS COMERCIO DE ARTIGOS ESPORTIVOS LTDA",
      "NATURAL COMPANY CONFECCOES LTDA",
      "NEW BRASIL ARTIGOS ESPORTIVOS LTDA",
      "NUR DISTRIBUIDORA LTDA",
      "M WILDNER ACESSORIOS LTDA",
      "KIT CLUB HERMES DISTRIBUIDORA DE ARTIGOS ESPORTIVOS LTDA",
      "SPORT BEL LTDA",
      "BM SPORT COMÉRCIO E CONFECÇÃO DE ROUPAS LTDA",
      "RANC CONFECCOES LTDA ME",
      "COMPANHIA FABRIL LEPPER - FILIAL",
      "Bel Watch Comercial Importadora e Exportadora Eireli",
      "TOREL COMERCIO DE ARTIGOS ESPORTIVOS LTDA ME",
      "BC SARTORI ARTIGOS ESPORTIVOS ME",
      "GENIUS 1 PARTICIPACOES JOIAS E ARTIGOS DE LUXO LTDA",
      "TVB INDUSTRIA E COMERCIO LTDA",
      "SUPERACAO COMERCIO DE ARTIGOS DO VESTUARIO LTDA",
      "BLUE WAVE IND E COM LTDA",
    ].some((x) => igual(A, x))
  )
    return G;
  // Premier: código sem o trecho depois do último "-" (tamanho) — mesmo
  // padrão da Maxima Apparel.
  if (igual(A, "PREMIER DIST DE VESTUARIOS CALCADOS EQUIPAMENTOS E ACESSORIO")) {
    const i = G.lastIndexOf("-");
    return i > 0 ? G.slice(0, i) : G;
  }
  // AP Old School: código sem os 2 últimos caracteres.
  if (igual(A, "AP OLD SCHOOL COM. ART. ESP. LTDA")) return G.slice(0, -2);
  // Aura: só os 4 primeiros caracteres do código.
  if (igual(A, "AURA COMERCIO DE ARTIGOS DO VESTUARIO LTDA")) return esquerda(G, 4);
  // Dualt: código sem os zeros à esquerda (remove enquanto começar com "0").
  if (igual(A, "DUALT INDUSTRIA DE ARTIGOS ESPORTIVOS LTDA")) return G.replace(/^0+/, "");
  // G.R.W Confecções (Approve): código = <ref><cor><TAMANHO>, ex. "7770KKKGG"
  // (cor "KKK", tam "GG") -> "7770KKK". O tamanho é lido da descrição
  // ("... (Cor: BEGE - Tam: GG)") e removido do FIM do código; assim "7770PPPP"
  // (cor "PPP" + tam "P") vira "7770PPP". Sem "Tam:" na descrição (item pai,
  // ex. "7770") o código fica como veio.
  if (igual(A, "G.R.W CONFECCOES LTDA")) {
    const m = H.match(/Tam:\s*([^)\s]+)\s*\)/i);
    if (m) {
      const tam = m[1];
      if (G.length > tam.length && G.toUpperCase().endsWith(tam.toUpperCase())) {
        return G.slice(0, G.length - tam.length);
      }
    }
    return G;
  }

  return null;
}

/**
 * Fórmula 3. Tentada só se a Fórmula 2 não casou. `null` = nenhum ramo casou.
 */
function referenciaFormula3(A: string, G: string, H: string, P: string, Q: string): string | null {
  const g1 = esquerda(G, 1);
  const g2 = esquerda(G, 2);

  if (igual(A, "BETEL LTDA")) {
    // Padrão normal: "... - <código numérico>-<nome da cor> - <tamanho>".
    // Auditoria confirmou a aritmética correta (sem off-by-one) e 96%+ de
    // acerto contra o cadastro.
    const loc1 = localizar("-", H);
    const after1 = direita(H, H.length - loc1 - 1);
    const loc2 = localizar("-", after1);
    const cor = esquerda(after1, loc2 - 1);
    if (loc1 > 0 && loc2 > 0 && cor !== "" && /^\d+$/.test(cor)) return G + cor;

    // Fallback: descrição foge do padrão (sem código numérico de cor) --
    // procura um nome de cor conhecido e usa o código correspondente.
    // Mapeamento validado empiricamente (98,1% de consistência nome->código
    // nos dados reais da Betel). Ordem importa: "VERMELHO PRETO" precisa ser
    // checado antes de "VERMELHO"/"PRETO" isolados.
    const CORES_BETEL: Array<[string, string]> = [
      ["VERMELHO PRETO", "9362"],
      ["PRETO", "01"],
      ["BRANCO", "02"],
      ["VERMELHO", "03"],
      ["AZUL", "06"],
      ["GRAFITE", "0457"],
    ];
    const Hu = H.toUpperCase();
    for (const [nome, codigo] of CORES_BETEL) {
      if (Hu.includes(nome)) return G + codigo;
    }
    return null;
  }
  // Coimbra: referência = os 5 primeiros caracteres do código do produto da
  // nota (antes era o código puro).
  if (igual(A, "COIMBRA SP INDUSTRIA E COMERCIO LTDA")) return esquerda(G, 5);
  if (igual(A, "MATMAMAT CONFECCOES LTDA"))
    return esquerda(substituir(substituir(G, " - ", "_"), "-", "_"), 8);
  if (igual(A, "WAB COMPANY LTDA")) return esquerda(G, 10);
  if (igual(A, "BRAZILIAN COMERCIO DE MODA PRAIA LTDA."))
    return esquerda(G, G.length - ultimoNome(H).length);
  if (igual(A, "ALPAR  DO BRASIL IND.COM.LTDA") || igual(A, "ALPAR DO BRASIL S/A"))
    return substituir(esquerda(H, localizar("-", H) - 2), "REF: ", "");
  if (igual(A, "BRANDILI TEXTIL LTDA")) return esquerda(G, 12);
  if (igual(A, "NEW ERA BRASIL LTDA")) return esquerda(G, 15);
  if (igual(A, "1QA+ Confeccoes Eireli (Torcida Baby)"))
    return esquerda(G, localizar(".FLA", G) - 1);
  if (igual(A, "MALHARIA RIKAM LTDA")) return substituir(substituir(G, ".JV", ""), ".", "");
  if (igual(A, "Torcida Baby do Brasil Ltda")) return esquerda(G, localizar(".", G) - 1);
  if (igual(A, "BRAZILINE INDUSTRIA E COMERCIO LTDA")) return esquerda(G, 11);
  if (igual(A, "ITF FERRARI PRODUTOS LICENCIADOS LTDA")) {
    // (V F FERRARI saiu daqui: agora entra no grupo Cebola da fórmula 2 —
    //  referência = código sem zeros à esquerda.)
    if (eqi(g2, "00")) return direita(G, 4);
    // REVISAR: ESQUERDA($G2;2)="0" compara 2 chars com "0" (1 char) — no Excel
    // só seria verdadeiro se G tiver exatamente 1 caractere.
    if (eqi(g2, "0")) return direita(G, 5);
    return G;
  }
  // Approve Street Wear: só ela e só no ramo "Approve" (código NÃO começa com
  // "J"). Códigos no formato REF-COR-TAM (>= 2 hifens) viram "REF_COR": pega
  // tudo antes do último "-" (descarta o tamanho) e troca os hifens restantes
  // por "_" — "7779-PPP-P" -> "7779_PPP". Sem esse formato, cai na regra antiga
  // do grupo R3 (usa a cor das informações complementares). O ramo "J" (JADE
  // JADE) e as demais empresas do grupo seguem inalterados.
  if (igual(A, "APPROVE STREET WEAR COMERCIAL LTDA")) {
    if (eqi(g1, "J")) return G + cor3(P);
    const nHifens = (G.match(/-/g) ?? []).length;
    if (nHifens >= 2) {
      return substituir(G.slice(0, G.lastIndexOf("-")), "-", "_");
    }
    return refGrupoR3ComCor(G, Q);
  }
  if (
    [
      "R3 TECIDOS E CONFECCOES LTDA",
      "JUST BRANDS COMERCIAL E SERVICOS LTDA",
      "PROPARRA - CONFECCAO E COMERCIO DE ARTIGOS DO VESTUARIO LTDA",
      "SF7 COMERCIAL E SERVICOS LTDA",
      "L6 COMERCIAL DO VESTUARIO LTDA",
    ].some((x) => igual(A, x))
  ) {
    if (eqi(g1, "J")) return G + cor3(P);
    return refGrupoR3ComCor(G, Q);
  }
  if (igual(A, "NB BRASIL COMERCIO DE CALCADOS LTDA")) return esquerda(G, G.length - 3);
  if (igual(A, "FILA BRASIL LTDA")) return esquerda(H, localizar("-", H) - 1) + G;
  if (igual(A, "High Company LTDA")) return esquerda(G, localizar("-", G) - 1);
  if (igual(A, "PUMA SPORTS LTDA")) return esquerda(G, G.length - ultimoNome(H).length);
  if (
    igual(A, "COOPERSHOES COOP.TRAB.IND.CALC.JOANETENSE LTDA") ||
    igual(A, "COOPERSHOES COOP.TRAB.IND.CAL.JOANETENSE LTDA") ||
    igual(A, "COOPERSHOES COOP.TRAB.IND.CAL.JOANETENSE LTD")
  )
    // 2ª palavra da descrição = o código do produto (1ª palavra é o tipo:
    // TENIS/CHINELO/MOCHILAS/BAG/BONES/MEIAS...). Sem corte de tamanho — o
    // código varia de ~7 a 15+ caracteres, às vezes com hífen. Era um corte de
    // posição fixa (chars 7-16) que só acertava quando a 1ª palavra tinha
    // exatamente 5 letras E o código tinha exatamente ~10 chars.
    return segundaPalavra(H);
  if (
    [
      "ARELL IMPORTACAO E COMERCIO LTDA",
      "VERON PRESENTES LTDA",
      "Liga dos Mascotes Criacoes Digitais e Licenciamentos Ltda",
      "DBS IND. COM. DE ARTIGOS ESPORTIVOS IMP. E EXP. EIRELI",
      "DBS INDUSTRIA E COMERCIO DE ARTIGOS ESPORTIVOS",
      "DBS INDUSTRIA E COMERCIO DE ARTIGOS ESPORTIVOS - MANAUS",
    ].some((x) => igual(A, x))
  )
    return G;
  if (
    igual(A, "KENERSON IND E COM DE PROD OPTICOS") ||
    igual(A, "KENERSON IND E COM DE PROD OPTICOS LTDA")
  )
    return G.length > 15 ? substituir(G, " ", "") : G;
  if (igual(A, "LUXOTTICA BRASIL PRODUTOS OTICOS E ESPORTIVOS LTDA")) {
    // SEERRO(SES(...); "")
    try {
      if (eqi(g2, "0O")) return substituir(G, " ", "");
      const locH = localizar("-", G);
      if (locH > 0)
        return esquerda(G, locH - 1) + esquerda(direita(G, G.length - locH + 1), 4);
      const locE = localizar(" ", G);
      if (locE > 0)
        return substituir(
          esquerda(G, locE - 1) + esquerda(direita(G, G.length - locE + 1), 4),
          " ",
          ""
        );
      return "";
    } catch {
      return "";
    }
  }

  return null;
}

export function identificarReferenciaFornecedor(
  razaoSocialEmitente: string,
  codigoProduto: string,
  descricaoProduto: string,
  informacoesComplementares: string,
  infAdProd?: string
): ResultadoReferencia {
  const A = razaoSocialEmitente;
  const G = s(codigoProduto);
  const H = s(descricaoProduto);
  const P = s(informacoesComplementares);
  const Q = s(infAdProd ?? ""); // det/infAdProd — info adicional DO ITEM (não da nota)

  // Tenta Fórmula 2; se a empresa não casou lá, tenta Fórmula 3.
  for (const fn of [referenciaFormula2, referenciaFormula3]) {
    let v: string | null;
    try {
      v = fn(A, G, H, P, Q);
    } catch {
      v = null; // ramo com erro no cálculo -> como se não existisse
    }
    if (v != null && v !== "") {
      return { valor: v, comRegraEspecifica: true };
    }
  }

  // Fallback: $AT2 (== codigoProduto puro).
  return { valor: G, comRegraEspecifica: false };
}
