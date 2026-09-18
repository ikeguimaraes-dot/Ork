"use client"

import { useResource } from "@/lib/hooks/use-resource"

import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts"
import { getEvolucaoPorCompra } from "@/app/financeiro/dre/cmv/actions"
import type { ProdutoEvolucao, CompraProduto } from "@/app/financeiro/dre/cmv/actions"

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—"
  : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)

const fmtPct = (v: number | null | undefined) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}%`

const fmtQty = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(v)

const fmtDate = (iso: string | null) => {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("pt-BR")
}

// Preço subiu (ruim) = vermelho; preço caiu (bom) = verde.
const varColor = (v: number | null): string =>
  v == null ? "var(--text-3)" : v > 0 ? "#EF4444" : v < 0 ? "#22C55E" : "var(--text-3)"

const unidSuffix = (u: string | null) => (u ? `/${u.toLowerCase()}` : "")

// ── Types ────────────────────────────────────────────────────────────────────
type SortMode = "variacao" | "nome" | "codigo" | "compras" | "preco"

type Props = { unitId: string | null; onSelecionarNota?: (chaveNfe: string) => void }

// ── Component ────────────────────────────────────────────────────────────────
export function AnaliseTab({ unitId, onSelecionarNota }: Props) {
  const [busca, setBusca]       = useState("")
  const [sortMode, setSort]     = useState<SortMode>("variacao")
  const [selId, setSelId]       = useState<string | null>(null)
  const detalheRef = useRef<HTMLDivElement>(null)

  // Rola até o painel de detalhe sempre que a seleção muda (ex.: clique nos
  // blocos Maiores Altas/Quedas, que ficam acima e longe do painel).
  useEffect(() => {
    if (selId) detalheRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [selId])

  const { data: produtos, loading } = useResource(String(unitId), () => getEvolucaoPorCompra(unitId), null)

  const lista = useMemo(() => produtos ?? [], [produtos])

  // ── KPIs e blocos de destaque (independem de busca/ordenação/seleção) ──────
  const maioresAltas = useMemo(() =>
    lista.filter(p => p.ultimaVarPct != null && p.ultimaVarPct > 0)
      .sort((a, b) => (b.ultimaVarPct ?? 0) - (a.ultimaVarPct ?? 0)).slice(0, 10)
  , [lista])

  const maioresQuedas = useMemo(() =>
    lista.filter(p => p.ultimaVarPct != null && p.ultimaVarPct < 0)
      .sort((a, b) => (a.ultimaVarPct ?? 0) - (b.ultimaVarPct ?? 0)).slice(0, 10)
  , [lista])

  const kpis = useMemo(() => {
    const subiram = lista.filter(p => p.ultimaVarPct != null && p.ultimaVarPct > 0).length
    const cairam  = lista.filter(p => p.ultimaVarPct != null && p.ultimaVarPct < 0).length

    // Média ponderada pelo valor comprado na última compra de cada produto.
    let somaPesoVar = 0
    let somaPeso = 0
    for (const p of lista) {
      const ultima = p.compras[p.compras.length - 1]
      if (!ultima || ultima.varPct == null || ultima.custoUnitario == null || ultima.qtd == null) continue
      const peso = ultima.custoUnitario * ultima.qtd
      somaPesoVar += ultima.varPct * peso
      somaPeso += peso
    }
    const mediaVariacaoPonderada = somaPeso > 0 ? somaPesoVar / somaPeso : null

    return { analisados: lista.length, subiram, cairam, mediaVariacaoPonderada }
  }, [lista])

  // ── Lista completa filtrada + ordenada ──────────────────────────────────────
  const listaFiltrada = useMemo(() => {
    let r = lista
    const b = busca.trim().toLowerCase()
    if (b) r = r.filter(p => p.nome.toLowerCase().includes(b) || p.codigo.toLowerCase().includes(b))
    const s = [...r]
    if (sortMode === "variacao")
      s.sort((a, b) => (b.ultimaVarPct ?? -Infinity) - (a.ultimaVarPct ?? -Infinity))
    else if (sortMode === "nome")
      s.sort((a, b) => a.nome.localeCompare(b.nome))
    else if (sortMode === "codigo")
      s.sort((a, b) => a.codigo.localeCompare(b.codigo))
    else if (sortMode === "compras")
      s.sort((a, b) => b.totalCompras - a.totalCompras)
    else
      s.sort((a, b) => (b.precoAtual ?? 0) - (a.precoAtual ?? 0))
    return s
  }, [lista, busca, sortMode])

  const selecionado = useMemo(
    () => lista.find(p => p.produtoId === selId) ?? null,
    [lista, selId]
  )

  if (loading) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
        Calculando variação de preço por compra…
      </div>
    )
  }

  if (lista.length === 0) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center",
        background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14 }}>
        <p style={{ fontSize: 14, color: "var(--text-3)", margin: 0 }}>
          Nenhum produto do catálogo com duas ou mais compras por XML.
        </p>
        <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 8 }}>
          Gere o catálogo e vincule os produtos na aba Catálogo para ver a evolução de preço.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* ── Topo: maiores altas, maiores quedas, KPIs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12 }}>
        <TopoCard title="Maiores altas" icon="▲" cor="#EF4444"
          itens={maioresAltas} selId={selId} onSelect={setSelId} vazio="Nenhum produto subiu de preço na última compra." />
        <TopoCard title="Maiores quedas" icon="▼" cor="#22C55E"
          itens={maioresQuedas} selId={selId} onSelect={setSelId} vazio="Nenhum produto caiu de preço na última compra." />
        <KpiCard kpis={kpis} />
      </div>

      {/* ── Painéis: lista + detalhe ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 16, alignItems: "start" }}>
        {/* Lista lateral (busca + ordenação rápida) */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: 12, borderBottom: "1px solid var(--border)", display: "grid", gap: 8 }}>
            <input
              placeholder="Buscar por nome ou código…"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              style={{
                padding: "7px 12px", borderRadius: 8, fontSize: 12,
                background: "var(--surface-2)", color: "var(--text)",
                border: "1px solid var(--border)", width: "100%",
              }}
            />
            <div style={{ display: "flex", borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden", flexWrap: "wrap" }}>
              {([["variacao", "Variação"], ["nome", "Nome"], ["codigo", "Código"], ["compras", "Nº compras"], ["preco", "Preço"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => setSort(v)} style={{
                  flex: 1, padding: "6px 4px", fontSize: 11, fontWeight: sortMode === v ? 700 : 500,
                  background: sortMode === v ? "var(--brand, #C4622D)" : "var(--surface)",
                  color: sortMode === v ? "var(--primary-foreground)" : "var(--text-3)",
                  border: "none", cursor: "pointer", whiteSpace: "nowrap",
                }}>{label}</button>
              ))}
            </div>
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>
              {listaFiltrada.length.toLocaleString("pt-BR")} produto{listaFiltrada.length !== 1 ? "s" : ""} · {lista.length} no total
            </span>
          </div>

          <div style={{ maxHeight: 620, overflowY: "auto" }}>
            {listaFiltrada.map(p => {
              const active = p.produtoId === selId
              return (
                <button key={p.produtoId} onClick={() => setSelId(p.produtoId)} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  width: "100%", padding: "9px 12px", textAlign: "left",
                  background: active ? "var(--surface-2)" : "transparent",
                  borderBottom: "1px solid var(--border)",
                  borderLeft: `3px solid ${active ? "var(--brand, #C4622D)" : "transparent"}`,
                  cursor: "pointer",
                }}>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 12, fontWeight: active ? 700 : 500,
                      color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.nome}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-3)" }}>
                      {p.codigo} · {fmtBRL(p.precoAtual)}{unidSuffix(p.unidade)} · {p.totalCompras} compra{p.totalCompras !== 1 ? "s" : ""}
                    </span>
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                    padding: "2px 7px", borderRadius: 99,
                    color: varColor(p.ultimaVarPct),
                    background: p.ultimaVarPct == null ? "transparent"
                      : p.ultimaVarPct > 0 ? "rgba(239,68,68,0.12)"
                      : p.ultimaVarPct < 0 ? "rgba(34,197,94,0.12)"
                      : "var(--surface-2)",
                  }}>
                    {fmtPct(p.ultimaVarPct)}
                  </span>
                </button>
              )
            })}
            {listaFiltrada.length === 0 && (
              <p style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
                Nenhum produto encontrado.
              </p>
            )}
          </div>
        </div>

        {/* Tabela completa + Detalhe do selecionado */}
        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          <ListaTabela produtos={listaFiltrada} selId={selId} onSelect={setSelId} />
          <div ref={detalheRef}>
            {selecionado ? (
              <Detalhe p={selecionado} onSelecionarNota={onSelecionarNota} />
            ) : (
              <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 13,
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }}>
                Selecione um produto na lista para ver a evolução por compra.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Bloco: Maiores altas / Maiores quedas ────────────────────────────────────
function TopoCard({ title, icon, cor, itens, selId, onSelect, vazio }: {
  title: string; icon: string; cor: string
  itens: ProdutoEvolucao[]; selId: string | null; onSelect: (id: string) => void; vazio: string
}) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase",
        color: "var(--text-3)", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: cor }}>{icon}</span> {title}
      </p>
      {itens.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>{vazio}</p>
      ) : (
        <div style={{ display: "grid", gap: 2 }}>
          {itens.map((p, i) => {
            const active = p.produtoId === selId
            return (
              <button key={p.produtoId} onClick={() => onSelect(p.produtoId)}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-2)" }}
                onMouseLeave={e => { e.currentTarget.style.background = active ? "var(--surface-2)" : "transparent" }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  padding: "5px 6px", borderRadius: 6, border: "none",
                  background: active ? "var(--surface-2)" : "transparent",
                  cursor: "pointer", textAlign: "left",
                }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-3)", width: 14 }}>{i + 1}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12, color: "var(--text)", overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.nome}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-3)" }}>
                      {p.codigo} · {fmtBRL(p.precoAtual)}{unidSuffix(p.unidade)}
                    </span>
                  </span>
                </span>
                <span style={{ display: "grid", justifyItems: "end", flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: cor, whiteSpace: "nowrap" }}>
                    {fmtPct(p.ultimaVarPct)}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-3)", whiteSpace: "nowrap" }}>
                    {p.ultimaVarAbs != null ? fmtBRL(p.ultimaVarAbs) : "—"}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Bloco: KPIs ───────────────────────────────────────────────────────────────
function KpiCard({ kpis }: {
  kpis: { analisados: number; subiram: number; cairam: number; mediaVariacaoPonderada: number | null }
}) {
  const item = (label: string, valor: string, cor?: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0" }}>
      <span style={{ fontSize: 12, color: "var(--text-3)" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: cor ?? "var(--text)" }}>{valor}</span>
    </div>
  )
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase",
        color: "var(--text-3)", margin: "0 0 10px" }}>
        Resumo
      </p>
      {item("Produtos analisados", kpis.analisados.toLocaleString("pt-BR"))}
      {item("Subiram de preço", kpis.subiram.toLocaleString("pt-BR"), kpis.subiram > 0 ? "#EF4444" : undefined)}
      {item("Caíram de preço", kpis.cairam.toLocaleString("pt-BR"), kpis.cairam > 0 ? "#22C55E" : undefined)}
      {item("Variação média ponderada", fmtPct(kpis.mediaVariacaoPonderada), varColor(kpis.mediaVariacaoPonderada))}
    </div>
  )
}

// ── Lista completa em tabela ──────────────────────────────────────────────────
function ListaTabela({ produtos, selId, onSelect }: {
  produtos: ProdutoEvolucao[]; selId: string | null; onSelect: (id: string) => void
}) {
  const thD = (align: "left" | "right" = "left"): CSSProperties => ({
    padding: "8px 12px", textAlign: align,
    fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
    textTransform: "uppercase", color: "var(--text-3)",
    borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
  })
  const tdD = (align: "left" | "right" = "left"): CSSProperties => ({
    padding: "7px 12px", textAlign: align, whiteSpace: "nowrap",
  })

  return (
    <div style={{ overflowX: "auto", maxHeight: 280, overflowY: "auto",
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead style={{ position: "sticky", top: 0, background: "var(--surface-2)", zIndex: 1 }}>
          <tr>
            <th style={thD()}>Código</th>
            <th style={thD()}>Nome</th>
            <th style={thD("right")}>Nº compras</th>
            <th style={thD("right")}>Preço atual</th>
            <th style={thD("right")}>Mín.</th>
            <th style={thD("right")}>Máx.</th>
            <th style={thD("right")}>Variação última compra</th>
          </tr>
        </thead>
        <tbody>
          {produtos.map(p => {
            const active = p.produtoId === selId
            return (
              <tr key={p.produtoId} onClick={() => onSelect(p.produtoId)}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-2)" }}
                onMouseLeave={e => { e.currentTarget.style.background = active ? "var(--surface-2)" : "transparent" }}
                style={{
                  borderTop: "1px solid var(--border)", cursor: "pointer",
                  background: active ? "var(--surface-2)" : "transparent",
                }}>
                <td style={{ ...tdD(), fontWeight: 700, color: "var(--text)" }}>{p.codigo}</td>
                <td style={{ ...tdD(), color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>
                  {p.nome}
                </td>
                <td style={{ ...tdD("right"), color: "var(--text)" }}>{p.totalCompras}</td>
                <td style={{ ...tdD("right"), fontWeight: 600, color: "var(--text)" }}>
                  {fmtBRL(p.precoAtual)}{unidSuffix(p.unidade)}
                </td>
                <td style={{ ...tdD("right"), color: "var(--text-3)" }}>{fmtBRL(p.precoMinimo)}</td>
                <td style={{ ...tdD("right"), color: "var(--text-3)" }}>{fmtBRL(p.precoMaximo)}</td>
                <td style={{ ...tdD("right"), fontWeight: 700, color: varColor(p.ultimaVarPct) }}>
                  {fmtPct(p.ultimaVarPct)}
                </td>
              </tr>
            )
          })}
          {produtos.length === 0 && (
            <tr>
              <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--text-3)" }}>
                Nenhum produto encontrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Detalhe do produto ────────────────────────────────────────────────────────
function Detalhe({ p, onSelecionarNota }: { p: ProdutoEvolucao; onSelecionarNota?: (chaveNfe: string) => void }) {
  const unid = p.unidade ?? ""
  const chartData = p.compras.map(c => ({
    label: fmtDate(c.data),
    preco: c.custoUnitario,
    fornecedor: c.fornecedor,
    nrDanfe: c.nrDanfe,
    varPct: c.varPct,
    trocouFornecedor: c.trocouFornecedor,
  }))
  const periodo = p.compras.length > 0
    ? `${fmtDate(p.compras[0]!.data)} – ${fmtDate(p.compras[p.compras.length - 1]!.data)}`
    : "—"

  const thD = (align: "left" | "right" = "left"): CSSProperties => ({
    padding: "8px 12px", textAlign: align,
    fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
    textTransform: "uppercase", color: "var(--text-3)",
    borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
  })

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Header do produto */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
        padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", margin: "0 0 4px", lineHeight: 1.3 }}>
            {p.nome}
          </h2>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
            {[p.codigo, unid ? `Unidade: ${unid}` : null, `${p.totalCompras} compras`, periodo]
              .filter(Boolean).join(" · ")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <MiniStat label="Atual" valor={fmtBRL(p.precoAtual)} />
          <MiniStat label="Mínimo" valor={fmtBRL(p.precoMinimo)} />
          <MiniStat label="Máximo" valor={fmtBRL(p.precoMaximo)} />
          <MiniStat label="Médio" valor={fmtBRL(p.precoMedio)} />
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase",
              color: "var(--text-3)", margin: "0 0 2px" }}>
              Última variação
            </p>
            <p style={{ fontSize: 22, fontWeight: 800, color: varColor(p.ultimaVarPct), margin: 0, lineHeight: 1 }}>
              {fmtPct(p.ultimaVarPct)}
            </p>
          </div>
        </div>
      </div>

      {/* Gráfico de linha por compra */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase",
          color: "var(--text-3)", margin: "0 0 16px" }}>
          Preço unitário ({unid ? `R$${unidSuffix(unid)}` : "R$"}) por compra
        </p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-3)" }} />
            <YAxis tickFormatter={v => fmtBRL(Number(v))} tick={{ fontSize: 10, fill: "var(--text-3)" }} width={78} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null
                const d = payload[0]!.payload as (typeof chartData)[number]
                return (
                  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
                    padding: "8px 10px", fontSize: 12 }}>
                    <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--text)" }}>{d.label}</p>
                    <p style={{ margin: "0 0 2px", color: "var(--text-3)" }}>{d.fornecedor ?? "—"}</p>
                    <p style={{ margin: "0 0 2px", color: "var(--text-3)" }}>Nota {d.nrDanfe ?? "—"}</p>
                    <p style={{ margin: "0 0 2px", fontWeight: 600, color: "var(--text)" }}>
                      {fmtBRL(d.preco)}{unidSuffix(unid)}
                    </p>
                    <p style={{ margin: 0, fontWeight: 600, color: varColor(d.varPct) }}>{fmtPct(d.varPct)}</p>
                    {d.trocouFornecedor && (
                      <p style={{ margin: "4px 0 0", fontSize: 10, fontWeight: 700, color: "#F59E0B" }}>
                        ⚠ Trocou de fornecedor
                      </p>
                    )}
                  </div>
                )
              }}
            />
            <Line
              type="monotone" dataKey="preco" stroke="#D4A574" strokeWidth={2.5} connectNulls
              dot={(props) => {
                const { cx, cy, payload, key } = props as { cx: number; cy: number; payload: (typeof chartData)[number]; key?: string }
                const trocou = payload.trocouFornecedor
                return (
                  <circle key={key} cx={cx} cy={cy} r={trocou ? 6 : 4}
                    fill={trocou ? "#F59E0B" : "#D4A574"}
                    stroke={trocou ? "#B45309" : "none"} strokeWidth={trocou ? 2 : 0} />
                )
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Tabela de compras */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12,
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              <th style={thD()}>Data</th>
              <th style={thD()}>Fornecedor</th>
              <th style={thD()}>Nota</th>
              <th style={thD("right")}>Qtd</th>
              <th style={thD("right")}>Preço unit.</th>
              <th style={thD("right")}>Variação</th>
            </tr>
          </thead>
          <tbody>
            {p.compras.map((c, i) => (
              <CompraRow key={i} c={c} isFirst={i === 0} onSelecionarNota={onSelecionarNota} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MiniStat({ label, valor }: { label: string; valor: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase",
        color: "var(--text-3)", margin: "0 0 2px" }}>
        {label}
      </p>
      <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0 }}>{valor}</p>
    </div>
  )
}

function CompraRow({ c, isFirst, onSelecionarNota }: {
  c: CompraProduto; isFirst: boolean; onSelecionarNota?: (chaveNfe: string) => void
}) {
  const clicavel = Boolean(onSelecionarNota && c.chaveNfe)
  return (
    <tr
      onClick={() => { if (clicavel) onSelecionarNota!(c.chaveNfe!) }}
      style={{
        borderTop: "1px solid var(--border)",
        cursor: clicavel ? "pointer" : "default",
        background: c.trocouFornecedor ? "rgba(245,158,11,0.06)" : "transparent",
      }}
    >
      <td style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>
        {fmtDate(c.data)}
      </td>
      <td style={{ padding: "8px 12px", color: "var(--text)" }}>
        {c.fornecedor ?? "—"}
        {c.trocouFornecedor && (
          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#F59E0B" }}>⚠ trocou</span>
        )}
      </td>
      <td style={{ padding: "8px 12px", color: "var(--text-3)", whiteSpace: "nowrap" }}>{c.nrDanfe ?? "—"}</td>
      <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text)" }}>{fmtQty(c.qtd)}</td>
      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: "var(--text)" }}>
        {fmtBRL(c.custoUnitario)}
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: varColor(c.varPct) }}>
        {isFirst ? "—" : fmtPct(c.varPct)}
      </td>
    </tr>
  )
}
