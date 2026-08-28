export default function MovimentacaoResumidaPage() {
  return (
    <div>
      <h1>Movimentação Resumida</h1>
      <div className="card">
        <p style={{ color: "var(--text-dim)" }}>
          Esse relatório está em construção. Antes de montar os filtros e a tabela, falta:
        </p>
        <ul style={{ color: "var(--text-dim)", fontSize: 14, lineHeight: 1.8 }}>
          <li>Conectar a API do PDV (usuário/senha) nas variáveis de ambiente do app</li>
          <li>Confirmar as opções de "Tipo Loja" que você vai mandar</li>
          <li>Cadastrar o Gestor e Tipo Loja de cada loja em "Configuração de Lojas"</li>
        </ul>
      </div>
    </div>
  );
}
