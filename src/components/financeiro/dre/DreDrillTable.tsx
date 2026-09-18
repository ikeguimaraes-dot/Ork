"use client"

import React, { useState } from "react"
import { formatBRLCompact } from "@/lib/financeiro/utils"

export type DreMensalRowClient = {
  mes_ano: string
  tipo: "orcado" | "realizado"
  receita_bruta: number | null
  cmv: number | null
  pessoal: number | null
  ocupacao: number | null
  utilidades: number | null
  operacao: number | null
  manutencao: number | null
  administrativa: number | null
  marketing: number | null
  taxa_cartao: number | null
  impostos: number | null
  ebitda: number | null
  resultado_liquido: number | null
  clientes: number | null
  ticket_medio: number | null
}

export type LinhaDetalhadaRow = {
  id?: number
  mes_ano: string
  tipo: "orcado" | "realizado"
  grupo: string
  descricao: string
  conta: string | null
  custo_tipo: string | null
  valor: number | null
  av_percentual: number | null
}

type DreLineConfig = {
  key: string
  label: string
  grupo: string | null
  isTotal?: boolean
}

const DRE_LINES: DreLineConfig[] = [
  { key: "receita_bruta",     label: "Receita Bruta",         grupo: "RECEITA" },
  { key: "impostos",          label: "(-) Impostos",          grupo: "IMPOSTOS" },
  { key: "receita_liquida",   label: "(=) Receita Líquida",   grupo: null, isTotal: true },
  { key: "cmv",               label: "(-) CMV",               grupo: "CMV" },
  { key: "pessoal",           label: "(-) Pessoal",           grupo: "PESSOAL" },
  { key: "ocupacao",          label: "(-) Ocupação",          grupo: "OCUPAÇÃO" },
  { key: "utilidades",        label: "(-) Utilidades",        grupo: "UTILIDADES" },
  { key: "operacao",          label: "(-) Operação",          grupo: "OPERAÇÃO" },
  { key: "manutencao",        label: "(-) Manutenção",        grupo: "MANUTENÇÃO" },
  { key: "administrativa",    label: "(-) Administrativa",    grupo: "ADMINISTRATIVA" },
  { key: "marketing",         label: "(-) Marketing",         grupo: "MARKETING" },
  { key: "taxa_cartao",       label: "(-) Taxa Cartão",       grupo: "TAXAS CARTÃO" },
  { key: "ebitda",            label: "(=) EBITDA",            grupo: null, isTotal: true },
  { key: "resultado_liquido", label: "(=) Resultado Líquido", grupo: null, isTotal: true },
]

function rowVal(key: string, row: DreMensalRowClient | undefined): number | null {
  if (!row) return null
  if (key === "receita_liquida") return (row.receita_bruta ?? 0) + (row.impostos ?? 0)
  return (row as unknown as Record<string, number | null>)[key] ?? null
}

function varR(a: number | null, b: number | null) {
  if (a === null || b === null) return null
  return a - b
}

function varPct(a: number | null, b: number | null) {
  if (a === null || b === null || b === 0) return null
  return ((a - b) / Math.abs(b)) * 100
}

function pctOf(v: number | null, base: number | null) {
  if (v === null || base === null || base === 0) return null
  return (v / base) * 100
}

const fmt = {
  pct:   (v: number | null) => v === null ? "—" : `${v.toFixed(1).replace(".", ",")}%`,
  vPct:  (v: number | null) => v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}%`,
  vR:    (v: number | null) => v === null ? "—" : `${v >= 0 ? "+" : "-"}${formatBRLCompact(Math.abs(v))}`,
  color: (v: number | null) => (v === null || Math.abs(v) < 0.5) ? "var(--text-3)" : v > 0 ? "#22C55E" : "#EF4444",
}

const TH_R: React.CSSProperties = {
  padding: "8px 12px", fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
  textTransform: "uppercase", borderBottom: "1px solid var(--border)",
  textAlign: "right", whiteSpace: "nowrap",
}

function tdR(muted = false, bold = false): React.CSSProperties {
  return {
    padding: "8px 12px", fontSize: 12, textAlign: "right",
    color: muted ? "var(--text-3)" : "var(--text)",
    fontWeight: bold ? 700 : 400, whiteSpace: "nowrap",
  }
}

function subTdR(muted = false): React.CSSProperties {
  return { ...tdR(muted), fontSize: 11, padding: "5px 12px" }
}

type Props = {
  bd: DreMensalRowClient | undefined
  re: DreMensalRowClient | undefined
  kpiForMes: Record<string, number | null> | null
  linhas: LinhaDetalhadaRow[]
  mes: string
}

export function DreDrillTable({ bd, re, kpiForMes, linhas, mes }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const bdRecLiq = rowVal("receita_liquida", bd)
  const reRecLiq = rowVal("receita_liquida", re)

  const orcLinhas = linhas.filter((l) => l.mes_ano === mes && l.tipo === "orcado")
  const reLinhas  = linhas.filter((l) => l.mes_ano === mes && l.tipo === "realizado")

  function getSubcats(grupo: string, excludeDescs: string[] = []) {
    const bdMap = new Map<string, LinhaDetalhadaRow>()
    const reMap = new Map<string, LinhaDetalhadaRow>()
    for (const l of orcLinhas) {
      if (l.grupo === grupo && !l.descricao.endsWith("Total") && !l.descricao.endsWith(" %") && !excludeDescs.includes(l.descricao))
        bdMap.set(l.descricao, l)
    }
    for (const l of reLinhas) {
      if (l.grupo === grupo && !l.descricao.endsWith("Total") && !l.descricao.endsWith(" %") && !excludeDescs.includes(l.descricao))
        reMap.set(l.descricao, l)
    }
    const allDescs = [...new Set([...bdMap.keys(), ...reMap.keys()])]
    return allDescs
      .map((desc) => ({
        descricao: desc,
        custo_tipo: bdMap.get(desc)?.custo_tipo ?? null,
        bd:  bdMap.get(desc)?.valor ?? null,
        re:  reMap.get(desc)?.valor ?? null,
        av:  reMap.get(desc)?.av_percentual ?? null,
      }))
      .sort((a, b) => Math.abs(b.bd ?? b.re ?? 0) - Math.abs(a.bd ?? a.re ?? 0))
  }

  function getPessoalLinhas() {
    const opSubcats = getSubcats("PESSOAL", ["Gorjetas Pagas", "Pessoal Operacional"])
    const opBd  = orcLinhas.find((l) => l.descricao === "Pessoal Operacional")?.valor ?? null
    const opRe  = reLinhas.find((l) => l.descricao === "Pessoal Operacional")?.valor ?? null
    const gorBd = orcLinhas.find((l) => l.grupo === "PESSOAL" && l.descricao === "Gorjetas Pagas")?.valor ?? null
    const gorRe = reLinhas.find((l) => l.grupo === "PESSOAL" && l.descricao === "Gorjetas Pagas")?.valor ?? null
    return { opSubcats, opBd, opRe, gorBd, gorRe }
  }

  // F/V totals from orcado (exclude Total rows)
  const fFixed = orcLinhas
    .filter((l) => l.custo_tipo === "F" && !l.descricao.endsWith("Total") && !l.descricao.endsWith(" %"))
    .reduce((s, l) => s + (l.valor ?? 0), 0)
  const fVar = orcLinhas
    .filter((l) => l.custo_tipo === "V" && !l.descricao.endsWith("Total") && !l.descricao.endsWith(" %"))
    .reduce((s, l) => s + (l.valor ?? 0), 0)

  const toggle = (key: string) => setExpanded((p) => (p === key ? null : key))

  const reClientes = re?.clientes ?? kpiForMes?.clientes ?? null
  const bdClientes = bd?.clientes ?? null
  const reTicket   = re?.ticket_medio ?? kpiForMes?.ticket_medio ?? null
  const bdTicket   = bd?.ticket_medio ?? null

  return (
    <div
      style={{
        overflowX: "auto",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        marginBottom: 28,
      }}
    >
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 760 }}>
        <thead>
          <tr style={{ background: "var(--surface-2)", color: "var(--text-3)", textAlign: "left" }}>
            <th
              style={{
                padding: "8px 14px", fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                textTransform: "uppercase", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
              }}
            >
              Linha DRE
            </th>
            <th style={TH_R}>% BD</th>
            <th style={TH_R}>Orçado R$</th>
            <th style={TH_R}>% RE</th>
            <th style={TH_R}>Real R$</th>
            <th style={TH_R}>Var R$</th>
            <th style={TH_R}>Var %</th>
          </tr>
        </thead>
        <tbody>
          {DRE_LINES.map((line) => {
            const bdVal = rowVal(line.key, bd)
            const reVal = rowVal(line.key, re)
            const vR    = varR(reVal, bdVal)
            const vP    = varPct(reVal, bdVal)
            const bdPct = pctOf(bdVal, bdRecLiq)
            const rePct = pctOf(reVal, reRecLiq)
            const isSep = line.key === "receita_liquida" || line.key === "ebitda"
            const canExpand = line.grupo !== null
            const isOpen    = expanded === line.key
            const subcats   = isOpen && line.grupo ? getSubcats(line.grupo) : []

            const isPessoal = line.key === "pessoal"
            const pessoal = isPessoal && isOpen ? getPessoalLinhas() : null

            return (
              <React.Fragment key={line.key}>
                <tr
                  style={{
                    background: line.isTotal ? "var(--surface-2)" : "transparent",
                    borderTop: isSep ? "2px solid var(--border)" : "1px solid var(--border)",
                    cursor: canExpand ? "pointer" : "default",
                  }}
                  onClick={canExpand ? () => toggle(line.key) : undefined}
                >
                  <td
                    style={{
                      padding: "8px 14px", fontSize: 12,
                      fontWeight: line.isTotal ? 700 : 500,
                      color: line.isTotal ? "var(--text)" : "var(--text-2)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {canExpand && (
                      <span style={{ fontSize: 9, marginRight: 6, color: "var(--text-3)" }}>
                        {isOpen ? "▾" : "▸"}
                      </span>
                    )}
                    {line.label}
                  </td>
                  <td style={tdR(true)}>{fmt.pct(bdPct)}</td>
                  <td style={tdR(false, line.isTotal)}>
                    {bdVal != null ? formatBRLCompact(bdVal) : "—"}
                  </td>
                  <td style={tdR(true)}>{fmt.pct(rePct)}</td>
                  <td style={tdR(false, line.isTotal)}>
                    {reVal != null ? formatBRLCompact(reVal) : "—"}
                  </td>
                  <td style={{ ...tdR(), color: fmt.color(vR) }}>{fmt.vR(vR)}</td>
                  <td style={{ ...tdR(), paddingRight: 14, color: fmt.color(vP) }}>{fmt.vPct(vP)}</td>
                </tr>

                {/* PESSOAL: operational subcats → Operacional subtotal → Gorjetas Pagas bridge */}
                {isPessoal && pessoal ? (
                  <>
                    {pessoal.opSubcats.map((sc, i) => (
                      <tr key={`pessoal-op-${i}`}
                        style={{ borderTop: "1px solid var(--border)", background: "rgba(255,255,255,0.015)" }}>
                        <td style={{ padding: "5px 14px 5px 30px", fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap" }}>
                          {sc.custo_tipo && (
                            <span style={{ fontSize: 9, fontWeight: 700, marginRight: 5,
                              color: sc.custo_tipo === "F" ? "#60A5FA" : "#F59E0B",
                              background: sc.custo_tipo === "F" ? "rgba(96,165,250,0.15)" : "rgba(245,158,11,0.15)",
                              padding: "1px 5px", borderRadius: 4 }}>
                              {sc.custo_tipo}
                            </span>
                          )}
                          {sc.descricao}
                        </td>
                        <td style={subTdR(true)}>{sc.av != null ? fmt.pct(sc.av * 100) : "—"}</td>
                        <td style={subTdR(true)}>{sc.bd != null ? formatBRLCompact(sc.bd) : "—"}</td>
                        <td style={subTdR(true)}>—</td>
                        <td style={{ ...subTdR(), color: sc.re != null ? "var(--text)" : "var(--text-3)" }}>
                          {sc.re != null ? formatBRLCompact(sc.re) : "—"}
                        </td>
                        <td style={{ ...subTdR(), color: fmt.color(varR(sc.re, sc.bd)) }}>{fmt.vR(varR(sc.re, sc.bd))}</td>
                        <td style={{ ...subTdR(), paddingRight: 14, color: fmt.color(varPct(sc.re, sc.bd)) }}>{fmt.vPct(varPct(sc.re, sc.bd))}</td>
                      </tr>
                    ))}
                    {/* Pessoal Operacional subtotal */}
                    <tr style={{ borderTop: "2px solid var(--border)", background: "var(--surface-2)" }}>
                      <td style={{ padding: "6px 14px 6px 22px", fontSize: 11, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 9, color: "var(--text-3)", marginRight: 6 }}>═</span>
                        Pessoal Operacional
                      </td>
                      <td style={subTdR(true)}>{fmt.pct(pctOf(pessoal.opBd, bdRecLiq))}</td>
                      <td style={{ ...subTdR(), fontWeight: 700, color: "var(--text)" }}>
                        {pessoal.opBd != null ? formatBRLCompact(pessoal.opBd) : "—"}
                      </td>
                      <td style={subTdR(true)}>{fmt.pct(pctOf(pessoal.opRe, reRecLiq))}</td>
                      <td style={{ ...subTdR(), fontWeight: 700, color: "var(--text)" }}>
                        {pessoal.opRe != null ? formatBRLCompact(pessoal.opRe) : "—"}
                      </td>
                      <td style={{ ...subTdR(), fontWeight: 700, color: fmt.color(varR(pessoal.opRe, pessoal.opBd)) }}>
                        {fmt.vR(varR(pessoal.opRe, pessoal.opBd))}
                      </td>
                      <td style={{ ...subTdR(), paddingRight: 14, fontWeight: 700, color: fmt.color(varPct(pessoal.opRe, pessoal.opBd)) }}>
                        {fmt.vPct(varPct(pessoal.opRe, pessoal.opBd))}
                      </td>
                    </tr>
                    {/* Gorjetas Pagas bridge */}
                    <tr style={{ borderTop: "1px solid var(--border)", background: "rgba(245,158,11,0.06)" }}>
                      <td style={{ padding: "6px 14px 6px 30px", fontSize: 11, fontWeight: 600, color: "#F59E0B", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: "#F59E0B",
                          background: "rgba(245,158,11,0.18)", padding: "1px 5px", borderRadius: 4, marginRight: 6 }}>V</span>
                        (+) Gorjetas Pagas
                      </td>
                      <td style={subTdR(true)}>—</td>
                      <td style={{ ...subTdR(), color: pessoal.gorBd != null ? "#F59E0B" : "var(--text-3)", fontWeight: 600 }}>
                        {pessoal.gorBd != null ? formatBRLCompact(pessoal.gorBd) : "—"}
                      </td>
                      <td style={subTdR(true)}>—</td>
                      <td style={{ ...subTdR(), color: pessoal.gorRe != null ? "#F59E0B" : "var(--text-3)", fontWeight: 600 }}>
                        {pessoal.gorRe != null ? formatBRLCompact(pessoal.gorRe) : "—"}
                      </td>
                      <td style={{ ...subTdR(), color: fmt.color(varR(pessoal.gorRe, pessoal.gorBd)) }}>
                        {fmt.vR(varR(pessoal.gorRe, pessoal.gorBd))}
                      </td>
                      <td style={{ ...subTdR(), paddingRight: 14, color: fmt.color(varPct(pessoal.gorRe, pessoal.gorBd)) }}>
                        {fmt.vPct(varPct(pessoal.gorRe, pessoal.gorBd))}
                      </td>
                    </tr>
                  </>
                ) : subcats.map((sc, i) => (
                  <tr
                    key={`${line.key}-${i}`}
                    style={{ borderTop: "1px solid var(--border)", background: "rgba(255,255,255,0.015)" }}
                  >
                    <td
                      style={{
                        padding: "5px 14px 5px 30px", fontSize: 11,
                        color: "var(--text-3)", whiteSpace: "nowrap",
                      }}
                    >
                      {sc.custo_tipo && (
                        <span
                          style={{
                            fontSize: 9, fontWeight: 700, marginRight: 5,
                            color: sc.custo_tipo === "F" ? "#60A5FA" : "#F59E0B",
                            background: sc.custo_tipo === "F" ? "rgba(96,165,250,0.15)" : "rgba(245,158,11,0.15)",
                            padding: "1px 5px", borderRadius: 4,
                          }}
                        >
                          {sc.custo_tipo}
                        </span>
                      )}
                      {sc.descricao}
                    </td>
                    <td style={subTdR(true)}>
                      {sc.av != null ? fmt.pct(sc.av * 100) : "—"}
                    </td>
                    <td style={subTdR(true)}>
                      {sc.bd != null ? formatBRLCompact(sc.bd) : "—"}
                    </td>
                    <td style={subTdR(true)}>—</td>
                    <td style={{ ...subTdR(), color: sc.re != null ? "var(--text)" : "var(--text-3)" }}>
                      {sc.re != null ? formatBRLCompact(sc.re) : "—"}
                    </td>
                    <td style={{ ...subTdR(), color: fmt.color(varR(sc.re, sc.bd)) }}>
                      {fmt.vR(varR(sc.re, sc.bd))}
                    </td>
                    <td style={{ ...subTdR(), paddingRight: 14, color: fmt.color(varPct(sc.re, sc.bd)) }}>
                      {fmt.vPct(varPct(sc.re, sc.bd))}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            )
          })}

          {/* KPI rows */}
          {(reClientes !== null || bdClientes !== null || reTicket !== null || bdTicket !== null) && (
            <>
              <tr style={{ borderTop: "2px solid var(--border)" }}>
                <td style={{ padding: "8px 14px", fontSize: 12, fontWeight: 500, color: "var(--text-2)" }}>Clientes</td>
                <td style={tdR(true)}>—</td>
                <td style={tdR()}>{bdClientes != null ? bdClientes.toLocaleString("pt-BR") : "—"}</td>
                <td style={tdR(true)}>—</td>
                <td style={tdR()}>{reClientes != null ? reClientes.toLocaleString("pt-BR") : "—"}</td>
                <td
                  style={{
                    ...tdR(),
                    color: fmt.color(reClientes != null && bdClientes != null ? reClientes - bdClientes : null),
                  }}
                >
                  {reClientes != null && bdClientes != null
                    ? `${reClientes - bdClientes >= 0 ? "+" : ""}${(reClientes - bdClientes).toLocaleString("pt-BR")}`
                    : "—"}
                </td>
                <td style={tdR(true)}>—</td>
              </tr>
              <tr style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 14px", fontSize: 12, fontWeight: 500, color: "var(--text-2)" }}>Ticket Médio</td>
                <td style={tdR(true)}>—</td>
                <td style={tdR()}>{bdTicket != null ? formatBRLCompact(bdTicket) : "—"}</td>
                <td style={tdR(true)}>—</td>
                <td style={tdR()}>{reTicket != null ? formatBRLCompact(reTicket) : "—"}</td>
                <td style={{ ...tdR(), color: fmt.color(varR(reTicket, bdTicket)) }}>
                  {fmt.vR(varR(reTicket, bdTicket))}
                </td>
                <td style={{ ...tdR(), paddingRight: 14, color: fmt.color(varPct(reTicket, bdTicket)) }}>
                  {fmt.vPct(varPct(reTicket, bdTicket))}
                </td>
              </tr>
              {kpiForMes?.icms != null && kpiForMes.icms !== 0 && (
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 14px 8px 28px", fontSize: 12, fontWeight: 500, color: "var(--text-3)" }}>↳ ICMS</td>
                  <td style={tdR(true)}>—</td>
                  <td style={tdR(true)}>—</td>
                  <td style={tdR(true)}>—</td>
                  <td style={tdR(true)}>{formatBRLCompact(kpiForMes.icms)}</td>
                  <td style={tdR(true)}>—</td>
                  <td style={tdR(true)}>—</td>
                </tr>
              )}
              {kpiForMes?.cofins != null && kpiForMes.cofins !== 0 && (
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 14px 8px 28px", fontSize: 12, fontWeight: 500, color: "var(--text-3)" }}>↳ COFINS</td>
                  <td style={tdR(true)}>—</td>
                  <td style={tdR(true)}>—</td>
                  <td style={tdR(true)}>—</td>
                  <td style={tdR(true)}>{formatBRLCompact(kpiForMes.cofins)}</td>
                  <td style={tdR(true)}>—</td>
                  <td style={tdR(true)}>—</td>
                </tr>
              )}
              {kpiForMes?.pis != null && kpiForMes.pis !== 0 && (
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 14px 8px 28px", fontSize: 12, fontWeight: 500, color: "var(--text-3)" }}>↳ PIS</td>
                  <td style={tdR(true)}>—</td>
                  <td style={tdR(true)}>—</td>
                  <td style={tdR(true)}>—</td>
                  <td style={tdR(true)}>{formatBRLCompact(kpiForMes.pis)}</td>
                  <td style={tdR(true)}>—</td>
                  <td style={tdR(true)}>—</td>
                </tr>
              )}
            </>
          )}
        </tbody>

        {/* F/V footer */}
        {(fFixed !== 0 || fVar !== 0) && (
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--border)", background: "var(--surface-2)" }}>
              <td style={{ padding: "8px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-3)", whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: "#60A5FA", background: "rgba(96,165,250,0.15)", padding: "1px 5px", borderRadius: 4, marginRight: 6 }}>F</span>
                Custos Fixos (Orçado)
              </td>
              <td style={tdR(true)}>{fmt.pct(pctOf(fFixed, bdRecLiq))}</td>
              <td style={tdR(false, true)}>{formatBRLCompact(fFixed)}</td>
              <td colSpan={4} />
            </tr>
            <tr style={{ borderTop: "1px solid var(--border)", background: "var(--surface-2)" }}>
              <td style={{ padding: "8px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-3)", whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: "#F59E0B", background: "rgba(245,158,11,0.15)", padding: "1px 5px", borderRadius: 4, marginRight: 6 }}>V</span>
                Custos Variáveis (Orçado)
              </td>
              <td style={tdR(true)}>{fmt.pct(pctOf(fVar, bdRecLiq))}</td>
              <td style={tdR(false, true)}>{formatBRLCompact(fVar)}</td>
              <td colSpan={4} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
