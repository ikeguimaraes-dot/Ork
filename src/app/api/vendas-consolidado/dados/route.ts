import { createFinanceiroClient } from "@/lib/financeiro/db/client";
// Leitura dos dados consolidados de vendas.
// GET ?unit_id=&periodo_id=  → produtos do período (ou do último período da unidade).
// Sempre retorna a lista de períodos importados (para o seletor) + os produtos.


export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin":  "http://localhost:3001",
  "Access-Control-Allow-Methods": "GET",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { headers: CORS });
}

const getServiceClient = createFinanceiroClient;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const unitId = searchParams.get("unit_id");
    let periodoId = searchParams.get("periodo_id");

    if (!unitId) {
      return Response.json({ error: "unit_id é obrigatório" }, { status: 400, headers: CORS });
    }

    const supabase = await getServiceClient();

    // Lista de períodos da unidade (mais recente primeiro)
    const { data: periodos, error: perErr } = await supabase
      .from("vendas_consolidado_periodo")
      .select("*")
      .eq("unit_id", unitId)
      .order("data_inicio", { ascending: false })
      .order("importado_em", { ascending: false });
    if (perErr) return Response.json({ error: perErr.message }, { status: 500, headers: CORS });

    if (!periodos?.length) {
      return Response.json({ periodos: [], periodo: null, produtos: [] }, { headers: CORS });
    }

    // Período selecionado (ou último)
    if (!periodoId || !periodos.some((p) => p.id === periodoId)) {
      periodoId = periodos[0]!.id;
    }
    const periodo = periodos.find((p) => p.id === periodoId) ?? periodos[0]!;

    // Produtos + todas as seções do Movimento, em paralelo.
    const [
      produtosRes, resumoRes, mensalRes, turnoRes, diaRes, ambienteRes, funcRes,
    ] = await Promise.all([
      supabase.from("vendas_consolidado_produtos").select("*").eq("periodo_id", periodoId).order("valor_liquido", { ascending: false }),
      supabase.from("vendas_consolidado_resumo").select("*").eq("periodo_id", periodoId).maybeSingle(),
      supabase.from("vendas_consolidado_mensal").select("*").eq("periodo_id", periodoId).order("ordem", { ascending: true }),
      supabase.from("vendas_consolidado_turno").select("*").eq("periodo_id", periodoId).order("bruto", { ascending: false }),
      supabase.from("vendas_consolidado_dia_semana").select("*").eq("periodo_id", periodoId).order("ordem", { ascending: true }),
      supabase.from("vendas_consolidado_ambiente").select("*").eq("periodo_id", periodoId).order("bruto", { ascending: false }),
      supabase.from("vendas_consolidado_funcionarios").select("*").eq("periodo_id", periodoId).order("bruto", { ascending: false }),
    ]);
    if (produtosRes.error) return Response.json({ error: produtosRes.error.message }, { status: 500, headers: CORS });

    return Response.json({
      periodos,
      periodo,
      produtos: produtosRes.data ?? [],
      resumo: resumoRes.data ?? null,
      mensal: mensalRes.data ?? [],
      turno: turnoRes.data ?? [],
      dia_semana: diaRes.data ?? [],
      ambiente: ambienteRes.data ?? [],
      funcionarios: funcRes.data ?? [],
    }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
}
