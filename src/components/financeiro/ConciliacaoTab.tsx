"use client"

import { useResource } from "@/lib/hooks/use-resource"

import { Fragment, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import { getConciliacao } from "@/app/financeiro/actions-operations"
import type { NotaConciliacao, TituloComUnidade } from "@/app/financeiro/actions-operations"

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—"
  : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)

function fmtDate(d: string | null) {
  return d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR") : "—"
}

// ── Style helpers (mesmo padrão das outras abas: Bonificação/Fornecedor) ────
const thS = (align: "left" | "right" = "left"): CSSProperties => ({
  padding: "8px 12px", textAlign: align,
  fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
  textTransform: "uppercase", color: "var(--text-3)",
  borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
})

const tdS = (align: "left" | "right" = "left"): CSSProperties => ({
  padding: "7px 12px", textAlign: align, color: "var(--text)",
})

const tableStyle: CSSProperties = {
  width: "100%", borderCollapse: "collapse", fontSize: 12,
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
}

const cardStyle: CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px",
}

const cardLabel: CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-3)", margin: 0,
}

const cardValue = (color?: string): CSSProperties => ({
  fontSize: 20, fontWeight: 700, color: color ?? "var(--text)", margin: "4px 0 0",
})

const chevronStyle = (expanded: boolean): CSSProperties => ({
  display: "inline-block", transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
  transition: "transform 0.15s ease", color: "var(--text-3)", fontSize: 12, width: 12,
})

const sectionTitle: CSSProperties = {
  fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
  color: "var(--text-3)", margin: "0 0 10px",
}

function isVencido(dVencimento: string | null): boolean {
  if (!dVencimento) return false
  return new Date(`${dVencimento}T12:00:00`) < new Date(new Date().toDateString())
}

function SituacaoBadge({ situacao }: { situacao: string | null }) {
  if (!situacao) return <span style={{ color: "var(--text-3)", fontSize: 11 }}>—</span>
  const lower = situacao.toLowerCase()
  const isOk = lower.includes("pago") || lower.includes("liquidado") || lower.includes("baixado")
  const isAlert = lower.includes("vencido") || lower.includes("atraso") || lower.includes("protest")
  const bg = isOk ? "rgba(34,197,94,0.10)" : isAlert ? "rgba(239,68,68,0.10)" : "var(--surface-2)"
  const border = isOk ? "rgba(34,197,94,0.30)" : isAlert ? "rgba(239,68,68,0.30)" : "var(--border)"
  const color = isOk ? "#22C55E" : isAlert ? "#EF4444" : "var(--text-2)"
  return (
    <span style={{
      display: "inline-flex", padding: "2px 8px", fontSize: 10, fontWeight: 700,
      letterSpacing: 0.4, textTransform: "uppercase", background: bg,
      border: `1px solid ${border}`, color, borderRadius: 99, whiteSpace: "nowrap",
    }}>
      {situacao}
    </span>
  )
}

type Props = { unitId: string | null; mes: number; ano: number }

type StatusFiltro = "todos" | "conciliado" | "sem_boleto" | "boleto_sem_nota"

const STATUS_LABELS: Record<StatusFiltro, string> = {
  todos: "Todos",
  conciliado: "Conciliado",
  sem_boleto: "Nota sem boleto",
  boleto_sem_nota: "Boleto sem nota",
}

// ── Component ────────────────────────────────────────────────────────────────
export function ConciliacaoTab({ unitId, mes, ano }: Props) {
  const [buscaFornecedor, setBuscaFornecedor] = useState("")
  const [buscaNota, setBuscaNota]             = useState("")
  const [statusFiltro, setStatusFiltro]       = useState<StatusFiltro>("todos")
  const [expandedNotas, setExpandedNotas]     = useState<Set<string>>(new Set())
  const [expandedFornecedores, setExpandedFornecedores] = useState<Set<string>>(new Set())

  const { data, loading } = useResource(`${unitId}|${mes}|${ano}`, () => getConciliacao(unitId, mes, ano), null)

  const notas = useMemo(() => data?.notas ?? [], [data])
  const boletosSemNota = useMemo(() => data?.boletosSemNota ?? [], [data])

  const fornecedores = useMemo(() => {
    const set = new Set<string>()
    for (const n of notas) if (n.fornecedor_nome) set.add(n.fornecedor_nome)
    for (const t of boletosSemNota) if (t.razao_fornecedor) set.add(t.razao_fornecedor)
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"))
  }, [notas, boletosSemNota])

  const sugestoesFornecedor = useMemo(() => {
    const b = buscaFornecedor.trim().toLowerCase()
    if (!b) return fornecedores
    return fornecedores.filter(f => f.toLowerCase().includes(b))
  }, [fornecedores, buscaFornecedor])

  // Busca client-side (sem router.push) — filtra fornecedor + nº da nota,
  // além do filtro de status (Conciliado/Nota sem boleto/Boleto sem
  // nota/Todos) selecionado no topo.
  const notasFiltradas = useMemo(() => {
    if (statusFiltro === "boleto_sem_nota") return []
    const bf = buscaFornecedor.trim().toLowerCase()
    const bn = buscaNota.trim().toLowerCase()
    return notas.filter(n => {
      if (statusFiltro === "conciliado" && n.boletos.length === 0) return false
      if (statusFiltro === "sem_boleto" && n.boletos.length > 0) return false
      if (bf && !(n.fornecedor_nome ?? "").toLowerCase().includes(bf)) return false
      if (bn && !n.nr_danfe.toLowerCase().includes(bn)) return false
      return true
    })
  }, [notas, buscaFornecedor, buscaNota, statusFiltro])

  // Agrupa boletos sem nota por fornecedor (razao_fornecedor) — mesmo padrão
  // da aba Títulos (soma de v_titulo por grupo, ordenado por valor desc).
  const gruposSemNota = useMemo(() => {
    if (statusFiltro === "conciliado" || statusFiltro === "sem_boleto") return []
    const bf = buscaFornecedor.trim().toLowerCase()
    const filtrados = boletosSemNota.filter(t =>
      !bf || (t.razao_fornecedor ?? "").toLowerCase().includes(bf)
    )
    const map = new Map<string, TituloComUnidade[]>()
    for (const t of filtrados) {
      const key = t.razao_fornecedor ?? "(sem fornecedor)"
      const bucket = map.get(key) ?? []
      bucket.push(t)
      map.set(key, bucket)
    }
    const grupos = [...map.entries()].map(([razaoFornecedor, ts]) => {
      const ordenados = [...ts].sort((a, b) => {
        const da = a.d_vencimento ?? ""
        const db = b.d_vencimento ?? ""
        if (da !== db) return da.localeCompare(db)
        return (a.n_titulo ?? "").localeCompare(b.n_titulo ?? "", "pt-BR", { numeric: true })
      })
      const descricoes = new Set(ts.map(t => t.descricao_c_gerencial ?? "").filter(Boolean))
      const descCGerencial = descricoes.size === 0 ? "—" : descricoes.size === 1 ? [...descricoes][0] : "Vários"
      const vTituloTotal = ts.reduce((sum, t) => sum + (t.v_titulo ?? 0), 0)
      return {
        razaoFornecedor,
        fantasiaFornecedor: ts.find(t => t.fantasia_fornecedor)?.fantasia_fornecedor ?? null,
        cnpjCpf: ts.find(t => t.cnpj_cpf_fornecedor)?.cnpj_cpf_fornecedor ?? null,
        descCGerencial,
        vTituloTotal,
        titulos: ordenados,
      }
    })
    return grupos.sort((a, b) => b.vTituloTotal - a.vTituloTotal)
  }, [boletosSemNota, buscaFornecedor, statusFiltro])

  function toggleNota(key: string) {
    setExpandedNotas(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleFornecedor(key: string) {
    setExpandedFornecedores(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Resumo — reflete o universo completo (não os filtros de busca/status),
  // pra servir de visão geral estável enquanto o usuário navega pelos filtros.
  const resumo = useMemo(() => {
    let conciliadoQtd = 0, conciliadoValor = 0
    let semBoletoQtd = 0, semBoletoValor = 0
    for (const n of notas) {
      if (n.boletos.length === 0) {
        semBoletoQtd++
        semBoletoValor += n.v_total_danfe ?? 0
      } else {
        conciliadoQtd++
        conciliadoValor += n.boletos.reduce((s, b) => s + (b.v_titulo ?? 0), 0)
      }
    }
    const boletoSemNotaQtd = boletosSemNota.length
    const boletoSemNotaValor = boletosSemNota.reduce((s, t) => s + (t.v_titulo ?? 0), 0)
    return { conciliadoQtd, conciliadoValor, semBoletoQtd, semBoletoValor, boletoSemNotaQtd, boletoSemNotaValor }
  }, [notas, boletosSemNota])

  const semDadosNotas = statusFiltro !== "boleto_sem_nota" && notasFiltradas.length === 0
  const semDadosSemNota = (statusFiltro === "todos" || statusFiltro === "boleto_sem_nota") && gruposSemNota.length === 0
  const mostrarNotas = statusFiltro !== "boleto_sem_nota"
  const mostrarSemNota = statusFiltro === "todos" || statusFiltro === "boleto_sem_nota"

  if (loading) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
        Cruzando notas do CMV com boletos…
      </div>
    )
  }

  if (notas.length === 0 && boletosSemNota.length === 0) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center",
        background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14 }}>
        <p style={{ fontSize: 14, color: "var(--text-3)", margin: 0 }}>
          Nenhuma nota nem boleto encontrado para este mês/unidade.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Filtro de status */}
      <div style={{ display: "flex", borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden", width: "fit-content" }}>
        {(Object.keys(STATUS_LABELS) as StatusFiltro[]).map(s => (
          <button key={s} onClick={() => setStatusFiltro(s)} style={{
            padding: "7px 14px", fontSize: 12, fontWeight: statusFiltro === s ? 700 : 500,
            background: statusFiltro === s ? "var(--brand, #D4A574)" : "var(--surface)",
            color: statusFiltro === s ? "var(--primary-foreground, #1A1208)" : "var(--text-3)",
            border: "none", cursor: "pointer", whiteSpace: "nowrap",
          }}>
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Filtros de texto */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Buscar fornecedor por razão social…"
          value={buscaFornecedor}
          onChange={e => setBuscaFornecedor(e.target.value)}
          style={{
            padding: "7px 12px", borderRadius: 8, fontSize: 12,
            background: "var(--surface)", color: "var(--text)",
            border: "1px solid var(--border)", minWidth: 240, flex: 1,
          }}
        />
        <select
          value={fornecedores.includes(buscaFornecedor) ? buscaFornecedor : ""}
          onChange={e => setBuscaFornecedor(e.target.value)}
          style={{
            padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500,
            background: "var(--surface)", color: "var(--text)",
            border: "1px solid var(--border)", minWidth: 220, cursor: "pointer",
          }}
        >
          <option value="">Todos os fornecedores</option>
          {sugestoesFornecedor.map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        {mostrarNotas && (
          <input
            placeholder="Nº da nota…"
            value={buscaNota}
            onChange={e => setBuscaNota(e.target.value)}
            style={{
              padding: "7px 12px", borderRadius: 8, fontSize: 12,
              background: "var(--surface)", color: "var(--text)",
              border: "1px solid var(--border)", minWidth: 140,
            }}
          />
        )}
      </div>

      {/* Resumo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
        <div style={cardStyle}>
          <p style={cardLabel}>Total conciliado</p>
          <p style={cardValue("#22C55E")}>{resumo.conciliadoQtd.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>{fmtBRL(resumo.conciliadoValor)}</p>
        </div>
        <div style={cardStyle}>
          <p style={cardLabel}>Notas sem boleto</p>
          <p style={cardValue(resumo.semBoletoQtd > 0 ? "#EF4444" : undefined)}>{resumo.semBoletoQtd.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>{fmtBRL(resumo.semBoletoValor)}</p>
        </div>
        <div style={cardStyle}>
          <p style={cardLabel}>Boletos sem nota</p>
          <p style={cardValue(resumo.boletoSemNotaQtd > 0 ? "#EF4444" : undefined)}>{resumo.boletoSemNotaQtd.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>{fmtBRL(resumo.boletoSemNotaValor)}</p>
        </div>
      </div>

      {/* Notas — mestre = nota, expande pros boletos vinculados */}
      {mostrarNotas && (
        <div>
          {statusFiltro === "todos" && <h2 style={sectionTitle}>Notas de produto</h2>}
          {semDadosNotas ? (
            <div style={{ padding: "40px 24px", textAlign: "center",
              background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14 }}>
              <p style={{ fontSize: 14, color: "var(--text-3)", margin: 0 }}>
                Nenhuma nota encontrada com os filtros aplicados.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ background: "var(--surface-2)" }}>
                    <th style={{ width: 28, padding: "8px 0 8px 12px", borderBottom: "1px solid var(--border)" }} />
                    <th style={thS()}>Nº Nota</th>
                    <th style={thS()}>Fornecedor</th>
                    <th style={thS("right")}>Valor da nota</th>
                    <th style={thS("right")}>Soma boletos</th>
                    <th style={thS("right")}>Qtd boletos</th>
                    <th style={thS()}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {notasFiltradas.map((n: NotaConciliacao) => {
                    const isOpen = expandedNotas.has(n.nr_danfe)
                    const somaBoletos = n.boletos.reduce((s, b) => s + (b.v_titulo ?? 0), 0)
                    const semBoleto = n.boletos.length === 0
                    return (
                      <Fragment key={n.nr_danfe}>
                        <tr
                          style={{
                            borderTop: "1px solid var(--border)", cursor: "pointer",
                            background: semBoleto ? "rgba(239,68,68,0.04)" : "transparent",
                          }}
                          onClick={() => toggleNota(n.nr_danfe)}
                        >
                          <td style={{ padding: "8px 0 8px 12px", verticalAlign: "middle" }}>
                            <span style={chevronStyle(isOpen)}>›</span>
                          </td>
                          <td style={{ ...tdS(), fontWeight: 600, whiteSpace: "nowrap" }}>{n.nr_danfe}</td>
                          <td style={{ ...tdS(), maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {n.fornecedor_nome ?? "—"}
                          </td>
                          <td style={tdS("right")}>{fmtBRL(n.v_total_danfe)}</td>
                          <td style={{ ...tdS("right"), fontWeight: 600 }}>{fmtBRL(somaBoletos)}</td>
                          <td style={tdS("right")}>{n.boletos.length}</td>
                          <td style={{ padding: "7px 12px" }}>
                            {semBoleto ? (
                              <span style={{
                                fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
                                padding: "2px 8px", borderRadius: 99,
                                background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", color: "#EF4444",
                              }}>
                                Sem boleto
                              </span>
                            ) : (
                              <span style={{
                                fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
                                padding: "2px 8px", borderRadius: 99,
                                background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.30)", color: "#22C55E",
                              }}>
                                Conciliado
                              </span>
                            )}
                          </td>
                        </tr>

                        {isOpen && (
                          <tr>
                            <td colSpan={7} style={{ padding: 0, border: "none" }}>
                              <div style={{ background: "var(--surface-2)", padding: "10px 12px 10px 40px" }}>
                                {n.boletos.length === 0 ? (
                                  <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>
                                    Nenhum boleto vinculado a esta nota.
                                  </p>
                                ) : (
                                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                    <thead>
                                      <tr>
                                        <th style={{ ...thS(), padding: "5px 10px", fontSize: 9 }}>Nº Título</th>
                                        <th style={{ ...thS(), padding: "5px 10px", fontSize: 9 }}>Parcela</th>
                                        <th style={{ ...thS(), padding: "5px 10px", fontSize: 9 }}>D. Vencimento</th>
                                        <th style={{ ...thS("right"), padding: "5px 10px", fontSize: 9 }}>V. Título</th>
                                        <th style={{ ...thS(), padding: "5px 10px", fontSize: 9 }}>Situação</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {n.boletos.map(b => {
                                        const vencido = isVencido(b.d_vencimento)
                                        return (
                                          <tr key={b.id} style={{ borderTop: "1px solid var(--border)" }}>
                                            <td style={{ padding: "5px 10px", color: "var(--text-3)", whiteSpace: "nowrap" }}>{b.n_titulo ?? "—"}</td>
                                            <td style={{ padding: "5px 10px", color: "var(--text-2)", whiteSpace: "nowrap" }}>
                                              Parcela {b.parcelaPos} de {b.parcelaTotal}
                                            </td>
                                            <td style={{ padding: "5px 10px", color: "var(--text-2)", whiteSpace: "nowrap" }}>
                                              {fmtDate(b.d_vencimento)}
                                            </td>
                                            <td style={{ padding: "5px 10px", textAlign: "right", color: "var(--text)", fontWeight: 600 }}>
                                              {fmtBRL(b.v_titulo)}
                                            </td>
                                            <td style={{ padding: "5px 10px" }}>
                                              <span style={{
                                                fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
                                                padding: "2px 7px", borderRadius: 99,
                                                background: vencido ? "rgba(239,68,68,0.10)" : "var(--surface)",
                                                border: `1px solid ${vencido ? "rgba(239,68,68,0.30)" : "var(--border)"}`,
                                                color: vencido ? "#EF4444" : "var(--text-3)",
                                              }}>
                                                {b.d_vencimento ? (vencido ? "Vencido" : "A vencer") : "—"}
                                              </span>
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Boletos sem nota — mestre = fornecedor, expande pros títulos (mesmo padrão da aba Títulos) */}
      {mostrarSemNota && (
        <div>
          {statusFiltro === "todos" && <h2 style={sectionTitle}>Boletos sem nota</h2>}
          {semDadosSemNota ? (
            <div style={{ padding: "40px 24px", textAlign: "center",
              background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14 }}>
              <p style={{ fontSize: 14, color: "var(--text-3)", margin: 0 }}>
                Nenhum boleto sem nota encontrado com os filtros aplicados.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ background: "var(--surface-2)" }}>
                    <th style={thS()}></th>
                    <th style={thS()}>Razão Fornecedor</th>
                    <th style={thS()}>Fantasia Fornecedor</th>
                    <th style={thS()}>CNPJ/CPF</th>
                    <th style={thS()}>Desc. C. Gerencial</th>
                    <th style={thS("right")}>V. Título</th>
                    <th style={thS("right")}>Títulos</th>
                  </tr>
                </thead>
                <tbody>
                  {gruposSemNota.map(g => {
                    const expanded = expandedFornecedores.has(g.razaoFornecedor)
                    return (
                      <Fragment key={g.razaoFornecedor}>
                        <tr
                          style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                          onClick={() => toggleFornecedor(g.razaoFornecedor)}
                        >
                          <td style={{ ...tdS(), width: 24 }}>
                            <span style={chevronStyle(expanded)}>›</span>
                          </td>
                          <td style={{ ...tdS(), fontWeight: 600, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {g.razaoFornecedor}
                          </td>
                          <td style={{ ...tdS(), maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {g.fantasiaFornecedor ?? "—"}
                          </td>
                          <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{g.cnpjCpf ?? "—"}</td>
                          <td style={{ ...tdS(), maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {g.descCGerencial}
                          </td>
                          <td style={{ ...tdS("right"), fontWeight: 700 }}>{fmtBRL(g.vTituloTotal)}</td>
                          <td style={tdS("right")}>
                            {g.titulos.length} título{g.titulos.length !== 1 ? "s" : ""}
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={7} style={{ padding: "0 12px 12px 36px", background: "var(--surface-2)" }}>
                              <div style={{ overflowX: "auto" }}>
                                <table style={{ ...tableStyle, background: "var(--surface)", fontSize: 11 }}>
                                  <thead>
                                    <tr>
                                      <th style={thS()}>N. Título</th>
                                      <th style={thS()}>Parcela</th>
                                      <th style={thS()}>D. Vencimento</th>
                                      <th style={thS()}>D. Competência</th>
                                      <th style={thS()}>Desc. C. Gerencial</th>
                                      <th style={thS()}>Portador</th>
                                      <th style={thS()}>Situação</th>
                                      <th style={thS("right")}>V. Título</th>
                                      <th style={thS("right")}>V. Saldo Atual</th>
                                      <th style={thS()}>N. Nota Fiscal</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.titulos.map(t => {
                                      const vencido = !!t.d_vencimento && isVencido(t.d_vencimento)
                                      return (
                                        <tr key={t.id} style={{
                                          borderTop: "1px solid var(--border)",
                                          background: vencido && (t.v_saldo_atual ?? 0) > 0 ? "rgba(239,68,68,0.04)" : undefined,
                                        }}>
                                          <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{t.n_titulo ?? "—"}</td>
                                          <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{t.parcela ?? "—"}</td>
                                          <td style={{ ...tdS(), whiteSpace: "nowrap" }}>
                                            <span style={{ color: vencido ? "#EF4444" : "var(--text)", fontWeight: vencido ? 600 : 400 }}>
                                              {fmtDate(t.d_vencimento)}
                                            </span>
                                          </td>
                                          <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{fmtDate(t.d_competencia)}</td>
                                          <td style={{ ...tdS(), maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {t.descricao_c_gerencial ?? "—"}
                                          </td>
                                          <td style={{ ...tdS(), maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {t.portador ?? "—"}
                                          </td>
                                          <td style={tdS()}>
                                            <SituacaoBadge situacao={t.situacao_atual} />
                                          </td>
                                          <td style={tdS("right")}>{fmtBRL(t.v_titulo)}</td>
                                          <td style={tdS("right")}><strong>{fmtBRL(t.v_saldo_atual)}</strong></td>
                                          <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{t.n_nota_fiscal ?? "—"}</td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
