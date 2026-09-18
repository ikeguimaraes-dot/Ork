"use client"

import { useReducedMotion } from "@/components/ui/useReducedMotion"

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts"
import { formatBRL } from "@/lib/financeiro/utils"
import type { DiaFluxo } from "@/lib/financeiro/fluxo/calcularFluxo"

type Props = {
  dias: DiaFluxo[]
  hoje: string
  diaCruzaZero: string | null
}

function formatDiaCurto(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

export function FluxoCalendario({ dias, hoje, diaCruzaZero }: Props) {
  const reducedMotion = useReducedMotion();
  const data = dias.map((d) => ({
    data: d.data,
    label: formatDiaCurto(d.data),
    entradaRealizada: d.entradasRealizadas,
    entradaPrevista: d.entradasPrevistas,
    saidaRealizada: -d.saidasRealizadas,
    saidaPrevista: -d.saidasPrevistas,
    saldoFinal: d.saldoFinal,
  }))

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 20,
        padding: "16px 12px 10px",
        marginBottom: 28,
      }}
    >
      <div className="ork-panel-heading" style={{ padding: "8px 12px 22px" }}><div><h2>Seu caixa ao longo do tempo</h2><p>Entradas e saídas na escala à esquerda · saldo na escala à direita</p></div></div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--text-3)" }}
            axisLine={false}
            tickLine={false}
            interval={Math.max(0, Math.floor(data.length / 12) - 1)}
          />
          <YAxis
            yAxisId="fluxo"
            tick={{ fontSize: 10, fill: "var(--text-3)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => formatBRL(v).replace("R$", "").trim()}
          />
          <YAxis
            yAxisId="saldo"
            orientation="right"
            tick={{ fontSize: 10, fill: "var(--text-3)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => formatBRL(v).replace("R$", "").trim()}
          />
          <Tooltip
            formatter={(value: unknown, name: unknown) => {
              const n = typeof value === "number" ? value : 0
              const key = typeof name === "string" ? name : String(name)
              const nomes: Record<string, string> = {
                entradaRealizada: "Entrada realizada",
                entradaPrevista: "Entrada prevista",
                saidaRealizada: "Saída realizada",
                saidaPrevista: "Saída prevista",
                saldoFinal: "Saldo acumulado",
              }
              return [formatBRL(key.startsWith("saida") ? Math.abs(n) : n), nomes[key] ?? key]
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
          <ReferenceLine yAxisId="fluxo" y={0} stroke="var(--border-strong)" />
          <ReferenceLine
            yAxisId="fluxo"
            x={formatDiaCurto(hoje)}
            stroke="var(--text-3)"
            strokeDasharray="4 3"
            label={{ value: "Hoje", fill: "var(--text-3)", fontSize: 10, position: "top" }}
          />
          {diaCruzaZero && (
            <ReferenceLine
              yAxisId="fluxo"
              x={formatDiaCurto(diaCruzaZero)}
              stroke="var(--color-danger)"
              strokeDasharray="4 3"
              label={{ value: "Falta caixa", fill: "var(--color-danger)", fontSize: 10, position: "top" }}
            />
          )}
          <Bar isAnimationActive={!reducedMotion} animationDuration={550} yAxisId="fluxo" dataKey="entradaRealizada" stackId="entrada" fill="var(--chart-2)" fillOpacity={0.85} />
          <Bar isAnimationActive={!reducedMotion} animationDuration={550} yAxisId="fluxo" dataKey="entradaPrevista" stackId="entrada" fill="var(--chart-2)" fillOpacity={0.35} />
          <Bar isAnimationActive={!reducedMotion} animationDuration={550} yAxisId="fluxo" dataKey="saidaRealizada" stackId="saida" fill="var(--color-danger)" fillOpacity={0.85} />
          <Bar isAnimationActive={!reducedMotion} animationDuration={550} yAxisId="fluxo" dataKey="saidaPrevista" stackId="saida" fill="var(--color-danger)" fillOpacity={0.35} />
          <Line
            isAnimationActive={!reducedMotion}
            animationDuration={550}
            yAxisId="saldo"
            type="monotone"
            dataKey="saldoFinal"
            stroke="var(--brand)"
            strokeWidth={2.5}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, padding: "18px 12px 12px", fontSize: 11, color: "var(--text-2)" }}><span>● Entradas</span><span style={{ color: "var(--color-danger)" }}>● Saídas</span><span style={{ color: "var(--brand)" }}>━ Saldo acumulado</span><span>Cor suave: previsão · cor forte: realizado</span></div>
    </div>
  )
}
