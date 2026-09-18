import { getServiceClient, jsonOk, jsonError, corsOptions, LINHAS_DRE } from "@/lib/dre/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function OPTIONS() {
  return corsOptions();
}

// GET /api/dre/mapa?ano=&mes=
// Retorna o mapa atual + TODAS as contas distintas da titulos_a_pagar com seus
// totais (sum v_titulo, contagem). O mapeamento (linha_dre) é GLOBAL — o filtro
// de mês afeta SÓ os totais/contagem exibidos, nunca a classificação.
// mes pode ser "todos" (consolidado do ano) ou 1..12. Sem mes/ano: usa o mês
// mais recente COM dados (não o do calendário). Retorna meses_disponiveis e o
// mes_aplicado/ano_aplicado para a tela sincronizar os seletores.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const anoP = searchParams.get("ano");
    const mesP = searchParams.get("mes"); // "todos" | "1".."12" | null

    const supabase = await getServiceClient();
    const [titRes, mapaRes] = await Promise.all([
      supabase.from("titulos_a_pagar").select("descricao_c_gerencial, v_titulo, ref_mes"),
      supabase.from("mapa_conta_dre").select("descricao_c_gerencial, linha_dre, esperada_mensal"),
    ]);
    if (titRes.error) return jsonError(`titulos_a_pagar: ${titRes.error.message}`);
    if (mapaRes.error) return jsonError(`mapa_conta_dre: ${mapaRes.error.message}`);

    const titulos = titRes.data ?? [];
    const meses_disponiveis = Array.from(new Set(titulos.map((t) => t.ref_mes).filter(Boolean) as string[])).sort().reverse();

    // Resolve o filtro de mês.
    let refFiltro: (r: string | null) => boolean = () => true;
    let mes_aplicado: string | number | null = null;
    let ano_aplicado: number | null = anoP ? Number(anoP) : null;
    if (mesP === "todos") {
      mes_aplicado = "todos";
      if (anoP) { const a = anoP; refFiltro = (r) => !!r && r >= `${a}-01-01` && r <= `${a}-12-31`; }
    } else if (mesP && anoP) {
      const ref = `${anoP}-${String(Number(mesP)).padStart(2, "0")}-01`;
      refFiltro = (r) => r === ref; mes_aplicado = Number(mesP); ano_aplicado = Number(anoP);
    } else {
      const latest = meses_disponiveis[0] ?? null; // mais recente COM dados
      if (latest) { refFiltro = (r) => r === latest; ano_aplicado = Number(latest.slice(0, 4)); mes_aplicado = Number(latest.slice(5, 7)); }
    }

    const mapa = new Map<string, { linha_dre: string | null; esperada_mensal: boolean }>();
    for (const m of mapaRes.data ?? []) {
      mapa.set(m.descricao_c_gerencial, { linha_dre: m.linha_dre ?? null, esperada_mensal: !!m.esperada_mensal });
    }

    // Agrega títulos (filtrados pelo mês) por conta gerencial.
    const agg = new Map<string, { total: number; count: number }>();
    for (const t of titulos) {
      if (!refFiltro((t.ref_mes as string | null) ?? null)) continue;
      const k = t.descricao_c_gerencial ?? "(sem conta)";
      const ex = agg.get(k) ?? { total: 0, count: 0 };
      ex.total += Number(t.v_titulo ?? 0);
      ex.count += 1;
      agg.set(k, ex);
    }

    // Base = TODAS as contas distintas que existem na titulos_a_pagar (qualquer
    // mês), com os totais do mês filtrado (0 se não houver título no mês). Assim
    // a classificação (global) continua sempre visível, só os números mudam.
    const contasTitulos = new Set<string>(titulos.map((t) => t.descricao_c_gerencial ?? "(sem conta)"));
    const contas = Array.from(contasTitulos)
      .map((descricao_c_gerencial) => {
        const a = agg.get(descricao_c_gerencial) ?? { total: 0, count: 0 };
        const m = mapa.get(descricao_c_gerencial);
        return {
          descricao_c_gerencial,
          total: a.total,
          count: a.count,
          linha_dre: m?.linha_dre ?? null,
          esperada_mensal: m?.esperada_mensal ?? false,
          classificada: !!m?.linha_dre,
        };
      })
      .sort((a, b) => b.total - a.total);

    const a_classificar = contas.filter((c) => !c.classificada).length;

    return jsonOk({ contas, linhas: LINHAS_DRE, a_classificar, meses_disponiveis, mes_aplicado, ano_aplicado });
  } catch (e) {
    return jsonError(String(e));
  }
}

// POST /api/dre/mapa  { mapeamentos: [{ descricao_c_gerencial, linha_dre, esperada_mensal }] }
// Upsert no mapa_conta_dre (chave: descricao_c_gerencial).
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      mapeamentos?: { descricao_c_gerencial: string; linha_dre: string | null; esperada_mensal?: boolean }[];
    };
    const lista = (body.mapeamentos ?? []).filter((m) => m.descricao_c_gerencial);
    if (!lista.length) return jsonError("nenhum mapeamento enviado", 400);

    const supabase = await getServiceClient();
    const rows = lista.map((m) => ({
      descricao_c_gerencial: m.descricao_c_gerencial,
      linha_dre: m.linha_dre || null,
      esperada_mensal: !!m.esperada_mensal,
      atualizado_em: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("mapa_conta_dre")
      .upsert(rows, { onConflict: "descricao_c_gerencial" });
    if (error) return jsonError(error.message);

    return jsonOk({ ok: true, salvos: rows.length });
  } catch (e) {
    return jsonError(String(e));
  }
}
