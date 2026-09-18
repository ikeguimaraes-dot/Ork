import "server-only"
import { createHash } from "node:crypto"
import { createFinanceiroClient } from "@/lib/financeiro/db/client"
import { applyBatch, replacement, type Mutation } from "@/lib/financeiro/db/atomic"
import { importarLinhasCompra } from "../compras/importarCompras"
import { normalizarCategoria } from "../compras/normalizarCategoria"
import type { OrkBatchPreview, NfEntradaRow, ContaPagarRow, ReceitaCaixaRow } from "./types"

export class ImportConflictError extends Error {
  constructor(message: string) { super(message); this.name = "ImportConflictError" }
}

export async function persistOrkArchive(input: {
  unitId: string; unitName: string; userId: string; fileName: string; bytes: Buffer; preview: OrkBatchPreview; replaceExisting: boolean
}) {
  const db = await createFinanceiroClient()
  if (input.preview.kind === "unknown" || input.preview.kind === "folha" || !input.preview.records.length) throw new Error("Pacote sem registros válidos para importar.")
  const checksum = createHash("sha256").update(input.bytes.toString("base64")).digest("hex")
  const { data: previous, error: previousError } = await db.from("financeiro_importacoes").select("id").eq("unit_id", input.unitId).eq("checksum_sha256", checksum).maybeSingle()
  if (previousError) throw new Error(previousError.message)
  const id: string = previous?.id ?? crypto.randomUUID()
  const safeName = input.fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-")
  const storagePath = `${input.unitId}/${checksum.slice(0, 16)}-${safeName}`
  const contentType = /\.zip$/i.test(input.fileName) ? "application/zip" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  const { error: uploadError } = await db.storage.from("financeiro-importacoes").upload(storagePath, input.bytes, { contentType, upsert: true })
  if (uploadError) throw new Error(`Falha ao preservar arquivo original: ${uploadError.message}`)
  const operations: Mutation[] = []
  // Reuse the canonical purchase pipeline, but collect its transaction together
  // with the audit record. Re-uploading an older file intentionally restores it.
  const collector = { rpc: async (_name: string, args: { p_operations: Mutation[] }) => { operations.push(...args.p_operations); return { error: null } } }
  if (input.preview.kind === "nf_entrada" || input.preview.kind === "contas_pagar") {
    const compras = input.preview.kind === "nf_entrada"
    const linhas = compras
      ? (input.preview.records as NfEntradaRow[]).map(r => ({ fornecedorNome: r.fornecedor, dLancamento: r.dataEntrada, nNotaFiscal: r.numeroNf,
        produtoOriginal: r.produto, categoriaNormalizada: normalizarCategoria(r.produto, "nf_pedidos"), valorTotalNfOrigem: r.valorTotal, parcela: null,
        dVencimento: null, vTitulo: r.valorTotal, liquidacaoOrigem: null, dCompetencia: r.competencia }))
      : (input.preview.records as ContaPagarRow[]).map(r => ({ fornecedorNome: r.fornecedor, dLancamento: r.dataEntrada, nNotaFiscal: r.numeroNf,
        produtoOriginal: r.categoria ?? "", categoriaNormalizada: normalizarCategoria(r.categoria ?? "", "contas_pagar"), valorTotalNfOrigem: r.valorTotalNf, parcela: r.parcela,
        dVencimento: r.vencimento, vTitulo: r.valorParcela, liquidacaoOrigem: r.liquidacao, dCompetencia: r.competencia }))
    const result = await importarLinhasCompra(collector, linhas, input.unitId, compras ? "compra" : "despesa", compras ? "nf_pedidos" : "contas_pagar")
    if (!result.ok) throw new Error(result.error)
    for (const op of operations) if (op.table === "titulos_a_pagar" && op.rows) op.rows.forEach(row => { row.importacao_id = id })
  } else {
    const rows = input.preview.records as ReceitaCaixaRow[]
    const scopes = new Set<string>()
    for (const row of rows) {
      const scope = `${row.data}|${row.turno}`
      if (scopes.has(scope)) throw new ImportConflictError(`Receita duplicada em ${row.data} (${row.turno}).`)
      scopes.add(scope)
      // The file describes these dates/shifts, not every shift of the day.
      const wdId = crypto.randomUUID()
      const workdayId = 960_000_000 + Number(row.data.slice(2).replaceAll("-", "")) * 10 + (row.turno === "jantar" ? 2 : row.turno === "almoco" ? 1 : 0)
      operations.push(...replacement("receita_dias", { unit_id: input.unitId, data: row.data, turno: row.turno }, [{
        id: wdId, unit_id: input.unitId, importacao_id: id, workday_id: workdayId, data: row.data, turno: row.turno,
        receita_bruta: row.receitaBruta, previsto: row.receitaBruta, desconto: Math.max(0, row.receitaBruta - row.receitaLiquida),
        gorjeta: row.taxaServico, gorjeta_colaborador: row.taxaColaborador, gorjeta_casa: row.taxaCasa, gorjeta_terceiro: row.taxaTerceiro,
        receita_liquida: row.receitaLiquida, clientes: row.clientes, ticket_medio: row.clientes ? row.receitaBruta / row.clientes : null,
        ticket_real: row.clientes ? row.receitaLiquida / row.clientes : null, custo: null, lucro: row.receitaLiquida, cmv_pct: null, devedor: 0,
      }]))
      const payments = row.pagamentos.map(p => ({ workday_id_fk: wdId, forma: p.descricao, valor_fechado: p.valor, valor_recebido: p.valor }))
      if (payments.length) operations.push({ table: "receita_pagamentos", operation: "insert", rows: payments })
    }
  }
  operations.unshift({ table: "financeiro_importacoes", operation: "upsert", conflict: "id", rows: [{
    id, unit_id: input.unitId, tipo: input.preview.kind, arquivo: input.fileName, checksum_sha256: checksum, storage_path: storagePath,
    registros: input.preview.records.length, totais: input.preview.totals, avisos: input.preview.warnings,
    status: "concluido", criado_por: input.userId, concluido_em: new Date().toISOString(), erro: null,
  }] })
  await applyBatch(db, operations)
  return { ok: true, duplicate: false, imported: input.preview.records.length, importId: id }
}
