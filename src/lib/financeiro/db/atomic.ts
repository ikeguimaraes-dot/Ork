import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;
export type Mutation = {
  table: string;
  affectedUnits?: string[];
  operation: "delete" | "insert" | "upsert";
  scope?: Row;
  rows?: Row[];
  conflict?: string;
  ignoreDuplicates?: boolean;
};

/** A single RPC is a PostgreSQL transaction: failure preserves the old data. */
export async function applyBatch(db: Pick<SupabaseClient, "rpc">, operations: Mutation[]): Promise<void> {
  if (!operations.length) return;
  const { error } = await db.rpc("financeiro_aplicar_lote", { p_operations: operations });
  if (error) throw new Error(`Falha ao salvar; a versão anterior foi preservada: ${error.message}`);
  // The collector used while preparing a transaction only implements rpc.
  if ("from" in db) {
    const sourceTables = new Set(["titulos_a_pagar", "produtos_relatorio", "receita_dias", "payroll_extrato_dominio_competencia"]);
    const units = operations.filter(op => sourceTables.has(op.table)).flatMap(op => [...(op.affectedUnits ?? []), op.scope?.unit_id, ...(op.rows ?? []).map(row => row.unit_id)]).filter((id): id is string => typeof id === "string");
    if (units.length) {
      const { refreshUnits } = await import("@/lib/financeiro/razao/refresh");
      await refreshUnits(db as SupabaseClient, units);
    }
  }
}

export function replacement(table: string, scope: Row, rows: Row[]): Mutation[] {
  return [{ table, operation: "delete", scope }, ...(rows.length ? [{ table, operation: "insert" as const, rows }] : [])];
}
