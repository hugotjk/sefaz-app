import Link from "next/link";

export default function RelatoriosPage() {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Relatórios</h1>
        <Link href="/relatorios/configuracao-lojas" style={{ fontSize: 13, color: "var(--text-dim)" }}>
          ⚙ Configuração de Lojas
        </Link>
      </div>
      <div className="report-cards">
        <Link href="/relatorios/movimentacao-resumida" className="report-card">
          <h3>Movimentação Resumida</h3>
          <p>Compara vendas e estoque por gestor ou loja, com filtros por rede, coleção, grupo e mais.</p>
          <span className="tag">Em construção</span>
        </Link>
        <Link href="/relatorios/conferencia-prazo" className="report-card">
          <h3>Conferência de Prazo</h3>
          <p>Uma linha por nota fiscal recebida: fornecedor, modelo, loja e o prazo de pagamento das duplicatas.</p>
        </Link>
      </div>
    </div>
  );
}
