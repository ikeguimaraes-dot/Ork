import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@ork/db/supabase/server";
import { getShellBase } from "@/lib/shell-url";
export async function GET(request: NextRequest) {
  const db = await createSupabaseServerClient();
  const code = request.nextUrl.searchParams.get("code");
  const token = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  let ok = false;
  if (db && code) ok = !(await db.auth.exchangeCodeForSession(code)).error;
  else if (db && token && (type === "invite" || type === "recovery" || type === "magiclink")) ok = !(await db.auth.verifyOtp({ token_hash: token, type })).error;
  return NextResponse.redirect(new URL(ok ? "/redefinir-senha" : "/login?error=credentials", getShellBase()));
}
