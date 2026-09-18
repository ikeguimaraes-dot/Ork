import { getServiceClient, jsonOk, jsonError, corsOptions, pickContrato } from "@/lib/contratos/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsOptions();
}

// GET /api/contratos — lista com contagem de arquivos
export async function GET() {
  try {
    const supabase = await getServiceClient();
    const { data, error } = await supabase
      .from("contratos")
      .select("*, contratos_arquivos(count)")
      .order("created_at", { ascending: false });
    if (error) return jsonError(error.message);
    const contratos = (data ?? []).map((row) => {
      const { contratos_arquivos, ...rest } = row;
      return { ...rest, arquivos_count: contratos_arquivos?.[0]?.count ?? 0 };
    });
    return jsonOk({ contratos });
  } catch (e) {
    return jsonError(String(e));
  }
}

// POST /api/contratos — cria contrato (metadados) → retorna id
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (!body.titulo || !body.categoria || !body.contraparte) {
      return jsonError("titulo, categoria e contraparte são obrigatórios", 400);
    }
    const supabase = await getServiceClient();
    const { data, error } = await supabase
      .from("contratos")
      .insert(pickContrato(body))
      .select("id")
      .single();
    if (error) return jsonError(error.message);
    return jsonOk({ id: data.id }, 201);
  } catch (e) {
    return jsonError(String(e));
  }
}
