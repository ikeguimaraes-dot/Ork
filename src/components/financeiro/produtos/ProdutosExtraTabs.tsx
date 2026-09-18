"use client"

import { useResource } from "@/lib/hooks/use-resource"

import { useMemo, useState } from "react"
import {
  getBonificacoes, getComprasPorFornecedor, getFornecedoresLista, getNotasARevisar,
  type ProdutoCompra,
} from "@/app/financeiro/dre/cmv/actions"

const money = (value: number | null) => value == null ? "—" : new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL",
}).format(Number(value))

const cell = { padding: "8px 10px", borderTop: "1px solid var(--border)", color: "var(--text)" }
const head = { padding: "8px 10px", textAlign: "left" as const, fontSize: 10, textTransform: "uppercase" as const,
  color: "var(--text-3)", background: "var(--surface-2)" }

function ComprasTable({ rows, highlightZero = false }: { rows: ProdutoCompra[]; highlightZero?: boolean }) {
  const notas = useMemo(() => {
    const map = new Map<string, ProdutoCompra[]>()
    for (const row of rows) {
      const key = `${row.fornecedor_nome ?? "Sem fornecedor"}|${row.nr_danfe ?? "Sem DANFE"}`
      map.set(key, [...map.get(key) ?? [], row])
    }
    return [...map.entries()]
  }, [rows])
  const [open, setOpen] = useState<string | null>(null)

  if (!notas.length) return <p style={{ color: "var(--text-3)", fontSize: 13 }}>Nenhum registro encontrado.</p>
  return <div style={{ display: "grid", gap: 8 }}>
    {notas.map(([key, itens]) => {
      const first = itens[0]!
      const opened = open === key
      return <div key={key} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--surface)" }}>
        <button onClick={() => setOpen(opened ? null : key)} style={{ width: "100%", border: 0, padding: "11px 14px",
          display: "grid", gridTemplateColumns: "1fr auto auto", gap: 16, textAlign: "left", cursor: "pointer",
          background: "transparent", color: "var(--text)" }}>
          <span><strong>{first.fornecedor_nome ?? "Sem fornecedor"}</strong><br/><small style={{ color: "var(--text-3)" }}>NF {first.nr_danfe ?? "—"} · {itens.length} itens</small></span>
          <span>{money(first.v_total_danfe)}</span><span>{opened ? "−" : "+"}</span>
        </button>
        {opened && <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr><th style={head}>Produto</th><th style={head}>CFOP</th><th style={{...head,textAlign:"right"}}>Quantidade</th><th style={{...head,textAlign:"right"}}>Custo</th><th style={{...head,textAlign:"right"}}>Total</th></tr></thead>
          <tbody>{itens.map(item => <tr key={item.id} style={highlightZero && Number(item.v_custo_compra) === 0 ? { background: "rgba(239,68,68,.10)" } : undefined}>
            <td style={cell}>{item.item_descricao ?? "—"}</td><td style={cell}>{item.cfop ?? "—"}</td>
            <td style={{...cell,textAlign:"right"}}>{item.q_embalagem ?? "—"}</td>
            <td style={{...cell,textAlign:"right",color:highlightZero && Number(item.v_custo_compra) === 0 ? "#ef4444" : "var(--text)"}}>{money(item.v_custo_compra)}</td>
            <td style={{...cell,textAlign:"right"}}>{money(item.v_total_embalagem)}</td>
          </tr>)}</tbody>
        </table></div>}
      </div>
    })}
  </div>
}

export function BonificacaoTab({ unitId }: { unitId: string | null }) {
  const { data: rows, loading } = useResource(String(unitId), () => getBonificacoes(unitId), [])
  if (loading) return <p style={{ color: "var(--text-3)" }}>Carregando bonificações...</p>
  return <section><p style={{ color: "var(--text-3)", fontSize: 13 }}>Notas identificadas por CFOP 5910 ou 6910, ou valor total igual a zero ou um centavo.</p><ComprasTable rows={rows}/></section>
}

export function FornecedorTab({ unitId, mes, ano }: { unitId: string | null; mes: number; ano: number }) {
  const [selected, setSelected] = useState("")
  const [query, setQuery] = useState("")
  const { data: list } = useResource(`${unitId}|${mes}|${ano}`, () => getFornecedoresLista(unitId, mes, ano), [])
  const { data: rows } = useResource(`${unitId}|${selected}|${mes}|${ano}`, () => selected ? getComprasPorFornecedor(unitId, selected, mes, ano) : Promise.resolve([]), [])
  const filtered = list.filter(name => name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")))
  return <section style={{ display: "grid", gap: 12 }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar fornecedor" style={{ padding: 9, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", minWidth: 220 }}/>
      <select value={selected} onChange={event => setSelected(event.target.value)} style={{ padding: 9, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", minWidth: 280 }}>
        <option value="">Selecione o fornecedor</option>{filtered.map(name => <option key={name}>{name}</option>)}
      </select>
    </div>
    <ComprasTable rows={rows}/>
  </section>
}

export function ARevisarTab({ unitId }: { unitId: string | null }) {
  const [onlyCmv, setOnlyCmv] = useState(false)
  const { data: rows, loading } = useResource(String(unitId), () => getNotasARevisar(unitId), [])
  const filtered = useMemo(() => {
    if (!onlyCmv) return rows
    const qualifying = new Set(rows
      .filter(row => row.calcula_cmv === true && Number(row.v_custo_compra) === 0)
      .map(row => `${row.fornecedor_nome ?? ""}|${row.nr_danfe ?? ""}`))
    return rows.filter(row => qualifying.has(`${row.fornecedor_nome ?? ""}|${row.nr_danfe ?? ""}`))
  }, [onlyCmv, rows])
  if (loading) return <p style={{ color: "var(--text-3)" }}>Carregando itens para revisão...</p>
  return <section>
    <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text-3)", fontSize: 13, marginBottom: 12 }}>
      <input type="checkbox" checked={onlyCmv} onChange={event => setOnlyCmv(event.target.checked)}/> Mostrar somente notas com item zerado que entra no CMV
    </label>
    <ComprasTable rows={filtered} highlightZero/>
  </section>
}
