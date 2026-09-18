import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@ork/db/supabase/server";
import { getShellLoginUrl } from "../../../src/lib/shell-url";
import type { RoleName } from "@ork/db/types/database";

export type CurrentUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  roles: Array<{
    role: RoleName;
    unitId: string | null;
    brandId: string | null;
    groupId: string | null;
  }>;
};

/**
 * DAL — verifica sessão e carrega roles. `cache` memoiza durante uma render pass.
 * Server-only. Retorna null se sem sessão ou sem Supabase.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  try {
    const cookieStore = await cookies();
    const supabase = await createSupabaseServerClient(cookieStore);
    if (!supabase) {
      console.warn("[getCurrentUser] supabase indisponível");
      return null;
    }

    // Valida a identidade no servidor, inclusive em chamadas diretas às actions.
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError) {
      console.warn("[getCurrentUser] auth.getUser error:", authError.message);
      return null;
    }
    if (!user) return null;

    // Pega roles do user. RLS permite SELECT do próprio user_roles.
    // Embedded select (roles!inner) não é tipado pelo nosso Database — cast explícito.
    type RoleJoinRow = {
      unit_id: string | null;
      brand_id: string | null;
      group_id: string | null;
      roles: { name: RoleName } | { name: RoleName }[] | null;
    };
    const { data: rolesData, error: rolesError } = await supabase
      .from("user_roles")
      .select("unit_id, brand_id, group_id, roles!inner(name)")
      .eq("user_id", user.id)
      .returns<RoleJoinRow[]>();

    if (rolesError) {
      console.error("[getCurrentUser] roles query error:", rolesError.message);
      // Continua com roles vazias — não bloqueia o user.
    }

    const roles = (rolesData ?? []).map((r) => {
      const roleObj = Array.isArray(r.roles) ? r.roles[0] : r.roles;
      return {
        role: (roleObj?.name ?? "colaborador") as RoleName,
        unitId: r.unit_id,
        brandId: r.brand_id,
        groupId: r.group_id,
      };
    });

    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const displayName = [metadata.display_name, metadata.full_name, metadata.name]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
      ?.trim() ?? null;

    return {
      id: user.id,
      email: user.email ?? null,
      displayName,
      roles,
    };
  } catch (e) {
    // Next.js usa exceptions especiais (NEXT_REDIRECT, NEXT_DYNAMIC_USAGE) pra
    // controle de fluxo. NUNCA engolir — deixa Next tratar.
    if (isNextInternal(e)) throw e;
    console.error("[getCurrentUser] exceção:", e);
    return null;
  }
});

function isNextInternal(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const digest = (e as { digest?: unknown }).digest;
  if (typeof digest === "string") {
    return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("DYNAMIC_SERVER_USAGE");
  }
  const message = (e as { message?: unknown }).message;
  return typeof message === "string" && message.includes("Dynamic server usage");
}

/**
 * Garante user autenticado. Se não houver sessão, redireciona pro login do shell.
 *
 * O middleware (ork-financeiro/src/middleware.ts) já deveria ter bloqueado
 * essa request antes de chegar aqui. Este redirect é uma rede de segurança
 * caso o middleware falhe ou seja bypassado em alguma rota interna.
 *
 * A URL do shell vem de NEXT_PUBLIC_SHELL_URL (dev) ou do fallback de produção.
 * Não usamos `headers().get("referer")` porque pode ser spoofed.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user) return user;
  if (process.env.NEXT_PUBLIC_SHELL_URL?.includes("localhost")) {
    const cookieStore = await cookies();
    console.info("[finance-require-user] no session", {
      cookieNames: cookieStore.getAll().map((cookie) => cookie.name),
    });
  }
  // Sem sessão → manda pro login do shell. Não temos `request.url` aqui
  // (servers components não recebem a request), então voltamos pra raiz
  // do shell — o shell decide pra onde mandar.
  redirect(getShellLoginUrl("/financeiro").toString());
}

/** Falha se o user não tiver pelo menos uma das roles especificadas. */
export async function requireRole(allowed: ReadonlyArray<RoleName>): Promise<CurrentUser> {
  const user = await requireUser();
  const has = user.roles.some((r) => allowed.includes(r.role));
  if (!has) redirect("/");
  return user;
}

/** Conveniência: o user é founder? */
export function isFounder(user: CurrentUser | null): boolean {
  return !!user?.roles.some((r) => r.role === "founder");
}
