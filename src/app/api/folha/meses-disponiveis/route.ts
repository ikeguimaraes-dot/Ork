import { createFinanceiroClient } from "@/lib/financeiro/db/client"

export const runtime = "nodejs"

const CORS = {
  "Access-Control-Allow-Origin": "http://localhost:3001",
  "Access-Control-Allow-Methods": "GET, POST",
  "Access-Control-Allow-Headers": "Content-Type",
}

export async function OPTIONS() {
  return new Response(null, { headers: CORS })
}

// GET /api/folha/meses-disponiveis?unit_id=<uuid>
// Competências (YYYY-MM) que têm colaboradores para a unidade, ordenadas DESC.
// A página usa a primeira (mais recente COM dados) como default dos seletores,
// em vez de assumir o mês corrente — que pode não ter folha importada ainda.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const unit_id = searchParams.get("unit_id")

  if (!unit_id) {
    return Response.json({ error: "unit_id obrigatório" }, { status: 400, headers: CORS })
  }

  const supabase = await createFinanceiroClient()

  const { data, error } = await supabase
    .from("payroll_extrato_dominio_competencia")
    .select("competencia")
    .eq("unit_id", unit_id)
    .order("competencia", { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500, headers: CORS })
  }

  const competencias = [...new Set((data ?? []).map((r) => r.competencia as string))]

  return Response.json({ competencias }, { headers: CORS })
}
