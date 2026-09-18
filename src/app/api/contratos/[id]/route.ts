import { getServiceClient, jsonOk, jsonError, corsOptions, BUCKET, pickContrato } from "@/lib/contratos/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsOptions();
}

// GET /api/contratos/[id] — contrato + arquivos
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await getServiceClient();
    const { data, error } = await supabase
      .from("contratos")
      .select("*, contratos_arquivos(*)")
      .eq("id", id)
      .single();
    if (error) return jsonError(error.message, 404);
    return jsonOk({ contrato: data });
  } catch (e) {
    return jsonError(String(e));
  }
}

// PATCH /api/contratos/[id] — edita
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    const supabase = await getServiceClient();
    const patch = { ...pickContrato(body), updated_at: new Date().toISOString() };
    const { error } = await supabase.from("contratos").update(patch).eq("id", id);
    if (error) return jsonError(error.message);
    return jsonOk({ ok: true });
  } catch (e) {
    return jsonError(String(e));
  }
}

// DELETE /api/contratos/[id] — apaga contrato + remove arquivos do Storage
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await getServiceClient();
    const { data: arqs } = await supabase
      .from("contratos_arquivos")
      .select("storage_path")
      .eq("contrato_id", id);
    const paths = (arqs ?? []).map((a) => a.storage_path).filter(Boolean);
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    const { error } = await supabase.from("contratos").delete().eq("id", id); // cascade nos arquivos
    if (error) return jsonError(error.message);
    return jsonOk({ ok: true });
  } catch (e) {
    return jsonError(String(e));
  }
}
