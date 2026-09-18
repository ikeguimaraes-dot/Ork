"use server"

import { createFinanceiroClient } from "@/lib/financeiro/db/client";

import { requireUser } from "@ork/auth/server"

import type { LinhaCompraParseada } from "@/lib/financeiro/importacao/compras/parseComprasXlsx"
import { importarLinhasCompra, type ImportarComprasResultado } from "@/lib/financeiro/importacao/compras/importarCompras"

export type { ImportarComprasResultado } from "@/lib/financeiro/importacao/compras/importarCompras"

export async function importarNfPedidos(
  linhas: LinhaCompraParseada[],
  unitIdBase: string
): Promise<ImportarComprasResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, inseridos: 0, roteadosOutraUnidade: 0, valorRoteadoOutraUnidade: 0, error: "Sem conexão com banco" }
  return importarLinhasCompra(db, linhas, unitIdBase, "compra", "nf_pedidos")
}

export async function importarContasPagar(
  linhas: LinhaCompraParseada[],
  unitIdBase: string
): Promise<ImportarComprasResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, inseridos: 0, roteadosOutraUnidade: 0, valorRoteadoOutraUnidade: 0, error: "Sem conexão com banco" }
  return importarLinhasCompra(db, linhas, unitIdBase, "despesa", "contas_pagar")
}

export type LimparHistoricoResultado = { ok: boolean; removidos: number; error?: string }

// GATE 2 (FASE 7): botão separado, fora do fluxo de importação — nunca
// chamado automaticamente. Apaga só as ~2.000 linhas de origem='PLANILHA
// ORK' (export de ERP de origem desconhecida), autorizado pelo Ike pra
// dar lugar aos dados de NF_PEDIDOS/CONTAS_A_PAGAR.
export async function limparHistoricoTitulos(): Promise<LimparHistoricoResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, removidos: 0, error: "Sem conexão com banco" }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any).from("titulos_a_pagar")
      .delete()
      .eq("origem", "PLANILHA ORK")
      .select("id")
    if (error) throw new Error(error.message)
    return { ok: true, removidos: data?.length ?? 0 }
  } catch (e) {
    return { ok: false, removidos: 0, error: e instanceof Error ? e.message : String(e) }
  }
}
