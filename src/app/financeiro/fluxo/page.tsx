import { PageHeading } from "@/components/ui/PageHeading"
import Link from "next/link"

import { requireUser } from "@ork/auth/server"
import { getCurrentUnitComOrigem } from "@ork/auth/unit"
import { getFluxoCaixa, getContasBancarias } from "./actions"
import { FluxoPainel } from "@/components/financeiro/fluxo/FluxoPainel"
import { ContasBancariasPainel } from "@/components/financeiro/fluxo/ContasBancariasPainel"
import { AvisoUnidadeFallback } from "@/components/financeiro/AvisoUnidadeFallback"

export const dynamic = "force-dynamic"

const PERIODOS = [30, 60, 90] as const

function hojeIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value
    return acc
  }, {})
  return `${parts.year}-${parts.month}-${parts.day}`
}

function somarDias(dataIso: string, dias: number): string {
  const d = new Date(`${dataIso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

type SearchParams = Promise<{ conta?: string; dias?: string }>

export default async function FluxoCaixaPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser()
  const sp = await searchParams

  // Unidade é contexto global (cookie do shell) — conta bancária e período
  // continuam sendo filtros legítimos desta tela.
  const { unit, cookiePresente } = await getCurrentUnitComOrigem()
  const unitId = unit?.id ?? null
  const unitName = unit?.name ?? "—"

  const periodoDias = sp.dias && (PERIODOS as readonly number[]).includes(Number(sp.dias)) ? Number(sp.dias) : 90
  const dataInicio = hojeIso()
  const dataFim = somarDias(dataInicio, periodoDias)

  const contas = unitId ? await getContasBancarias(unitId) : []
  const contaId = sp.conta && contas.some((c) => c.id === sp.conta) ? sp.conta : null

  const dados = unitId ? await getFluxoCaixa(unitId, contaId, dataInicio, dataFim) : null

  const href = (contaVal: string | null, diasVal: number) => {
    const params = new URLSearchParams()
    if (contaVal) params.set("conta", contaVal)
    params.set("dias", String(diasVal))
    return `/financeiro/fluxo?${params.toString()}`
  }
  const linkStyle = (ativo: boolean): React.CSSProperties => ({
    padding: "10px 16px", borderRadius: 999, fontSize: 12, fontWeight: ativo ? 700 : 500,
    textDecoration: "none", whiteSpace: "nowrap",
    background: ativo ? "var(--brand, #C4622D)" : "var(--surface-2)",
    color: ativo ? "var(--primary-foreground)" : "var(--text-3)",
    border: "1px solid var(--border)",
  })

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <PageHeading title="Fluxo de caixa" eyebrow={`Financeiro · ${unitName}`} description="Entradas, saídas e saldo projetado. Antecipe os próximos movimentos do seu caixa." />
      <div style={{ marginBottom: 24 }}>
        <AvisoUnidadeFallback cookiePresente={cookiePresente} />
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Link href={href(null, periodoDias)} style={linkStyle(contaId === null)}>Todas as contas</Link>
            {contas.map((c) => (
              <Link key={c.id} href={href(c.id, periodoDias)} style={linkStyle(c.id === contaId)}>
                {c.apelido ?? c.banco}
              </Link>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PERIODOS.map((d) => (
              <Link key={d} href={href(contaId, d)} style={linkStyle(d === periodoDias)}>{d} dias</Link>
            ))}
          </div>
        </div>
      </div>

      {!dados || !unitId ? (
        <div style={{ padding: 48, textAlign: "center", background: "var(--surface)",
          border: "1px dashed var(--border)", borderRadius: 14, color: "var(--text-3)", fontSize: 13 }}>
          {!unitId ? "Selecione uma unidade no menu para consultar o fluxo de caixa." : "Não foi possível carregar o fluxo de caixa. Tente atualizar a página."}
        </div>
      ) : (
        <>
          <ContasBancariasPainel unitId={unitId} contas={contas} />
          <FluxoPainel dados={dados} temContaCadastrada={contas.length > 0} />
        </>
      )}
    </div>
  )
}
