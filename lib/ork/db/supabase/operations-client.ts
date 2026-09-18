import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { OperationsDatabase } from "../types/operations-database";

/**
 * Cliente Supabase para tabelas de operações Restaurante exemplo.
 *
 * Após Sprint 2 (migração consolidada), as tabelas workday_*, titulos_a_pagar,
 * vendas_diarias, metas_projecoes e notas_* vivem no banco Principal
 * (projeto-do-cliente). OPERATIONS_SUPABASE_* vars podem ser removidas.
 *
 * Fallback automático: se OPERATIONS_SUPABASE_URL não estiver definida,
 * usa o banco Principal via NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * NUNCA usar no bundle do cliente — service key é server-only.
 * Usar apenas em Server Actions e Route Handlers.
 */
export function createOperationsClient(): SupabaseClient<OperationsDatabase> | null {
  const url =
    process.env.OPERATIONS_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.OPERATIONS_SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient<OperationsDatabase>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Versão com anon key — fallback ao banco Principal se OPERATIONS_* não definido.
 */
export function createOperationsAnonClient(): SupabaseClient<OperationsDatabase> | null {
  const url =
    process.env.OPERATIONS_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.OPERATIONS_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient<OperationsDatabase>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
