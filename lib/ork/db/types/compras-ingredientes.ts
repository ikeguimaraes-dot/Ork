// Tipos do módulo de Ingredientes (migration 028_ingredientes.sql).
// NUMERIC do Postgres vem como string via PostgREST — use Number() nos cálculos do client.

export type IngredienteCategoria =
  | "proteina"
  | "verdura"
  | "legume"
  | "fruta"
  | "graos"
  | "laticinios"
  | "panificacao"
  | "bebida_alcoolica"
  | "bebida_nao_alcoolica"
  | "tempero"
  | "oleo_gordura"
  | "descartavel"
  | "limpeza"
  | "outro";

export type UnidadePadrao =
  | "kg"
  | "g"
  | "l"
  | "ml"
  | "un"
  | "cx"
  | "fardo"
  | "duzia";

export interface Ingredient {
  id: string;
  group_id: string;
  codigo: string | null;
  nome: string;
  categoria: IngredienteCategoria;
  unidade_padrao: UnidadePadrao;
  custo_padrao: string; // NUMERIC vem como string
  fornecedor_id: string | null;
  perdas_padrao: string | null;
  observacoes: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface IngredientInsert {
  group_id: string;
  nome: string;
  categoria: IngredienteCategoria;
  unidade_padrao: UnidadePadrao;
  custo_padrao?: number;
  codigo?: string | null;
  fornecedor_id?: string | null;
  perdas_padrao?: number | null;
  observacoes?: string | null;
  ativo?: boolean;
}

export type IngredientUpdate = Partial<Omit<IngredientInsert, "group_id">>;

// RecipeItem estendido — inclui ingredient_id e perda_pct da migration 028.
export interface RecipeItemExtended {
  id: string;
  menu_item_id: string;
  unit_id: string | null;
  insumo: string;
  unidade: string | null;
  quantidade: string; // NUMERIC → string
  custo_unitario: string;
  custo_total: string; // GENERATED ALWAYS AS (quantidade * custo_unitario)
  ingredient_id: string | null;
  perda_pct: string | null;
  created_at: string;
}

export interface RecipeItemWithIngredient extends RecipeItemExtended {
  ingredient: Ingredient | null;
}

export interface IngredientPriceHistory {
  id: string;
  ingredient_id: string;
  custo_anterior: string | null;
  custo_novo: string;
  motivo: string | null;
  changed_by: string | null;
  created_at: string;
}

export const CATEGORIA_LABELS: Record<IngredienteCategoria, string> = {
  proteina: "Proteína",
  verdura: "Verdura",
  legume: "Legume",
  fruta: "Fruta",
  graos: "Grãos e Cereais",
  laticinios: "Laticínios",
  panificacao: "Panificação",
  bebida_alcoolica: "Bebida Alcoólica",
  bebida_nao_alcoolica: "Bebida Não Alcoólica",
  tempero: "Tempero",
  oleo_gordura: "Óleo / Gordura",
  descartavel: "Descartável",
  limpeza: "Limpeza",
  outro: "Outro",
};

export const UNIDADE_LABELS: Record<UnidadePadrao, string> = {
  kg: "Quilograma",
  g: "Grama",
  l: "Litro",
  ml: "Mililitro",
  un: "Unidade",
  cx: "Caixa",
  fardo: "Fardo",
  duzia: "Dúzia",
};

export const INGREDIENTE_CATEGORIAS = Object.keys(
  CATEGORIA_LABELS,
) as IngredienteCategoria[];

export const UNIDADES_PADRAO = Object.keys(
  UNIDADE_LABELS,
) as UnidadePadrao[];
