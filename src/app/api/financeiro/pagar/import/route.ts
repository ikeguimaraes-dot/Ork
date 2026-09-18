import { applyBatch, replacement } from "@/lib/financeiro/db/atomic"
import { competenciaTitulo } from "@/lib/financeiro/dates"
import { createFinanceiroClient } from "@/lib/financeiro/db/client";
export const runtime = "nodejs"
export const maxDuration = 60

import * as XLSX from "xlsx"

import { requireUser } from "@ork/auth/server"
import { mapRow, normalizeUnitName } from "@/lib/pagar-import/parse-titulos"

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try { await requireUser() }
  catch { return Response.json({ error: "Não autorizado" }, { status: 401 }) }

  let formData: FormData
  try { formData = await req.formData() }
  catch { return Response.json({ error: "Requisição inválida" }, { status: 400 }) }

  const file = formData.get("file") as File | null
  if (!file) return Response.json({ error: "Arquivo não enviado" }, { status: 400 })
  const diagnostico = formData.get("mode") === "diagnostico"

  const buffer = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return Response.json({ error: "Planilha sem abas" }, { status: 400 })

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]!, { defval: null })
  if (!rows.length) return Response.json({ error: "Nenhuma linha encontrada" }, { status: 400 })

  const db = await createFinanceiroClient()
  if (!db) return Response.json({ error: "Banco indisponível" }, { status: 500 })
  const { data: units, error: unitsError } = await db.from("units").select("id,name")
  if (unitsError) return Response.json({ error: `Erro ao carregar unidades: ${unitsError.message}` }, { status: 500 })
  const unitMap = new Map<string, string>((units ?? []).map((unit: { id: string; name: string }) => [normalizeUnitName(unit.name), unit.id]))

  const importadoEm = new Date().toISOString()
  const unknownEmpresas = new Map<string, number>()
  const allRecords: Record<string, unknown>[] = []
  let linhasDescartadas = 0

  for (const r of rows) {
    const { record, fantasiaEmpresa } = mapRow(r, unitMap)
    if (!record) {
      if (fantasiaEmpresa) {
        // Fantasia Empresa presente mas não reconhecida — conta pra
        // reportar/abortar; não é a linha de rodapé (essa tem
        // Fantasia Empresa e Fornecedor ambos vazios).
        unknownEmpresas.set(fantasiaEmpresa, (unknownEmpresas.get(fantasiaEmpresa) ?? 0) + 1)
      } else {
        linhasDescartadas++
      }
      continue
    }
    allRecords.push({ ...record, importado_em: importadoEm })
  }

  // ── Modo Diagnóstico — só analisa, não grava nada no banco ──────────────────
  if (diagnostico) {
    const situacoes = new Map<string, number>()
    for (const rec of allRecords) {
      const s = String(rec.situacao_atual ?? "(vazio)")
      situacoes.set(s, (situacoes.get(s) ?? 0) + 1)
    }

    // Colisões de chave de dedup com valor divergente (mesmo diagnóstico
    // usado no import de produtos) — indicaria a mesma parcela aparecendo
    // duas vezes no arquivo com dados diferentes.
    const byKey = new Map<string, Record<string, unknown>[]>()
    for (const rec of allRecords) {
      const key = `${rec.n_titulo}|${rec.parcela}|${rec.fantasia_empresa}|${rec.ref_mes}`
      const bucket = byKey.get(key) ?? []
      bucket.push(rec)
      byKey.set(key, bucket)
    }
    const colisoes = [...byKey.entries()].filter(([, recs]) => recs.length > 1)

    const amostra = allRecords.slice(0, 15).map((rec) => ({
      id: rec.id, n_titulo: rec.n_titulo, parcela: rec.parcela,
      fantasia_empresa: rec.fantasia_empresa, ref_mes: rec.ref_mes,
      v_titulo: rec.v_titulo, v_saldo_atual: rec.v_saldo_atual,
      v_pagamento: rec.v_pagamento, situacao_atual: rec.situacao_atual,
      posicao: rec.posicao, dre: rec.dre, d_vencimento: rec.d_vencimento,
    }))

    return Response.json({
      ok: true,
      diagnostico: true,
      totalLinhasArquivo: rows.length,
      totalTitulosValidos: allRecords.length,
      linhasDescartadasSemFantasiaOuFornecedor: linhasDescartadas,
      fantasiaEmpresaNaoReconhecida: [...unknownEmpresas.entries()].map(([empresa, count]) => ({ empresa, count })),
      situacaoContagem: [...situacoes.entries()].sort((a, b) => b[1] - a[1]),
      colisoesDedupNaChave: colisoes.length,
      amostraColisoes: colisoes.slice(0, 5).map(([key, recs]) => ({ key, ocorrencias: recs.length })),
      amostraRegistros: amostra,
    })
  }

  // ── Import de verdade ────────────────────────────────────────────────────────
  // Aborta o import inteiro se alguma Fantasia Empresa não estiver no
  // UNIT_MAP — não grava nada com unit_id nulo nem pula em silêncio.
  if (unknownEmpresas.size > 0) {
    const detalhe = [...unknownEmpresas.entries()]
      .map(([empresa, count]) => `"${empresa}" (${count} linha${count !== 1 ? "s" : ""})`)
      .join(", ")
    return Response.json(
      { error: `Import abortado — Fantasia Empresa não reconhecida: ${detalhe}. Atualize o mapa de unidades antes de importar.` },
      { status: 400 },
    )
  }

  // Dedup em memória pela chave natural (n_titulo, parcela, fantasia_empresa,
  // ref_mes) — mantém a última ocorrência, pra não conflitar dentro do mesmo
  // upsert quando a planilha traz a mesma parcela repetida internamente.
  const dedup = new Map<string, Record<string, unknown>>()
  for (const rec of allRecords) {
    const key = `${rec.n_titulo}|${rec.parcela}|${rec.fantasia_empresa}|${rec.ref_mes}`
    dedup.set(key, rec)
  }
  const records = [...dedup.values()].map(rec => ({ ...rec, unit_id: String(rec.unit_id), import_unit_id: String(rec.unit_id), origem: "contas_pagar", d_competencia: competenciaTitulo(rec),
    c_gerencial: rec.c_gerencial ?? rec.descricao_c_gerencial,
    liquidacao_origem: rec.v_saldo_atual != null && Number(rec.v_saldo_atual) === 0 && Number(rec.v_titulo) > 0 ? "OK" : null,
  }))
  if (records.length === 0) {
    return Response.json({ error: "Nenhum título válido foi reconhecido. Confira se a planilha possui o layout esperado." }, { status: 422 })
  }

  if (records.some(r => !r.d_competencia)) return Response.json({ error: "Há títulos sem competência, lançamento ou vencimento; nenhum dado foi alterado." }, { status: 422 })
  const scopes = new Map(records.map(r => [`${r.unit_id}|${r.d_competencia}`, { unit_id: r.unit_id, import_unit_id: r.unit_id, d_competencia: r.d_competencia, origem: "contas_pagar" }]))
  await applyBatch(db, [...scopes.values()].flatMap(scope => replacement("titulos_a_pagar", scope, records.filter(r => r.unit_id === scope.unit_id && r.d_competencia === scope.d_competencia))))
  return Response.json({ ok: true, inserted: records.length, ref_meses: [...new Set(records.map(r => r.d_competencia))] })
}
