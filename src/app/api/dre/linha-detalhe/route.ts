import { getServiceClient, jsonOk, jsonError, corsOptions, resolveEmpresa } from "@/lib/dre/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function OPTIONS() {
  return corsOptions();
}

// GET /api/dre/linha-detalhe?linha=<linha>&unidade=&ano=
// Breakdown por conta gerencial DENTRO de uma linha da DRE, mês a mês, aplicando
// a precedência override do título > mapa da conta. Inclui as contas esperadas
// (esperada_mensal) mesmo sem lançamento, para a tela sinalizar faltantes.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const linha = searchParams.get("linha");
    if (!linha) return jsonError("param 'linha' é obrigatório", 400);
    const empresa = resolveEmpresa(searchParams.get("unidade") ?? searchParams.get("empresa"));
    const ano = Number(searchParams.get("ano")) || new Date().getFullYear();

    const supabase = await getServiceClient();
    let q = supabase
      .from("titulos_a_pagar")
      .select("id, descricao_c_gerencial, v_titulo, ref_mes, empresa")
      .gte("ref_mes", `${ano}-01-01`).lte("ref_mes", `${ano}-12-31`);
    if (empresa) q = q.eq("empresa", empresa);

    // Último mês com dados da unidade (qualquer linha, qualquer ano) — para a
    // tela escolher um mês inicial que não esteja vazio.
    let ultQ = supabase.from("titulos_a_pagar").select("ref_mes").order("ref_mes", { ascending: false }).limit(1);
    if (empresa) ultQ = ultQ.eq("empresa", empresa);

    const [titRes, mapaRes, ovRes, ultRes] = await Promise.all([
      q,
      supabase.from("mapa_conta_dre").select("descricao_c_gerencial, linha_dre, esperada_mensal"),
      supabase.from("titulo_override").select("titulo_id, linha_dre_corrigida"),
      ultQ,
    ]);
    if (titRes.error) return jsonError(`titulos_a_pagar: ${titRes.error.message}`);
    if (mapaRes.error) return jsonError(`mapa_conta_dre: ${mapaRes.error.message}`);
    if (ovRes.error) return jsonError(`titulo_override: ${ovRes.error.message}`);

    const mapaLinha = new Map<string, string | null>();
    const mapaEsperada = new Map<string, boolean>();
    for (const m of mapaRes.data ?? []) {
      mapaLinha.set(m.descricao_c_gerencial, m.linha_dre ?? null);
      mapaEsperada.set(m.descricao_c_gerencial, !!m.esperada_mensal);
    }
    const override = new Map<string, string | null>();
    for (const o of ovRes.data ?? []) override.set(o.titulo_id, o.linha_dre_corrigida ?? null);

    type Conta = { conta: string; esperada_mensal: boolean; meses: Record<string, number>; total: number };
    const contas = new Map<string, Conta>();

    for (const t of titRes.data ?? []) {
      const desc = t.descricao_c_gerencial ?? "(sem conta)";
      const eff = (override.has(t.id as string) ? override.get(t.id as string) : mapaLinha.get(desc)) ?? null;
      if (eff !== linha) continue;
      const v = Number(t.v_titulo ?? 0); // positivo = despesa
      const mes = (t.ref_mes as string | null) ?? null;
      const c: Conta = contas.get(desc) ?? { conta: desc, esperada_mensal: !!mapaEsperada.get(desc), meses: {}, total: 0 };
      if (mes) c.meses[mes] = (c.meses[mes] ?? 0) + v;
      c.total += v;
      contas.set(desc, c);
    }

    // Contas esperadas desta linha — incluir mesmo sem lançamento (faltantes).
    const esperadas: string[] = [];
    for (const [desc, esp] of mapaEsperada) {
      if (esp && mapaLinha.get(desc) === linha) {
        esperadas.push(desc);
        if (!contas.has(desc)) contas.set(desc, { conta: desc, esperada_mensal: true, meses: {}, total: 0 });
      }
    }

    const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}-01`);
    const lista = Array.from(contas.values()).sort((a, b) => b.total - a.total);
    const total = lista.reduce((s, c) => s + c.total, 0);

    // Meses (deste ano) que têm QUALQUER título da unidade — para o mês inicial.
    const meses_com_dados = Array.from(new Set((titRes.data ?? []).map((t) => t.ref_mes).filter(Boolean) as string[])).sort();
    const ultimo_mes_unidade = (ultRes.data?.[0]?.ref_mes as string | null) ?? null;

    return jsonOk({ linha, ano, empresa: empresa ?? null, meses, contas: lista, esperadas, total, meses_com_dados, ultimo_mes_unidade });
  } catch (e) {
    return jsonError(String(e));
  }
}
