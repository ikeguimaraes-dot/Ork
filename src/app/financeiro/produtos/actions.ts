"use server"

import { createSupabaseServerClient } from "@ork/db/supabase/server"
import { getCurrentUnit } from "@ork/auth/unit"

export type ProdutoInsert = {
  unit_id: string
  fornecedor_nome: string | null
  nr_danfe: string | null
  v_total_danfe: number | null
  dt_emissao: string | null
  item_codigo: string | null
  item_descricao: string | null
  unidade_medida: string | null
  tipo_item: string | null
  q_embalagem: number | null
  q_estoque: number | null
  v_embalagem: number | null
  v_total_embalagem: number | null
  v_custo_medio: number | null
  v_custo_compra: number | null
  v_custo_total: number | null
  perc_variacao: number | null
  calcula_cmv: boolean | null
  fornecedor_codigo: string | null
  codigo_gerencial: string | null
  desc_gerencial: string | null
  mes_lancamento: number
  ano_lancamento: number
}

export async function deleteProdutosMes(
  unitId: string,
  mes: number,
  ano: number
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db
      .from("produtos_relatorio")
      .delete()
      .eq("unit_id", unitId)
      .eq("mes_lancamento", mes)
      .eq("ano_lancamento", ano)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function insertProdutos(
  rows: ProdutoInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error, count } = await db
      .from("produtos_relatorio")
      .insert(rows)
      .select("id", { count: "exact", head: true })

    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: count ?? rows.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

export async function getProdutosMeses(
  unitId: string
): Promise<{ mes: number; ano: number; total: number }[]> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data } = await db
      .from("produtos_relatorio")
      .select("mes_lancamento, ano_lancamento")
      .eq("unit_id", unitId)
      .limit(10000)
    if (!data) return []
    const map = new Map<string, number>()
    for (const r of data) {
      const k = `${r.ano_lancamento}-${r.mes_lancamento}`
      map.set(k, (map.get(k) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([k, total]) => {
        const [ano, mes] = k.split("-").map(Number)
        return { mes: mes!, ano: ano!, total }
      })
      .sort((a, b) => a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes)
  } catch {
    return []
  }
}

export type RankingItem = {
  item_descricao: string | null
  item_codigo: string | null
  fornecedor_nome: string | null
  desc_gerencial: string | null
  unidade_medida: string | null
  custo_total: number
  quantidade_total: number
  custo_medio: number
  variacao_media: number | null
}

export type RankingResult = {
  porValor: RankingItem[]
  porQuantidade: RankingItem[]
  porVariacao: RankingItem[]
  totalCmv: number
}

export async function getRankingProdutos(
  unitId: string | null,
  mes: number,
  ano: number
): Promise<RankingResult> {
  const empty: RankingResult = { porValor: [], porQuantidade: [], porVariacao: [], totalCmv: 0 }
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return empty
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    let q = db
      .from("produtos_relatorio")
      .select("item_descricao,item_codigo,fornecedor_nome,desc_gerencial,unidade_medida,v_total_embalagem,v_custo_total,q_estoque,v_custo_medio,perc_variacao")
      .eq("mes_lancamento", mes)
      .eq("ano_lancamento", ano)
      .eq("calcula_cmv", true)
      .limit(10000)
    if (unitId) q = q.eq("unit_id", unitId)
    const { data } = await q
    if (!data || data.length === 0) return empty

    type Acc = {
      item_descricao: string | null
      item_codigo: string | null
      fornecedor_nome: string | null
      desc_gerencial: string | null
      unidade_medida: string | null
      custo_total: number
      quantidade_total: number
      custo_medio_sum: number
      custo_medio_n: number
      variacao_sum: number
      variacao_n: number
    }

    const map = new Map<string, Acc>()
    for (const r of data) {
      const key = `${r.item_descricao}||${r.fornecedor_nome}||${r.desc_gerencial}||${r.unidade_medida}`
      const a: Acc = map.get(key) ?? {
        item_descricao: r.item_descricao,
        item_codigo: r.item_codigo ?? null,
        fornecedor_nome: r.fornecedor_nome,
        desc_gerencial: r.desc_gerencial,
        unidade_medida: r.unidade_medida,
        custo_total: 0, quantidade_total: 0,
        custo_medio_sum: 0, custo_medio_n: 0,
        variacao_sum: 0, variacao_n: 0,
      }
      const ct = r.v_total_embalagem != null ? Number(r.v_total_embalagem) : 0
      const qt = r.q_estoque         != null ? Number(r.q_estoque)         : 0
      a.custo_total      += isFinite(ct) ? Math.abs(ct) : 0
      a.quantidade_total += isFinite(qt) ? qt           : 0
      if (r.v_custo_medio != null) {
        const n = Number(r.v_custo_medio)
        if (isFinite(n)) { a.custo_medio_sum += n; a.custo_medio_n++ }
      }
      if (r.perc_variacao != null) {
        const n = Number(r.perc_variacao)
        if (isFinite(n)) { a.variacao_sum += n; a.variacao_n++ }
      }
      if (!a.item_codigo && r.item_codigo) a.item_codigo = r.item_codigo
      map.set(key, a)
    }

    const items: RankingItem[] = [...map.values()].map(a => ({
      item_descricao:  a.item_descricao,
      item_codigo:     a.item_codigo,
      fornecedor_nome: a.fornecedor_nome,
      desc_gerencial:  a.desc_gerencial,
      unidade_medida:  a.unidade_medida,
      custo_total:     a.custo_total,
      quantidade_total: a.quantidade_total,
      custo_medio:     a.custo_medio_n > 0 ? a.custo_medio_sum / a.custo_medio_n : 0,
      variacao_media:  a.variacao_n > 0 ? a.variacao_sum / a.variacao_n : null,
    }))

    const totalCmv     = items.reduce((s, i) => s + i.custo_total, 0)
    const porValor     = [...items].sort((a, b) => b.custo_total - a.custo_total).slice(0, 20)
    const porQuantidade = [...items].sort((a, b) => b.quantidade_total - a.quantidade_total).slice(0, 20)
    const porVariacao  = items
      .filter(i => i.variacao_media != null && i.variacao_media > 0)
      .sort((a, b) => (b.variacao_media ?? 0) - (a.variacao_media ?? 0))
      .slice(0, 20)

    return { porValor, porQuantidade, porVariacao, totalCmv }
  } catch {
    return empty
  }
}

export type HistoricoRow = {
  mes_lancamento: number
  ano_lancamento: number
  fornecedor_nome: string | null
  q_estoque: number | null
  v_custo_medio: number | null
  v_custo_total: number | null
  perc_variacao: number | null
  desc_gerencial: string | null
  item_descricao: string | null
}

export async function getHistoricoProduto(
  unitId: string | null,
  itemCodigo: string
): Promise<HistoricoRow[]> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    let q = db
      .from("produtos_relatorio")
      .select("mes_lancamento,ano_lancamento,fornecedor_nome,q_estoque,v_custo_medio,v_custo_total,perc_variacao,desc_gerencial,item_descricao")
      .eq("item_codigo", itemCodigo)
      .order("ano_lancamento", { ascending: true })
      .order("mes_lancamento", { ascending: true })
      .limit(120)
    if (unitId) q = q.eq("unit_id", unitId)
    const { data } = await q
    return (data ?? []) as HistoricoRow[]
  } catch {
    return []
  }
}

export async function getCurrentUnitId(): Promise<string | null> {
  const unit = await getCurrentUnit()
  return unit?.id ?? null
}
