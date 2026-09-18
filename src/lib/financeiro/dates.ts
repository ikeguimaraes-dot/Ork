export function hojeSaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function competenciaTitulo(t: { d_competencia?: string | null; d_lancamento?: string | null; d_vencimento?: string | null }): string | null {
  const date = t.d_competencia ?? t.d_lancamento ?? t.d_vencimento;
  return date ? `${date.slice(0, 7)}-01` : null;
}
