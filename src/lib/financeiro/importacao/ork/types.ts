export type ImportWarning = {
  code: string
  message: string
  file?: string
  sheet?: string
  row?: number
}

export type SourceRef = { file: string; sheet: string; row: number }

export type NfEntradaRow = SourceRef & {
  fornecedor: string
  dataEntrada: string
  competencia: string
  numeroNf: string | null
  produto: string
  valorTotal: number
  observacao: string | null
  desconto: number
  pedido: string | null
}

export type ContaPagarRow = SourceRef & {
  fornecedor: string
  dataEntrada: string | null
  numeroNf: string | null
  categoria: string | null
  valorTotalNf: number
  parcela: string | null
  vencimento: string
  competencia: string
  valorParcela: number
  liquidacao: string | null
}

export type ReceitaCaixaRow = SourceRef & {
  data: string
  turno: "almoco" | "jantar" | "nao_informado"
  clientes: number | null
  receitaBruta: number
  receitaLiquida: number
  taxaServico: number
  taxaColaborador: number
  taxaCasa: number
  taxaTerceiro: number
  pagamentos: Array<{ descricao: string; valor: number }>
}

export type OrkBatchPreview = {
  kind: "nf_entrada" | "contas_pagar" | "receita" | "folha" | "unknown"
  files: string[]
  records: NfEntradaRow[] | ContaPagarRow[] | ReceitaCaixaRow[]
  warnings: ImportWarning[]
  totals: Record<string, number>
}
