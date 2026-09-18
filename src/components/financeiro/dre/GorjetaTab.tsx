"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

export type GorjetaRow = {
  mes_ano: string
  gorjeta_recebida: number | null
  gorjeta_paga: number | null
  retencao: number | null
  ferias: number | null
  decimo_terceiro: number | null
  fgts: number | null
  inss: number | null
  encargos_total: number | null
}

const MESES_SHORT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
const mesLabel = (m: string) => {
  const num = parseInt(m.split("-")[1] ?? "1", 10)
  return MESES_SHORT[(num - 1) % 12] ?? m
}

const fmtBRL = (v: number | null) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL",
        notation: "compact", maximumFractionDigits: 1 }).format(v)

const fmtFull = (v: number | null) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)

type Props = { data: GorjetaRow[] }

export function GorjetaTab({ data }: Props) {
  const sorted = [...data].sort((a, b) => {
    const toN = (s: string) => { const [y,m] = s.split("-").map(Number); return (y??0)*12+(m??0) }
    return toN(a.mes_ano) - toN(b.mes_ano)
  })

  const realizado = sorted.slice(0, 4)
  const latest = realizado.at(-1)

  const chartData = sorted.slice(0, 6).map((r) => ({
    mes: mesLabel(r.mes_ano),
    Recebida: r.gorjeta_recebida ?? 0,
    Paga: r.gorjeta_paga ?? 0,
    "Enc. Total": r.encargos_total ?? 0,
  }))

  const ENCARGO_ROWS = [
    { key: "ferias" as const,           label: "Férias (11,11%)" },
    { key: "decimo_terceiro" as const,  label: "13º Salário (8,33%)" },
    { key: "fgts" as const,             label: "FGTS (8%)" },
    { key: "inss" as const,             label: "INSS (25,8%)" },
    { key: "encargos_total" as const,   label: "Total Encargos" },
  ]

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {/* Summary cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {[
          { label: "Gorjeta Recebida", value: latest?.gorjeta_recebida, note: "13% serviço" },
          { label: "Gorjeta Paga", value: latest?.gorjeta_paga, note: "67% repassado" },
          { label: "Retenção", value: latest?.retencao, note: "33% empresa" },
          { label: "Encargos s/ Gorjeta", value: latest?.encargos_total, note: "Férias + 13º + FGTS + INSS" },
        ].map(({ label, value, note }) => (
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
            <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: "4px 0 0" }}>
              {fmtBRL(value ?? null)}
            </p>
            <p style={{ fontSize: 10, color: "var(--text-3)", margin: 0 }}>{note}</p>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "16px 16px 8px",
        }}
      >
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-3)", margin: "0 0 16px" }}>
          Evolução Mensal — Gorjeta
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} barSize={20} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
            <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#71717A" }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 10, fill: "#71717A" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => fmtBRL(v) ?? ""}
            />
            <Tooltip
              contentStyle={{ background: "#1A1A1E", border: "1px solid #27272A", borderRadius: 8, fontSize: 11, color: "#E5E5E7" }}
              formatter={(v: unknown) => [fmtBRL(typeof v === "number" ? v : null), ""]}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#71717A" }} />
            <Bar dataKey="Recebida" fill="#D4A574" fillOpacity={0.9} radius={[4, 4, 0, 0]} />
            <Bar dataKey="Paga" fill="#8B5CF6" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
            <Bar dataKey="Enc. Total" fill="#EF4444" fillOpacity={0.8} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Encargos breakdown table */}
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
              <th style={{ padding: "8px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-3)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                Encargo
              </th>
              {realizado.map((r) => (
                <th key={r.mes_ano} style={{ padding: "8px 12px", textAlign: "right", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-3)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                  {mesLabel(r.mes_ano)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ENCARGO_ROWS.map(({ key, label }) => (
              <tr
                key={key}
                style={{
                  borderTop: key === "encargos_total" ? "2px solid var(--border)" : "1px solid var(--border)",
                  background: key === "encargos_total" ? "var(--surface-2)" : "transparent",
                }}
              >
                <td style={{ padding: "8px 14px", fontWeight: key === "encargos_total" ? 700 : 500, color: "var(--text)" }}>
                  {label}
                </td>
                {realizado.map((r) => (
                  <td key={r.mes_ano} style={{ padding: "8px 12px", textAlign: "right", fontWeight: key === "encargos_total" ? 700 : 400, color: key === "encargos_total" ? "#EF4444" : "var(--text)" }}>
                    {fmtFull(r[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
