"use client"

import { useState, useMemo } from "react"
type TopProdutoItem = { produto: string; grupo: string; qtd: number; total: number };
import { formatBRL } from "@/lib/financeiro/utils"

type SortKey = "total" | "qtd"
type View = "todos" | "categoria"

type Props = { produtos: TopProdutoItem[] }

export function TopProdutosTable({ produtos }: Props) {
  const [view, setView] = useState<View>("todos")
  const [sort, setSort] = useState<SortKey>("total")

  const sorted = useMemo(
    () => [...produtos].sort((a, b) => b[sort] - a[sort]),
    [produtos, sort],
  )

  if (!produtos.length) {
    return (
      <div
        style={{
          padding: "28px 18px",
          textAlign: "center",
          fontSize: 13,
          color: "var(--text-3)",
          background: "var(--surface)",
          border: "1px dashed var(--border)",
          borderRadius: 12,
        }}
      >
        Sem dados de vendas de produtos para o mês atual.
      </div>
    )
  }

  return (
    <div>
      {/* Controles */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {/* View toggle */}
        <div style={{ display: "flex", gap: 6 }}>
          {(["todos", "categoria"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: "5px 14px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: view === v ? "var(--brand)" : "var(--surface)",
                color: view === v ? "#fff" : "var(--text-2)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                letterSpacing: 0.3,
              }}
            >
              {v === "todos" ? "Todos" : "Por categoria"}
            </button>
          ))}
        </div>

        {/* Sort toggle */}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <span style={{ fontSize: 11, color: "var(--text-3)", alignSelf: "center" }}>
            Ordenar:
          </span>
          {([
            ["total", "Faturamento"],
            ["qtd", "Quantidade"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              style={{
                padding: "5px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: sort === key ? "var(--text)" : "var(--surface)",
                color: sort === key ? "var(--bg, #fff)" : "var(--text-2)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                letterSpacing: 0.3,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "todos" ? (
        <FlatTable produtos={sorted} sort={sort} />
      ) : (
        <CategoriaView produtos={sorted} sort={sort} />
      )}
    </div>
  )
}

function FlatTable({ produtos, sort }: { produtos: TopProdutoItem[]; sort: SortKey }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "32px 1fr 100px 80px 90px",
          gap: 12,
          padding: "8px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "var(--text-3)",
        }}
      >
        <span>#</span>
        <span>Produto</span>
        <span>Categoria</span>
        <span style={{ textAlign: "right", color: sort === "qtd" ? "var(--brand)" : undefined }}>Qtd</span>
        <span style={{ textAlign: "right", color: sort === "total" ? "var(--brand)" : undefined }}>Total</span>
      </div>
      {produtos.map((p, i) => (
        <div
          key={`${p.grupo}::${p.produto}`}
          style={{
            display: "grid",
            gridTemplateColumns: "32px 1fr 100px 80px 90px",
            gap: 12,
            padding: "10px 16px",
            borderTop: i === 0 ? "none" : "1px solid var(--border)",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>
            {i + 1}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {p.produto}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {p.grupo}
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: sort === "qtd" ? 700 : 400,
              color: sort === "qtd" ? "var(--text)" : "var(--text-2)",
              textAlign: "right",
            }}
          >
            {fmtQtd(p.qtd)}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: sort === "total" ? 700 : 500,
              color: "var(--text)",
              textAlign: "right",
            }}
          >
            {formatBRL(p.total)}
          </span>
        </div>
      ))}
    </div>
  )
}

function CategoriaView({ produtos, sort }: { produtos: TopProdutoItem[]; sort: SortKey }) {
  const groupMap = new Map<string, { items: TopProdutoItem[]; total: number; qtd: number }>()
  for (const p of produtos) {
    const g = p.grupo || "Sem categoria"
    const ex = groupMap.get(g)
    if (ex) {
      ex.items.push(p)
      ex.total += p.total
      ex.qtd += p.qtd
    } else {
      groupMap.set(g, { items: [p], total: p.total, qtd: p.qtd })
    }
  }

  const groups = Array.from(groupMap.entries()).sort(
    (a, b) => b[1][sort] - a[1][sort],
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {groups.map(([grupo, { items, total, qtd }]) => (
        <div
          key={grupo}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 16px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", letterSpacing: 0.3 }}>
              {grupo}
            </span>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                {fmtQtd(qtd)} un
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--brand)" }}>
                {formatBRL(total)}
              </span>
            </div>
          </div>

          {items.map((p, i) => (
            <div
              key={p.produto}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 80px 90px",
                gap: 12,
                padding: "9px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.produto}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: sort === "qtd" ? 700 : 400,
                  color: sort === "qtd" ? "var(--text)" : "var(--text-3)",
                  textAlign: "right",
                }}
              >
                {fmtQtd(p.qtd)} un
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", textAlign: "right" }}>
                {formatBRL(p.total)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function fmtQtd(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)
}
