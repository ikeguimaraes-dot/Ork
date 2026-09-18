export const runtime = "nodejs";

export async function GET() {
  const anthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  return Response.json({
    ok: true,
    env: { anthropicKey, supabaseUrl, serviceKey },
    runtime: "nodejs",
    ts: new Date().toISOString(),
  });
}
