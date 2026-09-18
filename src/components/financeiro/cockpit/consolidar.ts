import type { KpiSnapshotRow } from "./types";

// "Consolidado" soma os valores absolutos das duas units e recalcula os
// percentuais a partir da soma — nunca faz média de percentual, que
// distorce quando as units têm porte diferente. pct_classificado e
// confianca_pct são ponderados pela receita líquida de cada unidade (não
// temos o "valor total de lançamentos" aqui pra ponderar por isso).
export function consolidarKpi(rows: KpiSnapshotRow[]): KpiSnapshotRow | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0]!;

  const soma = (f: (r: KpiSnapshotRow) => number | null) =>
    rows.reduce((s, r) => s + (f(r) ?? 0), 0);

  const receitaBruta = soma((r) => r.receita_bruta);
  const receitaLiquida = soma((r) => r.receita_liquida);
  const cmv = soma((r) => r.cmv_compras);
  const maoDeObra = soma((r) => r.mao_de_obra);
  const despesaOp = soma((r) => r.despesas_operacionais);
  const ebitda = soma((r) => r.ebitda);
  const resultadoLiquido = soma((r) => r.resultado_liquido);
  const clientes = rows.some((r) => r.clientes != null) ? soma((r) => r.clientes) : null;
  const ticketMedio = clientes && clientes > 0 ? receitaBruta / clientes : null;
  const cmvPorCliente = clientes && clientes > 0 ? cmv / clientes : null;
  const pct = (v: number): number | null => (receitaLiquida > 0 ? v / receitaLiquida : null);

  const pesoPor = (r: KpiSnapshotRow) => Math.abs(r.receita_liquida ?? 0);
  const mediaPonderada = (f: (r: KpiSnapshotRow) => number | null): number | null => {
    const validos = rows.filter((r) => f(r) != null && pesoPor(r) > 0);
    const pesoTotal = validos.reduce((s, r) => s + pesoPor(r), 0);
    if (pesoTotal <= 0) return null;
    return validos.reduce((s, r) => s + f(r)! * pesoPor(r), 0) / pesoTotal;
  };

  return {
    unit_id: "consolidado",
    competencia: rows[0]!.competencia,
    receita_bruta: receitaBruta,
    receita_liquida: receitaLiquida,
    cmv_compras: cmv,
    mao_de_obra: maoDeObra,
    despesas_operacionais: despesaOp,
    ebitda,
    resultado_liquido: resultadoLiquido,
    cmv_compras_pct: pct(cmv),
    mo_pct: pct(maoDeObra),
    prime_cost_pct: pct(cmv + maoDeObra),
    ebitda_pct: pct(ebitda),
    clientes,
    ticket_medio: ticketMedio,
    cmv_por_cliente: cmvPorCliente,
    tem_nfe: rows.some((r) => r.tem_nfe),
    tem_folha: rows.some((r) => r.tem_folha),
    pct_classificado: mediaPonderada((r) => r.pct_classificado),
    // v_fonte_saude é global — mesma leitura pras duas units, não soma.
    fontes_ok: rows[0]!.fontes_ok,
    fontes_total: rows[0]!.fontes_total,
    confianca_pct: mediaPonderada((r) => r.confianca_pct),
    possivel_dupla_contagem: soma((r) => r.possivel_dupla_contagem),
  };
}

export function agruparPorCompetencia(
  rows: KpiSnapshotRow[],
  janela: string[],
  unidade: string,
): Map<string, KpiSnapshotRow | null> {
  const mapa = new Map<string, KpiSnapshotRow | null>();
  for (const c of janela) {
    const doMes = rows.filter((r) => r.competencia === c);
    mapa.set(c, unidade === "consolidado" ? consolidarKpi(doMes) : doMes[0] ?? null);
  }
  return mapa;
}
