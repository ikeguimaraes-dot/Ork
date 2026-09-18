import { createFinanceiroClient } from "@/lib/financeiro/db/client"

export const runtime = "nodejs"

const CORS = {
  "Access-Control-Allow-Origin": "http://localhost:3001",
  "Access-Control-Allow-Methods": "GET, POST",
  "Access-Control-Allow-Headers": "Content-Type",
}

export async function OPTIONS() {
  return new Response(null, { headers: CORS })
}

// Custo total da competência = Total Geral Proventos + FGTS do mês + FGTS
// rescisório + INSS Empregador (rubrica "INSS EMPREGADOR", natureza DESCONTO
// no resumo por rubrica). Fórmula validada ao centavo contra os extratos reais
// (Restaurante e UNIDADE, jun-ago/2026). Não é apenas a soma dos proventos dos
// colaboradores: inclui encargos patronais que não são atribuídos a nenhum
// colaborador individual.
async function custoTotalCompetencia(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  unitId: string,
  competencia: string,
  totalGeralProventos: number | null,
  valorFgts: number | null,
  valorFgtsRescisorio: number | null
): Promise<number> {
  const { data: inss } = await supabase
    .from("payroll_extrato_dominio_rubrica")
    .select("valor")
    .eq("unit_id", unitId)
    .eq("competencia", competencia)
    .eq("rubrica_descricao", "INSS EMPREGADOR")
    .eq("natureza", "DESCONTO")
    .maybeSingle()

  return (
    (totalGeralProventos ?? 0) +
    (valorFgts ?? 0) +
    (valorFgtsRescisorio ?? 0) +
    (inss?.valor ?? 0)
  )
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const unit_id = searchParams.get("unit_id")
  const mes = searchParams.get("mes")
  const ano = searchParams.get("ano")

  if (!unit_id) {
    return Response.json({ error: "unit_id obrigatório" }, { status: 400, headers: CORS })
  }

  const supabase = await createFinanceiroClient()

  let competencia: string

  if (mes && ano) {
    competencia = `${ano}-${String(mes).padStart(2, "0")}`
  } else {
    const { data: ultima } = await supabase
      .from("payroll_extrato_dominio_competencia")
      .select("competencia")
      .eq("unit_id", unit_id)
      .order("competencia", { ascending: false })
      .limit(1)
      .single()

    competencia = ultima?.competencia ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
  }

  const { data: compRow, error: errComp } = await supabase
    .from("payroll_extrato_dominio_competencia")
    .select("total_geral_proventos, total_geral_descontos, liquido_geral, valor_fgts, valor_fgts_rescisorio")
    .eq("unit_id", unit_id)
    .eq("competencia", competencia)
    .maybeSingle()

  if (errComp) {
    return Response.json({ error: errComp.message }, { status: 500, headers: CORS })
  }

  const { data: colaboradoresRaw, error: errColab } = await supabase
    .from("payroll_extrato_dominio_colaborador")
    .select("id, nome, cargo_nome, vinculo, data_admissao, salario, proventos, descontos, liquido, base_inss, base_fgts, valor_fgts, base_irrf, cod_colaborador")
    .eq("unit_id", unit_id)
    .eq("competencia", competencia)
    .order("cargo_nome", { ascending: true })
    .order("nome", { ascending: true })

  if (errColab) {
    return Response.json({ error: errColab.message }, { status: 500, headers: CORS })
  }

  const { data: linhas } = await supabase
    .from("payroll_extrato_dominio_linha")
    .select("cod_colaborador, rubrica_codigo, natureza, valor")
    .eq("unit_id", unit_id)
    .eq("competencia", competencia)

  const { data: rubricas } = await supabase
    .from("payroll_extrato_dominio_rubrica")
    .select("rubrica_codigo, rubrica_descricao, natureza")
    .eq("unit_id", unit_id)
    .eq("competencia", competencia)

  const descricaoRubrica = new Map<string, string>(
    (rubricas ?? []).map((r: { rubrica_codigo: number; rubrica_descricao: string; natureza: string }) => [
      `${r.rubrica_codigo}|${r.natureza}`,
      r.rubrica_descricao,
    ])
  )

  const verbasPorColaborador = new Map<number, Array<{ codigo: string; descricao: string; provento?: number; desconto?: number }>>()
  for (const l of linhas ?? []) {
    const lista = verbasPorColaborador.get(l.cod_colaborador) ?? []
    const descricao = descricaoRubrica.get(`${l.rubrica_codigo}|${l.natureza}`) ?? `Rubrica ${l.rubrica_codigo}`
    lista.push({
      codigo: String(l.rubrica_codigo),
      descricao,
      provento: l.natureza === "PROVENTO" ? l.valor : undefined,
      desconto: l.natureza === "DESCONTO" ? l.valor : undefined,
    })
    verbasPorColaborador.set(l.cod_colaborador, lista)
  }

  const colaboradores = (colaboradoresRaw ?? []).map((c: {
    id: string; nome: string; cargo_nome: string | null; vinculo: string | null
    data_admissao: string | null
    salario: number | null; proventos: number; descontos: number; liquido: number
    base_inss: number | null; base_fgts: number | null; valor_fgts: number | null; base_irrf: number | null
    cod_colaborador: number
  }) => ({
    id: c.id,
    nome: c.nome,
    funcao: c.cargo_nome ?? "NAO INFORMADO",
    tipo: c.vinculo ?? "—",
    admissao: c.data_admissao,
    salario: c.salario ?? 0,
    custo_total: c.proventos ?? 0,
    is_vaga: false,
    total_proventos: c.proventos ?? 0,
    total_descontos: c.descontos ?? 0,
    valor_liquido: c.liquido ?? 0,
    base_inss: c.base_inss ?? 0,
    base_fgts: c.base_fgts ?? 0,
    fgts_mes: c.valor_fgts ?? 0,
    base_irrf: c.base_irrf ?? 0,
    gorjeta: 0,
    verbas: verbasPorColaborador.get(c.cod_colaborador) ?? [],
  }))

  const { data: competenciasRaw } = await supabase
    .from("payroll_extrato_dominio_competencia")
    .select("competencia")
    .eq("unit_id", unit_id)
    .order("competencia", { ascending: false })

  const competenciasDisponiveis = [
    ...new Set((competenciasRaw ?? []).map((r: { competencia: string }) => r.competencia)),
  ]

  const [anoNum, mesNum] = competencia.split("-").map(Number)

  const { data: gorjetaDist } = await supabase
    .from("gorjeta_distribuicao")
    .select("id, nome, cargo, percentual, valor_bruto, valor_liquido, mes, ano, periodo, employee_id")
    .eq("unit_id", unit_id)
    .eq("mes", mesNum)
    .eq("ano", anoNum)
    .order("valor_bruto", { ascending: false })

  let gorjetaFinal = gorjetaDist ?? []
  let gorjetaPeriodoLabel = gorjetaFinal.length > 0
    ? `${String(mesNum).padStart(2, "0")}/${anoNum}`
    : null

  if (gorjetaFinal.length === 0) {
    const { data: ultimaGorjeta } = await supabase
      .from("gorjeta_distribuicao")
      .select("mes, ano")
      .eq("unit_id", unit_id)
      .order("ano", { ascending: false })
      .order("mes", { ascending: false })
      .limit(1)
      .single()

    if (ultimaGorjeta) {
      const { data: gorjetaRecente } = await supabase
        .from("gorjeta_distribuicao")
        .select("id, nome, cargo, percentual, valor_bruto, valor_liquido, mes, ano, periodo, employee_id")
        .eq("unit_id", unit_id)
        .eq("mes", ultimaGorjeta.mes)
        .eq("ano", ultimaGorjeta.ano)
        .order("valor_bruto", { ascending: false })

      gorjetaFinal = gorjetaRecente ?? []
      gorjetaPeriodoLabel = gorjetaFinal.length > 0
        ? `${String(ultimaGorjeta.mes).padStart(2, "0")}/${ultimaGorjeta.ano} (último disponível)`
        : null
    }
  }

  const { data: cargoPontos } = await supabase
    .from("gorjeta_cargo_pontos")
    .select("cargo, pontos, ativo")
    .eq("unit_id", unit_id)
    .eq("ativo", true)
    .order("pontos", { ascending: false })

  const { data: gorjetaHistoricoRaw } = await supabase
    .from("gorjeta_distribuicao")
    .select("mes, ano, valor_bruto")
    .eq("unit_id", unit_id)

  const gorjetaPorPeriodo: Record<string, number> = {}
  for (const row of gorjetaHistoricoRaw ?? []) {
    const chave = `${row.ano}-${String(row.mes).padStart(2, "0")}`
    gorjetaPorPeriodo[chave] = (gorjetaPorPeriodo[chave] ?? 0) + (row.valor_bruto ?? 0)
  }
  const gorjetaHistorico = Object.entries(gorjetaPorPeriodo)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([periodo, total]) => ({ periodo, total }))

  const { data: historicoCompRaw } = await supabase
    .from("payroll_extrato_dominio_competencia")
    .select("competencia, total_geral_proventos, valor_fgts, valor_fgts_rescisorio")
    .eq("unit_id", unit_id)
    .order("competencia", { ascending: false })
    .limit(12)

  const folhaHistorico = await Promise.all(
    (historicoCompRaw ?? [])
      .slice()
      .reverse()
      .map(async (row: { competencia: string; total_geral_proventos: number | null; valor_fgts: number | null; valor_fgts_rescisorio: number | null }) => ({
        periodo: row.competencia,
        total: await custoTotalCompetencia(supabase, unit_id, row.competencia, row.total_geral_proventos, row.valor_fgts, row.valor_fgts_rescisorio),
      }))
  )

  const totalFolha = await custoTotalCompetencia(
    supabase,
    unit_id,
    competencia,
    compRow?.total_geral_proventos ?? null,
    compRow?.valor_fgts ?? null,
    compRow?.valor_fgts_rescisorio ?? null
  )
  const totalSalario = colaboradores.reduce((s: number, c: { salario: number }) => s + (c.salario ?? 0), 0)
  const headcount = colaboradores.length
  const custoPorPessoa = headcount > 0 ? totalFolha / headcount : 0

  // Cadastro de colaboradores (public.employees) — usado só pra avisar na
  // tela quando está incompleto; não decide nada aqui. Ver alerta 2.12.
  const { count: cadastroCount } = await supabase
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("unit_id", unit_id)
    .eq("ativo", true)

  const porFuncao: Record<string, { custo: number; headcount: number }> = {}
  for (const c of colaboradores) {
    const fn = c.funcao ?? "SEM FUNÇÃO"
    if (!porFuncao[fn]) porFuncao[fn] = { custo: 0, headcount: 0 }
    porFuncao[fn].custo += c.custo_total ?? 0
    porFuncao[fn].headcount += 1
  }
  const topFuncoes = Object.entries(porFuncao)
    .sort(([, a], [, b]) => b.custo - a.custo)
    .slice(0, 10)
    .map(([funcao, dados]) => ({ funcao, ...dados }))

  const gorjetaTotalBruto = gorjetaFinal.reduce((s: number, g: { valor_bruto: number | null }) => s + (g.valor_bruto ?? 0), 0)
  const gorjetaTotalLiquido = gorjetaFinal.reduce((s: number, g: { valor_liquido: number | null }) => s + (g.valor_liquido ?? 0), 0)

  const pontosMap: Record<string, number> = {}
  for (const cp of cargoPontos ?? []) pontosMap[cp.cargo] = cp.pontos

  const gorjetaPorCargo: Record<string, { valor_bruto: number; headcount: number; pontos: number }> = {}
  for (const g of gorjetaFinal) {
    const cargo = g.cargo || "Sem cargo"
    if (!gorjetaPorCargo[cargo]) gorjetaPorCargo[cargo] = { valor_bruto: 0, headcount: 0, pontos: pontosMap[cargo] ?? 0 }
    gorjetaPorCargo[cargo].valor_bruto += g.valor_bruto ?? 0
    gorjetaPorCargo[cargo].headcount += 1
  }
  const gorjetaBreakdownCargo = Object.entries(gorjetaPorCargo)
    .sort(([, a], [, b]) => b.valor_bruto - a.valor_bruto)
    .map(([cargo, dados]) => ({
      cargo,
      pontos: dados.pontos,
      headcount: dados.headcount,
      valor_total: dados.valor_bruto,
      valor_medio: dados.headcount > 0 ? dados.valor_bruto / dados.headcount : 0,
    }))

  return Response.json(
    {
      competencia,
      competenciasDisponiveis,
      resumo: {
        totalFolha,
        totalSalario,
        headcount,
        custoPorPessoa,
        vagasAbertas: 0,
      },
      colaboradores,
      cadastroColaboradores: {
        noExtrato: headcount,
        noCadastro: cadastroCount ?? 0,
      },
      topFuncoes,
      folhaHistorico,
      gorjeta: {
        periodo: gorjetaPeriodoLabel,
        totalBruto: gorjetaTotalBruto,
        totalLiquido: gorjetaTotalLiquido,
        headcount: gorjetaFinal.length,
        distribuicao: gorjetaFinal,
        breakdownCargo: gorjetaBreakdownCargo,
        historico: gorjetaHistorico,
        cargoPontos: cargoPontos ?? [],
      },
    },
    { headers: CORS }
  )
}
