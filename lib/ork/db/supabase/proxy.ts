import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "../types/database";

/**
 * Mantém a sessão Supabase em sincronia entre request e response.
 * Chamado pelo proxy.ts a cada request — a versão moderna do que era
 * o middleware do Next ≤ 15.
 *
 * Se as env vars não estão setadas (modo dev sem Supabase), retorna user=null
 * e o proxy redireciona pra /login. UI não quebra.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { response, user: null };
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Padrão oficial @supabase/ssr: atualiza request + cria nova response com
        // cookies persistidos. Server Components vêem o cookie atualizado via
        // request; browser recebe o cookie via Set-Cookie na response.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() valida o JWT contra o Auth server (não confia só no cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
