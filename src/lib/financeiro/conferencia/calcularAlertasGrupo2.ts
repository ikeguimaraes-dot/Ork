// Lógica pura da tela de Conferência — GRUPO 2 (Cobertura): falta dado
// pra o número ser confiável. Mesmo princípio do GRUPO 1 — calculado na
// leitura, nunca grava nada.
import { fetchAllPaginado } from "@/lib/financeiro/razao/gerar"
import { type Alerta, type AlertaOcorrencia, montarAlerta, round2, competenciaFim } from "./calcularAlertas"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

async function getKpiSnapshot(db: Db, unitId: string, competencia: string) {
  const { data } = await db.from("kpi_snapshot")
    .select("receita_liquida,tem_nfe,tem_folha,confianca_pct")
    .eq("unit_id", unitId).eq("competencia", competencia).maybeSingle()
  return data as { receita_liquida: number | null; tem_nfe: boolean; tem_folha: boolean; confianca_pct: number | null } | null
}

async function existeLancamento(db: Db, unitId: string, competencia: string): Promise<boolean> {
  const { data } = await db.from("lancamentos").select("id")
    .eq("unit_id", unitId).eq("competencia", competencia).limit(1)
  return (data?.length ?? 0) > 0
}

// Soma lancamentos por grupo de plano_contas (custo = cmv+mao_de_obra+
// despesa_operacional; deducao = grupo deducao) e a receita bruta real do
// mês, direto de receita_dias — não de kpi_snapshot, pra não depender de
// snapshot recém-regenerado. Serve às 2.9/2.10.
async function getCustoDeducaoReceita(db: Db, unitId: string, competencia: string) {
  const fim = competenciaFim(competencia)
  const linhas = await fetchAllPaginado((from, to) =>
    db.from("lancamentos").select("valor,conta_codigo")
      .eq("unit_id", unitId).eq("competencia", competencia).range(from, to)
  ) as Array<{ valor: number; conta_codigo: string }>

  const codigos = [...new Set(linhas.map((l) => l.conta_codigo))]
  const planoContas = codigos.length === 0 ? [] : await fetchAllPaginado((from, to) =>
    db.from("plano_contas").select("codigo,grupo").in("codigo", codigos).range(from, to)
  ) as Array<{ codigo: string; grupo: string }>
  const grupoPorConta = new Map(planoContas.map((p) => [p.codigo, p.grupo]))

  let custo = 0
  let deducao = 0
  for (const l of linhas) {
    const grupo = grupoPorConta.get(l.conta_codigo)
    const valor = Math.abs(Number(l.valor ?? 0))
    if (grupo === "cmv" || grupo === "mao_de_obra" || grupo === "despesa_operacional") custo += valor
    if (grupo === "deducao") deducao += valor
  }

  const dias = await fetchAllPaginado((from, to) =>
    db.from("receita_dias").select("receita_bruta")
      .eq("unit_id", unitId).gte("data", competencia).lt("data", fim).range(from, to)
  ) as Array<{ receita_bruta: number | null }>
  const receitaBruta = dias.reduce((s, d) => s + Number(d.receita_bruta ?? 0), 0)

  return { custo, deducao, receitaBruta }
}

// ── 2.1 · Competência com lançamento mas sem NF-e ───────────────────────────
// Antes exigia receita_liquida > 0 pra disparar — isso escondia exatamente
// o pior caso (custo lançado sem nenhuma receita, ver 2.9/2.10), já que
// receita zerada nunca é positiva. Dispara sempre que existe QUALQUER
// lançamento na competência.
export async function calcularAlertaReceitaSemNfe(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const [kpi, temLancamento] = await Promise.all([
    getKpiSnapshot(db, unitId, competencia),
    existeLancamento(db, unitId, competencia),
  ])
  const ocorrencias: AlertaOcorrencia[] = []
  if (kpi && temLancamento && !kpi.tem_nfe) {
    ocorrencias.push({
      chave: `${unitId}|${competencia}`,
      descricao: "Competência com lançamento registrado, mas nenhuma NF-e de entrada importada.",
      valor: round2(Math.abs(Number(kpi.receita_liquida ?? 0))),
    })
  }
  return montarAlerta({
    alertaChave: "2.1_receita_sem_nfe",
    grupo: 2,
    titulo: "Competência com lançamento mas sem NF-e",
    motivo: "Há lançamento nesta competência, mas nenhuma NF-e de entrada foi importada para o período.",
    severidade: "critico",
    link: "/financeiro/dre/cmv",
    ocorrencias,
  })
}

// ── 2.2 · Competência com lançamento mas sem folha ──────────────────────────
export async function calcularAlertaReceitaSemFolha(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const [kpi, temLancamento] = await Promise.all([
    getKpiSnapshot(db, unitId, competencia),
    existeLancamento(db, unitId, competencia),
  ])
  const ocorrencias: AlertaOcorrencia[] = []
  if (kpi && temLancamento && !kpi.tem_folha) {
    ocorrencias.push({
      chave: `${unitId}|${competencia}`,
      descricao: "Competência com lançamento registrado, mas nenhum extrato de folha importado.",
      valor: round2(Math.abs(Number(kpi.receita_liquida ?? 0))),
    })
  }
  return montarAlerta({
    alertaChave: "2.2_receita_sem_folha",
    grupo: 2,
    titulo: "Competência com lançamento mas sem folha",
    motivo: "Há lançamento nesta competência, mas nenhum extrato de folha (Domínio) foi importado.",
    severidade: "critico",
    link: "/financeiro/folha/dominio",
    ocorrencias,
  })
}

// ── 2.9 · Competência com custo mas sem receita ─────────────────────────────
// O pior estado possível: todo percentual calculado sobre esta competência
// (CMV%, MO%, prime cost%, EBITDA%) é inválido — divisão por zero.
export async function calcularAlertaCustoSemReceita(
  db: Db, unitId: string, unitNome: string, competencia: string
): Promise<Alerta | null> {
  const { custo, receitaBruta } = await getCustoDeducaoReceita(db, unitId, competencia)
  const ocorrencias: AlertaOcorrencia[] = custo > 0 && receitaBruta === 0
    ? [{
        chave: `${unitId}|${competencia}`,
        descricao: `${round2(custo)} de custo lançado sem nenhuma receita importada. Importe a receita de ${competencia.slice(0, 7)} para ${unitNome}.`,
        valor: round2(custo),
      }]
    : []
  return montarAlerta({
    alertaChave: "2.9_custo_sem_receita",
    grupo: 2,
    titulo: "Competência com custo mas sem receita",
    motivo: "Existe lançamento de CMV, mão de obra ou despesa operacional nesta competência, mas nenhuma receita foi importada.",
    severidade: "critico",
    link: "/financeiro/dre/receita",
    ocorrencias,
  })
}

// ── 2.10 · Dedução sem receita ──────────────────────────────────────────────
// É o que produz receita líquida negativa (dedução descontada de zero).
export async function calcularAlertaDeducaoSemReceita(
  db: Db, unitId: string, unitNome: string, competencia: string
): Promise<Alerta | null> {
  const { deducao, receitaBruta } = await getCustoDeducaoReceita(db, unitId, competencia)
  const ocorrencias: AlertaOcorrencia[] = deducao > 0 && receitaBruta === 0
    ? [{
        chave: `${unitId}|${competencia}`,
        descricao: `${round2(deducao)} de dedução (impostos/cancelamentos) lançada sem nenhuma receita importada para ${unitNome} — é isso que produz receita líquida negativa.`,
        valor: round2(deducao),
      }]
    : []
  return montarAlerta({
    alertaChave: "2.10_deducao_sem_receita",
    grupo: 2,
    titulo: "Dedução sem receita",
    motivo: "Existe lançamento no grupo dedução nesta competência, mas nenhuma receita foi importada.",
    severidade: "critico",
    link: "/financeiro/dre/receita",
    ocorrencias,
  })
}

// ── 2.3 · Títulos com número de nota mas XML não importado ─────────────────
export async function calcularAlertaTitulosSemXml(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const rows = await fetchAllPaginado((from, to) =>
    db.from("reconciliacoes_sugeridas")
      .select("id,titulo_id,valor_titulo")
      .eq("unit_id", unitId).eq("competencia", competencia).eq("status", "sem_xml")
      .range(from, to)
  ) as Array<{ id: string; titulo_id: string; valor_titulo: number | null }>

  const tituloIds = [...new Set(rows.map((r) => r.titulo_id))]
  const titulosInfo = tituloIds.length === 0 ? [] : await fetchAllPaginado((from, to) =>
    db.from("titulos_a_pagar").select("id,fantasia_fornecedor,razao_fornecedor,n_nota_fiscal").in("id", tituloIds).range(from, to)
  ) as Array<{ id: string; fantasia_fornecedor: string | null; razao_fornecedor: string | null; n_nota_fiscal: string | null }>
  const infoPorId = new Map(titulosInfo.map((t) => [t.id, t]))

  const ocorrencias: AlertaOcorrencia[] = rows.map((r) => {
    const info = infoPorId.get(r.titulo_id)
    return {
      chave: r.id,
      descricao: `${info?.fantasia_fornecedor ?? info?.razao_fornecedor ?? "Fornecedor não identificado"} · Nota ${info?.n_nota_fiscal ?? "?"}`,
      valor: Math.abs(Number(r.valor_titulo ?? 0)),
    }
  })

  return montarAlerta({
    alertaChave: "2.3_titulos_sem_xml",
    grupo: 2,
    titulo: "Títulos com número de nota mas XML não importado",
    motivo: "O título tem número de nota fiscal na planilha, mas nenhum XML correspondente foi importado ainda.",
    severidade: "atencao",
    link: "/financeiro/dre/divergencias",
    ocorrencias,
  })
}

// ── 2.4 · Títulos sem data de vencimento ────────────────────────────────────
export async function calcularAlertaTitulosSemVencimento(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const titulos = await fetchAllPaginado((from, to) =>
    db.from("titulos_a_pagar")
      .select("id,fantasia_fornecedor,razao_fornecedor,v_titulo")
      .eq("unit_id", unitId)
      .in("origem", ["nf_pedidos", "contas_pagar"])
      .eq("d_competencia", competencia)
      .is("d_vencimento", null)
      .range(from, to)
  ) as Array<{ id: string; fantasia_fornecedor: string | null; razao_fornecedor: string | null; v_titulo: number | null }>

  const ocorrencias: AlertaOcorrencia[] = titulos.map((t) => ({
    chave: t.id,
    descricao: `${t.fantasia_fornecedor ?? t.razao_fornecedor ?? "Fornecedor não identificado"} · sem data de vencimento`,
    valor: Math.abs(Number(t.v_titulo ?? 0)),
  }))

  return montarAlerta({
    alertaChave: "2.4_titulos_sem_vencimento",
    grupo: 2,
    titulo: "Títulos sem data de vencimento",
    motivo: "O título não tem data de vencimento cadastrada, então não entra na projeção do fluxo de caixa.",
    severidade: "atencao",
    link: "/financeiro/fluxo",
    ocorrencias,
  })
}

// ── 2.5 · Títulos sem confirmação de liquidação ─────────────────────────────
export async function calcularAlertaTitulosSemLiquidacao(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const fim = competenciaFim(competencia)
  const titulos = await fetchAllPaginado((from, to) =>
    db.from("titulos_a_pagar")
      .select("id,fantasia_fornecedor,razao_fornecedor,v_titulo")
      .eq("unit_id", unitId)
      .in("origem", ["nf_pedidos", "contas_pagar"])
      .or(`d_competencia.eq.${competencia},and(d_competencia.is.null,d_vencimento.gte.${competencia},d_vencimento.lt.${fim})`)
      .is("liquidacao_origem", null)
      .range(from, to)
  ) as Array<{ id: string; fantasia_fornecedor: string | null; razao_fornecedor: string | null; v_titulo: number | null }>

  const ocorrencias: AlertaOcorrencia[] = titulos.map((t) => ({
    chave: t.id,
    descricao: `${t.fantasia_fornecedor ?? t.razao_fornecedor ?? "Fornecedor não identificado"} · sem confirmação de liquidação`,
    valor: Math.abs(Number(t.v_titulo ?? 0)),
  }))

  return montarAlerta({
    alertaChave: "2.5_titulos_sem_liquidacao",
    grupo: 2,
    titulo: "Títulos sem confirmação de liquidação",
    motivo: "Não há marcação de pagamento para este título — status indefinido entre pago e não pago.",
    severidade: "atencao",
    link: "/financeiro/pagar",
    ocorrencias,
  })
}

// ── 2.6 · Dias de receita sem detalhe por forma de pagamento ────────────────
const FORMA_RESUMO_SEM_DETALHE = "Relatório Geral de Vendas"

export async function calcularAlertaReceitaSemDetalheForma(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const fim = competenciaFim(competencia)
  const dias = await fetchAllPaginado((from, to) =>
    db.from("receita_dias")
      .select("id,data,receita_liquida")
      .eq("unit_id", unitId).gte("data", competencia).lt("data", fim)
      .gt("receita_liquida", 0)
      .range(from, to)
  ) as Array<{ id: string; data: string; receita_liquida: number | null }>

  const ids = dias.map((d) => d.id)
  const pagamentos = ids.length === 0 ? [] : await fetchAllPaginado((from, to) =>
    db.from("receita_pagamentos").select("workday_id_fk,forma").in("workday_id_fk", ids).range(from, to)
  ) as Array<{ workday_id_fk: string; forma: string }>
  const temDetalhe = new Set(pagamentos.filter((p) => p.forma !== FORMA_RESUMO_SEM_DETALHE).map((p) => p.workday_id_fk))

  const ocorrencias: AlertaOcorrencia[] = dias
    .filter((d) => !temDetalhe.has(d.id))
    .map((d) => ({
      chave: d.id,
      descricao: `Dia ${d.data} · receita registrada só via "${FORMA_RESUMO_SEM_DETALHE}", sem quebra por forma de pagamento`,
      valor: Math.abs(Number(d.receita_liquida ?? 0)),
    }))

  return montarAlerta({
    alertaChave: "2.6_receita_sem_detalhe_forma",
    grupo: 2,
    titulo: "Dias de receita sem detalhe por forma de pagamento",
    motivo: "A receita do dia só tem o resumo geral de vendas, sem quebra por forma de pagamento — o prazo de recebimento é assumido como D+0.",
    severidade: "atencao",
    link: "/financeiro/dre/receita",
    ocorrencias,
  })
}

// ── 2.7 · Unidade sem conta bancária cadastrada ─────────────────────────────
export async function calcularAlertaUnidadeSemContaBancaria(db: Db, unitId: string, unitNome: string): Promise<Alerta | null> {
  const contas = await fetchAllPaginado((from, to) =>
    db.from("contas_bancarias").select("id").eq("unit_id", unitId).range(from, to)
  ) as Array<{ id: string }>

  const ocorrencias: AlertaOcorrencia[] = contas.length === 0
    ? [{ chave: unitId, descricao: `${unitNome} não tem nenhuma conta bancária cadastrada`, valor: 0 }]
    : []

  return montarAlerta({
    alertaChave: "2.7_unidade_sem_conta_bancaria",
    grupo: 2,
    titulo: "Unidade sem conta bancária cadastrada",
    motivo: "Sem conta bancária cadastrada, o fluxo de caixa não tem saldo inicial nem contraparte pra reconciliar.",
    severidade: "atencao",
    link: "/financeiro/fluxo",
    ocorrencias,
  })
}

// ── 2.8 · Índice de confiança abaixo de 70% ─────────────────────────────────
const PISO_CONFIANCA = 0.7

export async function calcularAlertaConfiancaBaixa(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const kpi = await getKpiSnapshot(db, unitId, competencia)
  const ocorrencias: AlertaOcorrencia[] = []
  if (kpi && kpi.confianca_pct != null && Number(kpi.confianca_pct) < PISO_CONFIANCA) {
    const pct = (Number(kpi.confianca_pct) * 100).toFixed(0)
    ocorrencias.push({
      chave: `${unitId}|${competencia}`,
      descricao: `Índice de confiança em ${pct}%, abaixo do piso de ${PISO_CONFIANCA * 100}%.`,
      valor: round2(Math.abs(Number(kpi.receita_liquida ?? 0))),
    })
  }
  return montarAlerta({
    alertaChave: "2.8_confianca_baixa",
    grupo: 2,
    titulo: "Índice de confiança abaixo de 70%",
    motivo: "O índice de confiança da competência (cobertura de classificação e das fontes) está abaixo do piso de 70%.",
    severidade: "atencao",
    link: "/financeiro",
    ocorrencias,
  })
}

// ── 2.11 · Nota fiscal existe mas XML não importado (CMV) ───────────────────
// Recorte de 2.3 (sem_xml) que importa de verdade: título com número de
// nota E cuja conta no razão é CMV — a nota existe, só falta o XML.
// Agrupado por fornecedor porque um pacote de XMLs de um único fornecedor
// costuma resolver dezenas de notas de uma vez.
export async function calcularAlertaNotaSemXmlCmv(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const rows = await fetchAllPaginado((from, to) =>
    db.from("reconciliacoes_sugeridas")
      .select("id,titulo_id,valor_titulo")
      .eq("unit_id", unitId).eq("competencia", competencia).eq("status", "sem_xml")
      .range(from, to)
  ) as Array<{ id: string; titulo_id: string; valor_titulo: number | null }>

  const tituloIds = [...new Set(rows.map((r) => r.titulo_id))]
  const titulosInfo = tituloIds.length === 0 ? [] : await fetchAllPaginado((from, to) =>
    db.from("titulos_a_pagar").select("id,fantasia_fornecedor,razao_fornecedor,n_nota_fiscal").in("id", tituloIds).range(from, to)
  ) as Array<{ id: string; fantasia_fornecedor: string | null; razao_fornecedor: string | null; n_nota_fiscal: string | null }>
  const lancamentosRows = tituloIds.length === 0 ? [] : await fetchAllPaginado((from, to) =>
    db.from("lancamentos").select("origem_id,conta_codigo").eq("origem", "titulo").in("origem_id", tituloIds).range(from, to)
  ) as Array<{ origem_id: string; conta_codigo: string }>

  const contaCodigos = [...new Set(lancamentosRows.map((l) => l.conta_codigo))]
  const planoContas = contaCodigos.length === 0 ? [] : await fetchAllPaginado((from, to) =>
    db.from("plano_contas").select("codigo,grupo").in("codigo", contaCodigos).range(from, to)
  ) as Array<{ codigo: string; grupo: string }>
  const grupoPorConta = new Map(planoContas.map((p) => [p.codigo, p.grupo]))
  const contaPorTitulo = new Map(lancamentosRows.map((l) => [l.origem_id, l.conta_codigo]))
  const infoPorId = new Map(titulosInfo.map((t) => [t.id, t]))

  const porFornecedor = new Map<string, { valor: number; qtd: number }>()
  for (const r of rows) {
    const info = infoPorId.get(r.titulo_id)
    if (!info?.n_nota_fiscal) continue
    const conta = contaPorTitulo.get(r.titulo_id)
    if (!conta || grupoPorConta.get(conta) !== "cmv") continue
    const fornecedor = info.fantasia_fornecedor ?? info.razao_fornecedor ?? "Fornecedor não identificado"
    const atual = porFornecedor.get(fornecedor) ?? { valor: 0, qtd: 0 }
    atual.valor += Math.abs(Number(r.valor_titulo ?? 0))
    atual.qtd += 1
    porFornecedor.set(fornecedor, atual)
  }

  const ocorrencias: AlertaOcorrencia[] = [...porFornecedor.entries()]
    .map(([fornecedor, { valor, qtd }]) => ({
      chave: fornecedor,
      descricao: `${fornecedor} · ${qtd} nota${qtd === 1 ? "" : "s"} com número mas sem XML importado`,
      valor: round2(valor),
    }))
    .sort((a, b) => b.valor - a.valor)

  return montarAlerta({
    alertaChave: "2.11_nota_sem_xml_cmv",
    grupo: 2,
    titulo: "Nota fiscal existe mas XML não importado",
    motivo: "Importar o XML resolve a categorização por NCM e o match título↔NF-e de uma vez para todas as notas do fornecedor.",
    severidade: "atencao",
    link: "/financeiro/dre/divergencias",
    ocorrencias,
  })
}

// ── 2.12 · Cadastro de colaboradores vazio ──────────────────────────────────
// O extrato Domínio (payroll_extrato_dominio_colaborador) lista quem foi
// pago no mês, mas não distingue área/divisão. Isso só vem do cadastro de
// colaboradores (public.employees) — sem ele preenchido, não há custo por
// área nem vínculo com o módulo de pessoas.
export async function calcularAlertaCadastroColaboradoresVazio(
  db: Db, unitId: string, unitNome: string, competencia: string
): Promise<Alerta | null> {
  const [extrato, cadastro] = await Promise.all([
    fetchAllPaginado((from, to) =>
      db.from("payroll_extrato_dominio_colaborador").select("id")
        .eq("unit_id", unitId).eq("competencia", competencia).range(from, to)
    ) as Promise<Array<{ id: string }>>,
    fetchAllPaginado((from, to) =>
      db.from("employees").select("id").eq("unit_id", unitId).eq("ativo", true).range(from, to)
    ) as Promise<Array<{ id: string }>>,
  ])

  const ocorrencias: AlertaOcorrencia[] = cadastro.length < extrato.length
    ? [{
        chave: `${unitId}|${competencia}`,
        descricao: `${extrato.length} colaboradores no extrato de folha, ${cadastro.length} no cadastro (${unitNome}). Sem o cadastro não há custo por área nem vínculo com o módulo de pessoas.`,
        valor: 0,
      }]
    : []

  return montarAlerta({
    alertaChave: "2.12_cadastro_colaboradores_vazio",
    grupo: 2,
    titulo: "Cadastro de colaboradores vazio",
    motivo: "O cadastro de colaboradores (public.employees) tem menos linhas que o extrato de folha da competência.",
    severidade: "atencao",
    link: "/pessoas/colaboradores",
    ocorrencias,
  })
}

export async function calcularAlertasGrupo2(
  db: Db,
  unitId: string,
  unitNome: string,
  competencia: string
): Promise<Alerta[]> {
  const alertas = await Promise.all([
    calcularAlertaReceitaSemNfe(db, unitId, competencia),
    calcularAlertaReceitaSemFolha(db, unitId, competencia),
    calcularAlertaTitulosSemXml(db, unitId, competencia),
    calcularAlertaTitulosSemVencimento(db, unitId, competencia),
    calcularAlertaTitulosSemLiquidacao(db, unitId, competencia),
    calcularAlertaReceitaSemDetalheForma(db, unitId, competencia),
    calcularAlertaUnidadeSemContaBancaria(db, unitId, unitNome),
    calcularAlertaConfiancaBaixa(db, unitId, competencia),
    calcularAlertaCustoSemReceita(db, unitId, unitNome, competencia),
    calcularAlertaDeducaoSemReceita(db, unitId, unitNome, competencia),
    calcularAlertaNotaSemXmlCmv(db, unitId, competencia),
    calcularAlertaCadastroColaboradoresVazio(db, unitId, unitNome, competencia),
  ])
  return alertas.filter((a): a is Alerta => a !== null)
}
