// Prazo de recebimento por forma de pagamento do PDV (receita_pagamentos.
// forma) — a venda já ocorreu (é receita, competência), mas o dinheiro só
// "entra" no caixa depois do prazo de liquidação daquela forma. Forma
// desconhecida — inclusive a linha de resumo "Relatório Geral de Vendas",
// que aparece em 79 dias sem detalhe por forma (ver PASSO 0) — é tratada
// como D+0 conservador (assume que já entrou) e reportada à parte na
// confiança da tela; nunca quebra o cálculo.
const PRAZO_DIAS_POR_FORMA: Record<string, number> = {
  "VENDA EM DINHEIRO": 0,
  "VENDA CARTÃO DÉBITO": 1,
  "VENDA CARTÃO CRÉDITO": 30,
  "VENDA SODEXO": 30,
}

export function prazoDiasPorForma(forma: string): { dias: number; conhecida: boolean } {
  const dias = PRAZO_DIAS_POR_FORMA[forma]
  return dias !== undefined ? { dias, conhecida: true } : { dias: 0, conhecida: false }
}

export function somarDias(dataIso: string, dias: number): string {
  const d = new Date(`${dataIso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}
