"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

/** The shell serves the app under the same host, so SSR uses host-only cookies. */
export function getBrowserClient(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createBrowserClient<Database>(url, anonKey, {
    cookieOptions: { path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production" },
  });
}
