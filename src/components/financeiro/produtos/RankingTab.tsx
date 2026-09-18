"use client"

import { useResource } from "@/lib/hooks/use-resource"

import { useState } from "react"
import type { CSSProperties } from "react"
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts"
import { getRankingProdutos, getHistoricoProduto } from "@/app/financeiro/dre/cmv/actions"
import type { HistoricoRow, RankingItem } from "@/app/financeiro/dre/cmv/actions"

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—"
  : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)

const fmtBRLc = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL",
    notation: "compact", maximumFractionDigits: 1 }).format(v)

const fmtPct = (v: number | null | undefined) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}%`

const fmtQty = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(v)

// ── Rank colors ──────────────────────────────────────────────────────────────
const rankColor = (i: number) => {
  if (i === 0) return "#FFD700"
  if (i === 1) return "#C0C0C0"
  if (i === 2) return "#CD7F32"
  return "var(--text-3)"
}

// ── Style helpers ────────────────────────────────────────────────────────────
const thS = (align: "left" | "right" = "left"): CSSProperties => ({
  padding: "8px 12px", textAlign: align,
  fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
  textTransform: "uppercase", color: "var(--text-3)",
  borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
})

const tdS = (align: "left" | "right" = "left"): CSSProperties => ({
  padding: "8px 12px", textAlign: align, color: "var(--text)",
})

const tableStyle: CSSProperties = {
  width: "100%", borderCollapse: "collapse", fontSize: 12,
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
}

const selectStyle = (active: boolean): CSSProperties => ({
  padding: "6px 12px", borderRadius: 8, fontSize: 12,
  background: "var(--surface)",
  color: active ? "var(--text)" : "var(--text-3)",
  border: `1px solid ${active ? "var(--brand, #C4622D)" : "var(--border)"}`,
  cursor: "pointer",
})

// ── Types ────────────────────────────────────────────────────────────────────
type SubTab = "valor" | "quantidade" | "variacao"

type Props = {
  unitId: string | null
  mes: number
  ano: number
}

// ── Component ────────────────────────────────────────────────────────────────
export function RankingTab({ unitId, mes, ano }: Props) {
  const [subTab, setSubTab]           = useState<SubTab>("valor")
  const [drawerItem, setDrawerItem]   = useState<RankingItem | null>(null)
  const [historico, setHistorico]     = useState<HistoricoRow[]>([])
  const [loadingHist, setLoadingHist] = useState(false)
  const [filterForn, setFilterForn]   = useState("")
  const [filterCat, setFilterCat]     = useState("")

  const { data, loading: loadingRanking } = useResource(`${unitId}|${mes}|${ano}`, () => getRankingProdutos(unitId, mes, ano), null)

  // ── Drawer ─────────────────────────────────────────────────────────────────
  async function openDrawer(item: RankingItem) {
    setDrawerItem(item)
    setHistorico([])
    if (!item.item_codigo) return
    setLoadingHist(true)
    try {
      const rows = await getHistoricoProduto(unitId, item.item_codigo)
      setHistorico(rows)
    } finally {
      setLoadingHist(false)
    }
  }

  function closeDrawer() { setDrawerItem(null); setHistorico([]) }

  const rowProps = (item: RankingItem) => ({
    onClick: () => openDrawer(item),
    style: { borderTop: "1px solid var(--border)", cursor: "pointer" } as CSSProperties,
    onMouseEnter: (e: React.MouseEvent<HTMLTableRowElement>) =>
      (e.currentTarget.style.background = "var(--surface-2)"),
    onMouseLeave: (e: React.MouseEvent<HTMLTableRowElement>) =>
      (e.currentTarget.style.background = ""),
  })

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: "valor",      label: "Por Valor" },
    { id: "quantidade", label: "Por Quantidade" },
    { id: "variacao",   label: "Por Variação" },
  ]

  // ── Loading / empty ─────────────────────────────────────────────────────────
  if (loadingRanking) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
        Calculando ranking…
      </div>
    )
  }

  if (!data) return null

  const { porValor, porQuantidade, porVariacao, totalCmv } = data

  // ── Filter options derived from all loaded items ────────────────────────────
  const allItems = [...porValor, ...porQuantidade, ...porVariacao]
  const fornOptions = [
    ...new Set(allItems.map(x => x.fornecedor_nome).filter((v): v is string => v != null))
  ].sort()
  const catOptions = [
    ...new Set(allItems.map(x => x.desc_gerencial).filter((v): v is string => v != null))
  ].sort()

  function applyFilters(items: RankingItem[]) {
    let r = items
    if (filterForn) r = r.filter(x => x.fornecedor_nome === filterForn)
    if (filterCat)  r = r.filter(x => x.desc_gerencial  === filterCat)
    return r
  }

  const filteredValor      = applyFilters(porValor)
  const filteredQuantidade = applyFilters(porQuantidade)
  const filteredVariacao   = applyFilters(porVariacao)
  const activeFilters      = (filterForn ? 1 : 0) + (filterCat ? 1 : 0)
  const maxValor           = filteredValor[0]?.custo_total ?? 1

  return (
    <>
      {/* Sub-tab nav + filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
        {/* Sub-tabs */}
        <div style={{ display: "flex", gap: 4 }}>
          {SUB_TABS.map(({ id, label }) => {
            const active = subTab === id
            return (
              <button key={id} onClick={() => setSubTab(id)} style={{
                padding: "6px 16px", fontSize: 12, fontWeight: active ? 700 : 500,
                color: active ? "var(--text)" : "var(--text-3)",
                background: active ? "var(--surface-2)" : "transparent",
                border: "1px solid", borderColor: active ? "var(--border)" : "transparent",
                borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap",
              }}>
                {label}
              </button>
            )
          })}
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center", flexWrap: "wrap" }}>
          {fornOptions.length > 0 && (
            <select value={filterForn} onChange={e => setFilterForn(e.target.value)}
              style={selectStyle(!!filterForn)}>
              <option value="">Todos fornecedores</option>
              {fornOptions.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          {catOptions.length > 0 && (
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              style={selectStyle(!!filterCat)}>
              <option value="">Todas categorias</option>
              {catOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {activeFilters > 0 && (
            <>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 99,
                background: "var(--brand, #C4622D)", color: "var(--primary-foreground)", whiteSpace: "nowrap",
              }}>
                {activeFilters} ativo{activeFilters > 1 ? "s" : ""}
              </span>
              <button
                onClick={() => { setFilterForn(""); setFilterCat("") }}
                style={{
                  padding: "5px 12px", borderRadius: 8, fontSize: 12,
                  background: "transparent", color: "var(--text-3)",
                  border: "1px solid var(--border)", cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                Limpar filtros
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Por Valor ── */}
      {subTab === "valor" && (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: "var(--surface-2)" }}>
                <th style={{ ...thS(), width: 40, textAlign: "center" }}>#</th>
                <th style={thS()}>Produto</th>
                <th style={thS()}>Fornecedor</th>
                <th style={thS()}>Categoria</th>
                <th style={{ ...thS("right"), minWidth: 220 }}>Valor Comprado (R$)</th>
                <th style={thS("right")}>% do Total CMV</th>
              </tr>
            </thead>
            <tbody>
              {filteredValor.map((r, i) => {
                const pct  = totalCmv > 0 ? r.custo_total / totalCmv * 100 : 0
                const barW = maxValor > 0 ? r.custo_total / maxValor * 100 : 0
                return (
                  <tr key={i} {...rowProps(r)}>
                    <td style={{ ...tdS(), textAlign: "center", fontWeight: 800, color: rankColor(i) }}>
                      {i + 1}
                    </td>
                    <td style={{ ...tdS(), maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
                      {r.item_descricao ?? "—"}
                    </td>
                    <td style={{ ...tdS(), maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-3)" }}>
                      {r.fornecedor_nome ?? "—"}
                    </td>
                    <td style={{ ...tdS(), color: "var(--text-3)", whiteSpace: "nowrap" }}>
                      {r.desc_gerencial ?? "—"}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <div style={{ width: 80, height: 5, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
                          <div style={{ width: `${barW}%`, height: "100%", background: rankColor(i), borderRadius: 3 }} />
                        </div>
                        <span style={{ fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>
                          {fmtBRL(r.custo_total)}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...tdS("right"), color: "var(--text-3)" }}>
                      {pct.toFixed(1).replace(".", ",")}%
                    </td>
                  </tr>
                )
              })}
              {filteredValor.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: "24px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                    Nenhum produto encontrado com os filtros aplicados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8, textAlign: "right" }}>
            Total CMV do mês: {fmtBRL(totalCmv)} · {filteredValor.length} produto{filteredValor.length !== 1 ? "s" : ""}
            {activeFilters > 0 ? " (filtrado)" : " (top 20)"}
          </p>
        </div>
      )}

      {/* ── Por Quantidade ── */}
      {subTab === "quantidade" && (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: "var(--surface-2)" }}>
                <th style={{ ...thS(), width: 40, textAlign: "center" }}>#</th>
                <th style={thS()}>Produto</th>
                <th style={thS()}>Fornecedor</th>
                <th style={thS()}>Categoria</th>
                <th style={thS("right")}>Quantidade Total</th>
                <th style={thS("right")}>Unidade</th>
                <th style={thS("right")}>Custo Médio (R$)</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuantidade.map((r, i) => (
                <tr key={i} {...rowProps(r)}>
                  <td style={{ ...tdS(), textAlign: "center", fontWeight: 800, color: rankColor(i) }}>{i + 1}</td>
                  <td style={{ ...tdS(), maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{r.item_descricao ?? "—"}</td>
                  <td style={{ ...tdS(), maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-3)" }}>{r.fornecedor_nome ?? "—"}</td>
                  <td style={{ ...tdS(), color: "var(--text-3)", whiteSpace: "nowrap" }}>{r.desc_gerencial ?? "—"}</td>
                  <td style={{ ...tdS("right"), fontWeight: 600 }}>{fmtQty(r.quantidade_total)}</td>
                  <td style={{ ...tdS("right"), color: "var(--text-3)" }}>{r.unidade_medida ?? "—"}</td>
                  <td style={tdS("right")}>{fmtBRL(r.custo_medio)}</td>
                </tr>
              ))}
              {filteredQuantidade.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "24px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                    Nenhum produto encontrado com os filtros aplicados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Por Variação ── */}
      {subTab === "variacao" && (
        <>
          {filteredVariacao.length === 0 ? (
            <p style={{ textAlign: "center", color: "var(--text-3)", fontSize: 13, padding: "32px 0" }}>
              {activeFilters > 0
                ? "Nenhum produto encontrado com os filtros aplicados."
                : "Nenhum produto com variação média positiva neste mês."}
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ background: "var(--surface-2)" }}>
                    <th style={{ ...thS(), width: 40, textAlign: "center" }}>#</th>
                    <th style={thS()}>Produto</th>
                    <th style={thS()}>Fornecedor</th>
                    <th style={thS()}>Categoria</th>
                    <th style={thS("right")}>Variação Média %</th>
                    <th style={thS("right")}>Custo Total</th>
                    <th style={thS("right")}>Custo Médio</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVariacao.map((r, i) => (
                    <tr key={i} {...rowProps(r)}>
                      <td style={{ ...tdS(), textAlign: "center", fontWeight: 800, color: rankColor(i) }}>{i + 1}</td>
                      <td style={{ ...tdS(), maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{r.item_descricao ?? "—"}</td>
                      <td style={{ ...tdS(), maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-3)" }}>{r.fornecedor_nome ?? "—"}</td>
                      <td style={{ ...tdS(), color: "var(--text-3)", whiteSpace: "nowrap" }}>{r.desc_gerencial ?? "—"}</td>
                      <td style={{ ...tdS("right"), fontWeight: 700, color: "#EF4444" }}>{fmtPct(r.variacao_media)}</td>
                      <td style={tdS("right")}>{fmtBRL(r.custo_total)}</td>
                      <td style={tdS("right")}>{fmtBRL(r.custo_medio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Histórico Drawer ── */}
      {drawerItem && (
        <HistoricoDrawer
          item={drawerItem}
          historico={historico}
          loading={loadingHist}
          onClose={closeDrawer}
        />
      )}
    </>
  )
}

// ── Histórico Drawer ──────────────────────────────────────────────────────────
const fmtDate = (value: string | null | undefined) => {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  }).format(date)
}

type DrawerProps = {
  item: RankingItem
  historico: HistoricoRow[]
  loading: boolean
  onClose: () => void
  onSelecionarNota?: (chaveNfe: string) => void
}

export function HistoricoDrawer({ item, historico, loading, onClose, onSelecionarNota }: DrawerProps) {
  const chartData = historico.map(h => ({
    label:      fmtDate(h.dt_emissao),
    custoTotal: h.v_custo_total != null ? Math.abs(h.v_custo_total) : null,
    custoMedio: h.v_custo_medio,
    quantidade: h.q_estoque,
  }))

  const thD = (align: "left" | "right" = "left"): CSSProperties => ({
    padding: "7px 10px", textAlign: align,
    fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
    textTransform: "uppercase", color: "var(--text-3)",
    borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
  })

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, zIndex: 998, background: "rgba(0,0,0,0.45)",
      }} />

      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(520px, 100vw)",
        zIndex: 999, background: "var(--surface)",
        borderLeft: "1px solid var(--border)",
        display: "flex", flexDirection: "column", overflowY: "auto",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.3)",
      }}>
        {/* Sticky header */}
        <div style={{
          padding: "20px 24px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          position: "sticky", top: 0, background: "var(--surface)", zIndex: 1,
        }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-3)", margin: "0 0 4px" }}>
              Histórico do Produto
            </p>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: "0 0 4px", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.item_descricao ?? item.item_codigo ?? "—"}
            </h2>
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
              {[item.fornecedor_nome, item.desc_gerencial].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "var(--text-3)",
            cursor: "pointer", fontSize: 22, lineHeight: 1, flexShrink: 0,
          }}>×</button>
        </div>

        <div style={{ padding: "20px 24px", flex: 1 }}>
          {loading && (
            <p style={{ color: "var(--text-3)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>
              Carregando histórico…
            </p>
          )}

          {!loading && historico.length === 0 && (
            <p style={{ color: "var(--text-3)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>
              Nenhum histórico encontrado para este produto.
            </p>
          )}

          {!loading && historico.length > 0 && (
            <>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-3)", margin: "0 0 12px" }}>
                Evolução — {historico.length} {historico.length === 1 ? "compra" : "compras"}
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 44, left: 0, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text-3)" }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis yAxisId="brl" orientation="left" tickFormatter={v => fmtBRLc(Number(v))} tick={{ fontSize: 10, fill: "var(--text-3)" }} width={72} />
                  <YAxis yAxisId="qty" orientation="right" tick={{ fontSize: 10, fill: "var(--text-3)" }} width={44} />
                  <Tooltip
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                    formatter={(v, name) => {
                      const n = Number(v)
                      if (name === "Quantidade") return [fmtQty(n), name]
                      return [fmtBRL(n), name as string]
                    }}
                  />
                  <Line yAxisId="brl" type="monotone" dataKey="custoTotal" stroke="#D4A574" strokeWidth={2} dot={{ r: 3 }} name="Custo Total"  connectNulls />
                  <Line yAxisId="brl" type="monotone" dataKey="custoMedio" stroke="#60A5FA" strokeWidth={2} dot={{ r: 3 }} name="Custo Médio" connectNulls />
                  <Line yAxisId="qty"  type="monotone" dataKey="quantidade" stroke="#4ADE80" strokeWidth={2} dot={{ r: 3 }} name="Quantidade"  connectNulls />
                </ComposedChart>
              </ResponsiveContainer>

              <div style={{ display: "flex", gap: 16, margin: "10px 0 24px", flexWrap: "wrap" }}>
                {([ ["#D4A574","Custo Total"], ["#60A5FA","Custo Médio"], ["#4ADE80","Quantidade"] ] as const).map(([color, label]) => (
                  <span key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-3)" }}>
                    <span style={{ width: 14, height: 3, background: color, borderRadius: 2, display: "inline-block" }} />
                    {label}
                  </span>
                ))}
              </div>

              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-3)", margin: "0 0 10px" }}>
                Compras
              </p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
                  <thead>
                    <tr style={{ background: "var(--surface-2)" }}>
                      <th style={thD()}>Data</th>
                      <th style={thD()}>Nota</th>
                      <th style={thD()}>Fornecedor</th>
                      <th style={thD("right")}>Qtd</th>
                      <th style={thD("right")}>Custo Médio</th>
                      <th style={thD("right")}>Custo Total</th>
                      <th style={thD("right")}>Variação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historico.map((h, i) => {
                      const podeVoltar = Boolean(onSelecionarNota && h.chave_nfe)
                      return (
                        <tr key={i}
                          onClick={() => { if (podeVoltar) onSelecionarNota!(h.chave_nfe!) }}
                          style={{ borderTop: "1px solid var(--border)", cursor: podeVoltar ? "pointer" : "default" }}
                          onMouseEnter={e => { if (podeVoltar) e.currentTarget.style.background = "var(--surface-2)" }}
                          onMouseLeave={e => { e.currentTarget.style.background = "" }}
                        >
                          <td style={{ padding: "6px 10px", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>
                            {fmtDate(h.dt_emissao)}
                          </td>
                          <td style={{ padding: "6px 10px", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                            {h.nr_danfe ?? "—"}
                          </td>
                          <td style={{ padding: "6px 10px", color: "var(--text-3)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {h.fornecedor_nome ?? "—"}
                          </td>
                          <td style={{ padding: "6px 10px", textAlign: "right", color: "var(--text)" }}>{fmtQty(h.q_estoque)}</td>
                          <td style={{ padding: "6px 10px", textAlign: "right", color: "var(--text)" }}>{fmtBRL(h.v_custo_medio)}</td>
                          <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: "var(--text)" }}>
                            {fmtBRL(h.v_custo_total != null ? Math.abs(h.v_custo_total) : null)}
                          </td>
                          <td style={{
                            padding: "6px 10px", textAlign: "right",
                            color: h.perc_variacao == null ? "var(--text-3)" : h.perc_variacao > 0 ? "#EF4444" : "#22C55E",
                            fontWeight: h.perc_variacao != null ? 600 : 400,
                          }}>
                            {fmtPct(h.perc_variacao)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
