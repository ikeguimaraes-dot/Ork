import { fetchAllPaginado as fetchAll } from "@/lib/financeiro/razao/gerar"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requireUser } from "@ork/auth/server"
import { getCurrentUnit } from "@ork/auth/unit"
import { createSupabaseServerClient } from "@ork/db/supabase/server"
import { ProdutosClient } from "@/components/financeiro/produtos/ProdutosClient"

export const dynamic = "force-dynamic"

export type NfeSearchParams = Promise<{ mes?: string; ano?: string; q?: string }>

export type ProdutoRow = {
  id: number
  unit_id: string
  chave_nfe: string | null
  fornecedor_nome: string | null
  nr_danfe: string | null
  v_total_danfe: number | null
  dt_emissao: string | null
  item_codigo: string | null
  item_descricao: string | null
  unidade_medida: string | null
  tipo_item: string | null
  q_embalagem: number | null
  q_estoque: number | null
  v_embalagem: number | null
  v_total_embalagem: number | null
  v_custo_medio: number | null
  v_custo_compra: number | null
  v_custo_total: number | null
  perc_variacao: number | null
  calcula_cmv: boolean | null
  fornecedor_codigo: string | null
  codigo_gerencial: string | null
  desc_gerencial: string | null
  mes_lancamento: number
  ano_lancamento: number
}

export async function NfeProdutosPage({ searchParams, direcao }: {
  searchParams: NfeSearchParams
  direcao: "entrada" | "saida"
}) {
  await requireUser()
  const sp = await searchParams

  const now = new Date()
  const mes = sp.mes ? parseInt(sp.mes, 10) : now.getMonth() + 1
  const ano = sp.ano ? parseInt(sp.ano, 10) : now.getFullYear()
  const q   = sp.q?.trim() ?? ""

  const unit = await getCurrentUnit()
  const unitId = unit?.id ?? null

  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uq = (qb: any) => unitId ? qb.eq("unit_id", unitId) : qb


  const baseProdutosQuery = () => {
    const query = uq(db.from("produtos_relatorio").select("*"))
      .eq("mes_lancamento", mes)
      .eq("ano_lancamento", ano)
      .order("id")
    return direcao === "entrada"
      ? query.or("direcao_nfe.eq.entrada,direcao_nfe.is.null")
      : query.eq("direcao_nfe", "saida")
  }

  // chave_nfe IS NOT NULL = veio de XML; chave_nfe IS NULL = veio de planilha/Excel.
  const rows = await fetchAll((from, to) =>
    baseProdutosQuery().not("chave_nfe", "is", null).range(from, to)
  )
  const rowsPlanilha = direcao === "entrada"
    ? await fetchAll((from, to) => baseProdutosQuery().is("chave_nfe", null).range(from, to))
    : []

  // Previous month for MoM comparison
  const prevMes = mes === 1 ? 12 : mes - 1
  const prevAno = mes === 1 ? ano - 1 : ano
  const prevRows = await fetchAll((from, to) => {
    let query = uq(db.from("produtos_relatorio")
      .select("id,v_custo_total,calcula_cmv,desc_gerencial"))
      .eq("mes_lancamento", prevMes)
      .eq("ano_lancamento", prevAno)
      .not("chave_nfe", "is", null)
      .order("id")
    query = direcao === "entrada"
      ? query.or("direcao_nfe.eq.entrada,direcao_nfe.is.null")
      : query.eq("direcao_nfe", "saida")
    return query.range(from, to)
  })

  // Available months for this direction only.
  const mesesData = await fetchAll<{ mes_lancamento: number; ano_lancamento: number }>((from, to) => {
    let query = uq(db.from("produtos_relatorio")
      .select("id,mes_lancamento,ano_lancamento"))
      .order("id")
    query = direcao === "entrada"
      ? query.or("direcao_nfe.eq.entrada,direcao_nfe.is.null")
      : query.eq("direcao_nfe", "saida")
    return query.range(from, to)
  })
  const mesesMap = new Map<string, { mes: number; ano: number }>()
  for (const row of mesesData ?? []) {
    const item = { mes: Number(row.mes_lancamento), ano: Number(row.ano_lancamento) }
    mesesMap.set(`${item.ano}-${item.mes}`, item)
  }
  const meses = [...mesesMap.values()].sort((a, b) =>
    a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes
  )

  // Para saída, o indicador deve usar o valor fiscal total das notas (vNF).
  // Somar itens pode divergir por impostos/frete e antes ainda era truncado.
  const inicioMes = `${ano}-${String(mes).padStart(2, "0")}-01T00:00:00.000Z`
  const proximoMes = new Date(Date.UTC(ano, mes, 1)).toISOString()
  const documentos = await fetchAll<{ valor_total: number | null }>((from, to) => uq(db.from("nfe_documentos")
    .select("id,valor_total")
    .eq("direcao", direcao)
    .eq("cancelada", false)
    .gte("emissao", inicioMes)
    .lt("emissao", proximoMes)
    .order("id")
    .range(from, to)))
  const totalDocumentos = documentos.reduce(
    (sum, row) => sum + Number(row.valor_total ?? 0), 0
  )

  const mesDisponivel = meses.some(m => m.mes === mes && m.ano === ano)
  if (!mesDisponivel && meses.length > 0) {
    const ultimo = meses[meses.length - 1]!
    const params = new URLSearchParams()
    params.set("mes", String(ultimo.mes))
    params.set("ano", String(ultimo.ano))
    if (q) params.set("q", q)
    const pathname = direcao === "entrada" ? "/financeiro/dre/cmv" : "/financeiro/dre/nfe-saida"
    redirect(`${pathname}?${params.toString()}`)
  }

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <Link
        href="/financeiro/dre"
        style={{
          fontSize: 11, color: "var(--text-3)", textDecoration: "none",
          fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase",
        }}
      >
        ← Financeiro
      </Link>

      <ProdutosClient
        rows={(rows ?? []) as ProdutoRow[]}
        rowsPlanilha={(rowsPlanilha ?? []) as ProdutoRow[]}
        prevRows={(prevRows ?? []) as Pick<ProdutoRow, "id" | "v_custo_total" | "calcula_cmv" | "desc_gerencial">[]}
        mes={mes}
        ano={ano}
        meses={meses}
        unitId={unitId}
        q={q}
        direcao={direcao}
        totalDocumentos={totalDocumentos}
      />
    </div>
  )
}

export default function ProdutosPage({ searchParams }: { searchParams: NfeSearchParams }) {
  return <NfeProdutosPage searchParams={searchParams} direcao="entrada" />
}
