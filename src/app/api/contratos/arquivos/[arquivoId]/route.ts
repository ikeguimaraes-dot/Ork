import { getServiceClient, jsonOk, jsonError, corsOptions, BUCKET } from "@/lib/contratos/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsOptions();
}

// DELETE /api/contratos/arquivos/[arquivoId] — remove o arquivo (Storage + linha)
export async function DELETE(_req: Request, { params }: { params: Promise<{ arquivoId: string }> }) {
  try {
    const { arquivoId } = await params;
    const supabase = await getServiceClient();
    const { data: arq } = await supabase
      .from("contratos_arquivos").select("storage_path").eq("id", arquivoId).single();
    if (arq?.storage_path) await supabase.storage.from(BUCKET).remove([arq.storage_path]);
    const { error } = await supabase.from("contratos_arquivos").delete().eq("id", arquivoId);
    if (error) return jsonError(error.message);
    return jsonOk({ ok: true });
  } catch (e) {
    return jsonError(String(e));
  }
}
