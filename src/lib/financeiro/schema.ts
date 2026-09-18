import { z } from "zod";

import type {
  CategoriaDespesa,
  CategoriaReceita,
  LancamentoNatureza,
  LancamentoRegime,
} from "@ork/db/types/database";

export const NATUREZA_VALUES = [
  "receita",
  "despesa",
] as const satisfies readonly LancamentoNatureza[];

export const REGIME_VALUES = [
  "caixa",
  "competencia",
] as const satisfies readonly LancamentoRegime[];

export const CATEGORIA_RECEITA_VALUES = [
  "vendas_salao",
  "vendas_delivery",
  "vendas_bar",
  "eventos_private_dining",
  "gorjeta",
  "outras_receitas",
] as const satisfies readonly CategoriaReceita[];

export const CATEGORIA_DESPESA_VALUES = [
  "cmv_cozinha",
  "cmv_bar",
  "cmv_delivery",
  "folha_salarios",
  "folha_encargos",
  "folha_beneficios",
  "folha_gorjeta_repasse",
  "aluguel",
  "condominio",
  "iptu",
  "energia_eletrica",
  "gas",
  "agua",
  "telefone_internet",
  "manutencao",
  "limpeza_higiene",
  "uniformes_epi",
  "descartaveis_embalagens",
  "marketing_publicidade",
  "delivery_taxas_plataforma",
  "comissoes",
  "contabilidade",
  "juridico",
  "seguros",
  "software_sistemas",
  "cartao_taxas",
  "pis_cofins",
  "irpj_csll",
  "iss",
  "outros_tributos",
  "depreciacao",
  "investimento_capex",
  "outras_despesas",
] as const satisfies readonly CategoriaDespesa[];

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

const numericRequired = z
  .union([z.string(), z.number()])
  .transform((v) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : NaN;
  })
  .refine((n) => Number.isFinite(n), { message: "Valor inválido" });

const numericOptional = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });

// ── Period ─────────────────────────────────────────────────────
export const createPeriodSchema = z.object({
  brand_id: z.string().uuid(),
  unit_id: z.string().uuid().nullable().optional(),
  competencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Use formato YYYY-MM-DD (dia 1 do mês)",
  }),
});

// ── Entry ──────────────────────────────────────────────────────
// Validação cruzada: categoria condizente com natureza, valor > 0 e
// justificativa obrigatória quando passa do threshold.
export const createEntryBaseSchema = z.object({
  period_id: z.string().uuid(),
  natureza: z.enum(NATUREZA_VALUES),
  categoria_receita: z
    .enum(CATEGORIA_RECEITA_VALUES)
    .nullable()
    .optional(),
  categoria_despesa: z
    .enum(CATEGORIA_DESPESA_VALUES)
    .nullable()
    .optional(),
  descricao: z.string().min(1, "Descrição obrigatória"),
  valor: numericRequired.refine((n) => n > 0, {
    message: "Valor deve ser maior que zero",
  }),
  data_lancamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Data inválida",
  }),
  data_vencimento: optionalText,
  data_pagamento: optionalText,
  regime: z.enum(REGIME_VALUES).default("caixa"),
  fornecedor: optionalText,
  numero_documento: optionalText,
  centro_custo: optionalText,
  event_id: z.string().uuid().nullable().optional(),
  justificativa: optionalText,
  // threshold da marca, passado pela página pra validação local.
  threshold: numericOptional.optional(),
});

export const createEntrySchema = createEntryBaseSchema.superRefine(
  (data, ctx) => {
    if (data.natureza === "receita") {
      if (!data.categoria_receita) {
        ctx.addIssue({
          code: "custom",
          message: "Selecione uma categoria de receita",
          path: ["categoria_receita"],
        });
      }
      if (data.categoria_despesa) {
        ctx.addIssue({
          code: "custom",
          message: "Receita não pode ter categoria de despesa",
          path: ["categoria_despesa"],
        });
      }
    } else {
      if (!data.categoria_despesa) {
        ctx.addIssue({
          code: "custom",
          message: "Selecione uma categoria de despesa",
          path: ["categoria_despesa"],
        });
      }
      if (data.categoria_receita) {
        ctx.addIssue({
          code: "custom",
          message: "Despesa não pode ter categoria de receita",
          path: ["categoria_receita"],
        });
      }
    }
    if (
      data.threshold &&
      data.valor > data.threshold &&
      (!data.justificativa || data.justificativa.trim() === "")
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Justificativa obrigatória para lançamentos acima de ${data.threshold}`,
        path: ["justificativa"],
      });
    }
  },
);

export type CreateEntryInput = z.input<typeof createEntrySchema>;
export type CreateEntryOutput = z.output<typeof createEntrySchema>;

// ── Projection ─────────────────────────────────────────────────
export const createProjectionSchema = z
  .object({
    period_id: z.string().uuid(),
    natureza: z.enum(NATUREZA_VALUES),
    categoria_receita: z
      .enum(CATEGORIA_RECEITA_VALUES)
      .nullable()
      .optional(),
    categoria_despesa: z
      .enum(CATEGORIA_DESPESA_VALUES)
      .nullable()
      .optional(),
    descricao: optionalText,
    valor_projetado: numericRequired.refine((n) => n >= 0, {
      message: "Valor não pode ser negativo",
    }),
    is_evento: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.natureza === "receita" && !data.categoria_receita) {
      ctx.addIssue({
        code: "custom",
        message: "Selecione categoria de receita",
        path: ["categoria_receita"],
      });
    }
    if (data.natureza === "despesa" && !data.categoria_despesa) {
      ctx.addIssue({
        code: "custom",
        message: "Selecione categoria de despesa",
        path: ["categoria_despesa"],
      });
    }
  });

// ── CMV ────────────────────────────────────────────────────────
export const createMenuItemSchema = z.object({
  brand_id: z.string().uuid(),
  unit_id: z.string().uuid().nullable().optional(),
  nome: z.string().min(1, "Nome obrigatório"),
  categoria: z.string().min(1, "Categoria obrigatória"),
  preco_venda: numericRequired.refine((n) => n > 0, {
    message: "Preço de venda deve ser maior que zero",
  }),
  custo_total: numericOptional,
  tem_ficha_tecnica: z.boolean().optional().default(false),
  ativo: z.boolean().optional().default(true),
  observacoes: optionalText,
});

export type CreateMenuItemInput = z.input<typeof createMenuItemSchema>;

export const updateMenuItemSchema = createMenuItemSchema.partial();
export type UpdateMenuItemInput = z.input<typeof updateMenuItemSchema>;
