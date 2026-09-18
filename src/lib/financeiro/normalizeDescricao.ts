// Normalização de descrição de produto para comparação de catálogo.
// Preserva números e calibres (12-14, AA, T8, GRAUDA) — só remove acento,
// pontuação e espaços redundantes. "14/16" e "14-16 LB" viram "14 16 LB".
export function normalizeDescricao(input: string): string {
  return input
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}
