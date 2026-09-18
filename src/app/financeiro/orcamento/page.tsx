import Link from "next/link";

import { requireUser } from "@ork/auth/server";
import {
  getOrcamentoData,
  getUnitsComDre,
  type DreAgregado,
  type OrcamentoMes,
} from "../actions-dre";
import { formatBRL, formatBRLCompact, formatPct } from "@/lib/financeiro/utils";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ brand?: string; ano?: string }>;

// ─── Helpers ──────────────────────────────────────────────────────

const MONTH_SHORT = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

function kpiValue(ag: DreAgregado | null, key: KpiKey): number | null {
  if (!ag) return null;
  const rev = ag.receita_bruta;
  switch (key) {
    case "receita_bruta":    return ag.receita_bruta;
    case "cmv_pct":          return ag.cmv_pct;
    case "pessoal_pct":      return ag.pessoal_pct;
    case "prime_cost_pct":   return ag.prime_cost_pct;
    case "ebitda_pct":       return ag.ebitda_pct;
    case "resultado_liquido":return ag.resultado_liquido;
    case "clientes":         return ag.clientes;
    case "ticket_medio":
      return ag.clientes > 0 ? rev / ag.clientes : null;
  }
}

type KpiKey =
  | "receita_bruta"
  | "cmv_pct"
  | "pessoal_pct"
  | "prime_cost_pct"
  | "ebitda_pct"
  | "resultado_liquido"
  | "clientes"
  | "ticket_medio";

type KpiDef = {
  key: KpiKey;
  label: string;
  fmt: (v: number | null) => string;
  /** true = realizado >= orcado → green (higher is better) */
  higherBetter: boolean;
  isPercent?: boolean;
};

const KPIS: KpiDef[] = [
  { key: "receita_bruta",    label: "Receita Bruta",    fmt: formatBRLCompact, higherBetter: true },
  { key: "cmv_pct",          label: "CMV %",            fmt: (v) => formatPct(v), higherBetter: false, isPercent: true },
  { key: "pessoal_pct",      label: "Pessoal %",        fmt: (v) => formatPct(v), higherBetter: false, isPercent: true },
  { key: "prime_cost_pct",   label: "Prime Cost %",     fmt: (v) => formatPct(v), higherBetter: false, isPercent: true },
  { key: "ebitda_pct",       label: "EBITDA %",         fmt: (v) => formatPct(v), higherBetter: true,  isPercent: true },
  { key: "resultado_liquido",label: "Resultado Líquido",fmt: formatBRL,        higherBetter: true },
  { key: "clientes",         label: "Clientes",         fmt: (v) => v === null ? "—" : Math.round(v).toLocaleString("pt-BR"), higherBetter: true },
  { key: "ticket_medio",    label: "Ticket Médio",     fmt: formatBRL,        higherBetter: true },
];

function deltaColor(delta: number | null, higherBetter: boolean): string {
  if (delta === null) return "var(--text-3)";
  const good = higherBetter ? delta >= 0 : delta <= 0;
  return good ? "#15803D" : "#B91C1C";
}

function fmtDelta(delta: number | null, kpi: KpiDef): string {
  if (delta === null) return "—";
  const prefix = delta > 0 ? "+" : "";
  if (kpi.isPercent) {
    return `${prefix}${delta.toFixed(1).replace(".", ",")}pp`;
  }
  if (kpi.key === "clientes") {
    return `${prefix}${Math.round(delta).toLocaleString("pt-BR")}`;
  }
  // BRL: compact with sign
  const abs = Math.abs(delta);
  const compact = formatBRLCompact(abs);
  return `${delta < 0 ? "−" : "+"}${compact.replace(/^R\$\s?/, "")}`;
}

// ─── YTD computation ──────────────────────────────────────────────

type YtdRow = {
  kpi: KpiDef;
  orcadoYtd: number | null;
  realizadoYtd: number | null;
};

function computeYtd(meses: OrcamentoMes[], kpi: KpiDef): YtdRow {
  // For raw values: sum; for %, re-derive from sums
  if (!kpi.isPercent) {
    let oSum: number | null = null;
    let rSum: number | null = null;
    for (const m of meses) {
      const ov = kpiValue(m.orcado, kpi.key);
      const rv = kpiValue(m.realizado, kpi.key);
      if (ov !== null) oSum = (oSum ?? 0) + ov;
      if (rv !== null) rSum = (rSum ?? 0) + rv;
    }
    return { kpi, orcadoYtd: oSum, realizadoYtd: rSum };
  }
  // For percentages: weighted average over months that have data
  // Weight = receita do mês
  let oNum = 0, oDen = 0;
  let rNum = 0, rDen = 0;
  for (const m of meses) {
    if (m.orcado) {
      const pct = kpiValue(m.orcado, kpi.key);
      const rev = m.orcado.receita_bruta;
      if (pct !== null && rev > 0) { oNum += pct * rev; oDen += rev; }
    }
    if (m.realizado) {
      const pct = kpiValue(m.realizado, kpi.key);
      const rev = m.realizado.receita_bruta;
      if (pct !== null && rev > 0) { rNum += pct * rev; rDen += rev; }
    }
  }
  return {
    kpi,
    orcadoYtd: oDen > 0 ? oNum / oDen : null,
    realizadoYtd: rDen > 0 ? rNum / rDen : null,
  };
}

// ─── Page ─────────────────────────────────────────────────────────

export default async function OrcamentoPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireUser();
  const sp = await searchParams;

  const ano = parseInt(sp.ano ?? String(new Date().getFullYear()), 10);
  const brandParam = sp.brand ?? "consolidado";

  const [allUnits, mesesConsolidado] = await Promise.all([
    getUnitsComDre(),
    getOrcamentoData(ano),
  ]);

  // Determine unit_ids for the selected brand filter
  let meses: OrcamentoMes[] = mesesConsolidado;
  let selectedBrandLabel = "Consolidado Grupo";
  let selectedBrandColor: string | null = null;

  if (brandParam !== "consolidado" && allUnits.length > 0) {
    const matchedUnits = allUnits.filter((u) => u.brand_slug === brandParam);
    if (matchedUnits.length > 0) {
      const unitIds = matchedUnits.map((u) => u.unit_id);
      meses = await getOrcamentoData(ano, unitIds);
      selectedBrandLabel = matchedUnits[0]!.brand_name;
      selectedBrandColor = matchedUnits[0]!.brand_color;
    }
  }

  // YTD only for months with at least orcado data
  const mesesComOrcado = meses.filter((m) => m.orcado !== null);
  const ytdRows = KPIS.map((kpi) => computeYtd(mesesComOrcado, kpi));

  const hasAnyData = meses.some((m) => m.orcado !== null || m.realizado !== null);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <Link
        href="/financeiro"
        style={{
          fontSize: 11,
          color: "var(--text-3)",
          textDecoration: "none",
          fontWeight: 600,
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        ← Financeiro
      </Link>

      <header style={{ margin: "10px 0 20px" }}>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: "var(--text)",
            letterSpacing: -0.5,
            margin: "0 0 4px",
          }}
        >
          Orçamento vs Realizado
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3)" }}>
          {ano} · Orçado | Realizado | Δ por mês
        </p>
      </header>

      {/* Tabs */}
      <nav
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <TabLink
          href={`?brand=consolidado&ano=${ano}`}
          active={brandParam === "consolidado"}
          color={null}
          label="Consolidado Grupo"
        />
        {allUnits.map((u) => (
          <TabLink
            key={u.unit_id}
            href={`?brand=${u.brand_slug}&ano=${ano}`}
            active={brandParam === u.brand_slug}
            color={u.brand_color}
            label={u.brand_name}
          />
        ))}
      </nav>

      {/* Active brand indicator */}
      {selectedBrandColor && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
            fontSize: 13,
            color: "var(--text-2)",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: selectedBrandColor,
              display: "inline-block",
            }}
          />
          {selectedBrandLabel}
        </div>
      )}

      {!hasAnyData ? (
        <div
          style={{
            padding: "56px 20px",
            textAlign: "center",
            background: "var(--surface)",
            border: "1px dashed var(--border)",
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
            Sem dados para {selectedBrandLabel} em {ano}
          </div>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
            Importe o orçamento e lançamentos realizados para esta marca.
          </p>
        </div>
      ) : (
        <>
          {/* Main table */}
          <div
            style={{
              overflowX: "auto",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              marginBottom: 28,
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 11,
                minWidth: 900,
              }}
            >
              <thead>
                {/* Month row */}
                <tr style={{ background: "var(--surface-2)" }}>
                  <th
                    rowSpan={2}
                    style={{
                      textAlign: "left",
                      padding: "8px 14px",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      color: "var(--text-3)",
                      borderBottom: "1px solid var(--border)",
                      minWidth: 150,
                      verticalAlign: "bottom",
                    }}
                  >
                    KPI
                  </th>
                  {meses.map((m) => (
                    <th
                      key={m.month}
                      colSpan={3}
                      style={{
                        textAlign: "center",
                        padding: "6px 0",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 0.6,
                        color:
                          m.realizado !== null
                            ? "var(--text)"
                            : m.orcado !== null
                            ? "var(--text-2)"
                            : "var(--text-3)",
                        borderLeft: "1px solid var(--border)",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      {MONTH_SHORT[m.month - 1]}
                      {m.realizado !== null && (
                        <span
                          style={{
                            display: "inline-block",
                            width: 5,
                            height: 5,
                            borderRadius: 99,
                            background: "#22C55E",
                            marginLeft: 4,
                            verticalAlign: "middle",
                          }}
                        />
                      )}
                    </th>
                  ))}
                  {/* YTD column */}
                  <th
                    colSpan={3}
                    style={{
                      textAlign: "center",
                      padding: "6px 0",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.6,
                      color: "var(--brand)",
                      borderLeft: "2px solid var(--border)",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    YTD
                  </th>
                </tr>
                {/* Sub-header: Orç | Real | Δ */}
                <tr style={{ background: "var(--surface-2)" }}>
                  {meses.map((m) => (
                    <SubHeaders key={m.month} />
                  ))}
                  <SubHeaders ytd />
                </tr>
              </thead>
              <tbody>
                {KPIS.map((kpi, ki) => {
                  const ytd = ytdRows[ki]!;
                  return (
                    <tr
                      key={kpi.key}
                      style={{
                        borderTop: "1px solid var(--border)",
                        background:
                          kpi.key === "ebitda_pct" || kpi.key === "resultado_liquido"
                            ? "var(--surface-2)"
                            : undefined,
                      }}
                    >
                      <td
                        style={{
                          padding: "7px 14px",
                          fontSize: 11,
                          fontWeight:
                            kpi.key === "ebitda_pct" || kpi.key === "resultado_liquido"
                              ? 700
                              : 400,
                          color: "var(--text-2)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {kpi.label}
                      </td>
                      {meses.map((m) => {
                        const ov = kpiValue(m.orcado, kpi.key);
                        const rv = kpiValue(m.realizado, kpi.key);
                        const delta = ov !== null && rv !== null ? rv - ov : null;
                        return (
                          <OrcCells
                            key={m.month}
                            orcado={ov}
                            realizado={rv}
                            delta={delta}
                            kpi={kpi}
                          />
                        );
                      })}
                      {/* YTD cells */}
                      {(() => {
                        const ov = ytd.orcadoYtd;
                        const rv = ytd.realizadoYtd;
                        const delta = ov !== null && rv !== null ? rv - ov : null;
                        return (
                          <OrcCells
                            orcado={ov}
                            realizado={rv}
                            delta={delta}
                            kpi={kpi}
                            isYtd
                          />
                        );
                      })()}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div
            style={{
              display: "flex",
              gap: 20,
              fontSize: 11,
              color: "var(--text-3)",
              marginBottom: 8,
            }}
          >
            <span>
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: "#22C55E",
                  marginRight: 4,
                  verticalAlign: "middle",
                }}
              />
              Meses com dado realizado
            </span>
            <span>Δ = Realizado − Orçado</span>
            <span style={{ color: "#15803D" }}>Verde = favorável</span>
            <span style={{ color: "#B91C1C" }}>Vermelho = desfavorável</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function TabLink({
  href,
  active,
  color,
  label,
}: {
  href: string;
  active: boolean;
  color: string | null;
  label: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        borderRadius: 99,
        background: active ? "var(--brand)" : "var(--surface)",
        border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
        color: active ? "#fff" : "var(--text-2)",
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {color && (
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 99,
            background: color,
            display: "inline-block",
          }}
        />
      )}
      {label}
    </Link>
  );
}

function SubHeaders({ ytd }: { ytd?: boolean }) {
  const borderLeft = ytd ? "2px solid var(--border)" : "1px solid var(--border)";
  const style = (extra?: React.CSSProperties): React.CSSProperties => ({
    textAlign: "right" as const,
    padding: "4px 8px",
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
    color: "var(--text-3)",
    borderBottom: "1px solid var(--border)",
    ...extra,
  });
  return (
    <>
      <th style={style({ borderLeft })} title="Orçado">Orç</th>
      <th style={style()} title="Realizado">Real</th>
      <th style={style()} title="Delta realizado vs orçado">Δ</th>
    </>
  );
}

function OrcCells({
  orcado,
  realizado,
  delta,
  kpi,
  isYtd,
}: {
  orcado: number | null;
  realizado: number | null;
  delta: number | null;
  kpi: KpiDef;
  isYtd?: boolean;
}) {
  const borderLeft = isYtd ? "2px solid var(--border)" : "1px solid var(--border)";
  const tdStyle = (extra?: React.CSSProperties): React.CSSProperties => ({
    textAlign: "right" as const,
    padding: "6px 8px",
    fontVariantNumeric: "tabular-nums" as const,
    whiteSpace: "nowrap" as const,
    ...extra,
  });

  const dc = deltaColor(delta, kpi.higherBetter);

  return (
    <>
      <td style={tdStyle({ borderLeft, color: "var(--text-3)" })}>
        {orcado === null ? "—" : kpi.fmt(orcado)}
      </td>
      <td style={tdStyle({ color: realizado === null ? "var(--text-3)" : "var(--text)" })}>
        {realizado === null ? "—" : kpi.fmt(realizado)}
      </td>
      <td
        style={tdStyle({
          color: dc,
          fontWeight: delta !== null && delta !== 0 ? 700 : 400,
        })}
      >
        {delta === null ? "—" : delta === 0 ? "=" : fmtDelta(delta, kpi)}
      </td>
    </>
  );
}
