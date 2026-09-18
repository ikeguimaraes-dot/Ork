import { SEVERITY_COLORS } from "@/lib/financeiro/labels";
import type { Severity } from "@/lib/financeiro/utils";

type Props = {
  severity: Severity;
  children: React.ReactNode;
};

const LABEL: Record<Severity, string> = {
  ok: "OK",
  atencao: "Atenção",
  critico: "Crítico",
};

/** Pílula colorida (verde/amarelo/vermelho) que envelopa um valor (ex: "23,3%"). */
export function SeverityBadge({ severity, children }: Props) {
  const c = SEVERITY_COLORS[severity];
  return (
    <span
      title={LABEL[severity]}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.fg,
        borderRadius: 99,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
