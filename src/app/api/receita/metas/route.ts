import { createFinanceiroClient } from "@/lib/financeiro/db/client";


export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin":  "http://localhost:3001",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { headers: CORS });
}

const getServiceClient = createFinanceiroClient;

type Override = { data: string; meta: number | null };

export async function POST(request: Request) {
  let body: { unit_id?: string; overrides?: Override[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400, headers: CORS });
  }

  const { unit_id, overrides } = body;
  if (!unit_id || !Array.isArray(overrides)) {
    return Response.json({ error: "unit_id e overrides são obrigatórios" }, { status: 400, headers: CORS });
  }

  let db: Awaited<ReturnType<typeof getServiceClient>>;
  try {
    db = await getServiceClient();
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }

  const toUpsert = overrides.filter((o) => o.meta != null);
  const toDelete = overrides.filter((o) => o.meta == null).map((o) => o.data);

  const errors: string[] = [];

  if (toUpsert.length > 0) {
    const { error } = await db
      .from("metas_dia_override")
      .upsert(
        toUpsert.map((o) => ({ unit_id, data: o.data, meta: o.meta })),
        { onConflict: "unit_id,data" },
      );
    if (error) errors.push(`upsert: ${error.message}`);
  }

  for (const data of toDelete) {
    const { error } = await db
      .from("metas_dia_override")
      .delete()
      .eq("unit_id", unit_id)
      .eq("data", data);
    if (error) errors.push(`delete ${data}: ${error.message}`);
  }

  if (errors.length > 0) {
    return Response.json({ error: errors.join(" | ") }, { status: 500, headers: CORS });
  }

  return Response.json({ ok: true }, { headers: CORS });
}
