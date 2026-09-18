// Lógica pura da tela de Conferência — GRUPO 4 (Anomalia).
import { fetchAllPaginado } from "@/lib/financeiro/razao/gerar"
import { calcularDivergenciasContasPagarNotas } from "@/lib/financeiro/divergencias/calcularDivergencias"
import { getEvolucaoPorCompra } from "@/app/financeiro/dre/cmv/actions"
import { type Alerta, type AlertaOcorrencia, montarAlerta, round2, competenciaFim } from "./calcularAlertas"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

// Bonificação (item de brinde/promocional) não é compra real: v_total_danfe
// 0 ou 0,01 — mesmo critério de getEvolucaoPorCompra().
function ehBonificacao(vTotalDanfe: number | null): boolean {
  return vTotalDanfe === 0 || vTotalDanfe === 0.01
}

// ── 4.1 · Item de NF-e com custo unitário 3x acima da média histórica ──────
// Média histórica calculada em TODAS as unidades (amostra maior, catálogo é
// compartilhado); só os itens da unidade+competência selecionada são
// flagados contra essa média.
const MULTIPLO_ANOMALIA = 3

export async function calcularAlertaCustoUnitarioAnomalo(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const ano = Number(competencia.slice(0, 4))
  const mes = Number(competencia.slice(5, 7))

  const linhas = await fetchAllPaginado((from, to) =>
    db.from("produtos_relatorio")
      .select("unit_id,fornecedor_codigo,item_codigo,item_descricao,v_custo_compra,v_total_danfe,chave_nfe,nr_danfe,mes_lancamento,ano_lancamento")
      .eq("direcao_nfe", "entrada")
      .not("fornecedor_codigo", "is", null).not("item_codigo", "is", null).not("v_custo_compra", "is", null)
      .range(from, to)
  ) as Array<{
    unit_id: string; fornecedor_codigo: string; item_codigo: string; item_descricao: string | null
    v_custo_compra: number | null; v_total_danfe: number | null; chave_nfe: string | null; nr_danfe: string | null
    mes_lancamento: number; ano_lancamento: number
  }>
  const validas = linhas.filter((l) => !ehBonificacao(l.v_total_danfe))

  const deparaRows = await fetchAllPaginado((from, to) =>
    db.from("produtos_depara").select("fornecedor_cnpj,item_codigo,produto_id").range(from, to)
  ) as Array<{ fornecedor_cnpj: string; item_codigo: string; produto_id: string | null }>
  const produtoIdPorPar = new Map(deparaRows.filter((d) => d.produto_id).map((d) => [`${d.fornecedor_cnpj}|${d.item_codigo}`, d.produto_id!]))

  const somaPorProduto = new Map<string, { soma: number; qtd: number }>()
  for (const l of validas) {
    const produtoId = produtoIdPorPar.get(`${l.fornecedor_codigo}|${l.item_codigo}`)
    if (!produtoId) continue
    const atual = somaPorProduto.get(produtoId) ?? { soma: 0, qtd: 0 }
    atual.soma += Number(l.v_custo_compra ?? 0)
    atual.qtd += 1
    somaPorProduto.set(produtoId, atual)
  }
  const mediaPorProduto = new Map<string, number>()
  for (const [produtoId, { soma, qtd }] of somaPorProduto) if (qtd > 0) mediaPorProduto.set(produtoId, soma / qtd)

  const produtoIds = [...new Set(produtoIdPorPar.values())]
  const catalogoRows = produtoIds.length === 0 ? [] : await fetchAllPaginado((from, to) =>
    db.from("produtos_catalogo").select("id,codigo,nome").in("id", produtoIds).range(from, to)
  ) as Array<{ id: string; codigo: string; nome: string }>
  const catalogoPorId = new Map(catalogoRows.map((c) => [c.id, c]))

  const ocorrencias: AlertaOcorrencia[] = []
  for (const l of validas) {
    if (l.unit_id !== unitId || l.mes_lancamento !== mes || l.ano_lancamento !== ano) continue
    const produtoId = produtoIdPorPar.get(`${l.fornecedor_codigo}|${l.item_codigo}`)
    if (!produtoId) continue
    const media = mediaPorProduto.get(produtoId)
    const custoAtual = Number(l.v_custo_compra ?? 0)
    if (!media || media <= 0 || custoAtual <= media * MULTIPLO_ANOMALIA) continue
    const catalogo = catalogoPorId.get(produtoId)
    ocorrencias.push({
      chave: `${l.chave_nfe}|${l.item_codigo}`,
      descricao: `${catalogo?.nome ?? l.item_descricao ?? "Produto"} · custo unitário ${round2(custoAtual)} vs. média histórica ${round2(media)} (nota ${l.nr_danfe ?? "?"})`,
      valor: round2(custoAtual),
    })
  }

  return montarAlerta({
    alertaChave: "4.1_custo_unitario_anomalo",
    grupo: 4,
    titulo: "Item de NF-e com custo unitário muito acima da média",
    motivo: "O custo unitário deste item está 3x ou mais acima da média histórica do mesmo produto no catálogo.",
    severidade: "atencao",
    link: "/financeiro/dre/cmv",
    ocorrencias,
  })
}

// ── 4.2 · Bonificação acima de R$1.000 no mês ───────────────────────────────
const LIMITE_BONIFICACAO_MES = 1000

export async function calcularAlertaBonificacaoAlta(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const ano = Number(competencia.slice(0, 4))
  const mes = Number(competencia.slice(5, 7))

  const linhas = await fetchAllPaginado((from, to) =>
    db.from("produtos_relatorio")
      .select("item_descricao,v_custo_total,v_total_danfe,chave_nfe,nr_danfe,fornecedor_nome")
      .eq("unit_id", unitId).eq("direcao_nfe", "entrada")
      .eq("mes_lancamento", mes).eq("ano_lancamento", ano)
      .in("v_total_danfe", [0, 0.01])
      .range(from, to)
  ) as Array<{
    item_descricao: string | null; v_custo_total: number | null; v_total_danfe: number | null
    chave_nfe: string | null; nr_danfe: string | null; fornecedor_nome: string | null
  }>

  const total = linhas.reduce((s, l) => s + Math.abs(Number(l.v_custo_total ?? 0)), 0)
  const ocorrencias: AlertaOcorrencia[] = total > LIMITE_BONIFICACAO_MES
    ? linhas.map((l) => ({
        chave: `${l.chave_nfe}|${l.item_descricao}`,
        descricao: `${l.fornecedor_nome ?? "Fornecedor não identificado"} · ${l.item_descricao ?? "item"} · nota ${l.nr_danfe ?? "?"} (bonificação)`,
        valor: round2(Math.abs(Number(l.v_custo_total ?? 0))),
      }))
    : []

  return montarAlerta({
    alertaChave: "4.2_bonificacao_alta",
    grupo: 4,
    titulo: "Bonificação acima de R$1.000 no mês",
    motivo: "O total de itens recebidos como bonificação (nota com valor zerado) neste mês passa de R$1.000 em custo equivalente.",
    severidade: "atencao",
    link: "/financeiro/dre/cmv",
    ocorrencias,
  })
}

// ── 4.3 · Nota fiscal sem título correspondente (lista D) ───────────────────
// Reaproveita xmlSemTitulo já calculado em calcularDivergenciasContasPagarNotas.
export async function calcularAlertaNotaSemTitulo(db: Db, unitId: string, unitNome: string, competencia: string): Promise<Alerta | null> {
  const resultado = await calcularDivergenciasContasPagarNotas(db, unitId, unitNome, competencia)
  const ocorrencias: AlertaOcorrencia[] = resultado.xmlSemTitulo.map((i) => ({
    chave: i.chave,
    descricao: `${i.fornecedor ?? "Fornecedor não identificado"} · Nota ${i.nNota ?? "?"}`,
    valor: i.valor,
  }))
  return montarAlerta({
    alertaChave: "4.3_nota_sem_titulo",
    grupo: 4,
    titulo: "Nota fiscal sem título correspondente",
    motivo: "Existe uma NF-e de entrada no fisco para este período sem nenhum título correspondente na planilha de contas a pagar.",
    severidade: "atencao",
    link: "/financeiro/dre/divergencias",
    ocorrencias,
  })
}

// ── 4.4 · Variação de preço de compra acima de 30% ──────────────────────────
// Reaproveita getEvolucaoPorCompra(), que já compara cada compra contra a
// compra ANTERIOR do mesmo produto (não contra a média).
const VARIACAO_MINIMA_PCT = 30

export async function calcularAlertaVariacaoPrecoCompra(unitId: string, competencia: string): Promise<Alerta | null> {
  const fim = competenciaFim(competencia)
  const evolucao = await getEvolucaoPorCompra(unitId)

  const ocorrencias: AlertaOcorrencia[] = []
  for (const produto of evolucao) {
    for (const compra of produto.compras) {
      if (!compra.data || compra.data < competencia || compra.data >= fim) continue
      if (compra.varPct == null || Math.abs(compra.varPct) <= VARIACAO_MINIMA_PCT) continue
      ocorrencias.push({
        chave: `${produto.produtoId}|${compra.chaveNfe}`,
        descricao: `${produto.nome} · ${compra.fornecedor ?? "fornecedor não identificado"} · variação de ${compra.varPct.toFixed(1)}% frente à compra anterior (nota ${compra.nrDanfe ?? "?"})`,
        valor: Math.abs(compra.custoUnitario ?? 0),
      })
    }
  }

  return montarAlerta({
    alertaChave: "4.4_variacao_preco_compra",
    grupo: 4,
    titulo: "Variação de preço de compra acima de 30%",
    motivo: "O custo unitário deste item variou mais de 30% frente à compra anterior do mesmo produto.",
    severidade: "atencao",
    link: "/financeiro/dre/cmv",
    ocorrencias,
  })
}

export async function calcularAlertasGrupo4(
  db: Db,
  unitId: string,
  unitNome: string,
  competencia: string
): Promise<Alerta[]> {
  const alertas = await Promise.all([
    calcularAlertaCustoUnitarioAnomalo(db, unitId, competencia),
    calcularAlertaBonificacaoAlta(db, unitId, competencia),
    calcularAlertaNotaSemTitulo(db, unitId, unitNome, competencia),
    calcularAlertaVariacaoPrecoCompra(unitId, competencia),
  ])
  return alertas.filter((a): a is Alerta => a !== null)
}
