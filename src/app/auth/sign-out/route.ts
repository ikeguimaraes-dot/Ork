import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@ork/db/supabase/server";
import { getShellBase } from "@/lib/shell-url";
export async function POST() {
  const db = await createSupabaseServerClient();
  await db?.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/login", getShellBase()), 303);
}
export function GET() {
  // GET is intentionally side-effect free: crawlers/prefetch cannot revoke a session.
  return NextResponse.redirect(new URL("/financeiro", getShellBase()), 303);
}
