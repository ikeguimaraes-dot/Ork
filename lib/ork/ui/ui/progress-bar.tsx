type Props = {
  value: number;
  max: number;
  color?: string;
  /** Altura em px. Default 4. */
  height?: number;
};

/** Barra simples de progresso. CSS puro — sem libs. */
export function ProgressBar({ value, max, color, height = 4 }: Props) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fill = color ?? "var(--brand)";
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      style={{
        width: "100%",
        height,
        background: "var(--surface-3, var(--border))",
        borderRadius: 99,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: fill,
          transition: "width var(--t)",
        }}
      />
    </div>
  );
}
