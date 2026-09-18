import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyBatch, replacement, type Mutation, type Row } from "@/lib/financeiro/db/atomic";

export function stableId(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function persistMovimento(db: SupabaseClient, row: Row, details: Record<string, Row[]>): Promise<string> {
  if (!row.unit_id || !row.workday_id || !row.data || !Number.isFinite(Number(row.receita_bruta))) throw new Error("Movimento sem unidade, dia, identificador ou receita válida.");
  const { data: existing, error } = await db.from("receita_dias").select("id").eq("unit_id", row.unit_id).eq("workday_id", row.workday_id).maybeSingle();
  if (error) throw new Error(error.message);
  const id: string = existing?.id ?? stableId(`${row.unit_id}|${row.workday_id}`);
  const operations: Mutation[] = [{ table: "receita_dias", operation: "upsert", rows: [{ ...row, id }], conflict: "unit_id,workday_id" }];
  for (const [table, rows] of Object.entries(details)) operations.push(...replacement(table, { workday_id_fk: id }, rows.map(r => ({ ...r, workday_id_fk: id }))));
  await applyBatch(db, operations);
  return id;
}

export function turnoDoMovimento(names: string[]): "almoco" | "jantar" | "dia_inteiro" {
  const text = names.join(" ").toLowerCase();
  const almoco = /tarde|almo[cç]o/.test(text), jantar = /noite|jantar/.test(text);
  return almoco && !jantar ? "almoco" : jantar && !almoco ? "jantar" : "dia_inteiro";
}
