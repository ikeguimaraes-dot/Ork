// Extrai o calibre (ex.: "14-16", "12/14") embutido numa descrição de
// produto — usado tanto na geração automática do catálogo (cmv/actions.ts)
// quanto na detecção de produtos duplicados (conferência).
export function extrairCalibre(texto: string): { texto: string; calibre: string | null } {
  const match = texto.match(/\b(\d{1,3})\s*[-/]\s*(\d{1,3})/)
  if (!match || match.index === undefined) return { texto, calibre: null }
  const calibre = `${match[1]}-${match[2]}`
  const semCalibre = texto.slice(0, match.index) + texto.slice(match.index + match[0].length)
  return { texto: semCalibre, calibre }
}
