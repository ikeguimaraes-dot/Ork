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

export type ReceitaRow = {
  mes_ano: string
  bandeira: string
  classificacao: string
  valor: number
}

const CORES: Record<string, string> = {
  "Dinheiro/Pix":    "#22C55E",
  "Cartão de Débito":"#3B82F6",
  "Cartão de Crédito":"#8B5CF6",
  "Voucher":         "#F59E0B",
  "Evento Faturado": "#D4A574",
}
const COR_DEFAULT = "#64748B"

const MESES_SHORT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
const mesLabel = (m: string) => {
  const num = parseInt(m.split("-")[1] ?? "1", 10)
  return MESES_SHORT[(num - 1) % 12] ?? m
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL",
    notation: "compact", maximumFractionDigits: 1 }).format(v)

type Props = { data: ReceitaRow[] }

export function ReceitaTab({ data }: Props) {
  const meses = [...new Set(data.map((d) => d.mes_ano))].sort((a, b) => {
    const toN = (s: string) => {
      const [y, m] = s.split("-").map(Number)
      return (y ?? 0) * 12 + (m ?? 0)
    }
    return toN(a) - toN(b)
  })

  const classificacoes = [...new Set(data.map((d) => d.classificacao))]

  const chartData = meses.map((m) => {
    const base: Record<string, string | number> = { mes: mesLabel(m) }
    let total = 0
    classificacoes.forEach((cls) => {
      const val = data.find((d) => d.mes_ano === m && d.classificacao === cls)?.valor ?? 0
      base[cls] = val
      total += val
    })
    base.total = total
    return base
  })

  // Per-month totals table
  const totalPorMes = meses.map((m) => {
    const rows = data.filter((d) => d.mes_ano === m)
    return {
      mes: m,
      mesLabel: mesLabel(m),
      total: rows.reduce((s, r) => s + r.valor, 0),
      items: rows.sort((a, b) => b.valor - a.valor),
    }
  })

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {/* Stacked bar chart */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "16px 16px 8px",
        }}
      >
        <p
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: "var(--text-3)",
            margin: "0 0 16px",
          }}
        >
          Receita por Meio de Pagamento
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
            <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#71717A" }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 10, fill: "#71717A" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => fmtBRL(v)}
            />
            <Tooltip
              contentStyle={{ background: "#1A1A1E", border: "1px solid #27272A", borderRadius: 8, fontSize: 11, color: "#E5E5E7" }}
              formatter={(value: unknown, name: unknown) => [
                fmtBRL(typeof value === "number" ? value : 0),
                String(name ?? ""),
              ]}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: "#71717A", paddingTop: 8 }}
            />
            {classificacoes.map((cls) => (
              <Bar
                key={cls}
                dataKey={cls}
                stackId="a"
                fill={CORES[cls] ?? COR_DEFAULT}
                radius={classificacoes.indexOf(cls) === classificacoes.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary table */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
          }}
        >
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              {["Meio de Pagamento", ...meses.map((m) => mesLabel(m)), "Total"].map((h, i) => (
                <th
                  key={h + i}
                  style={{
                    padding: "10px 12px",
                    textAlign: i === 0 ? "left" : "right",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.5,
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
            {classificacoes.map((cls) => {
              const rowTotal = data.filter((d) => d.classificacao === cls).reduce((s, r) => s + r.valor, 0)
              return (
                <tr key={cls} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: CORES[cls] ?? COR_DEFAULT,
                        flexShrink: 0,
                        display: "inline-block",
                      }}
                    />
                    {cls}
                  </td>
                  {meses.map((m) => {
                    const val = data.find((d) => d.mes_ano === m && d.classificacao === cls)?.valor ?? null
                    return (
                      <td key={m} style={{ padding: "8px 12px", textAlign: "right", color: "var(--text)" }}>
                        {val != null ? fmtBRL(val) : "—"}
                      </td>
                    )
                  })}
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "var(--text)" }}>
                    {fmtBRL(rowTotal)}
                  </td>
                </tr>
              )
            })}
            <tr style={{ borderTop: "2px solid var(--border)", background: "var(--surface-2)" }}>
              <td style={{ padding: "8px 12px", fontWeight: 700, color: "var(--text)" }}>Total</td>
              {totalPorMes.map(({ mes, total }) => (
                <td key={mes} style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "var(--text)" }}>
                  {fmtBRL(total)}
                </td>
              ))}
              <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "var(--brand, #D4A574)" }}>
                {fmtBRL(data.reduce((s, r) => s + r.valor, 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
