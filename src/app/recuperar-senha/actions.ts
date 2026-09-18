"use server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@ork/db/supabase/server";
import { getShellBase } from "@/lib/shell-url";
export async function recover(form: FormData) {
  const db = await createSupabaseServerClient();
  await db?.auth.resetPasswordForEmail(String(form.get("email") || "").trim(), { redirectTo: new URL("/auth/callback", getShellBase()).href });
  redirect("/recuperar-senha?sent=1");
}
