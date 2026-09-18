"use client"

import { useState } from "react"
import { formatBRL } from "@/lib/financeiro/utils"
import type { FaixaAPagar, TituloAPagar } from "@/lib/financeiro/fluxo/calcularFluxo"

const FAIXA_LABELS: Record<FaixaAPagar["faixa"], string> = {
  vencido: "Vencido",
  hoje: "Hoje",
  "7dias": "Até 7 dias",
  "15dias": "Até 15 dias",
  "30dias": "Até 30 dias",
  mais30: "Mais de 30 dias",
}

function formatData(iso: string | null): string {
  if (!iso) return "—"
  return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

type Props = {
  aPagarPorFaixa: FaixaAPagar[]
  aPagarSemData: { titulos: TituloAPagar[]; total: number }
}

export function APagarPorFaixa({ aPagarPorFaixa, aPagarSemData }: Props) {
  const [aberta, setAberta] = useState<FaixaAPagar["faixa"] | "sem-data" | null>(null)

  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={sectionTitle}>A pagar por vencimento</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {aPagarPorFaixa.map((f) => {
          const aberto = aberta === f.faixa
          const critico = f.faixa === "vencido" && f.total > 0
          return (
            <div
              key={f.faixa}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <button
                onClick={() => setAberta(aberto ? null : f.faixa)}
                disabled={f.titulos.length === 0}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  background: "transparent",
                  border: "none",
                  cursor: f.titulos.length === 0 ? "default" : "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                    {FAIXA_LABELS[f.faixa]}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {f.titulos.length} título{f.titulos.length === 1 ? "" : "s"}
                  </span>
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: critico ? "#EF4444" : "var(--text)" }}>
                  {formatBRL(f.total)}
                </span>
              </button>

              {aberto && f.titulos.length > 0 && (
                <div style={{ overflowX: "auto", borderTop: "1px solid var(--border)" }}>
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 560 }}>
                    <thead>
                      <tr style={{ background: "var(--surface-2)", color: "var(--text-3)", textAlign: "left" }}>
                        <th style={th}>Fornecedor</th>
                        <th style={th}>Nota</th>
                        <th style={{ ...th, textAlign: "right" }}>Valor</th>
                        <th style={th}>Vencimento</th>
                        <th style={th}>Categoria</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.titulos.map((t) => (
                        <tr key={t.id} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={td}>{t.fornecedor ?? "—"}</td>
                          <td style={td}>{t.nNotaFiscal ?? "—"}</td>
                          <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{formatBRL(t.valor)}</td>
                          <td style={td}>{formatData(t.vencimento)}</td>
                          <td style={{ ...td, color: "var(--text-3)" }}>{t.categoria ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}

        {aPagarSemData.titulos.length > 0 && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid #F59E0B",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <button
              onClick={() => setAberta(aberta === "sem-data" ? null : "sem-data")}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#F59E0B" }}>Sem data de vencimento</span>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                  {aPagarSemData.titulos.length} título{aPagarSemData.titulos.length === 1 ? "" : "s"} · não projetável
                </span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#F59E0B" }}>{formatBRL(aPagarSemData.total)}</span>
            </button>

            {aberta === "sem-data" && (
              <div style={{ overflowX: "auto", borderTop: "1px solid var(--border)" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 560 }}>
                  <thead>
                    <tr style={{ background: "var(--surface-2)", color: "var(--text-3)", textAlign: "left" }}>
                      <th style={th}>Fornecedor</th>
                      <th style={th}>Nota</th>
                      <th style={{ ...th, textAlign: "right" }}>Valor</th>
                      <th style={th}>Categoria</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aPagarSemData.titulos.map((t) => (
                      <tr key={t.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={td}>{t.fornecedor ?? "—"}</td>
                        <td style={td}>{t.nNotaFiscal ?? "—"}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{formatBRL(t.valor)}</td>
                        <td style={{ ...td, color: "var(--text-3)" }}>{t.categoria ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "var(--text-3)",
  margin: "0 0 10px",
}

const th: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
}

const td: React.CSSProperties = {
  padding: "7px 12px",
  color: "var(--text)",
  whiteSpace: "nowrap",
}
