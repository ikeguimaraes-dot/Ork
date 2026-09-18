"use client"

import React from "react"
import type { LinhaDetalhadaRow } from "./DreDrillTable"

const SLUG_LABEL: Record<string, string> = {
  cmv:              "CMV",
  pessoal:          "Pessoal Total",
  pessoal_op:       "↳ Pessoal Operacional",
  ocupacao:         "Ocupação",
  utilidades:       "Utilidades",
  operacao:         "Operação",
  manutencao:       "Manutenção",
  administrativa:   "Administrativa",
  marketing:        "Marketing",
  taxa_cartao:      "Taxa Cartão",
  ebitda:           "EBITDA",
  resultado_liquido:"Resultado Líq.",
}

const LOWER_IS_BETTER = new Set([
  "cmv","pessoal","pessoal_op","ocupacao","utilidades",
  "operacao","manutencao","administrativa","marketing","taxa_cartao",
])

// Grupos that have F/V in dre_linhas_detalhadas
const FV_GRUPOS = new Set(["CMV","PESSOAL","OCUPAÇÃO","UTILIDADES","OPERAÇÃO","MANUTENÇÃO","ADMINISTRATIVA","MARKETING","TAXAS CARTÃO"])

// Grupos that map to a display slug
const GRUPO_SLUG: Record<string, string> = {
  "CMV":            "cmv",
  "PESSOAL":        "pessoal",
  "OCUPAÇÃO":       "ocupacao",
  "UTILIDADES":     "utilidades",
  "OPERAÇÃO":       "operacao",
  "MANUTENÇÃO":     "manutencao",
  "ADMINISTRATIVA": "administrativa",
  "MARKETING":      "marketing",
  "TAXAS CARTÃO":   "taxa_cartao",
}

// All cost groups included in EBITDA (superset of GRUPO_SLUG)
const CUSTO_GRUPOS = [...Object.keys(GRUPO_SLUG), "DESP. FINANCEIRAS"]

function deriveIndicadoresFromLinhas(linhas: LinhaDetalhadaRow[]): IndicadorRow[] {
  const result: IndicadorRow[] = []
  const combos = [...new Set(linhas.map((l) => `${l.mes_ano}|${l.tipo}`))]

  for (const combo of combos) {
    const [mes, tipo] = combo.split("|") as [string, "orcado" | "realizado"]
    const ml = linhas.filter((l) => l.mes_ano === mes && l.tipo === tipo)
    const sum = (grupo: string) =>
      ml.filter((l) => l.grupo === grupo).reduce((s, l) => s + (l.valor ?? 0), 0)

    const receita = sum("RECEITA")
    const impostos = sum("IMPOSTOS")
    const rl = receita + impostos
    if (receita === 0 || rl === 0) continue

    for (const [grupo, slug] of Object.entries(GRUPO_SLUG)) {
      result.push({ mes_ano: mes, tipo, indicador: slug, valor: (sum(grupo) / rl) * 100 })
    }

    const ebitdaPct = (rl + CUSTO_GRUPOS.reduce((s, g) => s + sum(g), 0)) / rl * 100
    result.push({ mes_ano: mes, tipo, indicador: "ebitda",            valor: ebitdaPct })
    result.push({ mes_ano: mes, tipo, indicador: "resultado_liquido", valor: ebitdaPct })
  }

  return result
}

export type IndicadorRow = {
  mes_ano: string
  tipo: "orcado" | "realizado"
  indicador: string
  valor: number | null
}

type Props = {
  data: IndicadorRow[]
  linhas?: LinhaDetalhadaRow[]
}

export function IndicadoresTab({ data, linhas = [] }: Props) {
  const effectiveData = data.length > 0 ? data : deriveIndicadoresFromLinhas(linhas)

  const meses = [...new Set(effectiveData.map((d) => d.mes_ano))].sort((a, b) => {
    const toN = (s: string) => {
      const [y, m] = s.split("-").map(Number)
      return (y ?? 0) * 12 + (m ?? 0)
    }
    return toN(a) - toN(b)
  })

  const slugs = Object.keys(SLUG_LABEL)

  const get = (mes: string, tipo: "orcado" | "realizado", slug: string) =>
    effectiveData.find((d) => d.mes_ano === mes && d.tipo === tipo && d.indicador === slug)?.valor ?? null

  const getPessoalOp = (mes: string, tipo: "orcado" | "realizado") => {
    const opRow = linhas.find((l) => l.mes_ano === mes && l.tipo === tipo && l.descricao === "Pessoal Operacional")
    const rlRow = linhas.find((l) => l.mes_ano === mes && l.tipo === tipo && l.descricao === "Receita Líquida")
    if (!opRow?.valor || !rlRow?.valor || rlRow.valor === 0) return null
    return (opRow.valor / rlRow.valor) * 100
  }

  const fmt = (v: number | null) =>
    v === null ? "—" : `${v.toFixed(1).replace(".", ",")}%`

  const cellBg = (re: number | null, bd: number | null, slug: string) => {
    if (re === null || bd === null) return "transparent"
    const diff = re - bd
    const lib = LOWER_IS_BETTER.has(slug)
    if (Math.abs(diff) < 0.3) return "transparent"
    const good = lib ? diff < 0 : diff > 0
    return good ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.14)"
  }

  const cellColor = (re: number | null, bd: number | null, slug: string) => {
    if (re === null || bd === null) return "var(--text-3)"
    const diff = re - bd
    const lib = LOWER_IS_BETTER.has(slug)
    if (Math.abs(diff) < 0.3) return "var(--text)"
    return (lib ? diff < 0 : diff > 0) ? "#22C55E" : "#EF4444"
  }

  const MESES_SHORT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
  const mesLabel = (m: string) => {
    const num = parseInt(m.split("-")[1] ?? "1", 10)
    return MESES_SHORT[(num - 1) % 12] ?? m
  }

  // A month is "projected" when all realizado values for that month are null
  const isProjected = (mes: string) =>
    effectiveData.filter((d) => d.mes_ano === mes && d.tipo === "realizado").every((d) => d.valor === null)

  // F/V breakdown from dre_linhas_detalhadas
  const fvByMes = new Map<string, { f: number; v: number; rl: number | null }>()
  if (linhas.length > 0) {
    for (const mes of meses) {
      const orcMes = linhas.filter(
        (l) => l.mes_ano === mes && l.tipo === "orcado" &&
          FV_GRUPOS.has(l.grupo) &&
          !l.descricao.endsWith("Total") &&
          !l.descricao.endsWith(" %")
      )
      const f = orcMes.filter((l) => l.custo_tipo === "F").reduce((s, l) => s + (l.valor ?? 0), 0)
      const v = orcMes.filter((l) => l.custo_tipo === "V").reduce((s, l) => s + (l.valor ?? 0), 0)

      // Receita Líquida from linhas (orcado)
      const rlRow = linhas.find(
        (l) => l.mes_ano === mes && l.tipo === "orcado" && l.descricao === "Receita Líquida"
      )
      fvByMes.set(mes, { f, v, rl: rlRow?.valor ?? null })
    }
  }

  const hasFV = fvByMes.size > 0 && [...fvByMes.values()].some((x) => x.f !== 0 || x.v !== 0)

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div>
        <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 16 }}>
          % sobre Receita Líquida · verde = melhor que orçado · vermelho = pior
        </p>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              minWidth: 600,
            }}
          >
            <thead>
              <tr style={{ background: "var(--surface-2)" }}>
                <th
                  style={{
                    padding: "10px 14px",
                    textAlign: "left",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                    color: "var(--text-3)",
                    borderBottom: "1px solid var(--border)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Indicador
                </th>
                {meses.map((m) => (
                  <th
                    key={m}
                    colSpan={2}
                    style={{
                      padding: "10px 8px",
                      textAlign: "center",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                      color: isProjected(m) ? "#F59E0B" : "var(--text-3)",
                      borderBottom: "1px solid var(--border)",
                      borderLeft: "1px solid var(--border)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {mesLabel(m)}
                    {isProjected(m) && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 8,
                          fontWeight: 700,
                          letterSpacing: 0.8,
                          color: "#F59E0B",
                          background: "rgba(245,158,11,0.15)",
                          padding: "1px 4px",
                          borderRadius: 3,
                          marginTop: 2,
                        }}
                      >
                        PROJETADO
                      </span>
                    )}
                  </th>
                ))}
              </tr>
              <tr style={{ background: "var(--surface-2)" }}>
                <th
                  style={{
                    padding: "4px 14px",
                    borderBottom: "1px solid var(--border)",
                  }}
                />
                {meses.map((m) => (
                  <React.Fragment key={m}>
                    <th
                      style={{
                        padding: "4px 8px",
                        textAlign: "center",
                        fontSize: 9,
                        fontWeight: 600,
                        color: "var(--text-3)",
                        borderBottom: "1px solid var(--border)",
                        borderLeft: "1px solid var(--border)",
                      }}
                    >
                      BD
                    </th>
                    <th
                      style={{
                        padding: "4px 8px",
                        textAlign: "center",
                        fontSize: 9,
                        fontWeight: 600,
                        color: "var(--text-3)",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      RE
                    </th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {slugs.map((slug, si) => {
                const isEbitda = slug === "ebitda" || slug === "resultado_liquido"
                const isPessoalOp = slug === "pessoal_op"
                return (
                  <tr
                    key={slug}
                    style={{
                      borderTop: isEbitda && si > 0 ? "2px solid var(--border)" : "1px solid var(--border)",
                      background: isEbitda ? "var(--surface-2)" : isPessoalOp ? "rgba(139,92,246,0.04)" : "transparent",
                    }}
                  >
                    <td
                      style={{
                        padding: isPessoalOp ? "6px 14px" : "9px 14px",
                        fontWeight: isEbitda ? 700 : 500,
                        fontSize: isPessoalOp ? 11 : 12,
                        color: isPessoalOp ? "var(--text-3)" : "var(--text)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {SLUG_LABEL[slug]}
                    </td>
                    {meses.map((m) => {
                      const bd = isPessoalOp ? getPessoalOp(m, "orcado") : get(m, "orcado", slug)
                      const re = isPessoalOp ? getPessoalOp(m, "realizado") : get(m, "realizado", slug)
                      return (
                        <React.Fragment key={m}>
                          <td
                            style={{
                              padding: isPessoalOp ? "6px 8px" : "9px 8px",
                              textAlign: "center",
                              fontSize: isPessoalOp ? 11 : 12,
                              color: "var(--text-3)",
                              borderLeft: "1px solid var(--border)",
                            }}
                          >
                            {fmt(bd)}
                          </td>
                          <td
                            style={{
                              padding: isPessoalOp ? "6px 8px" : "9px 8px",
                              textAlign: "center",
                              fontSize: isPessoalOp ? 11 : 12,
                              background: cellBg(re, bd, slug),
                              color: isProjected(m) ? "var(--text-3)" : cellColor(re, bd, slug),
                              fontWeight: 600,
                            }}
                          >
                            {fmt(re)}
                          </td>
                        </React.Fragment>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* F/V breakdown table */}
      {hasFV && (
        <div>
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              color: "var(--text-3)",
              marginBottom: 12,
            }}
          >
            Estrutura de Custos — Fixos vs Variáveis (Orçado)
          </p>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                borderCollapse: "collapse",
                fontSize: 12,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                minWidth: 400,
              }}
            >
              <thead>
                <tr style={{ background: "var(--surface-2)" }}>
                  <th
                    style={{
                      padding: "8px 14px", textAlign: "left", fontSize: 10,
                      fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                      color: "var(--text-3)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                    }}
                  >
                    Mês
                  </th>
                  {["Fixos R$", "Fixos %RL", "Variáveis R$", "Variáveis %RL", "Total"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "8px 12px", textAlign: "right", fontSize: 10,
                        fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                        color: "var(--text-3)", borderBottom: "1px solid var(--border)",
                        borderLeft: "1px solid var(--border)", whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {meses.map((mes) => {
                  const fv = fvByMes.get(mes)
                  if (!fv) return null
                  const { f, v, rl } = fv
                  const total = f + v
                  const fPct  = rl && rl !== 0 ? (f / rl) * 100 : null
                  const vPct  = rl && rl !== 0 ? (v / rl) * 100 : null
                  const tPct  = rl && rl !== 0 ? (total / rl) * 100 : null
                  const proj  = isProjected(mes)
                  return (
                    <tr key={mes} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 14px", fontWeight: 600, color: proj ? "#F59E0B" : "var(--text)", whiteSpace: "nowrap" }}>
                        {mesLabel(mes)}
                        {proj && (
                          <span style={{ fontSize: 8, fontWeight: 700, color: "#F59E0B", background: "rgba(245,158,11,0.15)", padding: "1px 4px", borderRadius: 3, marginLeft: 6 }}>
                            PROJ
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#60A5FA", borderLeft: "1px solid var(--border)" }}>
                        {f !== 0 ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(f) : "—"}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-3)" }}>
                        {fmt(fPct)}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#F59E0B", borderLeft: "1px solid var(--border)" }}>
                        {v !== 0 ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v) : "—"}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-3)" }}>
                        {fmt(vPct)}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "var(--text)", borderLeft: "1px solid var(--border)" }}>
                        {fmt(tPct)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
