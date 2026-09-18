"use client"

import React, { useState } from "react"
import type { LinhaDetalhadaRow } from "./DreDrillTable"

export type FolhaRow = {
  id: number
  tipo: string
  nome: string | null
  funcao: string
  divisao: string
  admissao: string | null
  salario: number
  custo_total: number
  is_vaga: boolean
}

const DIVISAO_LABEL: Record<string, string> = {
  SALAO: "Salão",
  COZINHA: "Cozinha",
  BAR: "Bar",
  LIMPEZA: "Limpeza",
  PRODUCAO: "Produção",
  PRODUÇÃO: "Produção",
  ADM: "ADM",
  LIDERANCA: "Liderança",
  LIDERANÇA: "Liderança",
  CAIXA: "Caixa",
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)

const MESES_SHORT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
const mesLabel = (m: string) => {
  const num = parseInt(m.split("-")[1] ?? "1", 10)
  return MESES_SHORT[(num - 1) % 12] ?? m
}

type Props = {
  data: FolhaRow[]
  linhas?: LinhaDetalhadaRow[]
}

export function FolhaTab({ data, linhas = [] }: Props) {
  const [divisaoSel, setDivisaoSel] = useState<string | null>(null)

  const divisoes = [...new Set(data.map((d) => d.divisao))].sort()

  const filtered = divisaoSel
    ? data.filter((d) => d.divisao === divisaoSel)
    : data

  const byDivisao = divisoes.map((div) => {
    const rows = data.filter((d) => d.divisao === div)
    const vagas = rows.filter((d) => d.is_vaga).length
    const ativos = rows.filter((d) => !d.is_vaga).length
    const custo = rows.reduce((s, r) => s + r.custo_total, 0)
    return { div, vagas, ativos, total: rows.length, custo }
  })

  const totalCusto = data.reduce((s, r) => s + r.custo_total, 0)
  const totalVagas = data.filter((d) => d.is_vaga).length
  const totalAtivos = data.filter((d) => !d.is_vaga).length

  // ── Pessoal BD vs RE from dre_linhas_detalhadas ─────────────────────────────
  const pessoalMeses = [...new Set(linhas.filter(l => l.grupo === "PESSOAL").map(l => l.mes_ano))].sort((a, b) => {
    const toN = (s: string) => { const [y,m] = s.split("-").map(Number); return (y??0)*12+(m??0) }
    return toN(a) - toN(b)
  })

  const pessoalCats = [...new Set(
    linhas
      .filter(l => l.grupo === "PESSOAL" && !l.descricao.endsWith("Total") && l.descricao !== "Pessoal Operacional")
      .map(l => l.descricao)
  )]

  const getVal = (tipo: "orcado" | "realizado", mes: string, desc: string) =>
    linhas.find(l => l.grupo === "PESSOAL" && l.tipo === tipo && l.mes_ano === mes && l.descricao === desc)?.valor ?? null

  const getTotalPessoal = (tipo: "orcado" | "realizado", mes: string) => {
    const rows = linhas.filter(l =>
      l.grupo === "PESSOAL" && l.tipo === tipo && l.mes_ano === mes
    )
    if (rows.length === 0) return null
    return rows.reduce((acc, l) => acc + (l.valor ?? 0), 0)
  }

  const hasPessoalLinhas = linhas.some(l => l.grupo === "PESSOAL")

  return (
    <div style={{ display: "grid", gap: 20 }}>

      {/* ── Pessoal BD vs RE ── */}
      {hasPessoalLinhas && pessoalMeses.length > 0 && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-3)", margin: "0 0 12px" }}>
            Pessoal — Orçado vs Realizado por Categoria
          </p>

          {/* Totals row at top */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
            {pessoalMeses.map((mes) => {
              const bd = getTotalPessoal("orcado", mes)
              const re = getTotalPessoal("realizado", mes)
              const varV = bd !== null && re !== null ? re - bd : null
              return (
                <div key={mes} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-3)", margin: 0 }}>{mesLabel(mes)}</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "4px 0 0" }}>
                    {re !== null ? fmtBRL(Math.abs(re)) : bd !== null ? fmtBRL(Math.abs(bd)) : "—"}
                  </p>
                  {bd !== null && (
                    <p style={{ fontSize: 11, color: "var(--text-3)", margin: "2px 0 0" }}>BD: {fmtBRL(Math.abs(bd))}</p>
                  )}
                  {varV !== null && (
                    <p style={{ fontSize: 11, fontWeight: 700, color: varV > 0 ? "#EF4444" : "#22C55E", margin: "2px 0 0" }}>
                      {varV > 0 ? "+" : ""}{fmtBRL(varV)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {/* Detailed table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, minWidth: 500 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)" }}>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-3)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>Categoria</th>
                  {pessoalMeses.map((mes) => (
                    <React.Fragment key={mes}>
                      <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-3)", borderBottom: "1px solid var(--border)", borderLeft: "1px solid var(--border)", whiteSpace: "nowrap" }}>BD {mesLabel(mes)}</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-3)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>RE {mesLabel(mes)}</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pessoalCats.map((cat) => (
                  <tr key={cat} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "7px 12px", color: "var(--text)", fontWeight: 500 }}>{cat}</td>
                    {pessoalMeses.map((mes) => {
                      const bd = getVal("orcado", mes, cat)
                      const re = getVal("realizado", mes, cat)
                      return (
                        <React.Fragment key={mes}>
                          <td style={{ padding: "7px 10px", textAlign: "right", color: "var(--text-3)", borderLeft: "1px solid var(--border)" }}>
                            {bd !== null ? fmtBRL(Math.abs(bd)) : "—"}
                          </td>
                          <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: re !== null ? 600 : 400, color: re !== null ? (re > 0 ? "#22C55E" : "#EF4444") : "var(--text-3)" }}>
                            {re !== null ? fmtBRL(re) : "—"}
                          </td>
                        </React.Fragment>
                      )
                    })}
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--border)", background: "var(--surface-2)" }}>
                  <td style={{ padding: "7px 12px", fontWeight: 700, color: "var(--text)" }}>Total</td>
                  {pessoalMeses.map((mes) => {
                    const bd = getTotalPessoal("orcado", mes)
                    const re = getTotalPessoal("realizado", mes)
                    return (
                      <React.Fragment key={mes}>
                        <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: "var(--text)", borderLeft: "1px solid var(--border)" }}>
                          {bd !== null ? fmtBRL(Math.abs(bd)) : "—"}
                        </td>
                        <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: re !== null ? "#EF4444" : "var(--text-3)" }}>
                          {re !== null ? fmtBRL(Math.abs(re)) : "—"}
                        </td>
                      </React.Fragment>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        {[
          { label: "Total Quadro", value: String(data.length) },
          { label: "Ativos", value: String(totalAtivos), color: "#22C55E" },
          { label: "Vagas em Aberto", value: String(totalVagas), color: "#F59E0B" },
          { label: "Custo Estimado", value: fmtBRL(totalCusto), sub: "encargos incluídos" },
        ].map(({ label, value, color, sub }) => (
          <div
            key={label}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "14px 16px",
            }}
          >
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-3)", margin: 0 }}>
              {label}
            </p>
            <p style={{ fontSize: 22, fontWeight: 700, color: color ?? "var(--text)", margin: "4px 0 0" }}>
              {value}
            </p>
            {sub && <p style={{ fontSize: 10, color: "var(--text-3)", margin: 0 }}>{sub}</p>}
          </div>
        ))}
      </div>

      {/* By divisao */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            marginBottom: 4,
          }}
        >
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              {["Divisão", "Total", "Ativos", "Vagas", "Custo Total"].map((h, i) => (
                <th
                  key={h}
                  style={{
                    padding: "8px 12px",
                    textAlign: i === 0 ? "left" : "right",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                    color: "var(--text-3)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byDivisao.map(({ div, vagas, ativos, total, custo }) => (
              <tr
                key={div}
                style={{
                  borderTop: "1px solid var(--border)",
                  cursor: "pointer",
                  background: divisaoSel === div ? "rgba(212,165,116,0.08)" : "transparent",
                }}
                onClick={() => setDivisaoSel(divisaoSel === div ? null : div)}
              >
                <td style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text)" }}>
                  {DIVISAO_LABEL[div] ?? div}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text)" }}>{total}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: "#22C55E" }}>{ativos}</td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}>
                  {vagas > 0 ? (
                    <span style={{ color: "#F59E0B", fontWeight: 700 }}>{vagas}</span>
                  ) : (
                    <span style={{ color: "var(--text-3)" }}>—</span>
                  )}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text)" }}>
                  {fmtBRL(custo)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: "var(--text-3)", margin: "4px 0 16px 2px" }}>
          Clique em uma divisão para filtrar a tabela abaixo.
        </p>
      </div>

      {/* Employee table */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
          }}
        >
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              {["Nome / Função", "Divisão", "Admissão", "Salário", "Custo Total"].map((h, i) => (
                <th
                  key={h}
                  style={{
                    padding: "8px 12px",
                    textAlign: i < 2 ? "left" : "right",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                    color: "var(--text-3)",
                    borderBottom: "1px solid var(--border)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr
                key={i}
                style={{
                  borderTop: "1px solid var(--border)",
                  background: row.is_vaga
                    ? "rgba(245,158,11,0.10)"
                    : "transparent",
                }}
              >
                <td style={{ padding: "8px 12px" }}>
                  {row.is_vaga ? (
                    <span style={{ color: "#F59E0B", fontWeight: 700, fontSize: 11 }}>
                      🔸 VAGA EM ABERTO
                    </span>
                  ) : (
                    <span style={{ color: "var(--text)", fontWeight: 500 }}>{row.nome}</span>
                  )}
                  <span style={{ display: "block", fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>
                    {row.funcao}
                  </span>
                </td>
                <td style={{ padding: "8px 12px", color: "var(--text-3)" }}>
                  {DIVISAO_LABEL[row.divisao] ?? row.divisao}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-3)" }}>
                  {row.admissao ? row.admissao : <span style={{ color: "#F59E0B" }}>—</span>}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text)" }}>
                  {fmtBRL(row.salario)}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text)" }}>
                  {fmtBRL(row.custo_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
