import { getServiceClient, jsonOk, jsonError, corsOptions, BUCKET, unitFolder, safeFileName } from "@/lib/contratos/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsOptions();
}

// POST /api/contratos/[id]/arquivos/upload-url
// Gera uma signed upload URL. O client envia o PDF DIRETO ao Storage com ela
// (não passa pela Vercel — evita o limite de ~4.5 MB de body das functions).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { nome?: string };
    const nome = body.nome?.trim();
    if (!nome) return jsonError("nome do arquivo é obrigatório", 400);

    const supabase = await getServiceClient();
    const { data: contrato, error: cErr } = await supabase
      .from("contratos").select("unit_id").eq("id", id).single();
    if (cErr || !contrato) return jsonError("contrato não encontrado", 404);

    const path = `${unitFolder(contrato.unit_id)}/${id}/${Date.now()}-${safeFileName(nome)}`;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) return jsonError(error.message);

    return jsonOk({ path: data.path, token: data.token, signedUrl: data.signedUrl });
  } catch (e) {
    return jsonError(String(e));
  }
}
