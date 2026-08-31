"use client";

import type { OpcoesRelatorio } from "@/lib/relatorio-movimentacao";

export interface FiltrosForm {
  ordenacao: "venda" | "estoque";
  verPor: "loja" | "grupoLoja";
  dataInicial: string;
  dataFinal: string;
  redeId: number | null;
  tipoLojaId: number | null;
  grupoLojaId: number | null;
  campoProduto: "fornecedor" | "modelo";
  fornecedorNome: string | null;
  modeloNome: string | null;
  subGrupo: string | null;
  colecao: string | null;
  grupoProduto: string | null;
  listarPor: "referencia" | "referenciaFornecedor";
}

function Seg<T extends string>({
  valor,
  opcoes,
  onChange,
}: {
  valor: T;
  opcoes: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="mov-seg">
      {opcoes.map((o) => (
        <button
          key={o.v}
          type="button"
          className={valor === o.v ? "ativo" : ""}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MovimentacaoResumidaFiltros({
  filtros,
  opcoes,
  carregando,
  onChange,
  onAplicar,
}: {
  filtros: FiltrosForm;
  opcoes: OpcoesRelatorio | null;
  carregando: boolean;
  onChange: (patch: Partial<FiltrosForm>) => void;
  onAplicar: () => void;
}) {
  const selNull = (v: string): string | null => (v === "" ? null : v);

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="mov-filtros">
        <div className="field">
          <label>Ordenação</label>
          <Seg
            valor={filtros.ordenacao}
            opcoes={[
              { v: "venda", label: "Venda" },
              { v: "estoque", label: "Estoque" },
            ]}
            onChange={(v) => onChange({ ordenacao: v })}
          />
        </div>

        <div className="field">
          <label>Ver por</label>
          <Seg
            valor={filtros.verPor}
            opcoes={[
              { v: "loja", label: "Loja" },
              { v: "grupoLoja", label: "Grupo Loja" },
            ]}
            onChange={(v) => onChange({ verPor: v })}
          />
        </div>

        <div className="field">
          <label>Data inicial</label>
          <input
            type="date"
            value={filtros.dataInicial}
            onChange={(e) => onChange({ dataInicial: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Data final</label>
          <input
            type="date"
            value={filtros.dataFinal}
            onChange={(e) => onChange({ dataFinal: e.target.value })}
          />
        </div>

        <div className="field">
          <label>Rede</label>
          <select
            value={filtros.redeId == null ? "" : String(filtros.redeId)}
            onChange={(e) => onChange({ redeId: e.target.value === "" ? null : Number(e.target.value) })}
          >
            <option value="">Todas</option>
            {(opcoes?.redes ?? []).map((r) => (
              <option key={r.valor} value={r.valor}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Tipo Loja</label>
          <select
            value={filtros.tipoLojaId == null ? "" : String(filtros.tipoLojaId)}
            onChange={(e) => onChange({ tipoLojaId: e.target.value === "" ? null : Number(e.target.value) })}
          >
            <option value="">Todos</option>
            {(opcoes?.tiposLoja ?? []).map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Grupo Loja</label>
          <select
            value={filtros.grupoLojaId == null ? "" : String(filtros.grupoLojaId)}
            onChange={(e) => onChange({ grupoLojaId: e.target.value === "" ? null : Number(e.target.value) })}
          >
            <option value="">Todos</option>
            {(opcoes?.gruposLoja ?? []).map((g) => (
              <option key={g.valor} value={g.valor}>
                {g.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Filtrar por</label>
          <Seg
            valor={filtros.campoProduto}
            opcoes={[
              { v: "fornecedor", label: "Fornecedor" },
              { v: "modelo", label: "Modelo" },
            ]}
            onChange={(v) => onChange({ campoProduto: v })}
          />
        </div>

        {filtros.campoProduto === "fornecedor" ? (
          <div className="field">
            <label>Fornecedor</label>
            <select
              value={filtros.fornecedorNome ?? ""}
              onChange={(e) => onChange({ fornecedorNome: selNull(e.target.value) })}
            >
              <option value="">Todos</option>
              {(opcoes?.fornecedores ?? []).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="field">
            <label>Modelo</label>
            <select
              value={filtros.modeloNome ?? ""}
              onChange={(e) => onChange({ modeloNome: selNull(e.target.value) })}
            >
              <option value="">Todos</option>
              {(opcoes?.modelos ?? []).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label>Sub Grupo</label>
          <select
            value={filtros.subGrupo ?? ""}
            onChange={(e) => onChange({ subGrupo: selNull(e.target.value) })}
          >
            <option value="">Todos</option>
            {(opcoes?.subGrupos ?? []).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Coleção</label>
          <select
            value={filtros.colecao ?? ""}
            onChange={(e) => onChange({ colecao: selNull(e.target.value) })}
          >
            <option value="">Todas</option>
            {(opcoes?.colecoes ?? []).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Grupo (produto)</label>
          <select
            value={filtros.grupoProduto ?? ""}
            onChange={(e) => onChange({ grupoProduto: selNull(e.target.value) })}
          >
            <option value="">Todos</option>
            {(opcoes?.gruposProduto ?? []).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Listar por</label>
          <Seg
            valor={filtros.listarPor}
            opcoes={[
              { v: "referencia", label: "Referência" },
              { v: "referenciaFornecedor", label: "Ref. Fornecedor" },
            ]}
            onChange={(v) => onChange({ listarPor: v })}
          />
        </div>
      </div>

      <div className="mov-acoes">
        <button className="btn" type="button" onClick={onAplicar} disabled={carregando}>
          {carregando ? "Carregando..." : "Aplicar filtros"}
        </button>
      </div>
    </div>
  );
}
