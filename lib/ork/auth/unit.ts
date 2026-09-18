import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { createSupabaseServerClient } from "@ork/db/supabase/server";
import type { Unit } from "@ork/db/types/database";

// Rename kph_unit_id → ork_unit_id em andamento (mesmo rename kph→ork do
// menu). O shell ainda grava o nome antigo — migração coordenada nos dois
// repos. Leitura tolerante aos dois nomes enquanto isso: ork_unit_id tem
// prioridade se presente, senão cai pro nome antigo. Nunca escreve o
// cookie aqui (Server Component não pode; e quem grava é o shell).
const COOKIE_KEY_NOVO = "ork_unit_id";
const COOKIE_KEY_ANTIGO = "kph_unit_id";

async function lerCookieUnidade(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_KEY_NOVO)?.value ?? cookieStore.get(COOKIE_KEY_ANTIGO)?.value;
}

/**
 * Resolve a unit selecionada (server-side) lendo o cookie escrito pelo
 * AuthProvider. Se cookie ausente, inválido (UUID que não existe) ou
 * apontando pra unit que o user não acessa, cai pra primeira unit acessível.
 *
 * Falha em qualquer query NÃO derruba o request — loga e retorna null.
 */
export const getCurrentUnit = cache(async (): Promise<Unit | null> => {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      console.warn("[getCurrentUnit] supabase indisponível (env vars vazias)");
      return null;
    }

    const cookieId = await lerCookieUnidade();

    // 1) Tenta resolver pela unit no cookie. Se RLS bloquear ou não existir,
    //    cai no fallback abaixo.
    if (cookieId) {
      const { data, error } = await supabase
        .from("units")
        .select("*")
        .eq("id", cookieId)
        .eq("active", true)
        .maybeSingle();
      if (error) {
        console.warn("[getCurrentUnit] cookie lookup error:", error.message);
      }
      if (data) return data as Unit;
    }

    // 2) Fallback: primeira unit ativa que o user pode ver (RLS aplica).
    const { data, error } = await supabase
      .from("units")
      .select("*")
      .eq("active", true)
      .order("name")
      .limit(1);
    if (error) {
      console.error("[getCurrentUnit] fallback query error:", error.message);
      return null;
    }
    const first = data?.[0];
    if (!first) {
      console.warn("[getCurrentUnit] user não tem unit acessível (RLS sem match)");
      return null;
    }
    return first as Unit;
  } catch (e) {
    console.error("[getCurrentUnit] exceção:", e);
    return null;
  }
});

export type UnidadeAtual = { unit: Unit | null; cookiePresente: boolean };

/**
 * Mesma resolução de getCurrentUnit(), mas também informa se o cookie de
 * unidade existia — pra telas que precisam mostrar um aviso explícito
 * quando caem no fallback (nenhuma unidade selecionada no shell ainda).
 * Não substitui getCurrentUnit(): esta função é só para as telas que
 * removeram seletor local de unidade e precisam do aviso; os callers
 * existentes de getCurrentUnit() continuam intactos.
 */
export async function getCurrentUnitComOrigem(): Promise<UnidadeAtual> {
  const cookiePresente = !!(await lerCookieUnidade());
  const unit = await getCurrentUnit();
  return { unit, cookiePresente };
}
