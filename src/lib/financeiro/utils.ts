// Utilities compartilhados pelos componentes do Financeiro.
// Server-safe — todos os formatters usam Intl.* e fuso America/Sao_Paulo.

const TZ = "America/Sao_Paulo";

export const brlFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const brlCompactFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const competenciaFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  month: "long",
  year: "numeric",
});

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return brlFmt.format(value);
}

export function formatBRLCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return brlCompactFmt.format(value);
}

export function formatPct(
  value: number | null | undefined,
  digits = 1,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits).replace(".", ",")}%`;
}

export type Severity = "ok" | "atencao" | "critico";

/**
 * CMV semáforo:
 *   ok       < 30%
 *   atenção  30–40%
 *   crítico  > 40%
 * null → 'atencao' (sem ficha técnica = atenção).
 */
export function getCmvSeverity(pct: number | null | undefined): Severity {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "atencao";
  if (pct > 40) return "critico";
  if (pct >= 30) return "atencao";
  return "ok";
}

/**
 * Gap projeção × realizado:
 *   ok       |gap| < 5%
 *   atenção  5–10%
 *   crítico  > 10%
 */
export function getGapSeverity(pct: number | null | undefined): Severity {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "ok";
  const abs = Math.abs(pct);
  if (abs > 10) return "critico";
  if (abs >= 5) return "atencao";
  return "ok";
}

/**
 * EBITDA:
 *   ok       > 15%
 *   atenção  8–15%
 *   crítico  < 8%
 * Receita zero → crítico (sem operação).
 */
export function getEbitdaSeverity(pct: number | null | undefined): Severity {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "critico";
  if (pct > 15) return "ok";
  if (pct >= 8) return "atencao";
  return "critico";
}

/** "2026-04-01" → "Abril 2026" (capitaliza primeira letra). */
export function competenciaLabel(date: string | Date): string {
  const d = typeof date === "string" ? new Date(`${date.slice(0, 10)}T12:00:00`) : date;
  const s = competenciaFmt.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Primeiro dia do mês atual no fuso SP, formato "YYYY-MM-DD". */
export function getCompetenciaAtual(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  const y = parts.year ?? "1970";
  const m = parts.month ?? "01";
  return `${y}-${m}-01`;
}

/** Soma N meses a uma competencia "YYYY-MM-DD" e retorna mesmo formato. */
export function competenciaShift(
  competencia: string,
  deltaMonths: number,
): string {
  const [yStr, mStr] = competencia.split("-");
  let y = parseInt(yStr ?? "1970", 10);
  let m = parseInt(mStr ?? "1", 10) + deltaMonths;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

export function pctRealizado(
  realizado: number,
  previsto: number,
): number {
  if (previsto <= 0) return 0;
  return Math.min(100, Math.max(0, (realizado / previsto) * 100));
}
