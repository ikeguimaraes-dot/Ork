"use client";

import { useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight } from "lucide-react";
import { competenciaLabel, formatBRL } from "@/lib/financeiro/utils";
import type { KpiSnapshotRow } from "./types";
import { metricPresentation } from "./presentation";
import { useReducedMotion } from "@/components/ui/useReducedMotion";
import styles from "./cockpit.module.css";

export function EvolutionChart({ janela, rows }: { janela: string[]; rows: Map<string, KpiSnapshotRow | null> }) {
  const [metric, setMetric] = useState<"receita_liquida" | "resultado_liquido">("receita_liquida");
  const id = useId().replace(/:/g, "");
  const reducedMotion = useReducedMotion();
  const label = metric === "receita_liquida" ? "Receita líquida" : "Resultado líquido";
  const color = metric === "receita_liquida" ? "var(--chart-1)" : "var(--chart-2)";
  const data = janela.map((competencia) => {
    const presentation = metricPresentation(rows.get(competencia), metric);
    return { competencia, month: competenciaLabel(competencia).split(" ")[0], value: presentation.value, partial: presentation.partial };
  });
  const hasData = data.some((point) => point.value != null);
  return <section className={`ork-panel ${styles.evolution}`} aria-label="Evolução dos resultados">
    <div className="ork-panel-heading"><div><h2>O ritmo do seu negócio</h2><p>Últimos {janela.length} meses · valores em reais</p></div><ArrowUpRight size={18} className={styles.subtleIcon} /></div>
    <div className={styles.chartTabs} role="group" aria-label="Indicador do gráfico">
      <button type="button" aria-pressed={metric === "receita_liquida"} onClick={() => setMetric("receita_liquida")}><span style={{ background: "var(--chart-1)" }} />Receita líquida</button>
      <button type="button" aria-pressed={metric === "resultado_liquido"} onClick={() => setMetric("resultado_liquido")}><span style={{ background: "var(--chart-2)" }} />Resultado líquido</button>
    </div>
    <div className={styles.chart}>
      {hasData ? <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height: 210 }}>
        <AreaChart data={data} margin={{ top: 14, right: 14, left: 2, bottom: 0 }} accessibilityLayer>
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={.22} /><stop offset="95%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "var(--text-3)", fontSize: 11 }} dy={8} />
          <YAxis width={65} tickFormatter={(value: number) => new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 0 }).format(value)} axisLine={false} tickLine={false} tick={{ fill: "var(--text-3)", fontSize: 10 }} tickMargin={8} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0]?.payload as typeof data[number] | undefined;
            if (!point) return null;
            return <div className={styles.tooltip}><span>{competenciaLabel(point.competencia)}</span><strong>{point.value != null ? formatBRL(point.value) : "Sem dados"}</strong><small>{point.partial ?? label}</small></div>;
          }} cursor={{ stroke: "var(--border-strong)", strokeDasharray: "4 4" }} />
          <Area type="monotone" dataKey="value" name={label} stroke={color} strokeWidth={3} fill={`url(#${id})`} connectNulls={false} dot={{ r: 3, strokeWidth: 2, fill: "var(--surface)" }} activeDot={{ r: 6, strokeWidth: 3, stroke: "var(--surface)" }} isAnimationActive={!reducedMotion} animationDuration={650} />
        </AreaChart>
      </ResponsiveContainer> : <p className={styles.chartEmpty}>Os valores aparecerão aqui quando houver dados para este indicador.</p>}
    </div>
    <details className={styles.chartData}><summary>Ver valores por mês</summary><table className="ork-table"><caption className="sr-only">{label} por competência</caption><thead><tr><th>Mês</th><th>Valor</th></tr></thead><tbody>{data.map((point) => <tr key={point.competencia}><td>{competenciaLabel(point.competencia)}</td><td>{point.value == null ? "Sem dados" : formatBRL(point.value)}{point.partial && <small className={styles.partial}>{point.partial}</small>}</td></tr>)}</tbody></table></details>
    {data.some((point) => point.partial) && <p className={styles.chartNote}>Há resultados parciais nesta série. Consulte os valores por mês para ver os detalhes.</p>}
  </section>;
}
