import type { NFeParaExibir } from "@/lib/parse-nfe-xml";

function moeda(v: string) {
  return Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

export function DanfeView({ nfe }: { nfe: NFeParaExibir }) {
  return (
    <div className="danfe">
      <table style={{ marginBottom: 12 }}>
        <tbody>
          <tr>
            <td style={{ width: "60%" }}>
              <div className="titulo">{nfe.emitente.nome}</div>
              <div>{nfe.emitente.endereco}</div>
              <div>CNPJ: {nfe.emitente.cnpj}</div>
            </td>
            <td>
              <div className="secao-titulo">DANFE - Documento Auxiliar da NF-e</div>
              <div>Nº {nfe.numero} &nbsp; Série {nfe.serie}</div>
              <div>Emissão: {nfe.dataEmissao ? new Date(nfe.dataEmissao).toLocaleString("pt-BR") : "-"}</div>
              <div>Natureza da operação: {nfe.natOp}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <table style={{ marginBottom: 12 }}>
        <tbody>
          <tr>
            <td>
              <div className="secao-titulo">Chave de acesso</div>
              <div style={{ fontFamily: "monospace" }}>{nfe.chaveAcesso}</div>
            </td>
            <td>
              <div className="secao-titulo">Protocolo de autorização</div>
              <div>{nfe.protocolo || "-"}</div>
              <div>{nfe.dataAutorizacao ? new Date(nfe.dataAutorizacao).toLocaleString("pt-BR") : ""}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <table style={{ marginBottom: 12 }}>
        <tbody>
          <tr>
            <td>
              <div className="secao-titulo">Destinatário</div>
              <div>{nfe.destinatario.nome}</div>
              <div>{nfe.destinatario.endereco}</div>
              <div>CNPJ/CPF: {nfe.destinatario.cnpjCpf}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="secao-titulo" style={{ marginBottom: 6 }}>Produtos / Serviços</div>
      <table style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th>Código</th>
            <th>Descrição</th>
            <th>NCM</th>
            <th>CFOP</th>
            <th>Un.</th>
            <th>Qtd.</th>
            <th>Vl. Unit.</th>
            <th>Vl. Total</th>
          </tr>
        </thead>
        <tbody>
          {nfe.itens.map((item, i) => (
            <tr key={i}>
              <td>{item.codigo}</td>
              <td>{item.descricao}</td>
              <td>{item.ncm}</td>
              <td>{item.cfop}</td>
              <td>{item.unidade}</td>
              <td>{item.quantidade}</td>
              <td>{moeda(item.valorUnitario)}</td>
              <td>{moeda(item.valorTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table>
        <tbody>
          <tr>
            <td>Valor dos produtos: <b>R$ {moeda(nfe.totais.valorProdutos)}</b></td>
            <td>Frete: <b>R$ {moeda(nfe.totais.valorFrete)}</b></td>
            <td>Desconto: <b>R$ {moeda(nfe.totais.valorDesconto)}</b></td>
            <td>Total da nota: <b>R$ {moeda(nfe.totais.valorTotalNota)}</b></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
