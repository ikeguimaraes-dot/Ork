"use server";

import { createSupabaseServerClient } from "@ork/db/supabase/server";

// ─── Raw DB type ──────────────────────────────────────────────────

type DreMensalRow = {
  id: number;
  mes_ano: string; // "2026-1" ... "2026-12"
  tipo: string;
  unit_id: string;
  receita_bruta: number | null;
  cmv: number | null; // stored negative
  pessoal: number | null; // stored negative
  ocupacao: number | null;
  utilidades: number | null;
  operacao: number | null;
  manutencao: number | null;
  administrativa: number | null;
  marketing: number | null;
  taxa_cartao: number | null;
  impostos: number | null;
  ebitda: number | null;
  resultado_liquido: number | null;
  clientes: number | null;
  ticket_medio: number | null;
};

// ─── Exported types ───────────────────────────────────────────────

export type DreAgregado = {
  mes_ano: string;
  sortKey: number;
  receita_bruta: number;
  cmv: number;
  lucro_bruto: number;
  pessoal: number;
  ocupacao: number;
  utilidades: number;
  operacao: number;
  manutencao: number;
  administrativa: number;
  marketing: number;
  taxa_cartao: number;
  impostos: number;
  ebitda: number;
  resultado_liquido: number;
  clientes: number;
  num_marcas: number;
  cmv_pct: number | null;
  pessoal_pct: number | null;
  prime_cost_pct: number | null;
  ebitda_pct: number | null;
};

export type UnitComDre = {
  unit_id: string;
  unit_name: string;
  brand_id: string;
  brand_name: string;
  brand_slug: string;
  brand_color: string | null;
};

export type OrcamentoMes = {
  mes_ano: string;
  month: number;
  orcado: DreAgregado | null;
  realizado: DreAgregado | null;
};

// ─── Internal helpers ─────────────────────────────────────────────

function parseMesAno(mesAno: string): { year: number; month: number; sortKey: number } {
  const parts = mesAno.split("-");
  const year = parseInt(parts[0] ?? "0", 10);
  const month = parseInt(parts[1] ?? "0", 10);
  return { year, month, sortKey: year * 12 + month };
}

function agregaDre(rows: DreMensalRow[]): DreAgregado[] {
  const byMes = new Map<string, DreAgregado>();

  for (const r of rows) {
    const { sortKey } = parseMesAno(r.mes_ano);
    const prev = byMes.get(r.mes_ano);
    const ag: DreAgregado = prev ?? {
      mes_ano: r.mes_ano,
      sortKey,
      receita_bruta: 0, cmv: 0, lucro_bruto: 0,
      pessoal: 0, ocupacao: 0, utilidades: 0, operacao: 0,
      manutencao: 0, administrativa: 0, marketing: 0,
      taxa_cartao: 0, impostos: 0, ebitda: 0,
      resultado_liquido: 0, clientes: 0, num_marcas: 0,
      cmv_pct: null, pessoal_pct: null, prime_cost_pct: null, ebitda_pct: null,
    };
    ag.receita_bruta += Number(r.receita_bruta ?? 0);
    ag.cmv += Number(r.cmv ?? 0);
    ag.pessoal += Number(r.pessoal ?? 0);
    ag.ocupacao += Number(r.ocupacao ?? 0);
    ag.utilidades += Number(r.utilidades ?? 0);
    ag.operacao += Number(r.operacao ?? 0);
    ag.manutencao += Number(r.manutencao ?? 0);
    ag.administrativa += Number(r.administrativa ?? 0);
    ag.marketing += Number(r.marketing ?? 0);
    ag.taxa_cartao += Number(r.taxa_cartao ?? 0);
    ag.impostos += Number(r.impostos ?? 0);
    ag.ebitda += Number(r.ebitda ?? 0);
    ag.resultado_liquido += Number(r.resultado_liquido ?? 0);
    ag.clientes += Number(r.clientes ?? 0);
    ag.num_marcas += 1;
    byMes.set(r.mes_ano, ag);
  }

  for (const ag of byMes.values()) {
    const rev = ag.receita_bruta;
    ag.lucro_bruto = ag.receita_bruta + ag.cmv; // cmv is negative
    if (rev > 0) {
      ag.cmv_pct = (-ag.cmv / rev) * 100;
      ag.pessoal_pct = (-ag.pessoal / rev) * 100;
      ag.prime_cost_pct = ((-ag.cmv) + (-ag.pessoal)) / rev * 100;
      ag.ebitda_pct = (ag.ebitda / rev) * 100;
    }
  }

  return Array.from(byMes.values()).sort((a, b) => a.sortKey - b.sortKey);
}

// ─── Actions ──────────────────────────────────────────────────────

/**
 * Retorna todos os meses realizados do grupo, agregados por mes_ano.
 * Ordenados crescente (jan → mais recente).
 */
export async function getDreGrupoRealizado(): Promise<DreAgregado[]> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("dre_mensal")
      .select("*")
      .eq("tipo", "realizado");
    if (error) {
      console.error("[getDreGrupoRealizado] error:", error.message);
      return [];
    }
    return agregaDre((data ?? []) as DreMensalRow[]);
  } catch (e) {
    console.error("[getDreGrupoRealizado] exceção:", e);
    return [];
  }
}

/**
 * Retorna 12 meses do ano (esqueleto completo) com orcado + realizado por mês.
 * Filtra por unit_ids se fornecido (null/undefined = grupo todo).
 */
export async function getOrcamentoData(
  ano: number = new Date().getFullYear(),
  unitIds?: string[] | null,
): Promise<OrcamentoMes[]> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return [];

    const prefix = `${ano}-`;
    let realizadoQ = supabase
      .from("dre_mensal")
      .select("*")
      .eq("tipo", "realizado")
      .like("mes_ano", `${prefix}%`);
    let orcadoQ = supabase
      .from("dre_mensal")
      .select("*")
      .eq("tipo", "orcado")
      .like("mes_ano", `${prefix}%`);
    if (unitIds && unitIds.length > 0) {
      realizadoQ = realizadoQ.in("unit_id", unitIds);
      orcadoQ = orcadoQ.in("unit_id", unitIds);
    }

    const [realizadoRes, orcadoRes] = await Promise.all([realizadoQ, orcadoQ]);
    if (realizadoRes.error) console.error("[getOrcamentoData] realizado:", realizadoRes.error.message);
    if (orcadoRes.error) console.error("[getOrcamentoData] orcado:", orcadoRes.error.message);

    const realizados = agregaDre((realizadoRes.data ?? []) as DreMensalRow[]);
    const orcados = agregaDre((orcadoRes.data ?? []) as DreMensalRow[]);

    // Build 12-month skeleton
    const result: OrcamentoMes[] = Array.from({ length: 12 }, (_, i) => ({
      mes_ano: `${ano}-${i + 1}`,
      month: i + 1,
      orcado: null,
      realizado: null,
    }));
    for (const r of realizados) {
      const { month } = parseMesAno(r.mes_ano);
      const slot = result[month - 1];
      if (slot) slot.realizado = r;
    }
    for (const r of orcados) {
      const { month } = parseMesAno(r.mes_ano);
      const slot = result[month - 1];
      if (slot) slot.orcado = r;
    }
    return result;
  } catch (e) {
    console.error("[getOrcamentoData] exceção:", e);
    return [];
  }
}

/**
 * Lista unidades que têm dados em dre_mensal, com brand_name/slug/color.
 * Usado para montar as tabs do orçamento.
 */
export async function getUnitsComDre(): Promise<UnitComDre[]> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return [];

    const { data: dreData, error: dreError } = await supabase
      .from("dre_mensal")
      .select("unit_id");
    if (dreError) {
      console.error("[getUnitsComDre] dre_mensal:", dreError.message);
      return [];
    }
    const unitIds = [
      ...new Set(
        ((dreData ?? []) as { unit_id: string }[]).map((r) => r.unit_id),
      ),
    ];
    if (unitIds.length === 0) return [];

    const { data: unitsData, error: unitsError } = await supabase
      .from("units")
      .select("id, name, brand_id")
      .in("id", unitIds);
    if (unitsError || !unitsData) {
      console.error("[getUnitsComDre] units:", unitsError?.message);
      return [];
    }
    const units = unitsData as Array<{ id: string; name: string; brand_id: string }>;
    const brandIds = [...new Set(units.map((u) => u.brand_id))];

    const { data: brandsData } = await supabase
      .from("brands")
      .select("id, name, slug, color")
      .in("id", brandIds);
    const brandMap = new Map<string, { name: string; slug: string; color: string | null }>();
    for (const b of (brandsData ?? []) as Array<{ id: string; name: string; slug: string; color: string | null }>) {
      brandMap.set(b.id, { name: b.name, slug: b.slug, color: b.color });
    }

    return units.map((u) => {
      const brand = brandMap.get(u.brand_id);
      return {
        unit_id: u.id,
        unit_name: u.name,
        brand_id: u.brand_id,
        brand_name: brand?.name ?? "—",
        brand_slug: brand?.slug ?? "",
        brand_color: brand?.color ?? null,
      };
    });
  } catch (e) {
    console.error("[getUnitsComDre] exceção:", e);
    return [];
  }
}
