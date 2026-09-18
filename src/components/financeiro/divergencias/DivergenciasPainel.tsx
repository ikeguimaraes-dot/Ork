"use client"

import { useState } from "react"
import type { CSSProperties } from "react"
import * as XLSX from "xlsx"
import { formatBRL } from "@/lib/financeiro/utils"
import type { DivergenciasResultado } from "@/app/financeiro/dre/divergencias/actions"
import { FornecedoresAba } from "./FornecedoresAba"

// ── Style helpers (mesmo padrão de ConciliacaoTab.tsx) ──────────────────────
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
  fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
  color: "var(--text-3)", margin: "0 0 10px",
}

function fmtDate(d: string | null): string {
  return d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—"
}

function vazio(mensagem: string) {
  return (
    <div style={{ padding: "40px 24px", textAlign: "center",
      background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14 }}>
      <p style={{ fontSize: 14, color: "var(--text-3)", margin: 0 }}>{mensagem}</p>
    </div>
  )
}

function baixarXlsx(dados: DivergenciasResultado) {
  const wb = XLSX.utils.book_new()

  const wsA = XLSX.utils.json_to_sheet(dados.comNotaComXml.map((i) => ({
    Fornecedor: i.fornecedor ?? "", "Nº Nota": i.nNota,
    "Valor Título": i.valorTitulo, "Valor NF-e": i.valorNfe, "Diferença": i.diferenca,
    "Data Título": i.dataTitulo ?? "", "Data NF-e": i.dataNfe ?? "",
  })))
  XLSX.utils.book_append_sheet(wb, wsA, "Com nota e XML")

  const wsB = XLSX.utils.json_to_sheet(dados.comNotaSemXml.map((i) => ({
    Fornecedor: i.fornecedor ?? "", "Nº Nota": i.nNota, Valor: i.valor,
    Data: i.data ?? "", Categoria: i.categoria ?? "",
  })))
  XLSX.utils.book_append_sheet(wb, wsB, "Com nota sem XML")

  const wsC = XLSX.utils.json_to_sheet(dados.semNota.map((i) => ({
    Fornecedor: i.fornecedor ?? "", Valor: i.valor, Data: i.data ?? "",
    Categoria: i.categoria ?? "", Observação: i.observacao ?? "",
  })))
  XLSX.utils.book_append_sheet(wb, wsC, "Sem nota")

  const wsD = XLSX.utils.json_to_sheet(dados.xmlSemTitulo.map((i) => ({
    Fornecedor: i.fornecedor ?? "", "Nº Nota": i.nNota ?? "", Chave: i.chave,
    Valor: i.valor, Data: i.data ?? "", Unidade: i.unidade,
  })))
  XLSX.utils.book_append_sheet(wb, wsD, "XML sem título")

  const arrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
  const blob = new Blob([arrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `divergencias-${dados.unitName.replace(/\s+/g, "-")}-${dados.competencia.slice(0, 7)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

type Aba = "contas-notas" | "fornecedores"

export function DivergenciasPainel({ dados }: { dados: DivergenciasResultado }) {
  const [aba, setAba] = useState<Aba>("contas-notas")
  const { resumo } = dados

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden", width: "fit-content" }}>
          {([
            { id: "contas-notas" as const, label: "Contas a pagar × Notas" },
            { id: "fornecedores" as const, label: "Fornecedores" },
          ]).map((t) => (
            <button key={t.id} onClick={() => setAba(t.id)} style={{
              padding: "7px 14px", fontSize: 12, fontWeight: aba === t.id ? 700 : 500,
              background: aba === t.id ? "var(--brand, #D4A574)" : "var(--surface)",
              color: aba === t.id ? "var(--primary-foreground, #1A1208)" : "var(--text-3)",
              border: "none", cursor: "pointer", whiteSpace: "nowrap",
            }}>
              {t.label}
            </button>
          ))}
        </div>
        {aba === "contas-notas" && (
          <button
            onClick={() => baixarXlsx(dados)}
            style={{
              padding: "8px 16px", borderRadius: 7, border: "1px solid var(--border)",
              background: "var(--surface)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            ⬇ Baixar XLSX (4 abas)
          </button>
        )}
      </div>

      {aba === "contas-notas" && <ContasNotasAba dados={dados} resumo={resumo} />}
      {aba === "fornecedores" && <FornecedoresAba />}
    </div>
  )
}

function ContasNotasAba({ dados, resumo }: { dados: DivergenciasResultado; resumo: DivergenciasResultado["resumo"] }) {
  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* Resumo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
        <div style={cardStyle}>
          <p style={cardLabel}>Total de títulos</p>
          <p style={cardValue()}>{resumo.totalTitulos.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>{formatBRL(resumo.totalValor)}</p>
        </div>
        <div style={cardStyle}>
          <p style={cardLabel}>A · Com nota e XML</p>
          <p style={cardValue("#22C55E")}>{resumo.listaA.qtd.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>{formatBRL(resumo.listaA.valor)}</p>
        </div>
        <div style={cardStyle}>
          <p style={cardLabel}>B · Com nota, sem XML</p>
          <p style={cardValue(resumo.listaB.qtd > 0 ? "#F59E0B" : undefined)}>{resumo.listaB.qtd.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>{formatBRL(resumo.listaB.valor)}</p>
        </div>
        <div style={cardStyle}>
          <p style={cardLabel}>C · Sem nota</p>
          <p style={cardValue()}>{resumo.listaC.qtd.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>{formatBRL(resumo.listaC.valor)}</p>
        </div>
        <div style={cardStyle}>
          <p style={cardLabel}>D · XML sem título</p>
          <p style={cardValue(resumo.listaD.qtd > 0 ? "#EF4444" : undefined)}>{resumo.listaD.qtd.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>{formatBRL(resumo.listaD.valor)}</p>
        </div>
      </div>

      {/* Fechamento explícito */}
      <div style={{ ...cardStyle, display: "grid", gap: 10 }}>
        <p style={sectionTitle}>Conta de fechamento — ALIMENTOS/BEBIDAS</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
          <div>
            <p style={cardLabel}>Valor total da planilha</p>
            <p style={cardValue()}>{formatBRL(resumo.fechamento.valorPlanilhaAlimentos)}</p>
          </div>
          <div>
            <p style={cardLabel}>Valor total de NF-e</p>
            <p style={cardValue()}>{formatBRL(resumo.fechamento.valorNfeTotal)}</p>
          </div>
          <div>
            <p style={cardLabel}>Valor reconciliado (A)</p>
            <p style={cardValue("#22C55E")}>{formatBRL(resumo.fechamento.valorReconciliado)}</p>
          </div>
          <div>
            <p style={cardLabel}>Divergência não explicada</p>
            <p style={cardValue(Math.abs(resumo.fechamento.divergenciaNaoExplicada) > 0.01 ? "#EF4444" : "#22C55E")}>
              {formatBRL(resumo.fechamento.divergenciaNaoExplicada)}
            </p>
          </div>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>
          divergência não explicada = |planilha − NF-e| − reconciliado (lista A)
        </p>
      </div>

      {/* A */}
      <div>
        <h2 style={sectionTitle}>A · Com nota e com XML (reconciliado) — ordenado pela maior diferença</h2>
        {dados.comNotaComXml.length === 0 ? vazio("Nenhum título casou com uma NF-e neste mês.") : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: "var(--surface-2)" }}>
                  <th style={thS()}>Fornecedor</th>
                  <th style={thS()}>Nº Nota</th>
                  <th style={thS("right")}>Valor do título</th>
                  <th style={thS("right")}>Valor da NF-e</th>
                  <th style={thS("right")}>Diferença</th>
                  <th style={thS()}>Data do título</th>
                  <th style={thS()}>Data da NF-e</th>
                </tr>
              </thead>
              <tbody>
                {dados.comNotaComXml.map((i) => (
                  <tr key={`${i.fornecedor}|${i.nNota}`} style={{
                    borderTop: "1px solid var(--border)",
                    background: Math.abs(i.diferenca) > 0.01 ? "rgba(245,158,11,0.05)" : "transparent",
                  }}>
                    <td style={{ ...tdS(), maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.fornecedor ?? "—"}</td>
                    <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{i.nNota}</td>
                    <td style={tdS("right")}>{formatBRL(i.valorTitulo)}</td>
                    <td style={tdS("right")}>{formatBRL(i.valorNfe)}</td>
                    <td style={{ ...tdS("right"), fontWeight: 700, color: Math.abs(i.diferenca) > 0.01 ? "#F59E0B" : "var(--text)" }}>
                      {formatBRL(i.diferenca)}
                    </td>
                    <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{fmtDate(i.dataTitulo)}</td>
                    <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{fmtDate(i.dataNfe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* B */}
      <div>
        <h2 style={sectionTitle}>B · Com nota, sem XML (lista de XMLs que faltam)</h2>
        {dados.comNotaSemXml.length === 0 ? vazio("Nenhum título com número de nota sem XML correspondente.") : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: "var(--surface-2)" }}>
                  <th style={thS()}>Fornecedor</th>
                  <th style={thS()}>Nº Nota</th>
                  <th style={thS("right")}>Valor</th>
                  <th style={thS()}>Data</th>
                  <th style={thS()}>Categoria</th>
                </tr>
              </thead>
              <tbody>
                {dados.comNotaSemXml.map((i) => (
                  <tr key={`${i.fornecedor}|${i.nNota}`} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...tdS(), maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.fornecedor ?? "—"}</td>
                    <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{i.nNota}</td>
                    <td style={{ ...tdS("right"), fontWeight: 600 }}>{formatBRL(i.valor)}</td>
                    <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{fmtDate(i.data)}</td>
                    <td style={tdS()}>{i.categoria ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* C */}
      <div>
        <h2 style={sectionTitle}>C · Sem nota (compra sem nota fiscal)</h2>
        {dados.semNota.length === 0 ? vazio("Nenhum título sem número de nota.") : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: "var(--surface-2)" }}>
                  <th style={thS()}>Fornecedor</th>
                  <th style={thS("right")}>Valor</th>
                  <th style={thS()}>Data</th>
                  <th style={thS()}>Categoria</th>
                  <th style={thS()}>Observação</th>
                </tr>
              </thead>
              <tbody>
                {dados.semNota.map((i, idx) => (
                  <tr key={idx} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...tdS(), maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.fornecedor ?? "—"}</td>
                    <td style={{ ...tdS("right"), fontWeight: 600 }}>{formatBRL(i.valor)}</td>
                    <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{fmtDate(i.data)}</td>
                    <td style={tdS()}>{i.categoria ?? "—"}</td>
                    <td style={{ ...tdS(), maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.observacao ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* D */}
      <div>
        <h2 style={sectionTitle}>D · XML sem título (nota no fisco sem contrapartida na planilha)</h2>
        {dados.xmlSemTitulo.length === 0 ? vazio("Nenhuma NF-e sem título correspondente.") : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: "var(--surface-2)" }}>
                  <th style={thS()}>Fornecedor</th>
                  <th style={thS()}>Nº Nota</th>
                  <th style={thS()}>Chave</th>
                  <th style={thS("right")}>Valor</th>
                  <th style={thS()}>Data</th>
                  <th style={thS()}>Unidade</th>
                </tr>
              </thead>
              <tbody>
                {dados.xmlSemTitulo.map((i) => (
                  <tr key={i.chave} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...tdS(), maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.fornecedor ?? "—"}</td>
                    <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{i.nNota ?? "—"}</td>
                    <td style={{ ...tdS(), fontFamily: "monospace", fontSize: 10, whiteSpace: "nowrap" }}>{i.chave}</td>
                    <td style={{ ...tdS("right"), fontWeight: 600 }}>{formatBRL(i.valor)}</td>
                    <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{fmtDate(i.data)}</td>
                    <td style={tdS()}>{i.unidade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
