import { getServiceClient, jsonOk, jsonError, corsOptions } from "@/lib/dre/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function OPTIONS() {
  return corsOptions();
}

// POST /api/dre/override  { titulo_id, linha_dre_corrigida, observacao? }
// Grava/atualiza o override de um título (upsert por titulo_id).
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { titulo_id?: string; linha_dre_corrigida?: string | null; observacao?: string | null };
    if (!body.titulo_id) return jsonError("titulo_id é obrigatório", 400);
    if (!body.linha_dre_corrigida) return jsonError("linha_dre_corrigida é obrigatória", 400);

    const supabase = await getServiceClient();
    const { error } = await supabase
      .from("titulo_override")
      .upsert(
        { titulo_id: body.titulo_id, linha_dre_corrigida: body.linha_dre_corrigida, observacao: body.observacao ?? null },
        { onConflict: "titulo_id" },
      );
    if (error) return jsonError(error.message);
    return jsonOk({ ok: true });
  } catch (e) {
    return jsonError(String(e));
  }
}

// DELETE /api/dre/override?titulo_id=...  (ou body { titulo_id })
// Remove o override — o título volta a seguir o mapa da conta.
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    let tituloId = searchParams.get("titulo_id");
    if (!tituloId) {
      const body = (await req.json().catch(() => ({}))) as { titulo_id?: string };
      tituloId = body.titulo_id ?? null;
    }
    if (!tituloId) return jsonError("titulo_id é obrigatório", 400);

    const supabase = await getServiceClient();
    const { error } = await supabase.from("titulo_override").delete().eq("titulo_id", tituloId);
    if (error) return jsonError(error.message);
    return jsonOk({ ok: true });
  } catch (e) {
    return jsonError(String(e));
  }
}
