import { competenciaTitulo, hojeSaoPaulo } from "@/lib/financeiro/dates"
// Lógica pura da tela de Contas a Pagar — lê titulos_a_pagar diretamente.
// ref_mes é coluna legada do clone (nunca populada pelo pipeline atual) —
// NÃO USAR pra competência. Competência vem de d_competencia, com fallback
// pra date_trunc('month', d_vencimento) — mesma regra do razão (ver
// resolverCompetencia em gerar.ts). Título sem nenhuma das duas datas cai
// em "sem competência", mostrado à parte, nunca somado a um mês específico.
import { fetchAllPaginado } from "@/lib/financeiro/razao/gerar"
import { classificarLiquidacao } from "@/lib/financeiro/fluxo/liquidacao"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type OrigemTitulo = "contas_pagar" | "nf_pedidos"

export type Situacao = "pago" | "vencido" | "a_vencer" | "sem_confirmacao" | "sem_data"

export const SITUACAO_LABEL: Record<Situacao, string> = {
  pago: "Pago",
  vencido: "Vencido",
  a_vencer: "A vencer",
  sem_confirmacao: "Sem confirmação",
  sem_data: "Sem data de vencimento",
}

export type ReconciliacaoInfo = { status: string; chaveNfe: string } | null

export type TituloPagar = {
  id: string
  fornecedor: string | null
  categoria: string | null
  nNota: string | null
  parcela: string | null
  entrada: string | null
  vencimento: string | null
  valor: number
  situacao: Situacao
  liquidacaoOrigem: string | null
  contaRazao: string | null
  reconciliacao: ReconciliacaoInfo
  origem: OrigemTitulo
}

export type ResumoCategoria = {
  categoria: string
  qtdTitulos: number
  valor: number
  contaMapeada: string
  aClassificar: boolean
}

export type CardsPagar = {
  totalMes: number
  pago: number
  vencido: number
  aVencer: number
  semConfirmacao: number
  semDataVencimento: number
}

export type PagarResultado = {
  titulos: TituloPagar[]
  cards: CardsPagar
  resumoPorCategoria: ResumoCategoria[]
  semCompetencia: { qtd: number; valor: number }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function classificarSituacao(
  vencimento: string | null,
  liquidacaoOrigem: string | null,
  hojeIso: string
): Situacao {
  const status = classificarLiquidacao(liquidacaoOrigem)
  if (status === "pago") return "pago"
  if (!vencimento) return "sem_data"
  if (status === "indefinido") return "sem_confirmacao"
  return vencimento < hojeIso ? "vencido" : "a_vencer"
}

export async function calcularPagar(
  db: Db,
  unitId: string,
  competencia: string,
  origem: OrigemTitulo
): Promise<PagarResultado> {
  const todosOsTitulos = await fetchAllPaginado((from, to) =>
    db.from("titulos_a_pagar")
      .select("id,fantasia_fornecedor,razao_fornecedor,c_gerencial,descricao_c_gerencial,n_nota_fiscal,parcela,v_titulo,d_lancamento,d_vencimento,d_competencia,liquidacao_origem")
      .eq("unit_id", unitId)
      .eq("origem", origem)
      .range(from, to)
  ) as Array<{
    id: string; fantasia_fornecedor: string | null; razao_fornecedor: string | null
    c_gerencial: string | null; descricao_c_gerencial: string | null
    n_nota_fiscal: string | null; parcela: string | null; v_titulo: number | null
    d_lancamento: string | null; d_vencimento: string | null; d_competencia: string | null
    liquidacao_origem: string | null
  }>

  const hojeIso = hojeSaoPaulo()
  const doMes = todosOsTitulos.filter((t) => competenciaTitulo(t) === competencia)
  const semCompetenciaTitulos = todosOsTitulos.filter((t) => competenciaTitulo(t) === null)

  const ids = doMes.map((t) => t.id)
  const [lancamentosRows, reconciliacoesRows, regrasCategoria] = await Promise.all([
    ids.length === 0 ? [] : fetchAllPaginado((from, to) =>
      db.from("lancamentos").select("origem_id,conta_codigo").eq("origem", "titulo").in("origem_id", ids).range(from, to)
    ) as Promise<Array<{ origem_id: string; conta_codigo: string }>>,
    ids.length === 0 ? [] : fetchAllPaginado((from, to) =>
      db.from("reconciliacoes_sugeridas").select("titulo_id,status,chave_nfe").in("titulo_id", ids).range(from, to)
    ) as Promise<Array<{ titulo_id: string; status: string; chave_nfe: string }>>,
    fetchAllPaginado((from, to) =>
      db.from("regras_classificacao").select("unit_id,padrao,conta_codigo,prioridade")
        .eq("tipo", "categoria_gerencial").or(`unit_id.is.null,unit_id.eq.${unitId}`).range(from, to)
    ) as Promise<Array<{ unit_id: string | null; padrao: string; conta_codigo: string; prioridade: number }>>,
  ])

  const contaPorTituloId = new Map(lancamentosRows.map((l) => [l.origem_id, l.conta_codigo]))
  const reconciliacaoPorTituloId = new Map<string, ReconciliacaoInfo>()
  for (const r of reconciliacoesRows) {
    if (!reconciliacaoPorTituloId.has(r.titulo_id)) {
      reconciliacaoPorTituloId.set(r.titulo_id, { status: r.status, chaveNfe: r.chave_nfe })
    }
  }
  const contaPorCategoria = new Map<string, string>()
  for (const r of [...regrasCategoria].sort((a, b) => a.prioridade - b.prioridade)) {
    const chave = r.padrao.toUpperCase()
    if (!contaPorCategoria.has(chave)) contaPorCategoria.set(chave, r.conta_codigo)
  }

  const titulos: TituloPagar[] = doMes.map((t) => ({
    id: t.id,
    fornecedor: t.fantasia_fornecedor ?? t.razao_fornecedor,
    categoria: t.descricao_c_gerencial ?? t.c_gerencial,
    nNota: t.n_nota_fiscal,
    parcela: t.parcela,
    entrada: t.d_lancamento,
    vencimento: t.d_vencimento,
    valor: round2(Math.abs(Number(t.v_titulo ?? 0))),
    situacao: classificarSituacao(t.d_vencimento, t.liquidacao_origem, hojeIso),
    liquidacaoOrigem: t.liquidacao_origem,
    contaRazao: contaPorTituloId.get(t.id) ?? null,
    reconciliacao: reconciliacaoPorTituloId.get(t.id) ?? null,
    origem,
  }))

  const cards: CardsPagar = { totalMes: 0, pago: 0, vencido: 0, aVencer: 0, semConfirmacao: 0, semDataVencimento: 0 }
  for (const t of titulos) {
    cards.totalMes += t.valor
    if (t.situacao === "pago") cards.pago += t.valor
    else if (t.situacao === "vencido") cards.vencido += t.valor
    else if (t.situacao === "a_vencer") cards.aVencer += t.valor
    else if (t.situacao === "sem_confirmacao") cards.semConfirmacao += t.valor
    else if (t.situacao === "sem_data") cards.semDataVencimento += t.valor
  }
  cards.totalMes = round2(cards.totalMes)
  cards.pago = round2(cards.pago)
  cards.vencido = round2(cards.vencido)
  cards.aVencer = round2(cards.aVencer)
  cards.semConfirmacao = round2(cards.semConfirmacao)
  cards.semDataVencimento = round2(cards.semDataVencimento)

  const porCategoria = new Map<string, TituloPagar[]>()
  for (const t of titulos) {
    const chave = t.categoria ?? "Sem categoria"
    const arr = porCategoria.get(chave) ?? []
    arr.push(t)
    porCategoria.set(chave, arr)
  }
  const resumoPorCategoria: ResumoCategoria[] = [...porCategoria.entries()].map(([categoria, ts]) => {
    const contaMapeada = contaPorCategoria.get(categoria.toUpperCase()) ?? "9.99"
    return {
      categoria,
      qtdTitulos: ts.length,
      valor: round2(ts.reduce((s, t) => s + t.valor, 0)),
      contaMapeada,
      aClassificar: contaMapeada === "9.99",
    }
  }).sort((a, b) => b.valor - a.valor)

  return {
    titulos,
    cards,
    resumoPorCategoria,
    semCompetencia: {
      qtd: semCompetenciaTitulos.length,
      valor: round2(semCompetenciaTitulos.reduce((s, t) => s + Math.abs(Number(t.v_titulo ?? 0)), 0)),
    },
  }
}
