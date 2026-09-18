"use client"

import { useMemo, useState } from "react"
import type { CSSProperties } from "react"
import Link from "next/link"
import { formatBRL } from "@/lib/financeiro/utils"
import {
  SITUACAO_LABEL,
  type PagarResultado,
  type TituloPagar,
  type Situacao,
} from "@/lib/financeiro/pagar/calcularPagar"

// ── Style helpers (mesmo padrão de DivergenciasPainel/ConferenciaPainel) ────
const cardStyle: CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px",
}
const cardLabel: CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-3)", margin: 0,
}
const cardValue = (color?: string): CSSProperties => ({
  fontSize: 20, fontWeight: 700, color: color ?? "var(--text)", margin: "4px 0 0",
})
const sectionTitle: CSSProperties = {
  fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-3)", margin: "0 0 10px",
}
const thS = (align: "left" | "right" = "left"): CSSProperties => ({
  padding: "8px 12px", textAlign: align, fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
  textTransform: "uppercase", color: "var(--text-3)", borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
})
const tdS = (align: "left" | "right" = "left"): CSSProperties => ({
  padding: "7px 12px", textAlign: align, color: "var(--text)",
})
const tableStyle: CSSProperties = {
  width: "100%", borderCollapse: "collapse", fontSize: 12,
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
}
const selectStyle: CSSProperties = {
  padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)",
  background: "var(--surface)", color: "var(--text)", fontSize: 12,
}
const inputStyle: CSSProperties = {
  padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)",
  background: "var(--surface)", color: "var(--text)", fontSize: 12, width: 140,
}

const SITUACAO_COR: Record<Situacao, string> = {
  pago: "#22C55E",
  vencido: "#EF4444",
  a_vencer: "var(--text)",
  sem_confirmacao: "#F59E0B",
  sem_data: "#F59E0B",
}

function fmtDate(d: string | null): string {
  return d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR") : "—"
}

function vazio(mensagem: string) {
  return (
    <div style={{ padding: "40px 24px", textAlign: "center",
      background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14 }}>
      <p style={{ fontSize: 14, color: "var(--text-3)", margin: 0 }}>{mensagem}</p>
    </div>
  )
}

function SituacaoBadge({ situacao }: { situacao: Situacao }) {
  return (
    <span style={{
      display: "inline-flex", padding: "2px 8px", fontSize: 10, fontWeight: 700,
      letterSpacing: 0.4, textTransform: "uppercase", borderRadius: 99, whiteSpace: "nowrap",
      color: SITUACAO_COR[situacao],
      background: `color-mix(in srgb, ${SITUACAO_COR[situacao]} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${SITUACAO_COR[situacao]} 30%, transparent)`,
    }}>
      {SITUACAO_LABEL[situacao]}
    </span>
  )
}

type ColunaOrdenavel = "fornecedor" | "categoria" | "nNota" | "parcela" | "entrada" | "vencimento" | "valor" | "situacao"
type Ordenacao = { coluna: ColunaOrdenavel; direcao: "asc" | "desc" }
type FiltroSituacao = "todas" | Situacao

const PAGE_SIZE = 30

function valorOrdenacao(t: TituloPagar, coluna: ColunaOrdenavel): string | number {
  switch (coluna) {
    case "fornecedor": return t.fornecedor ?? ""
    case "categoria": return t.categoria ?? ""
    case "nNota": return t.nNota ?? ""
    case "parcela": return t.parcela ?? ""
    case "entrada": return t.entrada ?? ""
    case "vencimento": return t.vencimento ?? "9999-99-99"
    case "valor": return t.valor
    case "situacao": return t.situacao
  }
}

type Props = {
  dados: PagarResultado
  competenciaLabel: string
}

export function PagarPainel({ dados, competenciaLabel }: Props) {
  const { cards, titulos, resumoPorCategoria, semCompetencia } = dados

  const [filtroSituacao, setFiltroSituacao] = useState<FiltroSituacao>("todas")
  const [filtroCategoria, setFiltroCategoria] = useState<string>("todas")
  const [buscaFornecedor, setBuscaFornecedor] = useState("")
  const [valorMin, setValorMin] = useState("")
  const [valorMax, setValorMax] = useState("")
  const [ordenacao, setOrdenacao] = useState<Ordenacao>({ coluna: "vencimento", direcao: "asc" })
  const [pagina, setPagina] = useState(0)
  const [categoriasExpandidas, setCategoriasExpandidas] = useState<Set<string>>(new Set())
  const [tituloSelecionado, setTituloSelecionado] = useState<TituloPagar | null>(null)

  const categorias = useMemo(
    () => [...new Set(titulos.map((t) => t.categoria ?? "Sem categoria"))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [titulos]
  )

  const filtrados = useMemo(() => {
    const busca = buscaFornecedor.trim().toLowerCase()
    const min = valorMin ? Number(valorMin) : null
    const max = valorMax ? Number(valorMax) : null
    return titulos.filter((t) => {
      if (filtroSituacao !== "todas" && t.situacao !== filtroSituacao) return false
      if (filtroCategoria !== "todas" && (t.categoria ?? "Sem categoria") !== filtroCategoria) return false
      if (busca && !(t.fornecedor ?? "").toLowerCase().includes(busca)) return false
      if (min != null && t.valor < min) return false
      if (max != null && t.valor > max) return false
      return true
    })
  }, [titulos, filtroSituacao, filtroCategoria, buscaFornecedor, valorMin, valorMax])

  const ordenados = useMemo(() => {
    const sinal = ordenacao.direcao === "asc" ? 1 : -1
    return [...filtrados].sort((a, b) => {
      const va = valorOrdenacao(a, ordenacao.coluna)
      const vb = valorOrdenacao(b, ordenacao.coluna)
      if (va < vb) return -1 * sinal
      if (va > vb) return 1 * sinal
      return 0
    })
  }, [filtrados, ordenacao])

  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / PAGE_SIZE))
  const paginaAtual = Math.min(pagina, totalPaginas - 1)
  const paginaTitulos = ordenados.slice(paginaAtual * PAGE_SIZE, (paginaAtual + 1) * PAGE_SIZE)
  const somaFiltrado = ordenados.reduce((s, t) => s + t.valor, 0)

  function ordenarPor(coluna: ColunaOrdenavel) {
    setPagina(0)
    setOrdenacao((prev) => prev.coluna === coluna
      ? { coluna, direcao: prev.direcao === "asc" ? "desc" : "asc" }
      : { coluna, direcao: "asc" })
  }

  function toggleCategoria(categoria: string) {
    setCategoriasExpandidas((prev) => {
      const next = new Set(prev)
      if (next.has(categoria)) next.delete(categoria)
      else next.add(categoria)
      return next
    })
  }

  const setaOrdenacao = (coluna: ColunaOrdenavel) =>
    ordenacao.coluna === coluna ? (ordenacao.direcao === "asc" ? " ▲" : " ▼") : ""

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* LINHA 1 — cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
        <div style={cardStyle}>
          <p style={cardLabel}>Total do mês</p>
          <p style={cardValue()}>{formatBRL(cards.totalMes)}</p>
        </div>
        <div style={cardStyle}>
          <p style={cardLabel}>Pago</p>
          <p style={cardValue("#22C55E")}>{formatBRL(cards.pago)}</p>
        </div>
        <div style={cardStyle}>
          <p style={cardLabel}>A vencer</p>
          <p style={cardValue()}>{formatBRL(cards.aVencer)}</p>
        </div>
        <div style={cardStyle}>
          <p style={cardLabel}>Vencido</p>
          <p style={cardValue(cards.vencido > 0 ? "#EF4444" : undefined)}>{formatBRL(cards.vencido)}</p>
        </div>
        <div style={cardStyle}>
          <p style={cardLabel}>Sem confirmação de pagamento</p>
          <p style={cardValue(cards.semConfirmacao > 0 ? "#F59E0B" : undefined)}>{formatBRL(cards.semConfirmacao)}</p>
          <p style={{ fontSize: 10, color: "var(--text-3)", margin: "2px 0 0" }}>não é pago, não é vencido</p>
        </div>
        <div style={cardStyle}>
          <p style={cardLabel}>Sem data de vencimento</p>
          <p style={cardValue(cards.semDataVencimento > 0 ? "#F59E0B" : undefined)}>{formatBRL(cards.semDataVencimento)}</p>
          <p style={{ fontSize: 10, color: "var(--text-3)", margin: "2px 0 0" }}>não projetável no fluxo</p>
        </div>
      </div>

      {semCompetencia.qtd > 0 && (
        <div style={{ ...cardStyle, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            {semCompetencia.qtd} título{semCompetencia.qtd === 1 ? "" : "s"} sem competência (sem d_competencia nem
            d_vencimento) — não aparecem em nenhum mês, mostrados à parte:
          </span>
          <strong style={{ fontSize: 12, color: "var(--text)" }}>{formatBRL(semCompetencia.valor)}</strong>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select value={filtroSituacao} onChange={(e) => { setFiltroSituacao(e.target.value as FiltroSituacao); setPagina(0) }} style={selectStyle}>
          <option value="todas">Todas as situações</option>
          {(Object.keys(SITUACAO_LABEL) as Situacao[]).map((s) => (
            <option key={s} value={s}>{SITUACAO_LABEL[s]}</option>
          ))}
        </select>
        <select value={filtroCategoria} onChange={(e) => { setFiltroCategoria(e.target.value); setPagina(0) }} style={selectStyle}>
          <option value="todas">Todas as categorias</option>
          {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          placeholder="Buscar fornecedor…"
          value={buscaFornecedor}
          onChange={(e) => { setBuscaFornecedor(e.target.value); setPagina(0) }}
          style={{ ...inputStyle, width: 200 }}
        />
        <input
          placeholder="Valor mín."
          type="number"
          value={valorMin}
          onChange={(e) => { setValorMin(e.target.value); setPagina(0) }}
          style={inputStyle}
        />
        <input
          placeholder="Valor máx."
          type="number"
          value={valorMax}
          onChange={(e) => { setValorMax(e.target.value); setPagina(0) }}
          style={inputStyle}
        />
      </div>

      {/* LINHA 2 — lista */}
      <div>
        <h2 style={sectionTitle}>Títulos — {competenciaLabel}</h2>
        {ordenados.length === 0 ? vazio("Nenhum título encontrado para esse filtro.") : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ background: "var(--surface-2)" }}>
                    <th style={thS()} onClick={() => ordenarPor("fornecedor")}>Fornecedor{setaOrdenacao("fornecedor")}</th>
                    <th style={thS()} onClick={() => ordenarPor("categoria")}>Categoria{setaOrdenacao("categoria")}</th>
                    <th style={thS()} onClick={() => ordenarPor("nNota")}>Nº nota{setaOrdenacao("nNota")}</th>
                    <th style={thS()} onClick={() => ordenarPor("parcela")}>Parcela{setaOrdenacao("parcela")}</th>
                    <th style={thS()} onClick={() => ordenarPor("entrada")}>Entrada{setaOrdenacao("entrada")}</th>
                    <th style={thS()} onClick={() => ordenarPor("vencimento")}>Vencimento{setaOrdenacao("vencimento")}</th>
                    <th style={thS("right")} onClick={() => ordenarPor("valor")}>Valor{setaOrdenacao("valor")}</th>
                    <th style={thS()} onClick={() => ordenarPor("situacao")}>Situação{setaOrdenacao("situacao")}</th>
                    <th style={thS()}>Conta razão</th>
                  </tr>
                </thead>
                <tbody>
                  {paginaTitulos.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => setTituloSelecionado(t)}
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                    >
                      <td style={{ ...tdS(), maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.fornecedor ?? "—"}</td>
                      <td style={{ ...tdS(), maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.categoria ?? "—"}</td>
                      <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{t.nNota ?? "—"}</td>
                      <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{t.parcela ?? "—"}</td>
                      <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{fmtDate(t.entrada)}</td>
                      <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{fmtDate(t.vencimento)}</td>
                      <td style={{ ...tdS("right"), fontWeight: 600, whiteSpace: "nowrap" }}>{formatBRL(t.valor)}</td>
                      <td style={tdS()}><SituacaoBadge situacao={t.situacao} /></td>
                      <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{t.contaRazao ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)", background: "var(--surface-2)" }}>
                    <td style={{ ...tdS(), fontWeight: 700 }} colSpan={6}>
                      Total filtrado ({ordenados.length} título{ordenados.length === 1 ? "" : "s"})
                    </td>
                    <td style={{ ...tdS("right"), fontWeight: 700 }}>{formatBRL(somaFiltrado)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 10 }}>
              <button
                onClick={() => setPagina((p) => Math.max(0, p - 1))}
                disabled={paginaAtual === 0}
                style={{ ...selectStyle, cursor: paginaAtual === 0 ? "default" : "pointer", opacity: paginaAtual === 0 ? 0.5 : 1 }}
              >
                ← anterior
              </button>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                página {paginaAtual + 1} de {totalPaginas}
              </span>
              <button
                onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))}
                disabled={paginaAtual >= totalPaginas - 1}
                style={{ ...selectStyle, cursor: paginaAtual >= totalPaginas - 1 ? "default" : "pointer", opacity: paginaAtual >= totalPaginas - 1 ? 0.5 : 1 }}
              >
                próxima →
              </button>
            </div>
          </>
        )}
      </div>

      {/* LINHA 3 — resumo por categoria */}
      <div>
        <h2 style={sectionTitle}>Resumo por categoria</h2>
        {resumoPorCategoria.length === 0 ? vazio("Nenhuma categoria neste mês.") : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: "var(--surface-2)" }}>
                  <th style={thS()}></th>
                  <th style={thS()}>Categoria</th>
                  <th style={thS("right")}>Nº títulos</th>
                  <th style={thS("right")}>Valor</th>
                  <th style={thS()}>Conta contábil mapeada</th>
                </tr>
              </thead>
              <tbody>
                {resumoPorCategoria.map((r) => {
                  const expandido = categoriasExpandidas.has(r.categoria)
                  const titulosCategoria = titulos.filter((t) => (t.categoria ?? "Sem categoria") === r.categoria)
                  return (
                    <>
                      <tr key={r.categoria} style={{ borderTop: "1px solid var(--border)", cursor: "pointer",
                        background: r.aClassificar ? "rgba(245,158,11,0.06)" : undefined }}
                        onClick={() => toggleCategoria(r.categoria)}
                      >
                        <td style={{ ...tdS(), width: 20 }}>{expandido ? "▾" : "▸"}</td>
                        <td style={tdS()}>
                          {r.categoria}
                          {r.aClassificar && (
                            <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "#F59E0B", textTransform: "uppercase" }}>
                              a classificar
                            </span>
                          )}
                        </td>
                        <td style={tdS("right")}>{r.qtdTitulos}</td>
                        <td style={{ ...tdS("right"), fontWeight: 600 }}>{formatBRL(r.valor)}</td>
                        <td style={tdS()}>
                          {r.aClassificar ? (
                            <Link href="/financeiro/dre/classificacao" onClick={(e) => e.stopPropagation()} style={{ color: "#F59E0B" }}>
                              9.99 — classificar →
                            </Link>
                          ) : r.contaMapeada}
                        </td>
                      </tr>
                      {expandido && (
                        <tr>
                          <td colSpan={5} style={{ padding: "0 12px 12px 32px", background: "var(--surface-2)" }}>
                            <div style={{ display: "grid", gap: 4, paddingTop: 8 }}>
                              {titulosCategoria.map((t) => (
                                <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
                                  <span>{t.fornecedor ?? "—"} · Nota {t.nNota ?? "—"} · {fmtDate(t.vencimento)}</span>
                                  <span style={{ fontWeight: 600 }}>{formatBRL(t.valor)}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {tituloSelecionado && (
        <TituloDrawer titulo={tituloSelecionado} onClose={() => setTituloSelecionado(null)} />
      )}
    </div>
  )
}

function TituloDrawer({ titulo, onClose }: { titulo: TituloPagar; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 420, maxWidth: "100%", height: "100%", background: "var(--surface)", borderLeft: "1px solid var(--border)",
          padding: 24, overflowY: "auto", display: "grid", gap: 16, alignContent: "start" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>{titulo.fornecedor ?? "Fornecedor não identificado"}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-3)", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 8, fontSize: 12 }}>
          <Campo label="Categoria" valor={titulo.categoria ?? "—"} />
          <Campo label="Nº da nota" valor={titulo.nNota ?? "—"} />
          <Campo label="Parcela" valor={titulo.parcela ?? "—"} />
          <Campo label="Entrada" valor={fmtDate(titulo.entrada)} />
          <Campo label="Vencimento" valor={fmtDate(titulo.vencimento)} />
          <Campo label="Valor" valor={formatBRL(titulo.valor)} />
          <Campo label="Situação" valor={<SituacaoBadge situacao={titulo.situacao} />} />
          <Campo label="liquidacao_origem (bruto)" valor={titulo.liquidacaoOrigem ?? "—"} />
          <Campo label="Conta do razão" valor={titulo.contaRazao ?? "sem lançamento próprio nesta competência"} />
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <p style={{ ...sectionTitle, margin: "0 0 8px" }}>Reconciliação com NF-e</p>
          {titulo.reconciliacao ? (
            <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
              <Campo label="Status" valor={titulo.reconciliacao.status} />
              {titulo.reconciliacao.status === "confirmada" && !titulo.reconciliacao.chaveNfe.startsWith("SEM_XML:") && (
                <Link href="/financeiro/dre/divergencias" style={{ fontSize: 12, color: "var(--brand, #C4622D)" }}>
                  Ver nota casada na tela de Divergências →
                </Link>
              )}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>Sem sugestão de reconciliação gerada para este título.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Campo({ label, valor }: { label: string; valor: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span style={{ color: "var(--text)", fontWeight: 600, textAlign: "right" }}>{valor}</span>
    </div>
  )
}
