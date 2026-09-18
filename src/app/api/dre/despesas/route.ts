import { getServiceClient, jsonOk, jsonError, corsOptions, resolveEmpresa } from "@/lib/dre/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function OPTIONS() {
  return corsOptions();
}

// GET /api/dre/despesas?unidade=&ano=&linha_dre=
// Junta titulos_a_pagar com mapa_conta_dre (por descricao_c_gerencial), agrupa
// por linha_dre + ref_mes e soma v_titulo (regime de caixa). Inclui o bloco
// nao_classificadas (contas sem mapeamento).
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const empresa = resolveEmpresa(searchParams.get("unidade") ?? searchParams.get("empresa"));
    const ano = searchParams.get("ano");
    const linhaFiltro = searchParams.get("linha_dre");

    const supabase = await getServiceClient();

    let q = supabase
      .from("titulos_a_pagar")
      .select("id, descricao_c_gerencial, v_titulo, ref_mes, empresa");
    if (empresa) q = q.eq("empresa", empresa);
    if (ano) q = q.gte("ref_mes", `${ano}-01-01`).lte("ref_mes", `${ano}-12-31`);

    const [titRes, mapaRes, ovRes] = await Promise.all([
      q,
      supabase.from("mapa_conta_dre").select("descricao_c_gerencial, linha_dre, esperada_mensal"),
      supabase.from("titulo_override").select("titulo_id, linha_dre_corrigida"),
    ]);
    if (titRes.error) return jsonError(`titulos_a_pagar: ${titRes.error.message}`);
    if (mapaRes.error) return jsonError(`mapa_conta_dre: ${mapaRes.error.message}`);
    if (ovRes.error) return jsonError(`titulo_override: ${ovRes.error.message}`);

    const mapa = new Map<string, string | null>();
    for (const m of mapaRes.data ?? []) mapa.set(m.descricao_c_gerencial, m.linha_dre ?? null);
    // Precedência: override do título > mapa da conta.
    const override = new Map<string, string | null>();
    for (const o of ovRes.data ?? []) override.set(o.titulo_id, o.linha_dre_corrigida ?? null);

    // Agrupa por linha_dre → { total, meses: { ref_mes: valor } }
    const linhas: Record<string, { total: number; meses: Record<string, number> }> = {};
    // Não classificadas: por conta gerencial
    const naoMap = new Map<string, { total: number; count: number }>();

    for (const t of titRes.data ?? []) {
      const desc = t.descricao_c_gerencial ?? "(sem conta)";
      const valor = Number(t.v_titulo ?? 0); // positivo = despesa
      const mes = (t.ref_mes as string | null) ?? null;
      const ov = override.get(t.id as string);
      const linha = (ov !== undefined ? ov : mapa.get(desc)) ?? null;

      if (!linha) {
        const ex = naoMap.get(desc) ?? { total: 0, count: 0 };
        ex.total += valor; ex.count += 1; naoMap.set(desc, ex);
        continue;
      }
      if (linhaFiltro && linha !== linhaFiltro) continue;

      const L = (linhas[linha] ??= { total: 0, meses: {} });
      L.total += valor;
      if (mes) L.meses[mes] = (L.meses[mes] ?? 0) + valor;
    }

    const nao_classificadas = {
      total: Array.from(naoMap.values()).reduce((s, x) => s + x.total, 0),
      count: Array.from(naoMap.values()).reduce((s, x) => s + x.count, 0),
      contas: Array.from(naoMap.entries())
        .map(([descricao_c_gerencial, { total, count }]) => ({ descricao_c_gerencial, total, count }))
        .sort((a, b) => b.total - a.total),
    };

    return jsonOk({
      ano: ano ? Number(ano) : null,
      empresa: empresa ?? null,
      linhas,
      nao_classificadas,
    });
  } catch (e) {
    return jsonError(String(e));
  }
}
