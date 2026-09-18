"use client"

import { useState, useTransition } from "react"
import type { CSSProperties } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { formatBRL } from "@/lib/financeiro/utils"
import { conferirAlerta, type AlertaComStatus } from "@/app/financeiro/aprovacoes/actions"

// ── Style helpers (mesmo padrão de DivergenciasPainel.tsx) ──────────────────
const cardStyle: CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px",
}
const cardLabel: CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-3)", margin: 0,
}
const cardValue = (color?: string): CSSProperties => ({
  fontSize: 22, fontWeight: 700, color: color ?? "var(--text)", margin: "4px 0 0",
})
const sectionTitle: CSSProperties = {
  fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
  color: "var(--text-3)", margin: "0 0 10px",
}
const selectStyle: CSSProperties = {
  padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)",
  background: "var(--surface)", color: "var(--text)", fontSize: 12,
}
const ghostBtnStyle: CSSProperties = {
  padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--surface)", color: "var(--text)", fontSize: 11, fontWeight: 600, cursor: "pointer",
}
const primaryBtnStyle: CSSProperties = {
  padding: "6px 14px", borderRadius: 6, border: "none",
  background: "var(--brand, #C4622D)", color: "var(--primary-foreground, #fff)",
  fontSize: 11, fontWeight: 700, cursor: "pointer",
}
const linkBtnStyle: CSSProperties = {
  padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--surface)", color: "var(--text)", fontSize: 11, fontWeight: 600,
  textDecoration: "none", whiteSpace: "nowrap",
}

const SEVERIDADE_COR: Record<string, string> = { critico: "#EF4444", atencao: "#F59E0B" }

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
}

type Props = {
  unitId: string
  competencia: string
  ativos: AlertaComStatus[]
  conferidos: AlertaComStatus[]
}

type FiltroSeveridade = "todos" | "critico" | "atencao"
type FiltroGrupo = "todos" | 1 | 2 | 3 | 4

export function ConferenciaPainel({ unitId, competencia, ativos, conferidos }: Props) {
  const [filtroSeveridade, setFiltroSeveridade] = useState<FiltroSeveridade>("todos")
  const [filtroGrupo, setFiltroGrupo] = useState<FiltroGrupo>("todos")
  const [expandido, setExpandido] = useState<Set<string>>(new Set())

  const criticos = ativos.filter((a) => a.severidade === "critico")
  const atencoes = ativos.filter((a) => a.severidade === "atencao")
  const conferidosEstaveis = conferidos.filter((a) => !a.conferencia!.assinaturaMudou)

  const somaValor = (itens: AlertaComStatus[]) => itens.reduce((s, i) => s + i.valorEnvolvido, 0)

  const ativosFiltrados = ativos.filter((a) => {
    if (filtroSeveridade !== "todos" && a.severidade !== filtroSeveridade) return false
    if (filtroGrupo !== "todos" && a.grupo !== filtroGrupo) return false
    return true
  })

  function toggleExpandido(chave: string) {
    setExpandido((prev) => {
      const next = new Set(prev)
      if (next.has(chave)) next.delete(chave)
      else next.add(chave)
      return next
    })
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <div style={cardStyle}>
          <p style={cardLabel}>Críticos</p>
          <p style={cardValue(criticos.length > 0 ? "#EF4444" : undefined)}>{criticos.length}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>{formatBRL(somaValor(criticos))}</p>
        </div>
        <div style={cardStyle}>
          <p style={cardLabel}>Atenção</p>
          <p style={cardValue(atencoes.length > 0 ? "#F59E0B" : undefined)}>{atencoes.length}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>{formatBRL(somaValor(atencoes))}</p>
        </div>
        <div style={cardStyle}>
          <p style={cardLabel}>Conferidos</p>
          <p style={cardValue("#22C55E")}>{conferidosEstaveis.length}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>{formatBRL(somaValor(conferidosEstaveis))}</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={filtroSeveridade}
          onChange={(e) => setFiltroSeveridade(e.target.value as FiltroSeveridade)}
          style={selectStyle}
        >
          <option value="todos">Todas as severidades</option>
          <option value="critico">Crítico</option>
          <option value="atencao">Atenção</option>
        </select>
        <select
          value={filtroGrupo}
          onChange={(e) => setFiltroGrupo(e.target.value === "todos" ? "todos" : (Number(e.target.value) as FiltroGrupo))}
          style={selectStyle}
        >
          <option value="todos">Todos os grupos</option>
          <option value={1}>1 · Identidade</option>
          <option value={2}>2 · Cobertura</option>
          <option value={3}>3 · Valor fora de faixa</option>
          <option value={4}>4 · Anomalia</option>
        </select>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {ativosFiltrados.length === 0 ? (
          <div style={{ padding: "32px 24px", textAlign: "center",
            background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14 }}>
            <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>Nenhum alerta ativo com esse filtro.</p>
          </div>
        ) : (
          ativosFiltrados.map((alerta) => (
            <AlertaLinha
              key={alerta.alertaChave}
              alerta={alerta}
              unitId={unitId}
              competencia={competencia}
              expandido={expandido.has(alerta.alertaChave)}
              onToggle={() => toggleExpandido(alerta.alertaChave)}
            />
          ))
        )}
      </div>

      {conferidos.length > 0 && (
        <div>
          <h2 style={sectionTitle}>Conferidos recentemente</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {conferidos.map((alerta) => (
              <ConferidoLinha key={alerta.alertaChave} alerta={alerta} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AlertaLinha({
  alerta, unitId, competencia, expandido, onToggle,
}: {
  alerta: AlertaComStatus
  unitId: string
  competencia: string
  expandido: boolean
  onToggle: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [observacao, setObservacao] = useState(alerta.conferencia?.observacao ?? "")
  const [erro, setErro] = useState<string | null>(null)

  function conferir(status: "conferido" | "ignorado") {
    setErro(null)
    startTransition(async () => {
      const r = await conferirAlerta(unitId, competencia, alerta.alertaChave, alerta.assinatura, status, observacao.trim() || null)
      if (!r.ok) {
        setErro(r.error ?? "Erro ao conferir")
        return
      }
      router.refresh()
    })
  }

  return (
    <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap" }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: SEVERIDADE_COR[alerta.severidade], flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: 0 }}>
            {alerta.titulo}
            {alerta.conferencia?.assinaturaMudou && (
              <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "#F59E0B", textTransform: "uppercase" }}>
                valor mudou
              </span>
            )}
          </p>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: "2px 0 0" }}>{alerta.motivo}</p>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap" }}>
          {alerta.ocorrencias.length} caso{alerta.ocorrencias.length === 1 ? "" : "s"}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>
          {formatBRL(alerta.valorEnvolvido)}
        </span>
        <Link href={alerta.link} style={linkBtnStyle}>Ver</Link>
        <button onClick={onToggle} style={ghostBtnStyle}>{expandido ? "Fechar" : "Detalhar"}</button>
      </div>

      {expandido && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 16px", display: "grid", gap: 10, background: "var(--surface-2)" }}>
          <div style={{ display: "grid", gap: 4, maxHeight: 260, overflowY: "auto" }}>
            {alerta.ocorrencias.map((o) => (
              <div key={o.chave} style={{
                display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12,
                padding: "4px 0", borderBottom: "1px solid var(--border)",
              }}>
                <span style={{ color: "var(--text)" }}>{o.descricao}</span>
                {o.valor > 0 && <span style={{ color: "var(--text-3)", whiteSpace: "nowrap" }}>{formatBRL(o.valor)}</span>}
              </div>
            ))}
          </div>
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Observação (opcional)"
            rows={2}
            style={{
              width: "100%", fontSize: 12, padding: 8, borderRadius: 6,
              border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
            {erro && <span style={{ fontSize: 11, color: "#EF4444", marginRight: "auto" }}>{erro}</span>}
            <button onClick={() => conferir("ignorado")} disabled={pending} style={ghostBtnStyle}>Ignorar</button>
            <button onClick={() => conferir("conferido")} disabled={pending} style={primaryBtnStyle}>
              {pending ? "Salvando…" : "Conferir"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ConferidoLinha({ alerta }: { alerta: AlertaComStatus }) {
  const c = alerta.conferencia!
  return (
    <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{alerta.titulo}</span>
      <span style={{ fontSize: 11, color: c.status === "conferido" ? "#22C55E" : "var(--text-3)" }}>
        {c.status === "conferido" ? "Conferido" : "Ignorado"}
      </span>
      {c.assinaturaMudou && (
        <span style={{ fontSize: 10, fontWeight: 700, color: "#F59E0B", textTransform: "uppercase" }}>valor mudou</span>
      )}
      <span style={{ fontSize: 11, color: "var(--text-3)" }}>{c.conferidoPor ?? "—"} · {fmtDateTime(c.conferidoEm)}</span>
      {c.observacao && (
        <span style={{ fontSize: 11, color: "var(--text-3)", fontStyle: "italic" }}>&ldquo;{c.observacao}&rdquo;</span>
      )}
    </div>
  )
}
