// Lógica pura da tela de Conferência — GRUPO 3 (Valor fora de faixa).
// Nenhum destes alertas conclui que o número está ERRADO — só que o valor
// foge da faixa esperada e merece uma conferência da composição.
import { fetchAllPaginado } from "@/lib/financeiro/razao/gerar"
import { calcularDivergenciasContasPagarNotas } from "@/lib/financeiro/divergencias/calcularDivergencias"
import { type Alerta, type AlertaOcorrencia, montarAlerta, round2 } from "./calcularAlertas"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

type KpiValores = {
  receita_liquida: number | null
  cmv_compras: number | null
  cmv_compras_pct: number | null
  mo_pct: number | null
  prime_cost_pct: number | null
  ebitda: number | null
  ebitda_pct: number | null
}

async function getKpiValores(db: Db, unitId: string, competencia: string): Promise<KpiValores | null> {
  const { data } = await db.from("kpi_snapshot")
    .select("receita_liquida,cmv_compras,cmv_compras_pct,mo_pct,prime_cost_pct,ebitda,ebitda_pct")
    .eq("unit_id", unitId).eq("competencia", competencia).maybeSingle()
  return data
}

// ── 3.1 · CMV fora da faixa esperada (28%–40%) ──────────────────────────────
const CMV_PISO = 0.28
const CMV_TETO = 0.40
const CMV_CRITICO = 0.50

export async function calcularAlertaCmvForaFaixa(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const kpi = await getKpiValores(db, unitId, competencia)
  const ocorrencias: AlertaOcorrencia[] = []
  let critico = false

  if (kpi && kpi.cmv_compras_pct != null && Number(kpi.receita_liquida ?? 0) > 0) {
    const pct = Number(kpi.cmv_compras_pct)
    if (pct < CMV_PISO || pct > CMV_TETO) {
      const composicao = await fetchAllPaginado((from, to) =>
        db.from("dre_snapshot").select("conta_codigo,valor")
          .eq("unit_id", unitId).eq("competencia", competencia)
          .like("conta_codigo", "3.%").range(from, to)
      ) as Array<{ conta_codigo: string; valor: number }>
      const detalhe = composicao
        .filter((c) => Math.abs(c.valor) > 0.005)
        .map((c) => `${c.conta_codigo}: ${round2(c.valor)}`)
        .join(", ")
      critico = pct > CMV_CRITICO
      ocorrencias.push({
        chave: `${unitId}|${competencia}`,
        descricao: `CMV em ${(pct * 100).toFixed(1)}% da receita líquida (faixa esperada ${CMV_PISO * 100}%–${CMV_TETO * 100}%). Composição por conta: ${detalhe || "sem detalhe"}.`,
        valor: round2(Number(kpi.cmv_compras ?? 0)),
      })
    }
  }

  return montarAlerta({
    alertaChave: "3.1_cmv_fora_faixa",
    grupo: 3,
    titulo: "CMV fora da faixa esperada (28%–40%)",
    motivo: "O CMV do período está fora da faixa histórica esperada — não é conclusão de erro, é convite à conferência da composição.",
    severidade: critico ? "critico" : "atencao",
    link: "/financeiro/dre/cmv",
    ocorrencias,
  })
}

// ── 3.2 · Prime cost acima de 65% ───────────────────────────────────────────
const PRIME_COST_TETO = 0.65

export async function calcularAlertaPrimeCostAlto(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const kpi = await getKpiValores(db, unitId, competencia)
  const ocorrencias: AlertaOcorrencia[] = []
  if (kpi && kpi.prime_cost_pct != null && Number(kpi.receita_liquida ?? 0) > 0 && Number(kpi.prime_cost_pct) > PRIME_COST_TETO) {
    const pct = Number(kpi.prime_cost_pct)
    ocorrencias.push({
      chave: `${unitId}|${competencia}`,
      descricao: `Prime cost (CMV + mão de obra) em ${(pct * 100).toFixed(1)}% da receita líquida, acima do teto de ${PRIME_COST_TETO * 100}%.`,
      valor: round2(Number(kpi.receita_liquida ?? 0) * pct),
    })
  }
  return montarAlerta({
    alertaChave: "3.2_prime_cost_alto",
    grupo: 3,
    titulo: "Prime cost acima de 65%",
    motivo: "CMV + mão de obra juntos consomem mais de 65% da receita líquida do período.",
    severidade: "atencao",
    link: "/financeiro",
    ocorrencias,
  })
}

// ── 3.3 · EBITDA negativo ───────────────────────────────────────────────────
export async function calcularAlertaEbitdaNegativo(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const kpi = await getKpiValores(db, unitId, competencia)
  const ocorrencias: AlertaOcorrencia[] = []
  if (kpi && kpi.ebitda != null && Number(kpi.ebitda) < 0) {
    const pctTexto = kpi.ebitda_pct != null ? ` (${(Number(kpi.ebitda_pct) * 100).toFixed(1)}% da receita líquida)` : ""
    ocorrencias.push({
      chave: `${unitId}|${competencia}`,
      descricao: `EBITDA negativo no período${pctTexto}.`,
      valor: round2(Math.abs(Number(kpi.ebitda))),
    })
  }
  return montarAlerta({
    alertaChave: "3.3_ebitda_negativo",
    grupo: 3,
    titulo: "EBITDA negativo",
    motivo: "O resultado operacional (EBITDA) do período é negativo.",
    severidade: "atencao",
    link: "/financeiro",
    ocorrencias,
  })
}

// ── 3.4 · Mão de obra fora da faixa esperada (8%–30%) ───────────────────────
const MO_PISO = 0.08
const MO_TETO = 0.30

export async function calcularAlertaMaoDeObraForaFaixa(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const kpi = await getKpiValores(db, unitId, competencia)
  const ocorrencias: AlertaOcorrencia[] = []
  if (kpi && kpi.mo_pct != null && Number(kpi.receita_liquida ?? 0) > 0) {
    const pct = Number(kpi.mo_pct)
    if (pct < MO_PISO || pct > MO_TETO) {
      ocorrencias.push({
        chave: `${unitId}|${competencia}`,
        descricao: `Mão de obra em ${(pct * 100).toFixed(1)}% da receita líquida (faixa esperada ${MO_PISO * 100}%–${MO_TETO * 100}%).`,
        valor: round2(Number(kpi.receita_liquida ?? 0) * pct),
      })
    }
  }
  return montarAlerta({
    alertaChave: "3.4_mao_de_obra_fora_faixa",
    grupo: 3,
    titulo: "Mão de obra fora da faixa esperada (8%–30%)",
    motivo: "O custo de mão de obra do período está fora da faixa histórica esperada.",
    severidade: "atencao",
    link: "/financeiro/dre/folha",
    ocorrencias,
  })
}

// ── 3.5 · Divergência entre título e NF-e acima de R$100 ────────────────────
// Reaproveita a lista A (com nota e com XML) já calculada em
// calcularDivergenciasContasPagarNotas — mesmo critério de match, só filtra
// pela diferença absoluta.
const DIVERGENCIA_MINIMA = 100

export async function calcularAlertaDivergenciaTituloNfe(
  db: Db, unitId: string, unitNome: string, competencia: string
): Promise<Alerta | null> {
  const resultado = await calcularDivergenciasContasPagarNotas(db, unitId, unitNome, competencia)
  const ocorrencias: AlertaOcorrencia[] = resultado.comNotaComXml
    .filter((i) => Math.abs(i.diferenca) > DIVERGENCIA_MINIMA)
    .map((i) => ({
      chave: `${i.fornecedor}|${i.nNota}`,
      descricao: `${i.fornecedor ?? "Fornecedor não identificado"} · Nota ${i.nNota} · título ${i.valorTitulo} × NF-e ${i.valorNfe}`,
      valor: Math.abs(i.diferenca),
    }))

  return montarAlerta({
    alertaChave: "3.5_divergencia_titulo_nfe",
    grupo: 3,
    titulo: "Divergência entre título e NF-e acima de R$100",
    motivo: "O valor do título na planilha de contas a pagar diverge do valor da NF-e correspondente em mais de R$100.",
    severidade: "atencao",
    link: "/financeiro/dre/divergencias",
    ocorrencias,
  })
}

// ── 3.6 · Valor em conta 9.99 (a classificar) ───────────────────────────────
export async function calcularAlertaContaAClassificar(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const { data } = await db.from("dre_snapshot").select("valor")
    .eq("unit_id", unitId).eq("competencia", competencia).eq("conta_codigo", "9.99").maybeSingle()
  const valor = Math.abs(Number(data?.valor ?? 0))
  const ocorrencias: AlertaOcorrencia[] = valor > 0.005
    ? [{ chave: `${unitId}|${competencia}`, descricao: "Conta 9.99 (a classificar) com valor lançado no período.", valor: round2(valor) }]
    : []
  return montarAlerta({
    alertaChave: "3.6_conta_a_classificar",
    grupo: 3,
    titulo: "Valor em conta 9.99 (a classificar)",
    motivo: "Há valor lançado na conta genérica 'a classificar' — o DRE só fecha certo depois que isso for reclassificado numa conta real.",
    severidade: "atencao",
    link: "/financeiro/dre/classificacao",
    ocorrencias,
  })
}

// ── 3.7 · Lançamento em 9.98 (pagamento de folha) acima de R$10 mil ─────────
// "Lançamento" no singular mas o teto de R$10 mil só se mostrou significativo
// no TOTAL do mês na conta (nenhuma linha individual real passa de ~R$6,5 mil)
// — o alerta é sobre o acumulado da competência, que é o que de fato indicaria
// título de folha classificado errado nessa conta não-operacional.
const LIMITE_PAGAMENTO_FOLHA = 10000

export async function calcularAlertaPagamentoFolhaAlto(db: Db, unitId: string, competencia: string): Promise<Alerta | null> {
  const { data } = await db.from("dre_snapshot").select("valor")
    .eq("unit_id", unitId).eq("competencia", competencia).eq("conta_codigo", "9.98").maybeSingle()
  const valor = Math.abs(Number(data?.valor ?? 0))
  const ocorrencias: AlertaOcorrencia[] = valor > LIMITE_PAGAMENTO_FOLHA
    ? [{
        chave: `${unitId}|${competencia}`,
        descricao: `Conta 9.98 (pagamento de folha, não é custo) somou ${round2(valor)} no período — pode indicar título de folha classificado errado.`,
        valor: round2(valor),
      }]
    : []
  return montarAlerta({
    alertaChave: "3.7_pagamento_folha_alto",
    grupo: 3,
    titulo: "Lançamento em 9.98 acima de R$10 mil",
    motivo: "A conta 9.98 existe pra excedente pontual de folha fora do extrato Domínio — um total alto no mês pode indicar título de folha classificado nela por engano.",
    severidade: "atencao",
    link: "/financeiro/dre/folha",
    ocorrencias,
  })
}

export async function calcularAlertasGrupo3(
  db: Db,
  unitId: string,
  unitNome: string,
  competencia: string
): Promise<Alerta[]> {
  const alertas = await Promise.all([
    calcularAlertaCmvForaFaixa(db, unitId, competencia),
    calcularAlertaPrimeCostAlto(db, unitId, competencia),
    calcularAlertaEbitdaNegativo(db, unitId, competencia),
    calcularAlertaMaoDeObraForaFaixa(db, unitId, competencia),
    calcularAlertaDivergenciaTituloNfe(db, unitId, unitNome, competencia),
    calcularAlertaContaAClassificar(db, unitId, competencia),
    calcularAlertaPagamentoFolhaAlto(db, unitId, competencia),
  ])
  return alertas.filter((a): a is Alerta => a !== null)
}
