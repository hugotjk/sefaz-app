# Notas SEFAZ

App que consulta o webservice nacional **NFeDistribuicaoDFe** da SEFAZ de
hora em hora, usando certificados digitais A1 (.pfx), e mostra as notas
recebidas por CNPJ num painel — com visualização estilo DANFE.

## Stack (100% gratuita)

- **Next.js 14** (App Router) — hospedado na **Vercel (Hobby)**
- **Postgres via Supabase** (free tier) — armazena certificados (criptografados) e notas
- **Inngest** (free tier) — roda o cron de 1h e orquestra a consulta paginada por NSU
  sem esbarrar no timeout de function serverless

## Como rodar

```bash
npm install
cp .env.example .env
# preencha DATABASE_URL (Supabase) e ENCRYPTION_KEY (openssl rand -hex 32)
npx prisma migrate dev --name init
npm run dev
```

Em outro terminal, para testar as funções do Inngest localmente:

```bash
npx inngest-cli dev
```

## Deploy

1. **Supabase**: crie um projeto free em supabase.com, copie a Connection String (URI) para `DATABASE_URL`.
2. **Vercel**: importe o repositório, adicione as env vars (`DATABASE_URL`, `ENCRYPTION_KEY`), deploy.
3. **Inngest**: crie uma conta free em inngest.com, conecte ao app (ele detecta a rota `/api/inngest` automaticamente), copie `INNGEST_EVENT_KEY` e `INNGEST_SIGNING_KEY` para as env vars da Vercel.
4. Rode as migrations do Prisma contra o banco de produção: `npx prisma migrate deploy`.

## Fluxo de uso

1. Vá em **Certificados**, selecione um ou vários arquivos `.pfx`, digite a senha (a mesma
   para todos) e envie. Os que derem erro de senha aparecem marcados — reenvie só esses
   com a senha correta.
2. Ao validar, o Inngest dispara automaticamente a **carga inicial** (histórico completo),
   paginando por NSU respeitando um intervalo entre chamadas (ajustável em
   `src/inngest/functions.ts`, constante `INTERVALO_ENTRE_CHAMADAS_MS`).
3. A partir daí, o cron horário do Inngest consulta só o que é novo (usando o `ultNSU`
   salvo por certificado) — inclusive eventos como carta de correção e cancelamento,
   que atualizam a nota já salva.
4. No painel principal, clique numa nota para ver o layout impresso (estilo DANFE). O XML
   completo é buscado da SEFAZ na primeira vez que você abre a nota (a consulta por NSU só
   traz um resumo) e fica em cache no banco depois disso.

## Pontos que valem atenção antes de ir para produção com certificados reais

- **`cUFAutor`** no `src/lib/sefaz.ts` está fixo em `91` (Ambiente Nacional). Confirme no
  manual oficial da NFeDistribuicaoDFe se isso se aplica ao seu caso ou se precisa usar o
  código da UF do certificado.
- **Rate limit da SEFAZ**: o intervalo de 25s entre chamadas paginadas é uma estimativa
  conservadora. Se aparecer rejeição por "consumo indevido" (cStat 656), aumente esse valor.
- **Ambiente de homologação**: para testar sem usar cota de produção, troque
  `ambiente: "producao"` por `"homologacao"` nas chamadas — mas lembre que homologação só
  retorna notas emitidas nesse mesmo ambiente.
- O parser de CNPJ do certificado assume o padrão `RAZAO SOCIAL:CNPJ` no campo CN — é o
  padrão ICP-Brasil mais comum para e-CNPJ, mas vale validar com um certificado real.
