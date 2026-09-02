import Link from "next/link";

interface CardRelatorio {
  href: string;
  titulo: string;
  descricao: string;
  etiqueta: string;
  tag?: string;
}

const RELATORIOS: CardRelatorio[] = [
  {
    href: "/relatorios/movimentacao-resumida",
    titulo: "Movimentação Resumida",
    descricao:
      "Compara vendas e estoque por gestor ou loja, com filtros por rede, coleção, grupo e mais.",
    etiqueta: "Vendas & Estoque",
    tag: "Em construção",
  },
  {
    href: "/relatorios/conferencia-prazo",
    titulo: "Conferência de Prazo",
    descricao:
      "Uma linha por nota fiscal recebida: fornecedor, modelo, loja e o prazo de pagamento das duplicatas.",
    etiqueta: "Notas Fiscais",
  },
];

export default function RelatoriosPage() {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h1 style={{ margin: 0 }}>Relatórios</h1>
        <Link
          href="/relatorios/configuracao-lojas"
          style={{ fontSize: 13, color: "var(--text-dim)" }}
        >
          ⚙ Configuração de Lojas
        </Link>
      </div>

      <div className="report-cards">
        {RELATORIOS.map((r) => (
          <Link key={r.href} href={r.href} className="report-card">
            <span className="report-card-etiqueta">{r.etiqueta}</span>
            <h3>{r.titulo}</h3>
            <p>{r.descricao}</p>
            {r.tag && <span className="tag">{r.tag}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
