import type { SupabaseClient } from "@supabase/supabase-js";
import { competenciaTitulo } from "@/lib/financeiro/dates";
import { fetchAllPaginado, gerarRazao } from "./gerar";

/** Include old months so corrections that move/remove a source also clear old totals. */
export async function refreshUnits(db: SupabaseClient, unitIds: string[]): Promise<void> {
  for (const unitId of new Set(unitIds)) {
    const { data: canWrite, error: accessError } = await db.rpc("financeiro_can_write", { p_unit: unitId });
    if (accessError) throw new Error(accessError.message);
    if (!canWrite) {
      const { data: state, error } = await db.from("financeiro_revisoes").select("revisao").eq("unit_id", unitId).maybeSingle();
      if (error) throw new Error(error.message);
      if (state) {
        const snapshots = await fetchAllPaginado((from, to) => db.from("kpi_snapshot").select("revisao_fonte").eq("unit_id", unitId).range(from, to));
        if (!snapshots.length || snapshots.some(s => Number(s.revisao_fonte) !== Number(state.revisao))) throw new Error("Os indicadores aguardam recálculo por um usuário com permissão de edição.");
      }
      continue;
    }
    const [state, snapshots, receita, compras, produtos, folha, ledger] = await Promise.all([
      db.from("financeiro_revisoes").select("revisao").eq("unit_id", unitId).maybeSingle(),
      fetchAllPaginado((from, to) => db.from("kpi_snapshot").select("competencia,revisao_fonte").eq("unit_id", unitId).range(from, to)),
      fetchAllPaginado((from, to) => db.from("receita_dias").select("data").eq("unit_id", unitId).range(from, to)),
      fetchAllPaginado((from, to) => db.from("titulos_a_pagar").select("d_competencia,d_lancamento,d_vencimento").eq("unit_id", unitId).in("origem", ["nf_pedidos", "contas_pagar"]).range(from, to)),
      fetchAllPaginado((from, to) => db.from("produtos_relatorio").select("mes_lancamento,ano_lancamento").eq("unit_id", unitId).range(from, to)),
      fetchAllPaginado((from, to) => db.from("payroll_extrato_dominio_competencia").select("competencia").eq("unit_id", unitId).range(from, to)),
      fetchAllPaginado((from, to) => db.from("lancamentos").select("competencia").eq("unit_id", unitId).range(from, to)),
    ]);
    if (state.error) throw new Error(state.error.message);
    const revision = Number(state.data?.revisao ?? 0);
    const current = new Map(snapshots.map(r => [r.competencia, Number(r.revisao_fonte)]));
    const months = new Set<string>([
      ...ledger.map(r => String(r.competencia)), ...snapshots.map(r => String(r.competencia)), ...receita.map(r => `${String(r.data).slice(0, 7)}-01`),
      ...compras.map(r => competenciaTitulo(r)).filter((v): v is string => v !== null),
      ...produtos.filter(r => r.ano_lancamento && r.mes_lancamento).map(r => `${r.ano_lancamento}-${String(r.mes_lancamento).padStart(2, "0")}-01`),
      ...folha.map(r => `${String(r.competencia).slice(0, 7)}-01`),
    ]);
    for (const month of [...months].sort()) {
      if (current.get(month) === revision) continue;
      const result = await gerarRazao(db, unitId, month);
      if (!result.ok) throw new Error(`Fonte salva, mas os indicadores de ${month.slice(0, 7)} precisam ser recalculados: ${result.snapshot.error ?? result.receita.error ?? result.titulos.error ?? "falha no processamento"}`);
    }
  }
}
