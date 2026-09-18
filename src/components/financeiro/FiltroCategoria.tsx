"use client"

import { useRouter, useSearchParams } from "next/navigation"

export function FiltroCategoria({ categorias, atual }: { categorias: string[]; atual: string }) {
  const router = useRouter()
  const sp = useSearchParams()

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(sp.toString())
    if (e.target.value) {
      params.set("categoria", e.target.value)
    } else {
      params.delete("categoria")
    }
    router.push(`?${params.toString()}`)
  }

  return (
    <select
      value={atual}
      onChange={onChange}
      style={{
        padding: "6px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface-2)",
        color: atual ? "var(--text)" : "var(--text-3)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        minWidth: 180,
      }}
    >
      <option value="">Todas as categorias</option>
      {categorias.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  )
}
