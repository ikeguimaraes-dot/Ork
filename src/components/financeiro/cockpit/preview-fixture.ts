/** Fictional, local visual QA data. Never used by the financial data loaders. */
import type { CockpitProps } from "./CockpitPainel";
import type { KpiSnapshotRow } from "./types";

export const PREVIEW_MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
export function previewData(partial = false): CockpitProps {
  const revenues = [318000, 346800, 332400, 381600, 398400, 426800];
  const kpiRows: KpiSnapshotRow[] = PREVIEW_MONTHS.map((competencia, index) => {
    const receita = revenues[index]!;
    const cmv = receita * (.31 - index * .008);
    const folha = receita * .23;
    const resultado = receita * (.095 + index * .013);
    return { unit_id: "preview", competencia, receita_bruta: receita * 1.06, receita_liquida: receita, cmv_compras: cmv, mao_de_obra: folha, despesas_operacionais: receita * .16, ebitda: resultado * 1.22, resultado_liquido: resultado, cmv_compras_pct: cmv / receita, mo_pct: .23, prime_cost_pct: (cmv + folha) / receita, ebitda_pct: resultado * 1.22 / receita, clientes: 2470 + index * 141, ticket_medio: receita * 1.06 / (2470 + index * 141), cmv_por_cliente: null, tem_nfe: !partial, tem_folha: true, pct_classificado: .93, fontes_ok: 4, fontes_total: 5, confianca_pct: partial ? .58 : .86, possivel_dupla_contagem: partial ? 2400 : 0 };
  });
  return {
    unidade: "preview", competencia: "2026-09", janela: PREVIEW_MONTHS, kpiRows,
    metas: [{ chave: "receita_liquida", valor: 450000, tipo: "valor", origem: "manual" }, { chave: "prime_cost_pct", valor: .6, tipo: "percentual", origem: "manual" }],
    planoContas: [
      { codigo: "1.01", nome: "Vendas do restaurante", grupo: "receita", ordem: 1 },
      { codigo: "2.01", nome: "Impostos sobre vendas", grupo: "deducao", ordem: 2 },
      { codigo: "3.01", nome: "Alimentos e bebidas", grupo: "cmv", ordem: 3 },
      { codigo: "4.01", nome: "Equipe e benefícios", grupo: "mao_de_obra", ordem: 4 },
      { codigo: "5.01", nome: "Despesas da operação", grupo: "despesa_operacional", ordem: 5 },
      { codigo: "9.99", nome: "Lançamentos a classificar", grupo: "despesa_operacional", ordem: 6 },
    ],
    dreRows: [
      { unit_id: "preview", conta_codigo: "1.01", valor: 452408, qtd_lancamentos: 3175 },
      { unit_id: "preview", conta_codigo: "2.01", valor: -25608, qtd_lancamentos: 12 },
      { unit_id: "preview", conta_codigo: "3.01", valor: -115236, qtd_lancamentos: 183 },
      { unit_id: "preview", conta_codigo: "4.01", valor: -98164, qtd_lancamentos: 42 },
      { unit_id: "preview", conta_codigo: "5.01", valor: -65208, qtd_lancamentos: 84 },
      { unit_id: "preview", conta_codigo: "9.99", valor: 3080, qtd_lancamentos: 8 },
    ],
    fontes: [
      { fonte: "Vendas", ultima_escrita: null, dias_sem_atualizacao: 0, status_fonte: "viva" },
      { fonte: "Notas fiscais", ultima_escrita: null, dias_sem_atualizacao: 1, status_fonte: "viva" },
      { fonte: "Folha de pagamento", ultima_escrita: null, dias_sem_atualizacao: 2, status_fonte: "viva" },
      { fonte: "Contas a pagar", ultima_escrita: null, dias_sem_atualizacao: 0, status_fonte: "viva" },
      { fonte: "Extratos bancários", ultima_escrita: null, dias_sem_atualizacao: 8, status_fonte: "atrasada" },
    ],
  };
}
