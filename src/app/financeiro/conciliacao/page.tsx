import Link from "next/link"
import { requireUser } from "@ork/auth/server"
import { getCurrentUnit } from "@ork/auth/unit"
import { ConciliacaoTab } from "@/components/financeiro/ConciliacaoTab"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{ mes?: string; ano?: string }>

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await requireUser()
  const params = await searchParams
  const now = new Date()
  const mes = Math.min(12, Math.max(1, Number(params.mes) || now.getMonth() + 1))
  const ano = Number(params.ano) || now.getFullYear()
  const unit = await getCurrentUnit()

  return <div style={{ maxWidth: 1240, margin: "0 auto" }}>
    <Link href="/financeiro" style={{ fontSize: 11, color: "var(--text-3)", textDecoration: "none", fontWeight: 600 }}>
      ← Financeiro
    </Link>
    <header style={{ margin: "12px 0 22px" }}>
      <h1 style={{ fontSize: 26, color: "var(--text)", margin: 0 }}>Conciliação</h1>
      <p style={{ fontSize: 13, color: "var(--text-3)" }}>{unit?.name ?? "Todas as unidades"} · {String(mes).padStart(2, "0")}/{ano}</p>
    </header>
    <ConciliacaoTab unitId={unit?.id ?? null} mes={mes} ano={ano} />
  </div>
}
