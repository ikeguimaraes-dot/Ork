"use client"

import { useResource } from "@/lib/hooks/use-resource"

import { useMemo, useState } from "react"
import { getItensProdutoBusca, getHistoricoProduto } from "@/app/financeiro/dre/cmv/actions"
import type { ItemProdutoRow, HistoricoRow, RankingItem } from "@/app/financeiro/dre/cmv/actions"
import { HistoricoDrawer } from "./RankingTab"

// ── Formatters (mesmos das outras abas) ─────────────────────────────────────
const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—"
  : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)

const fmtQty = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(v)

const fmtDate = (value: string | null | undefined) => {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR").format(date)
}

const PAGE_SIZE = 50

type SortCol = keyof ItemProdutoRow | null
type SortDir = "asc" | "desc"

const COLUNAS: Array<[keyof ItemProdutoRow, string, "left" | "right"]> = [
  ["dtEmissao", "Data", "left"],
  ["produtoCodigo", "Cód.", "left"],
  ["fornecedorNome", "Fornecedor", "left"],
  ["nrDanfe", "N° NF", "left"],
  ["itemDescricao", "Item", "left"],
  ["categoria", "Categoria", "left"],
  ["qEstoque", "Qtd estoque", "right"],
  ["unidadeMedida", "Unidade", "right"],
  ["vTotalEmbalagem", "V. total emb.", "right"],
  ["vCustoCompra", "Custo compra", "right"],
  ["vCustoTotal", "Custo total", "right"],
]

type Props = { unitId: string | null }

export function ProdutoTab({ unitId }: Props) {
  const [q, setQ] = useState("")
  const [categoria, setCategoria] = useState("")
  const [de, setDe] = useState("")
  const [ate, setAte] = useState("")
  const [page, setPage] = useState(0)
  const [sortCol, setSortCol] = useState<SortCol>("dtEmissao")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const [drawerItem, setDrawerItem] = useState<RankingItem | null>(null)
  const [historico, setHistorico] = useState<HistoricoRow[]>([])
  const [loadingHist, setLoadingHist] = useState(false)

  const { data: rows, loading } = useResource(String(unitId), () => getItensProdutoBusca(unitId), [])

  const categorias = useMemo(() =>
    [...new Set(rows.map(r => r.categoria).filter((c): c is string => Boolean(c)))].sort()
  , [rows])

  const filtered = useMemo(() => {
    let r = rows
    const termo = q.trim().toLowerCase()
    if (termo) {
      r = r.filter(x =>
        (x.itemDescricao ?? "").toLowerCase().includes(termo) ||
        (x.fornecedorNome ?? "").toLowerCase().includes(termo) ||
        (x.nrDanfe ?? "").toLowerCase().includes(termo) ||
        (x.produtoNome ?? "").toLowerCase().includes(termo) ||
        (x.produtoCodigo ?? "").toLowerCase().includes(termo)
      )
    }
    if (categoria) r = r.filter(x => (categoria === "__sem_categoria__" ? !x.categoria : x.categoria === categoria))
    if (de) r = r.filter(x => (x.dtEmissao ?? "") >= de)
    if (ate) r = r.filter(x => (x.dtEmissao ?? "") <= ate)
    if (sortCol) {
      r = [...r].sort((a, b) => {
        const av = a[sortCol] ?? ""
        const bv = b[sortCol] ?? ""
        if (av < bv) return sortDir === "asc" ? -1 : 1
        if (av > bv) return sortDir === "asc" ? 1 : -1
        return 0
      })
    }
    return r
  }, [rows, q, categoria, de, ate, sortCol, sortDir])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
    setPage(0)
  }

  async function openDrawer(item: ItemProdutoRow) {
    const rankingItem: RankingItem = {
      item_descricao: item.produtoNome ?? item.itemDescricao,
      item_codigo: item.itemCodigo,
      fornecedor_nome: item.fornecedorNome,
      desc_gerencial: item.categoria,
      unidade_medida: item.unidadeMedida,
      custo_total: 0, quantidade_total: 0, custo_medio: 0, variacao_media: null,
    }
    setDrawerItem(rankingItem)
    setHistorico([])
    if (!item.itemCodigo) return
    setLoadingHist(true)
    try {
      const h = await getHistoricoProduto(unitId, item.itemCodigo, item.produtoId)
      setHistorico(h)
    } finally {
      setLoadingHist(false)
    }
  }

  const totalVTotalEmb = filtered.reduce((s, r) => s + Math.abs(r.vTotalEmbalagem ?? 0), 0)
  const totalCustoTotal = filtered.reduce((s, r) => s + Math.abs(r.vCustoTotal ?? 0), 0)

  if (loading) {
    return <p style={{ padding: "48px 0", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Carregando itens…</p>
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Buscar item, fornecedor, NF ou produto do catálogo…"
          value={q}
          onChange={e => { setQ(e.target.value); setPage(0) }}
          style={{
            padding: "7px 12px", borderRadius: 8, fontSize: 12,
            background: "var(--surface)", color: "var(--text)",
            border: "1px solid var(--border)", minWidth: 260, flex: 1,
          }}
        />
        <select
          value={categoria}
          onChange={e => { setCategoria(e.target.value); setPage(0) }}
          style={{ padding: "7px 12px", borderRadius: 8, fontSize: 12, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", minWidth: 180 }}
        >
          <option value="">Todas as categorias</option>
          <option value="__sem_categoria__">Sem categoria</option>
          {categorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" value={de} onChange={e => { setDe(e.target.value); setPage(0) }}
          style={{ padding: "7px 10px", borderRadius: 8, fontSize: 12, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }} />
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>até</span>
        <input type="date" value={ate} onChange={e => { setAte(e.target.value); setPage(0) }}
          style={{ padding: "7px 10px", borderRadius: 8, fontSize: 12, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }} />
        <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>
          {filtered.length.toLocaleString("pt-BR")} item{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Tabela */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12,
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              {COLUNAS.map(([col, label, align]) => (
                <th key={col} onClick={() => handleSort(col)} style={{
                  padding: "8px 12px", textAlign: align,
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                  textTransform: "uppercase", color: "var(--text-3)",
                  borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                  cursor: "pointer", userSelect: "none",
                }}>
                  {label}{sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map(r => (
              <tr key={r.id} onClick={() => void openDrawer(r)} style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                <td style={{ padding: "7px 12px", color: "var(--text-3)", whiteSpace: "nowrap" }}>{fmtDate(r.dtEmissao)}</td>
                <td style={{ padding: "7px 12px", color: "var(--text)", fontWeight: 600, whiteSpace: "nowrap" }}>{r.produtoCodigo ?? "—"}</td>
                <td style={{ padding: "7px 12px", color: "var(--text)", fontWeight: 500, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.fornecedorNome ?? "—"}</td>
                <td style={{ padding: "7px 12px", color: "var(--text-3)", whiteSpace: "nowrap" }}>{r.nrDanfe ?? "—"}</td>
                <td style={{ padding: "7px 12px", color: "var(--text)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.itemDescricao ?? "—"}</td>
                <td style={{ padding: "7px 12px", color: "var(--text-3)", whiteSpace: "nowrap" }}>{r.categoria ?? "sem categoria"}</td>
                <td style={{ padding: "7px 12px", textAlign: "right", color: "var(--text)" }}>{fmtQty(r.qEstoque)}</td>
                <td style={{ padding: "7px 12px", textAlign: "right", color: "var(--text-3)" }}>{r.unidadeMedida ?? "—"}</td>
                <td style={{ padding: "7px 12px", textAlign: "right", color: "var(--text)" }}>{fmtBRL(r.vTotalEmbalagem)}</td>
                <td style={{ padding: "7px 12px", textAlign: "right", color: "var(--text)" }}>{fmtBRL(r.vCustoCompra)}</td>
                <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 600, color: "var(--text)" }}>{fmtBRL(r.vCustoTotal)}</td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr><td colSpan={COLUNAS.length} style={{ padding: "30px 12px", textAlign: "center", color: "var(--text-3)" }}>Nenhum item encontrado.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--border)", background: "var(--surface-2)" }}>
              <td colSpan={8} style={{ padding: "8px 12px", fontWeight: 700, color: "var(--text)", fontSize: 12 }}>Total filtrado</td>
              <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "var(--text)", fontSize: 12, whiteSpace: "nowrap" }}>{fmtBRL(totalVTotalEmb)}</td>
              <td />
              <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "var(--text)", fontSize: 12, whiteSpace: "nowrap" }}>{fmtBRL(totalCustoTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--text-3)" }}>
          <span>Página {page + 1} de {totalPages} · {filtered.length.toLocaleString("pt-BR")} itens</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setPage(0)} disabled={page === 0}
              style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, border: "1px solid var(--border)",
                background: "var(--surface)", color: page === 0 ? "var(--text-3)" : "var(--text)", cursor: page === 0 ? "default" : "pointer" }}>«</button>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, border: "1px solid var(--border)",
                background: "var(--surface)", color: page === 0 ? "var(--text-3)" : "var(--text)", cursor: page === 0 ? "default" : "pointer" }}>‹ Anterior</button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
              style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, border: "1px solid var(--border)",
                background: "var(--surface)", color: page === totalPages - 1 ? "var(--text-3)" : "var(--text)", cursor: page === totalPages - 1 ? "default" : "pointer" }}>Próximo ›</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page === totalPages - 1}
              style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, border: "1px solid var(--border)",
                background: "var(--surface)", color: page === totalPages - 1 ? "var(--text-3)" : "var(--text)", cursor: page === totalPages - 1 ? "default" : "pointer" }}>»</button>
          </div>
        </div>
      )}

      {drawerItem && (
        <HistoricoDrawer
          item={drawerItem}
          historico={historico}
          loading={loadingHist}
          onClose={() => { setDrawerItem(null); setHistorico([]) }}
        />
      )}
    </div>
  )
}
