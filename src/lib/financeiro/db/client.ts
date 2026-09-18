import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@ork/db/supabase/server";

/** Requests always use the verified user's JWT and database RLS, never service role. */
export async function createFinanceiroClient(): Promise<SupabaseClient> {
  const db = await createSupabaseServerClient();
  if (!db) throw new Error("Banco de dados indisponível");
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) throw new Error("Não autorizado");
  return db;
}
