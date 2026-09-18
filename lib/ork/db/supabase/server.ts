import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "../types/database";

/**
 * Cliente Supabase para Server Components / Server Actions / Route Handlers.
 * Lê cookies via next/headers — a sessão é compartilhada com o cliente browser.
 *
 * Em Server Components, setAll é no-op (cookies só podem ser escritos durante
 * Server Actions ou Route Handlers — Next levanta erro se tentar). Por isso
 * tratamos a exceção silenciosamente.
 */
export async function createSupabaseServerClient(
  resolvedCookieStore?: Awaited<ReturnType<typeof cookies>>
): Promise<SupabaseClient<Database> | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const cookieStore = resolvedCookieStore ?? (await cookies());

  return createServerClient<Database>(url, anonKey, {
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component: cookies não podem ser escritos. proxy.ts
          // cuida do refresh. Ignorar é seguro.
        }
      },
    },
  });
}

/**
 * Cliente com service role — bypassa RLS. Usar APENAS em Server Actions /
 * Route Handlers de confiança (audit_log writer, jobs internos).
 * NUNCA expor SUPABASE_SERVICE_ROLE_KEY no bundle do client.
 */
export function createServiceClient(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
