"use server"

import { createFinanceiroClient } from "@/lib/financeiro/db/client";

import { requireUser } from "@ork/auth/server"

import { calcularDivergenciasContasPagarNotas, type DivergenciasResultado } from "@/lib/financeiro/divergencias/calcularDivergencias"

export type { DivergenciasResultado } from "@/lib/financeiro/divergencias/calcularDivergencias"

// Só leitura — requireUser() + await createFinanceiroClient() por cima da lógica pura
// em src/lib/financeiro/divergencias/calcularDivergencias.ts, mesmo padrão
// de src/app/financeiro/razao/actions.ts.
export async function getDivergenciasContasPagarNotas(
  unitId: string,
  unitName: string,
  competencia: string
): Promise<DivergenciasResultado | null> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return null
  return calcularDivergenciasContasPagarNotas(db, unitId, unitName, competencia)
}
