import type { KpiSnapshotRow } from "./types";

export type MetricKey = "receita_liquida" | "resultado_liquido" | "cmv_compras_pct" | "mo_pct" | "prime_cost_pct" | "ebitda_pct" | "clientes" | "ticket_medio";
const percentages = new Set<MetricKey>(["cmv_compras_pct", "mo_pct", "prime_cost_pct", "ebitda_pct"]);
const costs = new Set<MetricKey>(["cmv_compras_pct", "mo_pct", "prime_cost_pct"]);

export function metricPresentation(row: KpiSnapshotRow | null | undefined, key: MetricKey) {
  if (!row) return { value: null, missing: "Sem dados no período", partial: undefined };
  const missingSources = [!row.tem_nfe && "compras", !row.tem_folha && "folha"].filter(Boolean).join(" e ");
  let missing: string | undefined;
  let partial: string | undefined;
  if (percentages.has(key) && !row.receita_bruta) missing = "Receita ainda não importada";
  else if (key === "cmv_compras_pct" && !row.tem_nfe) missing = "Compras ainda não importadas";
  else if (key === "mo_pct" && !row.tem_folha) missing = "Folha ainda não importada";
  else if (key === "prime_cost_pct" && missingSources) missing = `Faltam dados de ${missingSources}`;
  else if ((key === "resultado_liquido" || key === "ebitda_pct") && missingSources) partial = `Parcial · faltam ${missingSources}`;
  const raw = row[key];
  const value = missing || raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
  return { value, missing: missing ?? (value == null ? "Sem dados no período" : undefined), partial };
}

export function metricDelta(key: MetricKey, current: number | null, previous: number | null, comparable = true) {
  if (!comparable || current == null || previous == null || previous === 0) return null;
  // Percentage KPIs compare in percentage points; monetary/count KPIs in percent.
  const percentagePoints = percentages.has(key);
  const value = percentagePoints ? (current - previous) * 100 : ((current - previous) / Math.abs(previous)) * 100;
  const good = costs.has(key) ? value < 0 : value > 0;
  return { value, unit: percentagePoints ? "p.p." : "%", tone: value === 0 ? "neutral" : good ? "success" : "danger" };
}

/** Separate SVG paths preserve missing months instead of bridging over them. */
export function sparklinePaths(values: Array<number | null>, width = 100, height = 32) {
  const valid = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (valid.length < 2) return [];
  const min = Math.min(...valid), max = Math.max(...valid);
  const range = max - min;
  const paths: string[] = [];
  let segment = "";
  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) { if (segment) paths.push(segment); segment = ""; return; }
    const x = 2 + index * ((width - 4) / Math.max(1, values.length - 1));
    const y = range ? height - 3 - ((value - min) / range) * (height - 6) : height / 2;
    segment += `${segment ? " L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  if (segment) paths.push(segment);
  return paths;
}
