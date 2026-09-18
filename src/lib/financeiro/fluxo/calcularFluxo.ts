import { hojeSaoPaulo } from "@/lib/financeiro/dates"
// Fluxo de caixa — DESEMBOLSO, não competência. Não lê lancamentos nem
// dre_snapshot (são projeções por competência); lê as fontes com data de
// movimentação real: titulos_a_pagar (d_vencimento + liquidacao_origem),
// receita_pagamentos (com prazo por forma), payroll_extrato_dominio_* (dia
// de pagamento estimado), e movimentacoes_caixa/recebiveis_cartao — hoje
// vazias (importador de extrato é fase separada), mas já consultadas pra
// quando existirem. Puro, sem escrita.
import { fetchAllPaginado } from "@/lib/financeiro/razao/gerar"
import { classificarLiquidacao } from "./liquidacao"
import { prazoDiasPorForma, somarDias } from "./prazoRecebimento"

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

// Folha não tem data de pagamento exata por competência — estimativa:
// competência M paga no dia 5 do mês seguinte (convenção comum de folha no
// Brasil). Reportado como estimativa na tela, não como dado confirmado.
const DIA_PAGAMENTO_FOLHA_ESTIMADO = 5
function dataPagamentoFolhaEstimada(competenciaTexto: string): string {
  const [anoStr, mesStr] = competenciaTexto.split("-")
  let ano = Number(anoStr)
  let mes = Number(mesStr) + 1
  if (mes > 12) { mes = 1; ano += 1 }
  return `${ano}-${String(mes).padStart(2, "0")}-${String(DIA_PAGAMENTO_FOLHA_ESTIMADO).padStart(2, "0")}`
}

export type DiaFluxo = {
  data: string
  saldoInicial: number
  entradasRealizadas: number
  entradasPrevistas: number
  saidasRealizadas: number
  saidasPrevistas: number
  saldoFinal: number
  status: "realizado" | "previsto"
}

export type TituloAPagar = {
  id: string
  fornecedor: string | null
  nNotaFiscal: string | null
  valor: number
  vencimento: string | null
  categoria: string | null
}

export type FaixaAPagar = {
  faixa: "vencido" | "hoje" | "7dias" | "15dias" | "30dias" | "mais30"
  titulos: TituloAPagar[]
  total: number
}

export type VencimentoPorCompetencia = {
  competencia: string
  total: number
  comVencimento: number
  pct: number
}

export type RecebivelPorForma = {
  forma: string
  formaConhecida: boolean
  prazoDias: number
  valorBruto: number
  valorLiquido: number
  custoAntecipacao: number
}

export type ResultadoFluxo = {
  unitId: string
  contaId: string | null
  dataInicio: string
  dataFim: string
  hoje: string
  dias: DiaFluxo[]
  resumo: {
    saldoHoje: number | null
    aPagarVencido: number
    aPagar7Dias: number
    aReceber7Dias: number
    projecao30Dias: number
    cruzaZero: boolean
    diaCruzaZero: string | null
  }
  aPagarPorFaixa: FaixaAPagar[]
  aPagarSemData: { titulos: TituloAPagar[]; total: number }
  aReceberPorForma: RecebivelPorForma[]
  ultimaReceitaImportada: string | null
  antecipacaoRegistrada: boolean
  confianca: {
    totalTitulos: number
    pctTitulosComVencimento: number | null
    vencimentoPorCompetencia: VencimentoPorCompetencia[]
    valorPago: number
    valorNaoPago: number
    valorIndefinido: number
    pctValorIndefinido: number | null
    diasComExtrato: number
    totalDiasPeriodo: number
    pctDiasComExtrato: number
    dataUltimoExtrato: string | null
    diasSemDetalheForma: number
    valorSemDetalheForma: number
  }
}


export async function calcularFluxo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  unitId: string,
  contaId: string | null,
  dataInicio: string,
  dataFim: string
): Promise<ResultadoFluxo> {
  const hoje = hojeSaoPaulo()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim) || !Number.isFinite(Date.parse(dataInicio)) || !Number.isFinite(Date.parse(dataFim)) || dataInicio > dataFim || (Date.parse(dataFim) - Date.parse(dataInicio)) / 86400000 > 366) throw new Error("Selecione um intervalo válido de até 366 dias.")

  // ── Contas bancárias (saldo inicial consolidado) ──────────────────────
  let queryContas = db.from("contas_bancarias").select("id,saldo_inicial,data_saldo_inicial").eq("unit_id", unitId).eq("ativo", true)
  if (contaId) queryContas = queryContas.eq("id", contaId)
  const contas = await fetchAllPaginado((from: number, to: number) => queryContas.range(from, to)) as Array<{
    id: string; saldo_inicial: number; data_saldo_inicial: string
  }>
  const saldoInicialConsolidado = contas.reduce((s, c) => s + Number(c.saldo_inicial ?? 0), 0)

  // ── Movimentações realizadas (extrato) ────────────────────────────────
  let queryMov = db.from("movimentacoes_caixa").select("conta_id,data,tipo,valor,origem,origem_id,conciliado").eq("unit_id", unitId).lte("data", dataFim)
  if (contaId) queryMov = queryMov.eq("conta_id", contaId)
  const movimentacoes = await fetchAllPaginado((from: number, to: number) => queryMov.range(from, to)) as Array<{
    conta_id: string | null; data: string; tipo: string; valor: number; origem: string; origem_id: string | null; conciliado: boolean
  }>
  const titulosConciliadosIds = new Set(
    movimentacoes.filter((m) => m.origem === "titulo" && m.conciliado).map((m) => m.origem_id)
  )

  if (contas.some(c => c.data_saldo_inicial > dataInicio)) throw new Error("O início do período deve ser igual ou posterior à data do saldo inicial das contas.")
  const basePorConta = new Map(contas.map(c => [c.id, c.data_saldo_inicial]))
  const movimentosAposBase = movimentacoes.filter(m => !m.conta_id || (basePorConta.has(m.conta_id) && m.data >= basePorConta.get(m.conta_id)!))
  const saldoAntesPeriodo = movimentosAposBase.filter(m => m.data < dataInicio).reduce((saldo, m) => saldo + (m.tipo === "entrada" ? 1 : -1) * Math.abs(Number(m.valor)), saldoInicialConsolidado)
  const entradasRealizadasPorDia = new Map<string, number>()
  const saidasRealizadasPorDia = new Map<string, number>()
  for (const m of movimentosAposBase) {
    const mapa = m.tipo === "entrada" ? entradasRealizadasPorDia : saidasRealizadasPorDia
    mapa.set(m.data, (mapa.get(m.data) ?? 0) + Math.abs(Number(m.valor ?? 0)))
  }

  // ── Títulos a pagar ────────────────────────────────────────────────────
  const titulos = await fetchAllPaginado((from: number, to: number) =>
    db.from("titulos_a_pagar")
      .select("id,fantasia_fornecedor,razao_fornecedor,n_nota_fiscal,v_titulo,d_vencimento,d_lancamento,d_competencia,c_gerencial,liquidacao_origem,d_liquidacao,d_liquidacao_atual")
      .eq("unit_id", unitId)
      .in("origem", ["nf_pedidos", "contas_pagar"])
      .range(from, to)
  ) as Array<{
    id: string; fantasia_fornecedor: string | null; razao_fornecedor: string | null
    n_nota_fiscal: string | null; v_titulo: number | null
    d_vencimento: string | null; d_lancamento: string | null; d_competencia: string | null
    c_gerencial: string | null; liquidacao_origem: string | null; d_liquidacao: string | null; d_liquidacao_atual: string | null
  }>

  const saidasPrevistasPorDia = new Map<string, number>()
  let valorPago = 0, valorNaoPago = 0, valorIndefinido = 0
  const titulosNaoPagos: Array<TituloAPagar & { dataEfetiva: string }> = []
  const titulosSemData: TituloAPagar[] = []
  // Completude de d_vencimento por competência — pra apontar em qual mês a
  // planilha de origem está incompleta (LINHA 5), não só o total agregado.
  const porCompetenciaVencimento = new Map<string, { total: number; comVencimento: number }>()

  for (const t of titulos) {
    const valor = Math.abs(Number(t.v_titulo ?? 0))
    const status = classificarLiquidacao(t.liquidacao_origem)

    const compKey = t.d_competencia ?? "sem-competencia"
    const stat = porCompetenciaVencimento.get(compKey) ?? { total: 0, comVencimento: 0 }
    stat.total += 1
    if (t.d_vencimento) stat.comVencimento += 1
    porCompetenciaVencimento.set(compKey, stat)

    if (status === "pago") {
      valorPago += valor
      // Título pago é fato histórico — fallback de data serve só pra registrar
      // quando o dinheiro já saiu, nunca pra projetar (já aconteceu).
      const dataEfetivaPago = t.d_liquidacao ?? t.d_liquidacao_atual
      if (!contaId && dataEfetivaPago && !titulosConciliadosIds.has(t.id)) {
        saidasRealizadasPorDia.set(dataEfetivaPago, (saidasRealizadasPorDia.get(dataEfetivaPago) ?? 0) + valor)
      }
      continue
    }

    if (status === "indefinido") valorIndefinido += valor
    else valorNaoPago += valor

    if (titulosConciliadosIds.has(t.id)) continue // já confirmado pago via extrato — não duplica como previsto

    // Sem d_vencimento não é "vencido" — é ausência de informação. Cair no
    // fallback de competência/lançamento (sempre no passado) inflava a faixa
    // "vencido" com título que pode não estar vencido de verdade. Fica de
    // fora da projeção e listado à parte, não projetável.
    if (!t.d_vencimento) {
      titulosSemData.push({
        id: t.id,
        fornecedor: t.fantasia_fornecedor ?? t.razao_fornecedor,
        nNotaFiscal: t.n_nota_fiscal,
        valor,
        vencimento: null,
        categoria: t.c_gerencial,
      })
      continue
    }

    saidasPrevistasPorDia.set(t.d_vencimento, (saidasPrevistasPorDia.get(t.d_vencimento) ?? 0) + valor)
    titulosNaoPagos.push({
      id: t.id,
      fornecedor: t.fantasia_fornecedor ?? t.razao_fornecedor,
      nNotaFiscal: t.n_nota_fiscal,
      valor,
      vencimento: t.d_vencimento,
      categoria: t.c_gerencial,
      dataEfetiva: t.d_vencimento,
    })
  }

  // ── Folha (extrato Domínio) — dia de pagamento estimado ───────────────
  const folhaLinhas = await fetchAllPaginado((from: number, to: number) =>
    db.from("payroll_extrato_dominio_linha").select("competencia,natureza,rubrica_codigo,valor").eq("unit_id", unitId).range(from, to)
  ) as Array<{ competencia: string; natureza: string; rubrica_codigo: number; valor: number }>
  const folhaCompetencias = await fetchAllPaginado((from: number, to: number) =>
    db.from("payroll_extrato_dominio_competencia").select("competencia,valor_fgts,valor_fgts_rescisorio").eq("unit_id", unitId).range(from, to)
  ) as Array<{ competencia: string; valor_fgts: number | null; valor_fgts_rescisorio: number | null }>

  const RUBRICA_DESCONTO_ENCARGO = 843
  const folhaPorCompetencia = new Map<string, number>()
  for (const l of folhaLinhas) {
    if (l.natureza === "DESCONTO" && l.rubrica_codigo !== RUBRICA_DESCONTO_ENCARGO) continue
    folhaPorCompetencia.set(l.competencia, (folhaPorCompetencia.get(l.competencia) ?? 0) + Math.abs(Number(l.valor ?? 0)))
  }
  for (const c of folhaCompetencias) {
    const extra = Number(c.valor_fgts ?? 0) + Number(c.valor_fgts_rescisorio ?? 0)
    if (extra > 0) folhaPorCompetencia.set(c.competencia, (folhaPorCompetencia.get(c.competencia) ?? 0) + extra)
  }
  for (const [competencia, valor] of folhaPorCompetencia) {
    const dataEfetiva = dataPagamentoFolhaEstimada(competencia)
    saidasPrevistasPorDia.set(dataEfetiva, (saidasPrevistasPorDia.get(dataEfetiva) ?? 0) + valor)
  }

  // ── Receita por forma de pagamento (prazo D+N) ────────────────────────
  // Janela de busca com folga de 40 dias pro maior prazo hoje (30, cartão de
  // crédito) — sem isso o fetch cresce sem limite conforme mais competências
  // são importadas, e venda antiga (que já devia ter virado caixa há meses)
  // voltaria a aparecer como "a receber" de novo.
  const MAIOR_PRAZO_MAIS_FOLGA = 40
  const receitaDias = await fetchAllPaginado((from: number, to: number) =>
    db.from("receita_dias").select("id,data")
      .eq("unit_id", unitId)
      .gte("data", somarDias(dataInicio, -MAIOR_PRAZO_MAIS_FOLGA))
      .lte("data", dataFim)
      .range(from, to)
  ) as Array<{ id: string; data: string }>
  const dataPorWorkdayId = new Map(receitaDias.map((r) => [r.id, r.data]))
  const workdayIds = receitaDias.map((r) => r.id)

  // Data da última receita importada pra essa unidade, sem limite de janela —
  // é só pra mensagem de confiança ("importação está desatualizada há X
  // dias"), não entra em nenhum cálculo. Consulta de 1 linha, não precisa de
  // fetchAllPaginado.
  const { data: ultimaReceitaRow } = await db
    .from("receita_dias")
    .select("data")
    .eq("unit_id", unitId)
    .order("data", { ascending: false })
    .limit(1)
    .maybeSingle()
  const ultimaReceitaImportada: string | null = ultimaReceitaRow?.data ?? null
  const receitaPagamentos = workdayIds.length === 0 ? [] : await fetchAllPaginado((from: number, to: number) =>
    db.from("receita_pagamentos").select("workday_id_fk,forma,valor_recebido").in("workday_id_fk", workdayIds).range(from, to)
  ) as Array<{ workday_id_fk: string; forma: string; valor_recebido: number | null }>

  const entradasPrevistasPorDia = new Map<string, number>()
  const recebivelPorForma = new Map<string, { formaConhecida: boolean; prazoDias: number; valorBruto: number }>()
  const diasSemDetalheFormaSet = new Set<string>()
  let valorSemDetalheForma = 0

  const receitaRealizadaRestante = new Map<string, number>()
  for (const m of movimentacoes) if (m.origem === "receita" && m.origem_id && m.conciliado && m.tipo === "entrada") receitaRealizadaRestante.set(m.origem_id, (receitaRealizadaRestante.get(m.origem_id) ?? 0) + Math.abs(Number(m.valor)))
  for (const p of receitaPagamentos) {
    const dataVenda = dataPorWorkdayId.get(p.workday_id_fk)
    if (!dataVenda) continue
    const bruto = Math.abs(Number(p.valor_recebido ?? 0))
    const realizado = receitaRealizadaRestante.get(p.workday_id_fk) ?? 0
    const valor = Math.max(0, bruto - realizado)
    receitaRealizadaRestante.set(p.workday_id_fk, Math.max(0, realizado - bruto))
    const { dias: prazoDias, conhecida } = prazoDiasPorForma(p.forma)
    const dataEfetiva = somarDias(dataVenda, prazoDias)
    // Venda com dataEfetiva fora da janela exibida já devia ter virado caixa
    // (ou ainda nem entrou na janela) — "a receber" mostra só o que pousa
    // dentro do período selecionado, senão soma histórico inteiro pra sempre.
    if (dataEfetiva < dataInicio || dataEfetiva > dataFim) continue

    entradasPrevistasPorDia.set(dataEfetiva, (entradasPrevistasPorDia.get(dataEfetiva) ?? 0) + valor)

    const atual = recebivelPorForma.get(p.forma) ?? { formaConhecida: conhecida, prazoDias, valorBruto: 0 }
    recebivelPorForma.set(p.forma, { ...atual, valorBruto: atual.valorBruto + valor })

    if (!conhecida) {
      diasSemDetalheFormaSet.add(dataVenda)
      valorSemDetalheForma += valor
    }
  }

  // ── Recebíveis de cartão (antecipação) — hoje sempre vazia; dado real só
  // chega com o extrato bancário / integração de adquirente (fase futura).
  // Consultada já no padrão certo pra quando existir. ─────────────────────
  const queryRecebiveis = db.from("recebiveis_cartao").select("id").eq("unit_id", unitId)
  const recebiveisCartao = await fetchAllPaginado((from: number, to: number) => queryRecebiveis.range(from, to)) as Array<{ id: number }>
  const antecipacaoRegistrada = recebiveisCartao.length > 0

  // ── Série diária ───────────────────────────────────────────────────────
  const dias: DiaFluxo[] = []
  let saldoAcumulado = saldoAntesPeriodo
  let cruzaZero = false
  let diaCruzaZero: string | null = null

  for (let d = dataInicio; d <= dataFim; d = somarDias(d, 1)) {
    const entradasRealizadas = entradasRealizadasPorDia.get(d) ?? 0
    const entradasPrevistas = contaId ? 0 : (entradasPrevistasPorDia.get(d) ?? 0)
    const saidasRealizadas = saidasRealizadasPorDia.get(d) ?? 0
    const saidasPrevistas = contaId ? 0 : (saidasPrevistasPorDia.get(d) ?? 0)
    const saldoInicialDia = saldoAcumulado
    const saldoFinalDia = saldoInicialDia + entradasRealizadas + entradasPrevistas - saidasRealizadas - saidasPrevistas
    if (saldoFinalDia < 0 && !cruzaZero) { cruzaZero = true; diaCruzaZero = d }
    dias.push({
      data: d,
      saldoInicial: round2(saldoInicialDia),
      entradasRealizadas: round2(entradasRealizadas),
      entradasPrevistas: round2(entradasPrevistas),
      saidasRealizadas: round2(saidasRealizadas),
      saidasPrevistas: round2(saidasPrevistas),
      saldoFinal: round2(saldoFinalDia),
      status: d <= hoje ? "realizado" : "previsto",
    })
    saldoAcumulado = saldoFinalDia
  }

  // ── Resumo (cards) ─────────────────────────────────────────────────────
  const em7Dias = somarDias(hoje, 7)
  const em30Dias = somarDias(hoje, 30)
  const diaHoje = dias.find((d) => d.data === hoje)
  const dia30 = dias.find((d) => d.data === em30Dias)

  const aPagarVencido = titulosNaoPagos.filter((t) => t.dataEfetiva && t.dataEfetiva < hoje).reduce((s, t) => s + t.valor, 0)
  const aPagar7Dias = titulosNaoPagos.filter((t) => t.dataEfetiva && t.dataEfetiva >= hoje && t.dataEfetiva <= em7Dias).reduce((s, t) => s + t.valor, 0)
  const aReceber7Dias = [...entradasPrevistasPorDia.entries()].filter(([d]) => d >= hoje && d <= em7Dias).reduce((s, [, v]) => s + v, 0)

  // ── A pagar por faixa de vencimento ────────────────────────────────────
  const em15Dias = somarDias(hoje, 15)
  function faixaDe(dataEfetiva: string): FaixaAPagar["faixa"] {
    if (dataEfetiva < hoje) return "vencido"
    if (dataEfetiva === hoje) return "hoje"
    if (dataEfetiva <= em7Dias) return "7dias"
    if (dataEfetiva <= em15Dias) return "15dias"
    if (dataEfetiva <= em30Dias) return "30dias"
    return "mais30"
  }
  const ORDEM_FAIXAS: FaixaAPagar["faixa"][] = ["vencido", "hoje", "7dias", "15dias", "30dias", "mais30"]
  const titulosPorFaixa = new Map<FaixaAPagar["faixa"], TituloAPagar[]>()
  for (const t of titulosNaoPagos) {
    const faixa = faixaDe(t.dataEfetiva)
    const arr = titulosPorFaixa.get(faixa) ?? []
    arr.push({ id: t.id, fornecedor: t.fornecedor, nNotaFiscal: t.nNotaFiscal, valor: round2(t.valor), vencimento: t.vencimento, categoria: t.categoria })
    titulosPorFaixa.set(faixa, arr)
  }
  const aPagarPorFaixa: FaixaAPagar[] = ORDEM_FAIXAS.map((faixa) => {
    const lista = (titulosPorFaixa.get(faixa) ?? []).sort((a, b) => b.valor - a.valor)
    return { faixa, titulos: lista, total: round2(lista.reduce((s, t) => s + t.valor, 0)) }
  })

  const listaSemData = titulosSemData.sort((a, b) => b.valor - a.valor)
  const aPagarSemData = { titulos: listaSemData, total: round2(listaSemData.reduce((s, t) => s + t.valor, 0)) }

  // ── A receber por forma ────────────────────────────────────────────────
  const aReceberPorForma: RecebivelPorForma[] = [...recebivelPorForma.entries()]
    .map(([forma, v]) => ({
      forma, formaConhecida: v.formaConhecida, prazoDias: v.prazoDias,
      valorBruto: round2(v.valorBruto), valorLiquido: round2(v.valorBruto), custoAntecipacao: 0,
    }))
    .sort((a, b) => b.valorBruto - a.valorBruto)

  // ── Confiança ──────────────────────────────────────────────────────────
  const totalTitulos = titulos.length
  const titulosComVencimento = titulos.filter((t) => t.d_vencimento).length
  const vencimentoPorCompetencia: VencimentoPorCompetencia[] = [...porCompetenciaVencimento.entries()]
    .map(([competencia, v]) => ({
      competencia, total: v.total, comVencimento: v.comVencimento,
      pct: v.total > 0 ? v.comVencimento / v.total : 0,
    }))
    .sort((a, b) => a.competencia.localeCompare(b.competencia))
  const totalDiasPeriodo = dias.length
  const diasComExtratoNoPeriodo = new Set(movimentacoes.filter((m) => m.data >= dataInicio && m.data <= dataFim).map((m) => m.data)).size
  const dataUltimoExtrato = movimentacoes.length > 0 ? [...movimentacoes].map((m) => m.data).sort().at(-1)! : null
  const valorTotalTitulos = valorPago + valorNaoPago + valorIndefinido

  return {
    unitId, contaId, dataInicio, dataFim, hoje, dias,
    resumo: {
      saldoHoje: diaHoje ? diaHoje.saldoFinal : null,
      aPagarVencido: contaId ? 0 : round2(aPagarVencido),
      aPagar7Dias: contaId ? 0 : round2(aPagar7Dias),
      aReceber7Dias: contaId ? 0 : round2(aReceber7Dias),
      projecao30Dias: dia30 ? dia30.saldoFinal : round2(saldoAcumulado),
      cruzaZero, diaCruzaZero,
    },
    aPagarPorFaixa: contaId ? [] : aPagarPorFaixa,
    aPagarSemData: contaId ? { titulos: [], total: 0 } : aPagarSemData,
    aReceberPorForma: contaId ? [] : aReceberPorForma,
    ultimaReceitaImportada,
    antecipacaoRegistrada,
    confianca: {
      totalTitulos,
      pctTitulosComVencimento: totalTitulos > 0 ? titulosComVencimento / totalTitulos : null,
      vencimentoPorCompetencia,
      valorPago: round2(valorPago),
      valorNaoPago: round2(valorNaoPago),
      valorIndefinido: round2(valorIndefinido),
      pctValorIndefinido: valorTotalTitulos > 0 ? valorIndefinido / valorTotalTitulos : null,
      diasComExtrato: diasComExtratoNoPeriodo,
      totalDiasPeriodo,
      pctDiasComExtrato: totalDiasPeriodo > 0 ? diasComExtratoNoPeriodo / totalDiasPeriodo : 0,
      dataUltimoExtrato,
      diasSemDetalheForma: diasSemDetalheFormaSet.size,
      valorSemDetalheForma: round2(valorSemDetalheForma),
    },
  }
}
