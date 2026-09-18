import type { ReactNode } from "react";

type Props = { label: string; value: ReactNode; sub?: ReactNode; trailing?: ReactNode; children?: ReactNode; accent?: string };

export function KpiCard({ label, value, sub, trailing, children, accent }: Props) {
  return <article className="ork-panel ork-kpi ork-enter">
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}><span className="ork-kpi-label" style={{ color: accent }}>{label}</span>{trailing}</header>
    <div className="ork-kpi-value">{value}</div>
    {sub && <div className="ork-kpi-sub">{sub}</div>}
    {children && <div>{children}</div>}
  </article>;
}
