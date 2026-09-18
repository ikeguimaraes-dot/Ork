import { getServiceClient, jsonOk, jsonError, corsOptions, resolveEmpresa } from "@/lib/dre/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function OPTIONS() {
  return corsOptions();
}

// GET /api/dre/titulos?conta=<descricao_c_gerencial>&unidade=&ano=
// Títulos individuais daquela conta gerencial (ordenados por valor desc), com a
// info de override quando houver. unidade/ano são opcionais.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const conta = searchParams.get("conta");
    const empresa = resolveEmpresa(searchParams.get("unidade") ?? searchParams.get("empresa"));
    const ano = searchParams.get("ano");
    const mes = searchParams.get("mes"); // "todos" | "1".."12" | null
    if (!conta) return jsonError("param 'conta' é obrigatório", 400);

    const supabase = await getServiceClient();
    let q = supabase
      .from("titulos_a_pagar")
      .select("id, fantasia_fornecedor, razao_fornecedor, documento, n_nota_fiscal, descricao_c_gerencial, v_titulo, ref_mes, d_vencimento")
      .eq("descricao_c_gerencial", conta)
      .order("v_titulo", { ascending: false });
    if (empresa) q = q.eq("empresa", empresa);
    // ref_mes é sempre o 1º dia do mês → filtro exato por mês.
    if (mes && mes !== "todos" && ano) q = q.eq("ref_mes", `${ano}-${String(Number(mes)).padStart(2, "0")}-01`);
    else if (ano) q = q.gte("ref_mes", `${ano}-01-01`).lte("ref_mes", `${ano}-12-31`);

    const titRes = await q;
    if (titRes.error) return jsonError(`titulos_a_pagar: ${titRes.error.message}`);
    const ids = (titRes.data ?? []).map((t) => t.id);

    const ovMap = new Map<string, { linha_dre_corrigida: string | null; observacao: string | null }>();
    if (ids.length) {
      const ovRes = await supabase
        .from("titulo_override")
        .select("titulo_id, linha_dre_corrigida, observacao")
        .in("titulo_id", ids);
      if (ovRes.error) return jsonError(`titulo_override: ${ovRes.error.message}`);
      for (const o of ovRes.data ?? []) ovMap.set(o.titulo_id, { linha_dre_corrigida: o.linha_dre_corrigida ?? null, observacao: o.observacao ?? null });
    }

    const titulos = (titRes.data ?? []).map((t) => {
      const ov = ovMap.get(t.id as string);
      return {
        id: t.id,
        razao_fornecedor: t.razao_fornecedor ?? null,
        fantasia_fornecedor: t.fantasia_fornecedor ?? null,
        fornecedor: t.razao_fornecedor ?? t.fantasia_fornecedor ?? "—",
        documento: t.documento ?? t.n_nota_fiscal ?? null,
        descricao_c_gerencial: t.descricao_c_gerencial,
        v_titulo: Number(t.v_titulo ?? 0),
        ref_mes: t.ref_mes,
        d_vencimento: t.d_vencimento,
        override_linha: ov?.linha_dre_corrigida ?? null,
        override_obs: ov?.observacao ?? null,
      };
    });

    return jsonOk({ conta, titulos });
  } catch (e) {
    return jsonError(String(e));
  }
}
