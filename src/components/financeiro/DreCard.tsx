import { SeverityBadge } from "./SeverityBadge";
import { formatBRL, formatPct, type Severity } from "@/lib/financeiro/utils";

type Props = {
  label: string;
  valor: number | null | undefined;
  /** Percentual sobre receita (opcional). */
  pct?: number | null;
  /** Meta de referência (opcional). */
  meta?: number | null;
  severity?: Severity;
  /** Linha em destaque (totais — receita bruta, despesa total, ebitda). */
  highlight?: boolean;
  /** Linha agregada (negrito, fundo levemente destacado). */
  emphasized?: boolean;
  /** Texto opcional sob o valor (ex: "Meta 28%"). */
  hint?: string;
};

/**
 * Linha de DRE: label + valor + (opcional) % + badge de severidade.
 * Layout em grid pra alinhar números à direita.
 */
export function DreCard({
  label,
  valor,
  pct,
  meta,
  severity,
  highlight,
  emphasized,
  hint,
}: Props) {
  const hintMeta =
    hint ?? (meta !== undefined && meta !== null ? `Meta ${formatPct(meta)}` : null);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        gap: 12,
        padding: highlight ? "12px 14px" : "8px 14px",
        background: highlight
          ? "var(--surface-2)"
          : emphasized
            ? "var(--surface)"
            : "transparent",
        borderRadius: highlight ? 10 : 6,
        border: highlight ? "1px solid var(--border-strong, var(--border))" : "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: highlight ? 12 : 11,
            fontWeight: highlight ? 700 : emphasized ? 600 : 500,
            color: highlight ? "var(--text)" : "var(--text-2)",
            letterSpacing: highlight ? 0.4 : 0,
            textTransform: highlight ? "uppercase" : "none",
          }}
        >
          {label}
        </span>
        {hintMeta && (
          <span
            style={{
              fontSize: 10,
              color: "var(--text-3)",
              letterSpacing: 0.3,
            }}
          >
            {hintMeta}
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        <span
          style={{
            fontSize: highlight ? 16 : 13,
            fontWeight: highlight ? 700 : 600,
            color: "var(--text)",
            letterSpacing: -0.2,
          }}
        >
          {formatBRL(valor)}
        </span>
        {pct !== null && pct !== undefined && severity ? (
          <SeverityBadge severity={severity}>{formatPct(pct)}</SeverityBadge>
        ) : pct !== null && pct !== undefined ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-3)",
            }}
          >
            {formatPct(pct)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
