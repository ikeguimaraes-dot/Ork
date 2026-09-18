import { getServiceClient, jsonOk, jsonError, corsOptions } from "@/lib/contratos/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsOptions();
}

// POST /api/contratos/[id]/arquivos — registra metadados do arquivo após o upload
// direto ao Storage (feito pelo client via signed URL).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      tipo?: string; nome?: string; storage_path?: string;
      tamanho_bytes?: number; content_type?: string;
    };
    if (!body.nome || !body.storage_path) {
      return jsonError("nome e storage_path são obrigatórios", 400);
    }
    const supabase = await getServiceClient();
    const { data, error } = await supabase
      .from("contratos_arquivos")
      .insert({
        contrato_id: id,
        tipo: body.tipo || "principal",
        nome: body.nome,
        storage_path: body.storage_path,
        tamanho_bytes: body.tamanho_bytes ?? null,
        content_type: body.content_type || "application/pdf",
      })
      .select("*")
      .single();
    if (error) return jsonError(error.message);
    return jsonOk({ arquivo: data }, 201);
  } catch (e) {
    return jsonError(String(e));
  }
}
