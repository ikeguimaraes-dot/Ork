import type {
  CategoriaDespesa,
  LancamentoNatureza,
  LancamentoStatus,
} from "@ork/db/types/database";

export type EntryFilters = {
  natureza?: LancamentoNatureza | null;
  status?: LancamentoStatus | null;
};

export type CmvFilters = {
  semFicha?: boolean;
  criticos?: boolean;
  categoria?: string | null;
};

export type FinanceiroResumoGrupo = {
  aprovacoes_pendentes: number;
  receita_mes_atual: number;
  despesa_mes_atual: number;
  ebitda_mes_atual: number;
  ebitda_pct_medio: number | null;
  cmv_pct_medio: number | null;
  itens_cmv_criticos: number;
};

export type BrandFinanceiroResumo = {
  brand_id: string;
  brand_slug: string;
  brand_name: string;
  brand_color: string;
  receita_bruta: number;
  cmv_pct: number | null;
  ebitda_pct: number | null;
  gap_pct_max: number | null;
  has_data: boolean;
};

// Linha agregada da DRE — categoria_despesa pode estar no namespace `tributos_*`
// já agregado pela view, então não tem o tipo exato aqui.
export type CategoriaDespesaPair = {
  categoria: CategoriaDespesa;
  valor: number;
};
