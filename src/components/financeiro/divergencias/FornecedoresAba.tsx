"use client"

import { Fragment, useEffect, useState } from "react"
import type { CSSProperties } from "react"
import { formatBRL } from "@/lib/financeiro/utils"
import {
  gerarFornecedoresAutomaticoAction, listarFornecedores, renomearFornecedor,
  mesclarFornecedores, moverVinculoFornecedor,
  type FornecedorCatalogado, type ResultadoGeracaoFornecedores,
} from "@/app/financeiro/dre/divergencias/fornecedores-actions"

const thS = (align: "left" | "right" = "left"): CSSProperties => ({
  padding: "8px 12px", textAlign: align,
  fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
  textTransform: "uppercase", color: "var(--text-3)",
  borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
})

const tdS = (align: "left" | "right" = "left"): CSSProperties => ({
  padding: "7px 12px", textAlign: align, color: "var(--text)",
})

const tableStyle: CSSProperties = {
  width: "100%", borderCollapse: "collapse", fontSize: 12,
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
}

const selectStyle: CSSProperties = {
  padding: "5px 8px", borderRadius: 6, fontSize: 11,
  background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)",
}

const buttonStyle: CSSProperties = {
  padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
  border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)",
}

const chevronStyle = (expanded: boolean): CSSProperties => ({
  display: "inline-block", transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
  transition: "transform 0.15s ease", color: "var(--text-3)", fontSize: 12, width: 12,
})

export function FornecedoresAba() {
  const [fornecedores, setFornecedores] = useState<FornecedorCatalogado[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)
  const [resultadoGeracao, setResultadoGeracao] = useState<ResultadoGeracaoFornecedores | null>(null)
  const [expandido, setExpandido] = useState<Set<string>>(new Set())
  const [editandoNome, setEditandoNome] = useState<Record<string, string>>({})
  const [mesclarAlvo, setMesclarAlvo] = useState<Record<string, string>>({})
  const [moverAlvo, setMoverAlvo] = useState<Record<string, string>>({})

  async function carregar() {
    const r = await listarFornecedores()
    if (r.ok) { setFornecedores(r.fornecedores); setErro(null) } else { setErro(r.error ?? "Erro ao carregar.") }
  }

  useEffect(() => { let active = true; listarFornecedores().then(r => { if (!active) return; if (r.ok) setFornecedores(r.fornecedores); else setErro(r.error ?? "Erro ao carregar.") }); return () => { active = false } }, [])

  async function gerar() {
    setGerando(true)
    const r = await gerarFornecedoresAutomaticoAction()
    setResultadoGeracao(r)
    setGerando(false)
    if (r.ok) await carregar()
  }

  function toggleExpandido(id: string) {
    setExpandido((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function salvarRenomear(id: string) {
    const nome = editandoNome[id]
    if (!nome) return
    const r = await renomearFornecedor(id, nome)
    if (r.ok) {
      setEditandoNome((prev) => { const next = { ...prev }; delete next[id]; return next })
      await carregar()
    } else {
      alert(r.error ?? "Erro ao renomear.")
    }
  }

  async function confirmarMesclar(origemId: string) {
    const destinoId = mesclarAlvo[origemId]
    if (!destinoId) return
    if (!window.confirm("Mesclar este fornecedor? Todos os vínculos passam para o destino e a origem fica inativa.")) return
    const r = await mesclarFornecedores(origemId, destinoId)
    if (r.ok) {
      setMesclarAlvo((prev) => { const next = { ...prev }; delete next[origemId]; return next })
      await carregar()
    } else {
      alert(r.error ?? "Erro ao mesclar.")
    }
  }

  async function confirmarMover(deparaId: string) {
    const destinoId = moverAlvo[deparaId]
    if (!destinoId) return
    const r = await moverVinculoFornecedor(deparaId, destinoId)
    if (r.ok) {
      setMoverAlvo((prev) => { const next = { ...prev }; delete next[deparaId]; return next })
      await carregar()
    } else {
      alert(r.error ?? "Erro ao mover vínculo.")
    }
  }

  if (erro) {
    return <div style={{ padding: "9px 12px", borderRadius: 7, background: "rgba(239,68,68,.1)", color: "#ef4444", fontSize: 12 }}>{erro}</div>
  }
  if (fornecedores === null) {
    return <p style={{ padding: 30, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Carregando fornecedores…</p>
  }

  const ativos = fornecedores.filter((f) => f.ativo)

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, maxWidth: 640 }}>
          Catálogo de fornecedores — de-para entre o nome na NF-e e o nome na planilha de compras.
          O match título↔NF-e usa esse vínculo, exato, sem comparar texto.
        </p>
        <button onClick={() => void gerar()} disabled={gerando} style={{ ...buttonStyle, background: "var(--brand, #C4622D)", color: "white", border: 0, opacity: gerando ? 0.6 : 1 }}>
          {gerando ? "Gerando…" : "Gerar automaticamente"}
        </button>
      </div>

      {resultadoGeracao && (
        <div style={{
          padding: "9px 12px", borderRadius: 7, fontSize: 12,
          background: resultadoGeracao.ok ? "rgba(34,197,94,.1)" : "rgba(239,68,68,.1)",
          color: resultadoGeracao.ok ? "#22c55e" : "#ef4444",
        }}>
          {resultadoGeracao.ok
            ? `${resultadoGeracao.criados} fornecedor(es) criado(s), ${resultadoGeracao.vinculados} nome(s) vinculado(s)${resultadoGeracao.ignoradosPorConflito > 0 ? `, ${resultadoGeracao.ignoradosPorConflito} nome(s) ignorado(s) por conflito (revisão manual)` : ""}.`
            : `Erro: ${resultadoGeracao.error}`}
        </div>
      )}

      {fornecedores.length === 0 ? (
        <div style={{ padding: "40px 24px", textAlign: "center", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14 }}>
          <p style={{ fontSize: 14, color: "var(--text-3)", margin: 0 }}>Nenhum fornecedor catalogado ainda. Clique em &quot;Gerar automaticamente&quot;.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: "var(--surface-2)" }}>
                <th style={{ width: 24 }} />
                <th style={thS()}>Código</th>
                <th style={thS()}>Nome</th>
                <th style={thS()}>CNPJ</th>
                <th style={thS("right")}>Valor NF-e</th>
                <th style={thS("right")}>Notas</th>
                <th style={thS("right")}>Valor título</th>
                <th style={thS("right")}>Títulos</th>
                <th style={thS()}>Status</th>
                <th style={thS()}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {fornecedores.map((f) => {
                const isOpen = expandido.has(f.id)
                const editando = editandoNome[f.id] !== undefined
                return (
                  <Fragment key={f.id}>
                    <tr style={{ borderTop: "1px solid var(--border)", opacity: f.ativo ? 1 : 0.5 }}>
                      <td style={{ padding: "8px 0 8px 12px", cursor: "pointer" }} onClick={() => toggleExpandido(f.id)}>
                        <span style={chevronStyle(isOpen)}>›</span>
                      </td>
                      <td style={{ ...tdS(), fontWeight: 700, whiteSpace: "nowrap" }}>{f.codigo}</td>
                      <td style={tdS()}>
                        {editando ? (
                          <div style={{ display: "flex", gap: 4 }}>
                            <input
                              value={editandoNome[f.id]}
                              onChange={(e) => setEditandoNome((prev) => ({ ...prev, [f.id]: e.target.value }))}
                              style={{ ...selectStyle, minWidth: 180 }}
                            />
                            <button style={buttonStyle} onClick={() => void salvarRenomear(f.id)}>Salvar</button>
                            <button style={buttonStyle} onClick={() => setEditandoNome((prev) => { const next = { ...prev }; delete next[f.id]; return next })}>Cancelar</button>
                          </div>
                        ) : f.nome}
                      </td>
                      <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{f.cnpj ?? "—"}</td>
                      <td style={tdS("right")}>{formatBRL(f.valorTotalNfe)}</td>
                      <td style={tdS("right")}>{f.qtdNotas}</td>
                      <td style={tdS("right")}>{formatBRL(f.valorTotalTitulo)}</td>
                      <td style={tdS("right")}>{f.qtdTitulos}</td>
                      <td style={tdS()}>{f.ativo ? "Ativo" : "Inativo"}</td>
                      <td style={{ padding: "7px 12px" }}>
                        {f.ativo && !editando && (
                          <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                            <button style={buttonStyle} onClick={() => setEditandoNome((prev) => ({ ...prev, [f.id]: f.nome }))}>Renomear</button>
                            <select
                              value={mesclarAlvo[f.id] ?? ""}
                              onChange={(e) => setMesclarAlvo((prev) => ({ ...prev, [f.id]: e.target.value }))}
                              style={selectStyle}
                            >
                              <option value="">Mesclar com…</option>
                              {ativos.filter((x) => x.id !== f.id).map((x) => (
                                <option key={x.id} value={x.id}>{x.codigo} — {x.nome}</option>
                              ))}
                            </select>
                            {mesclarAlvo[f.id] && (
                              <button style={{ ...buttonStyle, background: "rgba(239,68,68,.1)", color: "#ef4444" }} onClick={() => void confirmarMesclar(f.id)}>
                                Confirmar mesclagem
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={10} style={{ padding: "0 12px 12px 36px", background: "var(--surface-2)" }}>
                          {f.nomesOrigem.length === 0 ? (
                            <p style={{ fontSize: 11, color: "var(--text-3)", margin: "10px 0" }}>Nenhum nome de origem vinculado.</p>
                          ) : (
                            <table style={{ ...tableStyle, background: "var(--surface)", fontSize: 11, marginTop: 8 }}>
                              <thead>
                                <tr>
                                  <th style={thS()}>Nome de origem</th>
                                  <th style={thS()}>Origem</th>
                                  <th style={thS()}>Mover vínculo para</th>
                                </tr>
                              </thead>
                              <tbody>
                                {f.nomesOrigem.map((v) => (
                                  <tr key={v.deparaId} style={{ borderTop: "1px solid var(--border)" }}>
                                    <td style={tdS()}>{v.nomeOrigemLiteral}</td>
                                    <td style={tdS()}>{v.origem === "nfe" ? "NF-e" : "Título"}</td>
                                    <td style={{ padding: "7px 12px", display: "flex", gap: 4, alignItems: "center" }}>
                                      <select
                                        value={moverAlvo[v.deparaId] ?? ""}
                                        onChange={(e) => setMoverAlvo((prev) => ({ ...prev, [v.deparaId]: e.target.value }))}
                                        style={selectStyle}
                                      >
                                        <option value="">—</option>
                                        {ativos.filter((x) => x.id !== f.id).map((x) => (
                                          <option key={x.id} value={x.id}>{x.codigo} — {x.nome}</option>
                                        ))}
                                      </select>
                                      {moverAlvo[v.deparaId] && (
                                        <button style={buttonStyle} onClick={() => void confirmarMover(v.deparaId)}>Mover</button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
