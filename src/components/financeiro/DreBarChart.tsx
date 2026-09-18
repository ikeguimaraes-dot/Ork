"use client"

import { useReducedMotion } from "@/components/ui/useReducedMotion"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts"

export type DreChartPoint = {
  mes: string
  cmv_re: number | null
  cmv_bd: number | null
  pessoal_re: number | null
  pessoal_bd: number | null
  ebitda_re: number | null
  ebitda_bd: number | null
}

export function DreBarChart({ data }: { data: DreChartPoint[] }) {
  const avg = (vals: (number | null)[]) => {
    const nums = vals.filter((v): v is number => v !== null)
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 14,
      }}
    >
      <MiniChart
        title="CMV % da Receita"
        data={data.map((d) => ({ mes: d.mes, value: d.cmv_re, meta: d.cmv_bd }))}
        avgMeta={avg(data.map((d) => d.cmv_bd))}
        goodColor="var(--chart-2)"
        badColor="var(--color-danger)"
        lowerIsBetter
      />
      <MiniChart
        title="Pessoal % da Receita"
        data={data.map((d) => ({ mes: d.mes, value: d.pessoal_re, meta: d.pessoal_bd }))}
        avgMeta={avg(data.map((d) => d.pessoal_bd))}
        goodColor="var(--chart-2)"
        badColor="var(--color-warning)"
        lowerIsBetter
      />
      <MiniChart
        title="EBITDA % da Receita"
        data={data.map((d) => ({ mes: d.mes, value: d.ebitda_re, meta: d.ebitda_bd }))}
        avgMeta={avg(data.map((d) => d.ebitda_bd))}
        goodColor="var(--chart-2)"
        badColor="var(--color-danger)"
        lowerIsBetter={false}
      />
    </div>
  )
}

type MiniPoint = { mes: string; value: number | null; meta: number | null }

function MiniChart({
  title,
  data,
  avgMeta,
  goodColor,
  badColor,
  lowerIsBetter,
}: {
  title: string
  data: MiniPoint[]
  avgMeta: number | null
  goodColor: string
  badColor: string
  lowerIsBetter: boolean
}) {
  const reducedMotion = useReducedMotion();
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 20,
        padding: "14px 12px 10px",
      }}
    >
      <p
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--text-3)",
          margin: "0 0 12px",
        }}
      >
        {title}
      </p>
      <ResponsiveContainer width="100%" height={148}>
        <BarChart
          data={data}
          barSize={28}
          margin={{ top: 8, right: 4, left: -16, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="mes"
            tick={{ fontSize: 10, fill: "var(--text-3)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--text-3)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          />
          <Tooltip
            formatter={(value: unknown) => {
              const n = typeof value === "number" ? value : null
              return [
                n !== null ? `${n.toFixed(1).replace(".", ",")}%` : "—",
                title,
              ]
            }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 11,
              color: "var(--text)",
            }}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar isAnimationActive={!reducedMotion} animationDuration={550} dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((entry, idx) => {
              const v = entry.value
              const ref = entry.meta ?? avgMeta
              if (v === null) return <Cell key={idx} fill="var(--border-strong)" />
              if (ref === null) return <Cell key={idx} fill={goodColor} fillOpacity={0.7} />
              const isGood = lowerIsBetter ? v <= ref : v >= ref
              return (
                <Cell
                  key={idx}
                  fill={isGood ? goodColor : badColor}
                  fillOpacity={0.85}
                />
              )
            })}
          </Bar>
          {avgMeta !== null && (
            <ReferenceLine
              y={avgMeta}
              stroke="var(--brand)"
              strokeDasharray="5 3"
              strokeWidth={2.5}
              label={{
                value: `Meta ${avgMeta.toFixed(1)}%`,
                fill: "var(--brand)",
                fontSize: 10,
                position: "insideTopRight",
              }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
