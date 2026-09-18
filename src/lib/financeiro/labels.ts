import type {
  CategoriaDespesa,
  CategoriaReceita,
  LancamentoNatureza,
  LancamentoRegime,
  LancamentoStatus,
  ApprovalStatus,
} from "@ork/db/types/database";

export const NATUREZA_LABELS: Record<LancamentoNatureza, string> = {
  receita: "Receita",
  despesa: "Despesa",
};

export const REGIME_LABELS: Record<LancamentoRegime, string> = {
  caixa: "Caixa",
  competencia: "Competência",
};

export const CATEGORIA_RECEITA_LABELS: Record<CategoriaReceita, string> = {
  vendas_salao: "Vendas Salão",
  vendas_delivery: "Vendas Delivery",
  vendas_bar: "Vendas Bar",
  eventos_private_dining: "Eventos / Private Dining",
  gorjeta: "Gorjeta",
  outras_receitas: "Outras Receitas",
};

export const CATEGORIA_DESPESA_LABELS: Record<CategoriaDespesa, string> = {
  // CMV
  cmv_cozinha: "CMV Cozinha",
  cmv_bar: "CMV Bar",
  cmv_delivery: "CMV Delivery",
  // Folha
  folha_salarios: "Salários",
  folha_encargos: "Encargos",
  folha_beneficios: "Benefícios",
  folha_gorjeta_repasse: "Repasse de Gorjeta",
  // Ocupação
  aluguel: "Aluguel",
  condominio: "Condomínio",
  iptu: "IPTU",
  // Utilidades
  energia_eletrica: "Energia Elétrica",
  gas: "Gás",
  agua: "Água",
  telefone_internet: "Telefone / Internet",
  // Operacional
  manutencao: "Manutenção",
  limpeza_higiene: "Limpeza / Higiene",
  uniformes_epi: "Uniformes / EPI",
  descartaveis_embalagens: "Descartáveis / Embalagens",
  // Comercial
  marketing_publicidade: "Marketing / Publicidade",
  delivery_taxas_plataforma: "Taxas de Plataforma (Delivery)",
  comissoes: "Comissões",
  // Administrativo
  contabilidade: "Contabilidade",
  juridico: "Jurídico",
  seguros: "Seguros",
  software_sistemas: "Software / Sistemas",
  cartao_taxas: "Taxas de Cartão",
  // Tributos
  pis_cofins: "PIS/COFINS",
  irpj_csll: "IRPJ/CSLL",
  iss: "ISS",
  outros_tributos: "Outros Tributos",
  // Capex
  depreciacao: "Depreciação",
  investimento_capex: "Investimento (CAPEX)",
  // Outros
  outras_despesas: "Outras Despesas",
};

export const CATEGORIA_DESPESA_GRUPOS: Record<
  string,
  ReadonlyArray<CategoriaDespesa>
> = {
  CMV: ["cmv_cozinha", "cmv_bar", "cmv_delivery"],
  Folha: [
    "folha_salarios",
    "folha_encargos",
    "folha_beneficios",
    "folha_gorjeta_repasse",
  ],
  Ocupação: ["aluguel", "condominio", "iptu"],
  Utilidades: ["energia_eletrica", "gas", "agua", "telefone_internet"],
  Operacional: [
    "manutencao",
    "limpeza_higiene",
    "uniformes_epi",
    "descartaveis_embalagens",
  ],
  Comercial: [
    "marketing_publicidade",
    "delivery_taxas_plataforma",
    "comissoes",
  ],
  Administrativo: [
    "contabilidade",
    "juridico",
    "seguros",
    "software_sistemas",
    "cartao_taxas",
  ],
  Tributos: ["pis_cofins", "irpj_csll", "iss", "outros_tributos"],
  Investimento: ["depreciacao", "investimento_capex"],
  Outros: ["outras_despesas"],
};

export const LANCAMENTO_STATUS_LABELS: Record<LancamentoStatus, string> = {
  rascunho: "Rascunho",
  pendente_aprovacao: "Pendente",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  pago: "Pago",
  cancelado: "Cancelado",
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
};

// Cores semânticas (bg/border/fg) por status — mesmo padrão do labels.ts de eventos.
export const STATUS_COLORS: Record<
  LancamentoStatus,
  { bg: string; border: string; fg: string }
> = {
  rascunho: {
    bg: "rgba(148,163,184,0.10)",
    border: "rgba(148,163,184,0.35)",
    fg: "#94A3B8",
  },
  pendente_aprovacao: {
    bg: "rgba(234,179,8,0.10)",
    border: "rgba(234,179,8,0.40)",
    fg: "#EAB308",
  },
  aprovado: {
    bg: "rgba(34,197,94,0.10)",
    border: "rgba(34,197,94,0.40)",
    fg: "#22C55E",
  },
  rejeitado: {
    bg: "rgba(239,68,68,0.10)",
    border: "rgba(239,68,68,0.40)",
    fg: "#EF4444",
  },
  pago: {
    bg: "rgba(59,130,246,0.10)",
    border: "rgba(59,130,246,0.40)",
    fg: "#3B82F6",
  },
  cancelado: {
    bg: "rgba(100,116,139,0.10)",
    border: "rgba(100,116,139,0.40)",
    fg: "#64748B",
  },
};

export const APPROVAL_COLORS: Record<
  ApprovalStatus,
  { bg: string; border: string; fg: string }
> = {
  pendente: STATUS_COLORS.pendente_aprovacao,
  aprovado: STATUS_COLORS.aprovado,
  rejeitado: STATUS_COLORS.rejeitado,
};

// Cores por severidade pra badges de gap/CMV/EBITDA.
export const SEVERITY_COLORS: Record<
  "ok" | "atencao" | "critico",
  { bg: string; border: string; fg: string }
> = {
  ok: STATUS_COLORS.aprovado,
  atencao: STATUS_COLORS.pendente_aprovacao,
  critico: STATUS_COLORS.rejeitado,
};

// Categorias de menu_items (mesma vibe das categorias do menu de eventos).
export const CMV_CATEGORIA_OPTIONS: ReadonlyArray<string> = [
  "entrada",
  "prato_principal",
  "sobremesa",
  "bebida_alcoolica",
  "bebida_nao_alcoolica",
  "bar",
  "outros",
];
