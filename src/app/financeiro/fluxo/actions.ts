"use server"

import { createFinanceiroClient } from "@/lib/financeiro/db/client";

import { requireUser } from "@ork/auth/server"

import { calcularFluxo, type ResultadoFluxo } from "@/lib/financeiro/fluxo/calcularFluxo"

export type { ResultadoFluxo } from "@/lib/financeiro/fluxo/calcularFluxo"

// Só leitura — requireUser() + await createFinanceiroClient() por cima da lógica pura
// em src/lib/financeiro/fluxo/calcularFluxo.ts, mesmo padrão de
// src/app/financeiro/dre/divergencias/actions.ts.
export async function getFluxoCaixa(
  unitId: string,
  contaId: string | null,
  dataInicio: string,
  dataFim: string
): Promise<ResultadoFluxo | null> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return null
  return calcularFluxo(db, unitId, contaId, dataInicio, dataFim)
}

export type ContaBancaria = {
  id: string
  banco: string
  apelido: string | null
  saldoInicial: number
  dataSaldoInicial: string
}

export async function getContasBancarias(unitId: string): Promise<ContaBancaria[]> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return []
  // contas_bancarias não está nos tipos gerados do Supabase — mesmo padrão de
  // db usado em dre/divergencias/fornecedores-actions.ts pras
  // tabelas novas desta fase.
  const { data } = await db
    .from("contas_bancarias")
    .select("id,banco,apelido,saldo_inicial,data_saldo_inicial")
    .eq("unit_id", unitId)
    .eq("ativo", true)
    .order("banco")
  return ((data ?? []) as Array<{
    id: string; banco: string; apelido: string | null; saldo_inicial: number; data_saldo_inicial: string
  }>).map((c) => ({
    id: c.id,
    banco: c.banco,
    apelido: c.apelido,
    saldoInicial: Number(c.saldo_inicial),
    dataSaldoInicial: c.data_saldo_inicial,
  }))
}

export type SalvarContaResultado = { ok: true } | { ok: false; error: string }

export async function createContaBancaria(input: {
  unitId: string
  banco: string
  apelido: string | null
  saldoInicial: number
  dataSaldoInicial: string
}): Promise<SalvarContaResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, error: "Sem conexão com o banco de dados." }
  if (!input.banco.trim()) return { ok: false, error: "Banco é obrigatório." }

  const { error } = await db.from("contas_bancarias").insert({
    unit_id: input.unitId,
    banco: input.banco.trim(),
    apelido: input.apelido?.trim() || null,
    saldo_inicial: input.saldoInicial,
    data_saldo_inicial: input.dataSaldoInicial,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function updateSaldoInicial(
  contaId: string,
  saldoInicial: number,
  dataSaldoInicial: string
): Promise<SalvarContaResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, error: "Sem conexão com o banco de dados." }

  const { error } = await db
    .from("contas_bancarias")
    .update({ saldo_inicial: saldoInicial, data_saldo_inicial: dataSaldoInicial })
    .eq("id", contaId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
