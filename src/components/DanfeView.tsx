import type { NFeParaExibir } from "@/lib/parse-nfe-xml";

function moeda(v: string) {
  return Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function dataHora(iso: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR");
}

function dataCurta(iso: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR");
}

function chaveFormatada(chave: string) {
  return chave.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

const boxStyle: React.CSSProperties = {
  border: "1px solid #999",
  padding: "4px 6px",
};
const labelStyle: React.CSSProperties = {
  fontSize: 8,
  textTransform: "uppercase",
  color: "#555",
  display: "block",
};
const valueStyle: React.CSSProperties = {
  fontSize: 11,
};

function Campo({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={boxStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={{ ...valueStyle, fontFamily: mono ? "monospace" : undefined }}>{value || "-"}</span>
    </div>
  );
}

export function DanfeView({ nfe }: { nfe: NFeParaExibir }) {
  return (
    <div className="danfe">
      {/* Cabeçalho: emitente + identificação DANFE */}
      <table style={{ marginBottom: 8 }}>
        <tbody>
          <tr>
            <td style={{ width: "45%", verticalAlign: "top" }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{nfe.emitente.nome}</div>
              <div style={{ fontSize: 11 }}>{nfe.emitente.endereco}</div>
              <div style={{ fontSize: 11 }}>Fone/Fax: {nfe.emitente.telefone}</div>
            </td>
            <td style={{ width: "12%", textAlign: "center", verticalAlign: "middle" }}>
              <div style={{ fontWeight: 700, fontSize: 11 }}>DANFE</div>
              <div style={{ fontSize: 9 }}>Documento Auxiliar da Nota Fiscal Eletrônica</div>
              <div style={{ fontSize: 9, marginTop: 4 }}>{nfe.tipoOperacao}</div>
            </td>
            <td style={{ width: "18%", textAlign: "center", verticalAlign: "middle" }}>
              <div style={{ fontSize: 11 }}>Nº {nfe.numero}</div>
              <div style={{ fontSize: 11 }}>Série {nfe.serie}</div>
            </td>
            <td style={{ width: "25%", verticalAlign: "top" }}>
              <span style={labelStyle}>Chave de Acesso</span>
              <div style={{ fontFamily: "monospace", fontSize: 11 }}>{chaveFormatada(nfe.chaveAcesso)}</div>
              <div style={{ fontSize: 9, marginTop: 2 }}>
                Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 8 }}>
        <Campo label="Natureza da Operação" value={nfe.natOp} />
        <Campo
          label="Protocolo de Autorização de Uso"
          value={nfe.protocolo ? `${nfe.protocolo} - ${dataHora(nfe.dataAutorizacao)}` : "-"}
        />
      </div>

      {/* Destinatário */}
      <div style={{ ...labelStyle, marginBottom: 2 }}>Destinatário / Remetente</div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 4, marginBottom: 4 }}>
        <Campo label="Nome / Razão Social" value={nfe.destinatario.nome} />
        <Campo label="CNPJ / CPF" value={nfe.destinatario.cnpjCpf} />
        <Campo label="Data da Emissão" value={dataCurta(nfe.dataEmissao)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 4, marginBottom: 8 }}>
        <Campo label="Endereço" value={nfe.destinatario.endereco} />
        <Campo label="Bairro" value={nfe.destinatario.bairro} />
        <Campo label="CEP" value={nfe.destinatario.cep} />
        <Campo label="Inscrição Estadual" value={nfe.destinatario.ie} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 4, marginBottom: 8 }}>
        <Campo label="Município" value={nfe.destinatario.municipio} />
        <Campo label="UF" value={nfe.destinatario.uf} />
        <Campo label="Fone/Fax" value={nfe.destinatario.telefone} />
      </div>

      {/* Transportador / Volumes */}
      {(nfe.transportador.nome || nfe.transportador.volumes !== "0") && (
        <>
          <div style={{ ...labelStyle, marginBottom: 2 }}>Transportador / Volumes Transportados</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 4, marginBottom: 4 }}>
            <Campo label="Nome / Razão Social" value={nfe.transportador.nome} />
            <Campo label="Frete por Conta" value={nfe.transportador.modFrete} />
            <Campo label="CNPJ / CPF" value={nfe.transportador.cnpj} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 4, marginBottom: 8 }}>
            <Campo label="Quantidade" value={nfe.transportador.volumes} />
            <Campo label="Espécie" value={nfe.transportador.especie} />
            <Campo label="Marca" value={nfe.transportador.marca} />
            <Campo label="Peso Bruto" value={nfe.transportador.pesoBruto} />
            <Campo label="Peso Líquido" value={nfe.transportador.pesoLiquido} />
          </div>
        </>
      )}

      {/* Fatura / Duplicatas */}
      {nfe.duplicatas.length > 0 && (
        <>
          <div style={{ ...labelStyle, marginBottom: 2 }}>Fatura / Duplicata</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(nfe.duplicatas.length, 6)}, 1fr)`,
              gap: 4,
              marginBottom: 8,
            }}
          >
            {nfe.duplicatas.map((d, i) => (
              <div key={i} style={boxStyle}>
                <span style={labelStyle}>Num. {d.numero}</span>
                <div style={valueStyle}>Venc. {dataCurta(d.vencimento)}</div>
                <div style={valueStyle}>R$ {moeda(d.valor)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Cálculo do Imposto */}
      <div style={{ ...labelStyle, marginBottom: 2 }}>Cálculo do Imposto</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 8 }}>
        <Campo label="Base de Cálc. do ICMS" value={`R$ ${moeda(nfe.totais.baseCalcIcms)}`} />
        <Campo label="Valor do ICMS" value={`R$ ${moeda(nfe.totais.valorIcms)}`} />
        <Campo label="Base de Cálc. ICMS S.T." value={`R$ ${moeda(nfe.totais.baseCalcIcmsSt)}`} />
        <Campo label="Valor do ICMS Subst." value={`R$ ${moeda(nfe.totais.valorIcmsSt)}`} />
        <Campo label="Valor do Frete" value={`R$ ${moeda(nfe.totais.valorFrete)}`} />
        <Campo label="Valor do Seguro" value={`R$ ${moeda(nfe.totais.valorSeguro)}`} />
        <Campo label="Desconto" value={`R$ ${moeda(nfe.totais.valorDesconto)}`} />
        <Campo label="Outras Despesas" value={`R$ ${moeda(nfe.totais.outrasDespesas)}`} />
        <Campo label="Valor Total do IPI" value={`R$ ${moeda(nfe.totais.valorIpi)}`} />
        <Campo label="Valor do PIS" value={`R$ ${moeda(nfe.totais.valorPis)}`} />
        <Campo label="Valor da COFINS" value={`R$ ${moeda(nfe.totais.valorCofins)}`} />
        <Campo label="V. Total Produtos" value={`R$ ${moeda(nfe.totais.valorProdutos)}`} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ ...boxStyle, background: "#f4f4f4" }}>
          <span style={labelStyle}>Valor Total da Nota</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>R$ {moeda(nfe.totais.valorTotalNota)}</span>
        </div>
      </div>

      {/* Produtos */}
      <div style={{ ...labelStyle, marginBottom: 2 }}>Dados dos Produtos / Serviços</div>
      <table style={{ marginBottom: 8 }}>
        <thead>
          <tr>
            <th>Código</th>
            <th>Descrição</th>
            <th>NCM/SH</th>
            <th>CST</th>
            <th>CFOP</th>
            <th>Un</th>
            <th>Quant</th>
            <th>Vl. Unit.</th>
            <th>Vl. Total</th>
            <th>Vl. Desc.</th>
            <th>B. Cálc. ICMS</th>
            <th>Vl. ICMS</th>
            <th>Vl. IPI</th>
            <th>Alíq. ICMS</th>
            <th>Alíq. IPI</th>
          </tr>
        </thead>
        <tbody>
          {nfe.itens.map((item, i) => (
            <tr key={i}>
              <td>{item.codigo}</td>
              <td style={{ textAlign: "left" }}>{item.descricao}</td>
              <td>{item.ncm}</td>
              <td>{item.cst}</td>
              <td>{item.cfop}</td>
              <td>{item.unidade}</td>
              <td>{item.quantidade}</td>
              <td>{moeda(item.valorUnitario)}</td>
              <td>{moeda(item.valorTotal)}</td>
              <td>{moeda(item.valorDesconto)}</td>
              <td>{moeda(item.baseCalcIcms)}</td>
              <td>{moeda(item.valorIcms)}</td>
              <td>{moeda(item.valorIpi)}</td>
              <td>{item.aliqIcms}</td>
              <td>{item.aliqIpi}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Dados adicionais */}
      {nfe.informacoesComplementares && (
        <>
          <div style={{ ...labelStyle, marginBottom: 2 }}>Dados Adicionais</div>
          <div style={{ ...boxStyle, fontSize: 10, whiteSpace: "pre-wrap" }}>
            {nfe.informacoesComplementares}
          </div>
        </>
      )}
    </div>
  );
}
