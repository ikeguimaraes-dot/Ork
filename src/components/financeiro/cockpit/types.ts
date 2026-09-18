export type KpiSnapshotRow = {
  unit_id: string;
  competencia: string;
  receita_bruta: number | null;
  receita_liquida: number | null;
  cmv_compras: number | null;
  mao_de_obra: number | null;
  despesas_operacionais: number | null;
  ebitda: number | null;
  resultado_liquido: number | null;
  cmv_compras_pct: number | null;
  mo_pct: number | null;
  prime_cost_pct: number | null;
  ebitda_pct: number | null;
  clientes: number | null;
  ticket_medio: number | null;
  cmv_por_cliente: number | null;
  tem_nfe: boolean;
  tem_folha: boolean;
  pct_classificado: number | null;
  fontes_ok: number | null;
  fontes_total: number | null;
  confianca_pct: number | null;
  possivel_dupla_contagem: number | null;
};

export type DreSnapshotRow = {
  unit_id: string;
  conta_codigo: string;
  valor: number;
  qtd_lancamentos: number;
};

export type PlanoContaRow = {
  codigo: string;
  nome: string;
  grupo: string;
  ordem: number;
};

export type MetaRow = {
  chave: string;
  valor: number;
  tipo: string;
  origem: string;
};

export type FonteSaudeRow = {
  fonte: string;
  ultima_escrita: string | null;
  dias_sem_atualizacao: number | null;
  status_fonte: string;
};
