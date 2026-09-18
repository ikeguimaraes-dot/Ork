"use server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@ork/db/supabase/server";
export async function login(form: FormData) {
  const db = await createSupabaseServerClient();
  if (!db) redirect("/login?error=config");
  const { error } = await db.auth.signInWithPassword({ email: String(form.get("email") || "").trim(), password: String(form.get("password") || "") });
  if (error) redirect("/login?error=credentials");
  const next = String(form.get("next") || "/financeiro");
  redirect(next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/financeiro");
}
