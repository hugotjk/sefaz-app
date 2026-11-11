/**
 * Cadastra/atualiza as lojas do Emissor de NF-e a partir de scripts/data/emissor-lojas.json
 * (dados extraídos das devoluções já autorizadas). Não mexe em série/próximo número
 * de lojas já cadastradas.
 *
 *   npx tsx --env-file=.env scripts/seed-emissor-lojas.ts
 */
import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/db";

async function main() {
  const lojas = JSON.parse(
    fs.readFileSync(path.join(__dirname, "data", "emissor-lojas.json"), "utf8")
  ) as any[];
  for (const l of lojas) {
    const { serieAntiga, ultimoNumeroAntigo, ...fiscal } = l;
    await prisma.emissorLoja.upsert({
      where: { cnpj: l.cnpj },
      create: { ...fiscal, serieAntiga, ultimoNumeroAntigo },
      update: { ...fiscal, serieAntiga, ultimoNumeroAntigo },
    });
    console.log("ok", l.cnpj, l.razaoSocial);
  }
  console.log(`${lojas.length} loja(s) cadastrada(s).`);
}

main().finally(() => prisma.$disconnect());
