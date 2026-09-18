"use server"

import { createSupabaseServerClient } from "@ork/db/supabase/server"
import { getCurrentUnit } from "@ork/auth/unit"

export type DreLinhaInsert = {
  unit_id: string
  mes_ano: string
  tipo: "realizado" | "orcado"
  grupo: string
  descricao: string
  conta: string | null
  valor: number | null
  av_percentual: number | null
  custo_tipo: null
}

export async function deleteDreLinhasRealizado(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db
      .from("dre_linhas_detalhadas")
      .delete()
      .eq("unit_id", unitId)
      .eq("tipo", "realizado")
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertDreLinhas(
  rows: DreLinhaInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error, count } = await db
      .from("dre_linhas_detalhadas")
      .insert(rows)
      .select("id", { count: "exact", head: true })
    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: count ?? rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

export async function deleteDreLinhasOrcado(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db
      .from("dre_linhas_detalhadas")
      .delete()
      .eq("unit_id", unitId)
      .eq("tipo", "orcado")
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function getCurrentUnitId(): Promise<string | null> {
  const unit = await getCurrentUnit()
  return unit?.id ?? null
}

export type DreGorjetaInsert = {
  unit_id: string
  mes_ano: string
  gorjeta_recebida: number | null
  gorjeta_paga: number | null
  retencao: number | null
  ferias: number | null
  decimo_terceiro: number | null
  fgts: number | null
  inss: number | null
  encargos_total: number | null
}

export type DreReceitaInsert = {
  unit_id: string
  mes_ano: string
  bandeira: string | null
  classificacao: string | null
  grupo: string | null
  valor: number
}

export async function deleteDreGorjeta(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_gorjeta_mensal").delete().eq("unit_id", unitId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertDreGorjeta(
  rows: DreGorjetaInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error, count } = await db
      .from("dre_gorjeta_mensal")
      .insert(rows)
      .select("id", { count: "exact", head: true })
    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: count ?? rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

export async function deleteDreReceita(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_receita_detalhada").delete().eq("unit_id", unitId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertDreReceita(
  rows: DreReceitaInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error, count } = await db
      .from("dre_receita_detalhada")
      .insert(rows)
      .select("id", { count: "exact", head: true })
    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: count ?? rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

// ── dre_mensal ────────────────────────────────────────────────────────────────

export type DreMensalInsert = {
  unit_id: string
  mes_ano: string
  tipo: "realizado" | "orcado"
  receita_bruta: number
  cmv: number
  pessoal: number
  ocupacao: number
  utilidades: number
  operacao: number
  manutencao: number
  administrativa: number
  marketing: number
  taxa_cartao: number
  impostos: number
  ebitda: number
  resultado_liquido: number
  clientes: number | null
  ticket_medio: number | null
}

export async function deleteDreMensal(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_mensal").delete().eq("unit_id", unitId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertDreMensal(
  rows: DreMensalInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_mensal").insert(rows)
    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

// ── dre_kpis_mensais ──────────────────────────────────────────────────────────

export type DreKpisInsert = {
  unit_id: string
  mes_ano: string
  clientes: number | null
  ticket_medio: number | null
  gorjetas_recebidas: number | null
  icms: number | null
  cofins: number | null
  pis: number | null
  iss: number | null
}

export async function deleteDreKpis(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_kpis_mensais").delete().eq("unit_id", unitId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertDreKpis(
  rows: DreKpisInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_kpis_mensais").insert(rows)
    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

// ── dre_indicadores ───────────────────────────────────────────────────────────

export type DreIndicadoresInsert = {
  unit_id: string
  mes_ano: string
  tipo: "realizado" | "orcado"
  indicador: string
  valor: number | null
}

export async function deleteDreIndicadores(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_indicadores").delete().eq("unit_id", unitId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertDreIndicadores(
  rows: DreIndicadoresInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_indicadores").insert(rows)
    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

// ── dre_despesa_detalhada ─────────────────────────────────────────────────────

export type DreDespesaInsert = {
  unit_id: string
  mes_ano: string
  data_competencia: string | null
  descricao: string | null
  categoria: string | null
  valor: number
  tipo_despesa: string | null
  classificacao_dre: string | null
}

export async function deleteDreDespesa(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_despesa_detalhada").delete().eq("unit_id", unitId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertDreDespesa(
  rows: DreDespesaInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_despesa_detalhada").insert(rows)
    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

// ── dre_faturamento_historico ─────────────────────────────────────────────────

export type DreFaturamentoInsert = {
  unit_id: string
  mes_num: number
  categoria: string
  rec_2022: number | null
  rec_2023: number | null
  rec_2024: number | null
  rec_2025: number | null
  rec_2026_bd: number | null
  clientes_bd: number | null
  ticket_bd: number | null
}

export async function deleteDreFaturamento(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_faturamento_historico").delete().eq("unit_id", unitId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertDreFaturamento(
  rows: DreFaturamentoInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_faturamento_historico").insert(rows)
    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

// ── dre_contratos_fixos ───────────────────────────────────────────────────────

export type DreContratosInsert = {
  unit_id: string
  razao_social: string
  descricao: string | null
  valor_mensal: number
  codigo_contabil: string | null
  tipo: string | null
}

export async function deleteDreContratos(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_contratos_fixos").delete().eq("unit_id", unitId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertDreContratos(
  rows: DreContratosInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_contratos_fixos").insert(rows)
    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

// ── dre_folha ─────────────────────────────────────────────────────────────────

export type DreFolhaInsert = {
  unit_id: string
  tipo: string
  nome: string | null
  funcao: string | null
  divisao: string | null
  admissao: string | null
  salario: number
  custo_total: number | null
  is_vaga: boolean
}

export async function deleteDreFolha(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_folha").delete().eq("unit_id", unitId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertDreFolha(
  rows: DreFolhaInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_folha").insert(rows)
    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

// ── dre_pessoal_detalhado ─────────────────────────────────────────────────────

export type DrePessoalInsert = {
  unit_id: string
  mes_ano: string
  categoria: string
  valor: number
}

export async function deleteDrePessoal(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_pessoal_detalhado").delete().eq("unit_id", unitId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertDrePessoal(
  rows: DrePessoalInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_pessoal_detalhado").insert(rows)
    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

// ── dre_manutencao_detalhada ──────────────────────────────────────────────────

export type DreManutencaoInsert = {
  unit_id: string
  mes_ano: string | null
  fornecedor: string | null
  categoria: string | null
  valor: number
}

export async function deleteDreManutencao(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_manutencao_detalhada").delete().eq("unit_id", unitId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertDreManutencao(
  rows: DreManutencaoInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_manutencao_detalhada").insert(rows)
    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

// ── dre_prestadores ───────────────────────────────────────────────────────────

export type DrePrestadoresInsert = {
  unit_id: string
  mes_ano: string
  nome: string
  grupo: string
  valor: number
}

export async function deleteDrePrestadores(
  unitId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_prestadores").delete().eq("unit_id", unitId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertDrePrestadores(
  rows: DrePrestadoresInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("dre_prestadores").insert(rows)
    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}
