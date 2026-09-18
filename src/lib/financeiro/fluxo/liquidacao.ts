// Classificação de título por liquidacao_origem — três estados, não dois.
// 'pago' e 'nao_pago' são informação AFIRMATIVA (alguém marcou "OK" ou "*").
// 'indefinido' é AUSÊNCIA de informação — não sabemos se foi pago, e é o
// maior bloco em valor (~1/3 dos títulos). Tratar indefinido como nao_pago
// esconderia a maior incerteza do fluxo.
export type StatusLiquidacao = "pago" | "nao_pago" | "indefinido"

export function classificarLiquidacao(liquidacaoOrigem: string | null): StatusLiquidacao {
  if (liquidacaoOrigem == null) return "indefinido"
  const v = liquidacaoOrigem.trim().toUpperCase()
  if (!v) return "indefinido"
  if (v.startsWith("OK") || v === "OIK") return "pago"
  return "nao_pago"
}
