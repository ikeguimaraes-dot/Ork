"use server"

import { createFinanceiroClient } from "@/lib/financeiro/db/client";

import { requireUser } from "@ork/auth/server"

import { fetchAllPaginado } from "@/lib/financeiro/razao/gerar"
import {
  calcularAlertasGrupo1,
  aplicarConferencias,
  type AlertaComStatus,
  type ConferenciaRow,
  type UnidadeTag,
} from "@/lib/financeiro/conferencia/calcularAlertas"
import { calcularAlertasGrupo2 } from "@/lib/financeiro/conferencia/calcularAlertasGrupo2"
import { calcularAlertasGrupo3 } from "@/lib/financeiro/conferencia/calcularAlertasGrupo3"
import { calcularAlertasGrupo4 } from "@/lib/financeiro/conferencia/calcularAlertasGrupo4"

export type { AlertaComStatus } from "@/lib/financeiro/conferencia/calcularAlertas"

export type ConferenciaResultado = {
  ativos: AlertaComStatus[]
  conferidos: AlertaComStatus[]
} | null

// Só leitura — requireUser() + await createFinanceiroClient() por cima da lógica pura
// em src/lib/financeiro/conferencia/calcularAlertas.ts, mesmo padrão de
// src/app/financeiro/razao/actions.ts. Cruza os alertas recalculados com o
// que já foi conferido nesta unidade+competência.
export async function getConferencia(
  unitId: string,
  unitNome: string,
  unitTag: UnidadeTag,
  competencia: string
): Promise<ConferenciaResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return null

  const [grupo1, grupo2, grupo3, grupo4] = await Promise.all([
    calcularAlertasGrupo1(db, unitId, unitTag, competencia),
    calcularAlertasGrupo2(db, unitId, unitNome, competencia),
    calcularAlertasGrupo3(db, unitId, unitNome, competencia),
    calcularAlertasGrupo4(db, unitId, unitNome, competencia),
  ])
  const alertas = [...grupo1, ...grupo2, ...grupo3, ...grupo4]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any
  const rows = await fetchAllPaginado((from, to) =>
    dbAny.from("conferencias")
      .select("alerta_chave,assinatura,status,observacao,conferido_por,conferido_em")
      .eq("unit_id", unitId)
      .eq("competencia", competencia)
      .range(from, to)
  ) as ConferenciaRow[]

  const comStatus = aplicarConferencias(alertas, rows)
  return {
    ativos: comStatus
      .filter((a) => a.conferencia === null || a.conferencia.assinaturaMudou)
      .sort((a, b) => {
        if (a.severidade !== b.severidade) return a.severidade === "critico" ? -1 : 1
        return b.valorEnvolvido - a.valorEnvolvido
      }),
    conferidos: comStatus
      .filter((a) => a.conferencia !== null)
      .sort((a, b) => b.conferencia!.conferidoEm.localeCompare(a.conferencia!.conferidoEm)),
  }
}

export type ConferirAlertaResultado = { ok: boolean; error?: string }

export async function conferirAlerta(
  unitId: string,
  competencia: string,
  alertaChave: string,
  assinatura: string,
  status: "conferido" | "ignorado",
  observacao: string | null
): Promise<ConferirAlertaResultado> {
  const user = await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, error: "Sem conexão com banco" }
  try {
    const conferidoPor = user.displayName ?? user.email ?? user.id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("conferencias").upsert(
      {
        unit_id: unitId,
        competencia,
        alerta_chave: alertaChave,
        assinatura,
        status,
        observacao,
        conferido_por: conferidoPor,
        conferido_em: new Date().toISOString(),
      },
      { onConflict: "alerta_chave,unit_id,competencia" }
    )
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
