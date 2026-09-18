import { getServiceClient, jsonOk, jsonError, corsOptions, BUCKET } from "@/lib/contratos/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsOptions();
}

// GET /api/contratos/arquivos/[arquivoId]/download — signed URL temporária (60s).
// Bucket é privado; nunca expor URL pública.
export async function GET(_req: Request, { params }: { params: Promise<{ arquivoId: string }> }) {
  try {
    const { arquivoId } = await params;
    const supabase = await getServiceClient();
    const { data: arq, error: aErr } = await supabase
      .from("contratos_arquivos").select("storage_path, nome").eq("id", arquivoId).single();
    if (aErr || !arq) return jsonError("arquivo não encontrado", 404);

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(arq.storage_path, 60, { download: arq.nome });
    if (error) return jsonError(error.message);

    return jsonOk({ url: data.signedUrl, nome: arq.nome });
  } catch (e) {
    return jsonError(String(e));
  }
}
