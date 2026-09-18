"use client"

import React, { useMemo, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts"
import { useRouter } from "next/navigation"
import type { ProdutoRow } from "@/app/financeiro/dre/cmv/page"
import { getHistoricoProduto, getNotaCompleta } from "@/app/financeiro/dre/cmv/actions"
import type { HistoricoRow, RankingItem, NotaCompletaResultado, NotaItem } from "@/app/financeiro/dre/cmv/actions"
import { ImportModal } from "./ImportModal"
import { NfeImportModal } from "./NfeImportModal"
import { HistoricoDrawer, RankingTab } from "./RankingTab"
import { AnaliseTab } from "./AnaliseTab"
import { ARevisarTab, BonificacaoTab, FornecedorTab } from "./ProdutosExtraTabs"
import { CatalogoTab } from "./CatalogoTab"
import { ProdutoTab } from "./ProdutoTab"

// ── Formatters ─────────────────────────────────────────────────────────────────
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

const fmtDate = (value: string | null | undefined) => {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR").format(date)
}

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
const mesLabel = (m: number, a: number) => `${MESES[(m - 1) % 12]} ${a}`

// ── Types ──────────────────────────────────────────────────────────────────────
type SortDir = "asc" | "desc"
type SortCol = keyof ProdutoRow | null

type PrevRow = Pick<ProdutoRow, "id" | "v_custo_total" | "calcula_cmv" | "desc_gerencial">

type Props = {
  rows: ProdutoRow[]
  rowsPlanilha: ProdutoRow[]
  prevRows: PrevRow[]
  mes: number
  ano: number
  meses: { mes: number; ano: number }[]
  unitId: string | null
  q?: string
  direcao: "entrada" | "saida"
  totalDocumentos: number
}

const PAGE_SIZE = 50

// ── Main component ─────────────────────────────────────────────────────────────
export function ProdutosClient({ rows, rowsPlanilha, prevRows, mes, ano, meses, unitId, q = "", direcao, totalDocumentos }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<"tabela" | "ranking" | "cmv" | "analise" | "bonificacao" | "fornecedor" | "arevisar" | "planilha" | "catalogo" | "produto">(direcao === "entrada" ? "analise" : "tabela")
  const [showImport, setShowImport] = useState(false)
  const [showNfeImport, setShowNfeImport] = useState(false)
  const [tableDrawerItem, setTableDrawerItem] = useState<RankingItem | null>(null)
  const [tableHistorico, setTableHistorico] = useState<HistoricoRow[]>([])
  const [loadingTableHistorico, setLoadingTableHistorico] = useState(false)
  const [expandedChaves, setExpandedChaves] = useState<Set<string>>(new Set())
  const [notaDetalhes, setNotaDetalhes] = useState<Map<string, NotaCompletaResultado>>(new Map())
  const [loadingChaves, setLoadingChaves] = useState<Set<string>>(new Set())

  async function carregarDetalheNota(chaveNfe: string) {
    if (notaDetalhes.has(chaveNfe) || loadingChaves.has(chaveNfe)) return
    setLoadingChaves(prev => new Set(prev).add(chaveNfe))
    const r = await getNotaCompleta(chaveNfe)
    setNotaDetalhes(prev => new Map(prev).set(chaveNfe, r))
    setLoadingChaves(prev => { const next = new Set(prev); next.delete(chaveNfe); return next })
  }

  function toggleNota(chaveNfe: string) {
    setExpandedChaves(prev => {
      const next = new Set(prev)
      if (next.has(chaveNfe)) next.delete(chaveNfe)
      else next.add(chaveNfe)
      return next
    })
    void carregarDetalheNota(chaveNfe)
  }

  async function abrirHistoricoDoItem(item: NotaItem, fornecedorNomeFallback: string | null) {
    if (!item.itemCodigo) return
    const rankingItem: RankingItem = {
      item_codigo: item.itemCodigo,
      item_descricao: item.itemDescricao,
      fornecedor_nome: fornecedorNomeFallback,
      desc_gerencial: item.produtoNome,
      unidade_medida: item.unidade,
      custo_total: Number(item.valorTotal ?? 0),
      quantidade_total: Number(item.quantidade ?? 0),
      custo_medio: Number(item.valorUnitario ?? 0),
      variacao_media: null,
    }
    setTableDrawerItem(rankingItem)
    setTableHistorico([])
    setLoadingTableHistorico(true)
    try {
      setTableHistorico(await getHistoricoProduto(unitId, item.itemCodigo, item.produtoId))
    } finally {
      setLoadingTableHistorico(false)
    }
  }

  function irParaNota(chaveNfe: string) {
    setTab("tabela")
    setTableDrawerItem(null)
    setTableHistorico([])
    setExpandedChaves(prev => new Set(prev).add(chaveNfe))
    void carregarDetalheNota(chaveNfe)
    const idx = filtered.findIndex(n => n.chaveNfe === chaveNfe)
    if (idx >= 0) setPage(Math.floor(idx / PAGE_SIZE))
  }

  // ── Tabela filters (agora agrupado por nota, não por item) ───────────────────
  const [localQ, setLocalQ] = useState(q)

  const [filterCat, setFilterCat] = useState("")
  const [filterCmv, setFilterCmv] = useState<"all" | "cmv" | "no_cmv">("all")
  const [page, setPage] = useState(0)

  const categorias = useMemo(() =>
    [...new Set(rows.map(r => r.desc_gerencial).filter(Boolean))].sort() as string[]
  , [rows])

  type NotaAgrupada = {
    chaveNfe: string
    dtEmissao: string | null
    nrDanfe: string | null
    fornecedorNome: string | null
    itens: ProdutoRow[]
    qtdItens: number
    valorTotal: number
  }

  const notasAgrupadas = useMemo<NotaAgrupada[]>(() => {
    const map = new Map<string, NotaAgrupada>()
    for (const r of rows) {
      if (!r.chave_nfe) continue
      let g = map.get(r.chave_nfe)
      if (!g) {
        g = {
          chaveNfe: r.chave_nfe, dtEmissao: r.dt_emissao, nrDanfe: r.nr_danfe,
          fornecedorNome: r.fornecedor_nome, itens: [], qtdItens: 0, valorTotal: 0,
        }
        map.set(r.chave_nfe, g)
      }
      g.itens.push(r)
      g.qtdItens += 1
      g.valorTotal += Math.abs(r.v_total_embalagem ?? 0)
    }
    return [...map.values()]
  }, [rows])

  const filtered = (() => {
    let n = notasAgrupadas
    if (localQ.trim()) {
      const busca = localQ.toLowerCase()
      n = n.filter(nota =>
        (nota.fornecedorNome ?? "").toLowerCase().includes(busca) ||
        (nota.nrDanfe ?? "").toLowerCase().includes(busca) ||
        nota.itens.some(item => (item.item_descricao ?? "").toLowerCase().includes(busca))
      )
    }
    if (filterCat) n = n.filter(nota => nota.itens.some(item => item.desc_gerencial === filterCat))
    if (filterCmv === "cmv")    n = n.filter(nota => nota.itens.some(item => item.calcula_cmv === true))
    if (filterCmv === "no_cmv") n = n.filter(nota => nota.itens.some(item => item.calcula_cmv !== true))
    // Padrão: data desc — a compra mais recente primeiro.
    return [...n].sort((a, b) => (b.dtEmissao ?? "").localeCompare(a.dtEmissao ?? ""))
  })()

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageNotas  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function handleFilterChange() { setPage(0) }

  // ── Planilha filters (linhas sem chave_nfe, item_codigo é hash) ──────────────
  const [localQPlanilha, setLocalQPlanilha] = useState("")
  const [filterCatPlanilha, setFilterCatPlanilha] = useState("")
  const [filterCmvPlanilha, setFilterCmvPlanilha] = useState<"all" | "cmv" | "no_cmv">("all")
  const [pagePlanilha, setPagePlanilha] = useState(0)
  const [sortColPlanilha, setSortColPlanilha] = useState<SortCol>("fornecedor_nome")
  const [sortDirPlanilha, setSortDirPlanilha] = useState<SortDir>("asc")

  const categoriasPlanilha = useMemo(() =>
    [...new Set(rowsPlanilha.map(r => r.desc_gerencial).filter(Boolean))].sort() as string[]
  , [rowsPlanilha])

  const filteredPlanilha = useMemo(() => {
    let r = rowsPlanilha
    if (localQPlanilha.trim())
      r = r.filter(x =>
        (x.fornecedor_nome ?? "").toLowerCase().includes(localQPlanilha.toLowerCase()) ||
        (x.item_descricao ?? "").toLowerCase().includes(localQPlanilha.toLowerCase()) ||
        (x.nr_danfe ?? "").toLowerCase().includes(localQPlanilha.toLowerCase())
      )
    if (filterCatPlanilha) r = r.filter(x => x.desc_gerencial === filterCatPlanilha)
    if (filterCmvPlanilha === "cmv")    r = r.filter(x => x.calcula_cmv === true)
    if (filterCmvPlanilha === "no_cmv") r = r.filter(x => x.calcula_cmv !== true)
    if (sortColPlanilha) {
      r = [...r].sort((a, b) => {
        const av = a[sortColPlanilha] ?? ""
        const bv = b[sortColPlanilha] ?? ""
        if (av < bv) return sortDirPlanilha === "asc" ? -1 : 1
        if (av > bv) return sortDirPlanilha === "asc" ? 1 : -1
        return 0
      })
    }
    return r
  }, [rowsPlanilha, localQPlanilha, filterCatPlanilha, filterCmvPlanilha, sortColPlanilha, sortDirPlanilha])

  const totalPagesPlanilha = Math.ceil(filteredPlanilha.length / PAGE_SIZE)
  const pageRowsPlanilha   = filteredPlanilha.slice(pagePlanilha * PAGE_SIZE, (pagePlanilha + 1) * PAGE_SIZE)

  function handleSortPlanilha(col: SortCol) {
    if (sortColPlanilha === col) setSortDirPlanilha(d => d === "asc" ? "desc" : "asc")
    else { setSortColPlanilha(col); setSortDirPlanilha("asc") }
    setPagePlanilha(0)
  }

  function handleFilterChangePlanilha() { setPagePlanilha(0) }

  // ── CMV data ────────────────────────────────────────────────────────────────
  const cmvRows = useMemo(() => rows.filter(r => r.calcula_cmv === true), [rows])
  const totalCmv     = cmvRows.reduce((s, r) => s + Math.abs(r.v_custo_total ?? 0), 0)
  const prevCmvRows = useMemo(() => prevRows.filter(r => r.calcula_cmv === true), [prevRows])
  const prevTotalCmv = prevCmvRows.reduce((s, r) => s + Math.abs(r.v_custo_total ?? 0), 0)
  const cmvVarPct    = prevTotalCmv > 0 ? (totalCmv - prevTotalCmv) / prevTotalCmv * 100 : null

  const cmvByCat = (() => {
    const map = new Map<string, number>()
    for (const r of cmvRows) {
      const cat = r.desc_gerencial ?? "Sem categoria"
      map.set(cat, (map.get(cat) ?? 0) + Math.abs(r.v_custo_total ?? 0))
    }
    return [...map.entries()]
      .map(([cat, total]) => ({ cat, total }))
      .sort((a, b) => b.total - a.total)
  })()

  const top10Chart = cmvByCat.slice(0, 10).map(d => ({
    name: d.cat.length > 22 ? d.cat.slice(0, 20) + "…" : d.cat,
    fullName: d.cat,
    total: d.total,
  }))

  const prevCmvByCat = (() => {
    const map = new Map<string, number>()
    for (const r of prevCmvRows) {
      const cat = r.desc_gerencial ?? "Sem categoria"
      map.set(cat, (map.get(cat) ?? 0) + Math.abs(r.v_custo_total ?? 0))
    }
    return map
  })()

  const hasData       = rows.length > 0 || rowsPlanilha.length > 0
  const totalComprado = rows.reduce((s, r) => s + Math.abs(r.v_total_embalagem ?? 0), 0)
  const fornUnicos    = new Set(rows.map(r => r.fornecedor_nome).filter(Boolean)).size

  return (
    <>
      {/* ── Header ── */}
      <header style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between",
        gap:16, margin:"10px 0 20px", flexWrap:"wrap" }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:700, color:"var(--text)",
            letterSpacing:-0.5, margin:"0 0 4px" }}>
            NF-e {direcao === "entrada" ? "Entrada" : "Saída"}
          </h1>
          <p style={{ fontSize:13, color:"var(--text-3)", margin:0 }}>
            {direcao === "entrada" ? "Compras recebidas e CMV" : "Vendas emitidas"} por item · {mesLabel(mes, ano)}
            {rows.length > 0 && ` · ${rows.length.toLocaleString("pt-BR")} itens`}
          </p>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          {/* Month selector */}
          {meses.length > 0 && (
            <select
              value={`${ano}-${mes}`}
              onChange={e => {
                const [a, m] = e.target.value.split("-")
                const params = new URLSearchParams()
                if (localQ) params.set("q", localQ)
                params.set("mes", m!)
                params.set("ano", a!)
                const pathname = direcao === "entrada" ? "/financeiro/dre/cmv" : "/financeiro/dre/nfe-saida"
                router.push(`${pathname}?${params.toString()}`)
              }}
              style={{
                padding:"7px 12px", borderRadius:8, fontSize:12, fontWeight:500,
                background:"var(--surface)", color:"var(--text)",
                border:"1px solid var(--border)", cursor:"pointer",
              }}
            >
              {meses.map(({ mes: m, ano: a }) => (
                <option key={`${a}-${m}`} value={`${a}-${m}`}>{mesLabel(m, a)}</option>
              ))}
            </select>
          )}
          {/* Import button */}
          <button
            onClick={() => setShowNfeImport(true)}
            style={{
              padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:700,
              background:"var(--surface)", color:"var(--text)",
              border:"1px solid var(--border)", cursor:"pointer",
            }}
          >
            ↑ Importar NF-e {direcao === "entrada" ? "Entrada" : "Saída"}
          </button>
          <button
            onClick={() => setShowImport(true)}
            style={{
              padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:700,
              background:"var(--brand, #C4622D)", color:"var(--primary-foreground)",
              border:"none", cursor:"pointer",
            }}
          >
            ↑ Importar Excel
          </button>
        </div>
      </header>

      {/* ── Summary KPIs ── */}
      {hasData && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:12, marginBottom:20 }}>
          {([
            { label:direcao === "entrada" ? "Total Comprado" : "Total Emitido", value: fmtBRL(direcao === "entrada" ? totalComprado : totalDocumentos), sub: mesLabel(mes, ano) },
            { label:direcao === "entrada" ? "Itens CMV" : "Itens de Saída", value: (direcao === "entrada" ? cmvRows.length : rows.length).toLocaleString("pt-BR"), sub: `de ${rows.length.toLocaleString("pt-BR")} itens` },
            { label:"Fornecedores",    value: fornUnicos.toLocaleString("pt-BR"),            sub: "únicos no mês" },
          ]).map(({ label, value, sub }) => (
            <div key={label} style={{
              background:"var(--surface)", border:"1px solid var(--border)",
              borderRadius:10, padding:"14px 16px",
            }}>
              <p style={{ fontSize:10, fontWeight:700, letterSpacing:0.8, textTransform:"uppercase",
                color:"var(--text-3)", margin:0 }}>{label}</p>
              <p style={{ fontSize:20, fontWeight:700, color:"var(--text)", margin:"4px 0 0" }}>{value}</p>
              <p style={{ fontSize:11, color:"var(--text-3)", margin:0 }}>{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab nav ── */}
      <nav style={{ display:"flex", gap:2, borderBottom:"1px solid var(--border)", marginBottom:24 }}>
        {(["analise", "cmv", "ranking", "tabela", "bonificacao", "fornecedor", "arevisar", "planilha", "catalogo", "produto"] as const).map(t => {
          const labels = { tabela: "Tabela", ranking: "Ranking", cmv: "CMV", analise: "Análise", bonificacao: "Bonificação", fornecedor: "Fornecedor", arevisar: "A Revisar", planilha: "Planilha", catalogo: "Catálogo", produto: "Produto" }
          if (direcao === "saida" && t !== "tabela") return null
          const active = tab === t
          return (
            <button key={t} onClick={() => setTab(t)} style={{
              padding:"8px 18px", fontSize:13, fontWeight:active?700:500,
              color:active?"var(--text)":"var(--text-3)",
              borderBottom:active?"2px solid var(--brand, #C4622D)":"2px solid transparent",
              borderTop:"none", borderRight:"none", borderLeft:"none",
              background:"transparent", cursor:"pointer",
              whiteSpace:"nowrap", marginBottom:-1,
            }}>
              {labels[t]}
            </button>
          )
        })}
      </nav>

      {/* ── Empty state ── */}
      {!hasData && (
        <div style={{ padding:"48px 24px", textAlign:"center",
          background:"var(--surface)", border:"1px dashed var(--border)", borderRadius:14 }}>
          <p style={{ fontSize:14, color:"var(--text-3)", marginBottom:8 }}>
            Nenhum dado para {mesLabel(mes, ano)}.
          </p>
          <p style={{ fontSize:12, color:"var(--text-3)" }}>
            Importe o Excel de Relatório de Produtos para este mês.
          </p>
          <button onClick={() => setShowImport(true)} style={{
            marginTop:16, padding:"9px 20px", borderRadius:8, fontSize:13,
            fontWeight:700, background:"var(--brand, #C4622D)", color:"var(--primary-foreground)",
            border:"none", cursor:"pointer",
          }}>
            ↑ Importar Excel
          </button>
        </div>
      )}

      {/* ── Tabela tab (uma linha por NOTA, itens em dropdown inline) ── */}
      {hasData && tab === "tabela" && (
        <div style={{ display:"grid", gap:16 }}>
          {/* Filters */}
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
            <input
              placeholder="Buscar NF, fornecedor ou item…"
              value={localQ}
              onChange={e => { setLocalQ(e.target.value); setPage(0) }}
              style={{
                padding:"7px 12px", borderRadius:8, fontSize:12,
                background:"var(--surface)", color:"var(--text)",
                border:"1px solid var(--border)", minWidth:220, flex:1,
              }}
            />
            <select
              value={filterCat}
              onChange={e => { setFilterCat(e.target.value); handleFilterChange() }}
              style={{
                padding:"7px 12px", borderRadius:8, fontSize:12,
                background:"var(--surface)", color:"var(--text)",
                border:"1px solid var(--border)", minWidth:180,
              }}
            >
              <option value="">Todas as categorias</option>
              {categorias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div style={{ display:"flex", borderRadius:8, border:"1px solid var(--border)", overflow:"hidden" }}>
              {([["all","Todos"],["cmv","CMV"],["no_cmv","Sem CMV"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => { setFilterCmv(v); handleFilterChange() }} style={{
                  padding:"7px 14px", fontSize:12, fontWeight:filterCmv===v?700:500,
                  background:filterCmv===v?"var(--brand, #C4622D)":"var(--surface)",
                  color:filterCmv===v?"var(--primary-foreground)":"var(--text-3)",
                  border:"none", cursor:"pointer", whiteSpace:"nowrap",
                }}>{label}</button>
              ))}
            </div>
            <span style={{ fontSize:11, color:"var(--text-3)", marginLeft:"auto" }}>
              {filtered.length.toLocaleString("pt-BR")} nota{filtered.length!==1?"s":""}
            </span>
          </div>

          {/* Table */}
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12,
              background:"var(--surface)", border:"1px solid var(--border)", borderRadius:10 }}>
              <thead>
                <tr style={{ background:"var(--surface-2)" }}>
                  {([
                    ["", "left", 32],
                    ["Data", "left", undefined],
                    ["Número NF", "left", undefined],
                    ["Fornecedor", "left", undefined],
                    ["Qtd Itens", "right", undefined],
                    ["Valor Total", "right", undefined],
                  ] as [string, "left"|"right", number|undefined][]).map(([label, align, width], i) => (
                    <th key={i} style={{
                      padding:"8px 12px", textAlign:align, width,
                      fontSize:10, fontWeight:700, letterSpacing:0.4,
                      textTransform:"uppercase", color:"var(--text-3)",
                      borderBottom:"1px solid var(--border)", whiteSpace:"nowrap",
                    }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageNotas.map(nota => {
                  const expandida = expandedChaves.has(nota.chaveNfe)
                  const detalhe = notaDetalhes.get(nota.chaveNfe)
                  const carregando = loadingChaves.has(nota.chaveNfe)
                  return (
                    <React.Fragment key={nota.chaveNfe}>
                      <tr
                        onClick={() => toggleNota(nota.chaveNfe)}
                        style={{ borderTop:"1px solid var(--border)", cursor:"pointer" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-2)" }}
                        onMouseLeave={e => { e.currentTarget.style.background = "" }}
                      >
                        <td style={{ padding:"7px 12px", textAlign:"center", color:"var(--text-3)" }}>
                          {expandida ? "▾" : "▸"}
                        </td>
                        <td style={{ padding:"7px 12px", color:"var(--text-3)", whiteSpace:"nowrap" }}>
                          {fmtDate(nota.dtEmissao)}
                        </td>
                        <td style={{ padding:"7px 12px", color:"var(--text)", fontWeight:600, whiteSpace:"nowrap" }}>
                          {nota.nrDanfe ?? "—"}
                        </td>
                        <td style={{ padding:"7px 12px", color:"var(--text)", fontWeight:500, maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {nota.fornecedorNome ?? "—"}
                        </td>
                        <td style={{ padding:"7px 12px", textAlign:"right", color:"var(--text)" }}>
                          {nota.qtdItens}
                        </td>
                        <td style={{ padding:"7px 12px", textAlign:"right", fontWeight:600, color:"var(--text)" }}>
                          {fmtBRL(nota.valorTotal)}
                        </td>
                      </tr>
                      {expandida && (
                        <tr>
                          <td colSpan={6} style={{ padding:0, background:"var(--surface-2)", borderTop:"1px solid var(--border)" }}>
                            {carregando ? (
                              <p style={{ padding:"16px 20px", textAlign:"center", color:"var(--text-3)", fontSize:12 }}>
                                Carregando itens…
                              </p>
                            ) : (
                              <div style={{ padding:"10px 16px 14px" }}>
                                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                                  <thead>
                                    <tr>
                                      {([
                                        ["Código","left"], ["Descrição","left"], ["Produto do catálogo","left"],
                                        ["NCM","left"], ["Unid.","right"], ["Qtd","right"],
                                        ["Vlr Unit.","right"], ["Vlr Total","right"],
                                      ] as [string, "left"|"right"][]).map(([label, align]) => (
                                        <th key={label} style={{
                                          padding:"6px 10px", textAlign:align,
                                          fontSize:9, fontWeight:700, letterSpacing:0.4,
                                          textTransform:"uppercase", color:"var(--text-3)",
                                          borderBottom:"1px solid var(--border)", whiteSpace:"nowrap",
                                        }}>
                                          {label}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(detalhe?.itens ?? []).map((item, i) => (
                                      <tr key={i}
                                        onClick={() => void abrirHistoricoDoItem(item, detalhe?.nota?.emitenteNome ?? nota.fornecedorNome)}
                                        style={{ borderTop:"1px solid var(--border)", cursor: item.itemCodigo ? "pointer" : "default" }}
                                        onMouseEnter={e => { if (item.itemCodigo) e.currentTarget.style.background = "var(--surface)" }}
                                        onMouseLeave={e => { e.currentTarget.style.background = "" }}
                                      >
                                        <td style={{ padding:"6px 10px", color:"var(--text-3)", whiteSpace:"nowrap" }}>
                                          {item.itemCodigo ?? "—"}
                                        </td>
                                        <td style={{ padding:"6px 10px", color:"var(--text)", maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                          {item.itemDescricao ?? "—"}
                                        </td>
                                        <td style={{ padding:"6px 10px", whiteSpace:"nowrap" }}>
                                          {item.produtoCodigo
                                            ? <span style={{ color:"var(--text)" }}><strong>{item.produtoCodigo}</strong> {item.produtoNome}</span>
                                            : <span style={{ color:"var(--text-3)", fontStyle:"italic" }}>sem produto</span>
                                          }
                                        </td>
                                        <td style={{ padding:"6px 10px", color:"var(--text-3)", whiteSpace:"nowrap" }}>
                                          {item.ncm ?? "—"}
                                        </td>
                                        <td style={{ padding:"6px 10px", textAlign:"right", color:"var(--text-3)" }}>
                                          {item.unidade ?? "—"}
                                        </td>
                                        <td style={{ padding:"6px 10px", textAlign:"right", color:"var(--text)" }}>
                                          {fmtQty(item.quantidade)}
                                        </td>
                                        <td style={{ padding:"6px 10px", textAlign:"right", color:"var(--text)" }}>
                                          {fmtBRL(item.valorUnitario)}
                                        </td>
                                        <td style={{ padding:"6px 10px", textAlign:"right", fontWeight:600, color:"var(--text)" }}>
                                          {fmtBRL(item.valorTotal)}
                                        </td>
                                      </tr>
                                    ))}
                                    {(detalhe?.itens ?? []).length === 0 && (
                                      <tr>
                                        <td colSpan={8} style={{ padding:"12px", textAlign:"center", color:"var(--text-3)" }}>
                                          Nenhum item encontrado para esta nota.
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop:"2px solid var(--border)", background:"var(--surface-2)" }}>
                  <td colSpan={4} style={{ padding:"8px 12px", fontWeight:700, color:"var(--text)", fontSize:12 }}>
                    {filterCat ? `Total ${filterCat}` : "Total geral"}
                  </td>
                  <td style={{ padding:"8px 12px", textAlign:"right", fontWeight:700, color:"var(--text)", fontSize:12 }}>
                    {filtered.reduce((s, n) => s + n.qtdItens, 0)}
                  </td>
                  <td style={{ padding:"8px 12px", textAlign:"right", fontWeight:700, color:"var(--text)", fontSize:12, whiteSpace:"nowrap" }}>
                    {fmtBRL(filtered.reduce((s, n) => s + n.valorTotal, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:12, color:"var(--text-3)" }}>
              <span>
                Página {page + 1} de {totalPages} · {filtered.length.toLocaleString("pt-BR")} notas
              </span>
              <div style={{ display:"flex", gap:4 }}>
                <button onClick={() => setPage(0)} disabled={page===0}
                  style={{ padding:"5px 10px",borderRadius:6,fontSize:11,border:"1px solid var(--border)",
                    background:"var(--surface)",color:page===0?"var(--text-3)":"var(--text)",cursor:page===0?"default":"pointer" }}>
                  «
                </button>
                <button onClick={() => setPage(p => Math.max(0, p-1))} disabled={page===0}
                  style={{ padding:"5px 10px",borderRadius:6,fontSize:11,border:"1px solid var(--border)",
                    background:"var(--surface)",color:page===0?"var(--text-3)":"var(--text)",cursor:page===0?"default":"pointer" }}>
                  ‹ Anterior
                </button>
                <button onClick={() => setPage(p => Math.min(totalPages-1, p+1))} disabled={page===totalPages-1}
                  style={{ padding:"5px 10px",borderRadius:6,fontSize:11,border:"1px solid var(--border)",
                    background:"var(--surface)",color:page===totalPages-1?"var(--text-3)":"var(--text)",cursor:page===totalPages-1?"default":"pointer" }}>
                  Próximo ›
                </button>
                <button onClick={() => setPage(totalPages-1)} disabled={page===totalPages-1}
                  style={{ padding:"5px 10px",borderRadius:6,fontSize:11,border:"1px solid var(--border)",
                    background:"var(--surface)",color:page===totalPages-1?"var(--text-3)":"var(--text)",cursor:page===totalPages-1?"default":"pointer" }}>
                  »
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Planilha tab (linhas sem chave_nfe — importação por Excel) ── */}
      {hasData && tab === "planilha" && (
        <div style={{ display:"grid", gap:16 }}>
          {/* Filters */}
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
            <input
              placeholder="Buscar NF, fornecedor ou item…"
              value={localQPlanilha}
              onChange={e => { setLocalQPlanilha(e.target.value); setPagePlanilha(0) }}
              style={{
                padding:"7px 12px", borderRadius:8, fontSize:12,
                background:"var(--surface)", color:"var(--text)",
                border:"1px solid var(--border)", minWidth:220, flex:1,
              }}
            />
            <select
              value={filterCatPlanilha}
              onChange={e => { setFilterCatPlanilha(e.target.value); handleFilterChangePlanilha() }}
              style={{
                padding:"7px 12px", borderRadius:8, fontSize:12,
                background:"var(--surface)", color:"var(--text)",
                border:"1px solid var(--border)", minWidth:180,
              }}
            >
              <option value="">Todas as categorias</option>
              {categoriasPlanilha.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div style={{ display:"flex", borderRadius:8, border:"1px solid var(--border)", overflow:"hidden" }}>
              {([["all","Todos"],["cmv","CMV"],["no_cmv","Sem CMV"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => { setFilterCmvPlanilha(v); handleFilterChangePlanilha() }} style={{
                  padding:"7px 14px", fontSize:12, fontWeight:filterCmvPlanilha===v?700:500,
                  background:filterCmvPlanilha===v?"var(--brand, #C4622D)":"var(--surface)",
                  color:filterCmvPlanilha===v?"var(--primary-foreground)":"var(--text-3)",
                  border:"none", cursor:"pointer", whiteSpace:"nowrap",
                }}>{label}</button>
              ))}
            </div>
            <span style={{ fontSize:11, color:"var(--text-3)", marginLeft:"auto" }}>
              {filteredPlanilha.length.toLocaleString("pt-BR")} item{filteredPlanilha.length!==1?"s":""}
            </span>
          </div>

          {/* Table */}
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12,
              background:"var(--surface)", border:"1px solid var(--border)", borderRadius:10 }}>
              <thead>
                <tr style={{ background:"var(--surface-2)" }}>
                  {([
                    ["dt_emissao","Data","left"],
                    ["nr_danfe","Número NF","left"],
                    ["fornecedor_nome","Fornecedor","left"],
                    ["item_descricao","Item","left"],
                    ["desc_gerencial","Categoria","left"],
                    ["q_estoque","Qtd Estoque","right"],
                    ["unidade_medida","Unidade","right"],
                    ["v_total_embalagem","V. Total Emb.","right"],
                    ["v_custo_medio","Custo Médio","right"],
                    ["v_custo_compra","Custo Compra","right"],
                    ["v_custo_total","Custo Total","right"],
                    ["perc_variacao","% Variação","right"],
                    ["calcula_cmv","CMV","right"],
                  ] as [keyof ProdutoRow, string, string][]).map(([col, label, align]) => (
                    <th key={col} onClick={() => handleSortPlanilha(col)} style={{
                      padding:"8px 12px", textAlign:align as "left"|"right",
                      fontSize:10, fontWeight:700, letterSpacing:0.4,
                      textTransform:"uppercase", color:"var(--text-3)",
                      borderBottom:"1px solid var(--border)", whiteSpace:"nowrap",
                      cursor:"pointer", userSelect:"none",
                    }}>
                      {label}{sortColPlanilha===col ? (sortDirPlanilha==="asc"?" ↑":" ↓") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRowsPlanilha.map(r => (
                  <tr key={r.id} style={{ borderTop:"1px solid var(--border)", cursor:"default" }}>
                    <td style={{ padding:"7px 12px", color:"var(--text-3)", whiteSpace:"nowrap" }}>
                      {fmtDate(r.dt_emissao)}
                    </td>
                    <td style={{ padding:"7px 12px", color:"var(--text)", fontWeight:600, whiteSpace:"nowrap" }}>
                      {r.nr_danfe ?? "—"}
                    </td>
                    <td style={{ padding:"7px 12px", color:"var(--text)", fontWeight:500, maxWidth:160, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {r.fornecedor_nome ?? "—"}
                    </td>
                    <td style={{ padding:"7px 12px", color:"var(--text)", maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {r.item_descricao ?? "—"}
                    </td>
                    <td style={{ padding:"7px 12px", color:"var(--text-3)", whiteSpace:"nowrap" }}>
                      {r.desc_gerencial ?? "—"}
                    </td>
                    <td style={{ padding:"7px 12px", textAlign:"right", color:"var(--text)" }}>
                      {fmtQty(r.q_estoque)}
                    </td>
                    <td style={{ padding:"7px 12px", textAlign:"right", color:"var(--text-3)" }}>
                      {r.unidade_medida ?? "—"}
                    </td>
                    <td style={{ padding:"7px 12px", textAlign:"right", color:"var(--text)" }}>
                      {fmtBRL(r.v_total_embalagem)}
                    </td>
                    <td style={{ padding:"7px 12px", textAlign:"right", color:"var(--text)" }}>
                      {fmtBRL(r.v_custo_medio)}
                    </td>
                    <td style={{ padding:"7px 12px", textAlign:"right", color:"var(--text)" }}>
                      {fmtBRL(r.v_custo_compra)}
                    </td>
                    <td style={{ padding:"7px 12px", textAlign:"right", fontWeight:600, color:"var(--text)" }}>
                      {fmtBRL(r.v_custo_total)}
                    </td>
                    <td style={{ padding:"7px 12px", textAlign:"right",
                      color:r.perc_variacao==null?"var(--text-3)":r.perc_variacao>0?"#EF4444":"#22C55E" }}>
                      {fmtPct(r.perc_variacao)}
                    </td>
                    <td style={{ padding:"7px 12px", textAlign:"right" }}>
                      {r.calcula_cmv === true
                        ? <span style={{ fontSize:10,fontWeight:700,color:"#22C55E",background:"rgba(34,197,94,0.12)",padding:"2px 8px",borderRadius:99 }}>SIM</span>
                        : <span style={{ fontSize:10,color:"var(--text-3)" }}>NÃO</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop:"2px solid var(--border)", background:"var(--surface-2)" }}>
                  <td colSpan={7} style={{ padding:"8px 12px", fontWeight:700, color:"var(--text)", fontSize:12 }}>
                    {filterCatPlanilha ? `Total ${filterCatPlanilha}` : "Total geral"}
                  </td>
                  <td style={{ padding:"8px 12px", textAlign:"right", fontWeight:700, color:"var(--text)", fontSize:12, whiteSpace:"nowrap" }}>
                    {fmtBRL(filteredPlanilha.reduce((s, r) => s + Math.abs(r.v_total_embalagem ?? 0), 0))}
                  </td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Pagination */}
          {totalPagesPlanilha > 1 && (
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:12, color:"var(--text-3)" }}>
              <span>
                Página {pagePlanilha + 1} de {totalPagesPlanilha} · {filteredPlanilha.length.toLocaleString("pt-BR")} itens
              </span>
              <div style={{ display:"flex", gap:4 }}>
                <button onClick={() => setPagePlanilha(0)} disabled={pagePlanilha===0}
                  style={{ padding:"5px 10px",borderRadius:6,fontSize:11,border:"1px solid var(--border)",
                    background:"var(--surface)",color:pagePlanilha===0?"var(--text-3)":"var(--text)",cursor:pagePlanilha===0?"default":"pointer" }}>
                  «
                </button>
                <button onClick={() => setPagePlanilha(p => Math.max(0, p-1))} disabled={pagePlanilha===0}
                  style={{ padding:"5px 10px",borderRadius:6,fontSize:11,border:"1px solid var(--border)",
                    background:"var(--surface)",color:pagePlanilha===0?"var(--text-3)":"var(--text)",cursor:pagePlanilha===0?"default":"pointer" }}>
                  ‹ Anterior
                </button>
                <button onClick={() => setPagePlanilha(p => Math.min(totalPagesPlanilha-1, p+1))} disabled={pagePlanilha===totalPagesPlanilha-1}
                  style={{ padding:"5px 10px",borderRadius:6,fontSize:11,border:"1px solid var(--border)",
                    background:"var(--surface)",color:pagePlanilha===totalPagesPlanilha-1?"var(--text-3)":"var(--text)",cursor:pagePlanilha===totalPagesPlanilha-1?"default":"pointer" }}>
                  Próximo ›
                </button>
                <button onClick={() => setPagePlanilha(totalPagesPlanilha-1)} disabled={pagePlanilha===totalPagesPlanilha-1}
                  style={{ padding:"5px 10px",borderRadius:6,fontSize:11,border:"1px solid var(--border)",
                    background:"var(--surface)",color:pagePlanilha===totalPagesPlanilha-1?"var(--text-3)":"var(--text)",cursor:pagePlanilha===totalPagesPlanilha-1?"default":"pointer" }}>
                  »
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Catálogo tab (de-para de fornecedor) ── */}
      {hasData && tab === "catalogo" && <CatalogoTab />}

      {hasData && tab === "produto" && <ProdutoTab unitId={unitId} />}

      {/* ── Ranking tab ── */}
      {hasData && tab === "ranking" && (
        <RankingTab unitId={unitId} mes={mes} ano={ano} />
      )}

      {/* ── Análise tab (variação de preço por compra, histórico completo) ── */}
      {hasData && tab === "analise" && (
        <AnaliseTab unitId={unitId} onSelecionarNota={irParaNota} />
      )}

      {/* ── CMV tab ── */}
      {hasData && tab === "cmv" && (
        <div style={{ display:"grid", gap:24 }}>
          {/* KPIs */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:12 }}>
            {[
              {
                label:"Total CMV do Mês",
                value: fmtBRLc(totalCmv),
                sub: mesLabel(mes, ano),
                color: undefined,
              },
              {
                label:"Itens com CMV",
                value: cmvRows.length.toLocaleString("pt-BR"),
                sub: `de ${rows.length.toLocaleString("pt-BR")} itens`,
                color: "#22C55E",
              },
              {
                label:"Variação vs mês anterior",
                value: cmvVarPct != null ? fmtPct(cmvVarPct) : "—",
                sub: prevTotalCmv > 0 ? `Anterior: ${fmtBRLc(prevTotalCmv)}` : "Sem dados anteriores",
                color: cmvVarPct == null ? undefined : cmvVarPct > 0 ? "#EF4444" : "#22C55E",
              },
            ].map(({ label, value, sub, color }) => (
              <div key={label} style={{
                background:"var(--surface)", border:"1px solid var(--border)",
                borderRadius:10, padding:"14px 16px",
              }}>
                <p style={{ fontSize:10,fontWeight:700,letterSpacing:0.8,textTransform:"uppercase",
                  color:"var(--text-3)",margin:0 }}>{label}</p>
                <p style={{ fontSize:22,fontWeight:700,color:color??"var(--text)",margin:"4px 0 0" }}>
                  {value}
                </p>
                <p style={{ fontSize:11, color:"var(--text-3)", margin:0 }}>{sub}</p>
              </div>
            ))}
          </div>

          {/* Bar chart */}
          {top10Chart.length === 1 && (
            <div style={{
              background:"var(--surface)", border:"1px solid var(--border)",
              borderRadius:10, padding:"18px 20px",
            }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:16 }}>
                <div>
                  <p style={{ fontSize:10,fontWeight:700,letterSpacing:0.8,textTransform:"uppercase",
                    color:"var(--text-3)",margin:"0 0 6px" }}>CMV por categoria</p>
                  <p style={{ fontSize:14,fontWeight:650,color:"var(--text)",margin:0 }}>
                    {top10Chart[0]!.fullName}
                  </p>
                  {top10Chart[0]!.fullName.startsWith("NF-e sem classifica") && (
                    <p style={{ fontSize:11,color:"var(--text-3)",margin:"5px 0 0" }}>
                      Classifique os itens para visualizar a distribuição por categoria.
                    </p>
                  )}
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <p style={{ fontSize:18,fontWeight:750,color:"var(--text)",margin:0 }}>
                    {fmtBRL(top10Chart[0]!.total)}
                  </p>
                  <p style={{ fontSize:11,color:"var(--text-3)",margin:"3px 0 0" }}>100% do CMV</p>
                </div>
              </div>
              <div style={{ height:6,background:"var(--surface-2)",borderRadius:999,marginTop:16,overflow:"hidden" }}>
                <div style={{ width:"100%",height:"100%",background:"var(--brand, #C4622D)",borderRadius:999 }} />
              </div>
            </div>
          )}
          {top10Chart.length > 1 && (
            <div style={{ background:"var(--surface)", border:"1px solid var(--border)",
              borderRadius:10, padding:"16px 20px" }}>
              <p style={{ fontSize:10,fontWeight:700,letterSpacing:0.8,textTransform:"uppercase",
                color:"var(--text-3)",margin:"0 0 16px" }}>
                CMV por Categoria — Top 10
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={top10Chart} margin={{ top:0, right:0, left:0, bottom:60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" fill="transparent" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize:10, fill:"var(--text-3)" }}
                    angle={-40} textAnchor="end" interval={0} />
                  <YAxis tickFormatter={v => fmtBRLc(v)} tick={{ fontSize:10, fill:"var(--text-3)" }} width={80} />
                  <Tooltip
                    formatter={(v) => [fmtBRL(Number(v)), "CMV"]}
                    labelFormatter={(_,p) => p?.[0]?.payload?.fullName ?? ""}
                    contentStyle={{ background:"var(--surface)", border:"1px solid var(--border)",
                      borderRadius:8, fontSize:12 }}
                  />
                  <Bar dataKey="total" fill="var(--brand, #C4622D)" maxBarSize={56} radius={[5,5,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Summary table */}
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12,
              background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10 }}>
              <thead>
                <tr style={{ background:"var(--surface-2)" }}>
                  {["Categoria","Total CMV","% do Total","Variação MoM"].map((h,i) => (
                    <th key={h} style={{
                      padding:"8px 12px", textAlign:i===0?"left":"right",
                      fontSize:10,fontWeight:700,letterSpacing:0.4,
                      textTransform:"uppercase",color:"var(--text-3)",
                      borderBottom:"1px solid var(--border)",whiteSpace:"nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cmvByCat.map(({ cat, total }) => {
                  const pct  = totalCmv > 0 ? total / totalCmv * 100 : 0
                  const prev = prevCmvByCat.get(cat) ?? 0
                  const varP = prev > 0 ? (total - prev) / prev * 100 : null
                  return (
                    <tr key={cat} style={{ borderTop:"1px solid var(--border)" }}>
                      <td style={{ padding:"7px 12px", fontWeight:500, color:"var(--text)" }}>{cat}</td>
                      <td style={{ padding:"7px 12px", textAlign:"right", color:"var(--text)" }}>
                        {fmtBRL(total)}
                      </td>
                      <td style={{ padding:"7px 12px", textAlign:"right", color:"var(--text-3)" }}>
                        {pct.toFixed(1).replace(".",",")}%
                      </td>
                      <td style={{ padding:"7px 12px", textAlign:"right",
                        color:varP==null?"var(--text-3)":varP>0?"#EF4444":"#22C55E",
                        fontWeight:varP!=null?600:400 }}>
                        {varP != null ? fmtPct(varP) : "—"}
                      </td>
                    </tr>
                  )
                })}
                {/* Total row */}
                <tr style={{ borderTop:"2px solid var(--border)", background:"var(--surface-2)" }}>
                  <td style={{ padding:"7px 12px",fontWeight:700,color:"var(--text)" }}>Total</td>
                  <td style={{ padding:"7px 12px",textAlign:"right",fontWeight:700,color:"var(--text)" }}>
                    {fmtBRL(totalCmv)}
                  </td>
                  <td style={{ padding:"7px 12px",textAlign:"right",fontWeight:700,color:"var(--text)" }}>
                    100,0%
                  </td>
                  <td style={{ padding:"7px 12px",textAlign:"right",fontWeight:700,
                    color:cmvVarPct==null?"var(--text-3)":cmvVarPct>0?"#EF4444":"#22C55E" }}>
                    {cmvVarPct != null ? fmtPct(cmvVarPct) : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasData && tab === "bonificacao" && <BonificacaoTab unitId={unitId} />}
      {hasData && tab === "fornecedor" && <FornecedorTab unitId={unitId} mes={mes} ano={ano} />}
      {hasData && tab === "arevisar" && <ARevisarTab unitId={unitId} />}

      {/* ── Import modal ── */}
      {showImport && (
        <ImportModal
          unitId={unitId}
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false)
            router.refresh()
          }}
        />
      )}
      {showNfeImport && (
        <NfeImportModal
          direction={direcao}
          onClose={() => setShowNfeImport(false)}
          onSuccess={() => router.refresh()}
        />
      )}
      {tableDrawerItem && (
        <HistoricoDrawer
          item={tableDrawerItem}
          historico={tableHistorico}
          loading={loadingTableHistorico}
          onClose={() => { setTableDrawerItem(null); setTableHistorico([]) }}
          onSelecionarNota={irParaNota}
        />
      )}
    </>
  )
}
