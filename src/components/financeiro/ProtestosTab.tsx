"use client"

import { useResource } from "@/lib/hooks/use-resource"

import { Fragment, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { getBrowserClient } from "@ork/db/supabase/client"
import {
  getProtestos,
  getProtestoUploadUrl,
  processarCertidaoProtesto,
} from "@/app/financeiro/pagar/protestos-actions"

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—"
  : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)

function fmtDate(d: string | null) {
  return d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR") : "—"
}

// ── Style helpers (mesmo padrão das outras abas) ──────────────────────────────
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

const chevronStyle = (expanded: boolean): CSSProperties => ({
  display: "inline-block", transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
  transition: "transform 0.15s ease", color: "var(--text-3)", fontSize: 12, width: 12,
})

function SituacaoBadge({ situacao }: { situacao: "em_aberto" | "cancelado" }) {
  const isOk = situacao === "cancelado"
  return (
    <span style={{
      display: "inline-flex", padding: "2px 8px", fontSize: 10, fontWeight: 700,
      letterSpacing: 0.4, textTransform: "uppercase", borderRadius: 99, whiteSpace: "nowrap",
      background: isOk ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
      border: `1px solid ${isOk ? "rgba(34,197,94,0.30)" : "rgba(239,68,68,0.30)"}`,
      color: isOk ? "#22C55E" : "#EF4444",
    }}>
      {isOk ? "Cancelado" : "Em aberto"}
    </span>
  )
}

type Props = { unitId: string | null }

export function ProtestosTab({ unitId }: Props) {
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const [uploadErro, setUploadErro] = useState<string | null>(null)
  const [expandedProtestos, setExpandedProtestos] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: certidoes, loading, reload: carregar } = useResource(String(unitId), () => getProtestos(unitId), null)

  const toggleProtesto = (id: string) => {
    setExpandedProtestos((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function enviarArquivo(file: File) {
    setUploading(true)
    setUploadErro(null)
    setUploadMsg(`Enviando ${file.name}…`)
    try {
      const ju = await getProtestoUploadUrl(file.name)
      if ("error" in ju) throw new Error(ju.error)

      const sb = getBrowserClient()
      if (!sb) throw new Error("Cliente Supabase indisponível no navegador")
      const up = await sb.storage.from("protestos").uploadToSignedUrl(ju.path, ju.token, file, {
        contentType: file.type || "application/pdf",
      })
      if (up.error) throw new Error(`Upload: ${up.error.message}`)

      setUploadMsg("Extraindo protestos do PDF…")
      const resultado = await processarCertidaoProtesto({
        storage_path: ju.path,
        nome_arquivo: file.name,
        tamanho_bytes: file.size,
      })
      if (!resultado.ok) throw new Error(resultado.error)

      setUploadMsg(
        `Certidão importada: ${resultado.protestos} protesto(s), ${resultado.cancelados} cancelado(s)` +
          (resultado.unit_id ? "" : " — CNPJ do devedor não bateu com nenhuma unidade cadastrada.")
      )
      carregar()
    } catch (e) {
      setUploadErro(e instanceof Error ? e.message : String(e))
      setUploadMsg(null)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const todosRegistros = (certidoes ?? []).flatMap((c) => c.registros)
  const totalProtestos = todosRegistros.length
  const totalCancelados = todosRegistros.filter((r) => r.situacao === "cancelado").length
  const totalEmAberto = totalProtestos - totalCancelados
  const valorTotalProtestado = todosRegistros.reduce((sum, r) => sum + (r.valor_protestado ?? 0), 0)

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Upload — área de drop + botão, input nativo escondido (acessível via label) */}
      <div
        onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (uploading) return
          const file = e.dataTransfer.files?.[0]
          if (file) enviarArquivo(file)
        }}
        style={{
          display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center",
          padding: "18px 20px", borderRadius: 12,
          background: dragOver ? "var(--surface-2)" : "var(--surface)",
          border: `1px dashed ${dragOver ? "var(--brand, #D4A574)" : "var(--border)"}`,
          transition: "background 0.15s ease, border-color 0.15s ease",
        }}
      >
        <label
          htmlFor="protesto-pdf-input"
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "10px 20px", borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: uploading ? "var(--surface-2)" : "var(--brand, #D4A574)",
            color: uploading ? "var(--text-3)" : "var(--primary-foreground, #1A1208)",
            cursor: uploading ? "default" : "pointer", whiteSpace: "nowrap",
          }}
        >
          {uploading ? "Enviando…" : "Enviar certidão (PDF)"}
        </label>
        <input
          id="protesto-pdf-input"
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) enviarArquivo(file)
          }}
          style={{
            position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
            overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0,
          }}
        />
        <span style={{ fontSize: 11, color: "var(--text-3)", flex: "1 1 260px" }}>
          Certidão de protesto (PDF do tabelião) — arraste o arquivo aqui ou clique no botão. A unidade é identificada automaticamente pelo CNPJ do devedor no documento.
        </span>
        {uploadMsg && (
          <span style={{ fontSize: 12, color: uploading ? "var(--text-3)" : "#22C55E", fontWeight: 600 }}>
            {uploadMsg}
          </span>
        )}
        {uploadErro && (
          <span style={{ fontSize: 12, color: "#EF4444", fontWeight: 600 }}>
            {uploadErro}
          </span>
        )}
      </div>

      {/* Resumo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
        <div style={cardStyle}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-3)", margin: 0 }}>
            Total de protestos
          </p>
          <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: "4px 0 0" }}>
            {totalProtestos.toLocaleString("pt-BR")}
          </p>
        </div>
        <div style={cardStyle}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-3)", margin: 0 }}>
            Em aberto
          </p>
          <p style={{ fontSize: 20, fontWeight: 700, color: "#EF4444", margin: "4px 0 0" }}>
            {totalEmAberto.toLocaleString("pt-BR")}
          </p>
        </div>
        <div style={cardStyle}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-3)", margin: 0 }}>
            Cancelados
          </p>
          <p style={{ fontSize: 20, fontWeight: 700, color: "#22C55E", margin: "4px 0 0" }}>
            {totalCancelados.toLocaleString("pt-BR")}
          </p>
        </div>
        <div style={cardStyle}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-3)", margin: 0 }}>
            Valor total protestado
          </p>
          <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: "4px 0 0" }}>
            {fmtBRL(valorTotalProtestado)}
          </p>
        </div>
      </div>

      {/* Certidões */}
      {loading ? (
        <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
          Carregando protestos…
        </div>
      ) : !certidoes || certidoes.length === 0 ? (
        <div style={{
          padding: "40px 24px", textAlign: "center",
          background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14,
          color: "var(--text-3)", fontSize: 13,
        }}>
          Nenhuma certidão de protesto importada ainda.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 20 }}>
          {certidoes.map((c) => (
            <div key={c.id}>
              <p style={{
                fontSize: 12, fontWeight: 700, color: "var(--text)", margin: "0 0 8px",
                display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
              }}>
                {c.nome_devedor ?? "(devedor não identificado)"}
                <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-3)" }}>
                  {c.cnpj_devedor ?? "—"} · Certidão de {fmtDate(c.data_certidao)} · {c.registros.length} protesto{c.registros.length !== 1 ? "s" : ""}
                  {c.unit_id == null && " · sem unidade"}
                </span>
              </p>
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={{ background: "var(--surface-2)" }}>
                      <th style={thS()}></th>
                      <th style={thS()}>Apresentante</th>
                      <th style={thS("right")}>Valor do Título</th>
                      <th style={thS("right")}>Valor Protestado</th>
                      <th style={thS()}>Data do Protesto</th>
                      <th style={thS()}>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.registros.map((r) => {
                      const expanded = expandedProtestos.has(r.id)
                      return (
                        <Fragment key={r.id}>
                          <tr
                            style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                            onClick={() => toggleProtesto(r.id)}
                          >
                            <td style={{ ...tdS(), width: 24 }}>
                              <span style={chevronStyle(expanded)}>›</span>
                            </td>
                            <td style={{ ...tdS(), fontWeight: 600, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {r.apresentante ?? "—"}
                            </td>
                            <td style={tdS("right")}>{fmtBRL(r.valor_titulo)}</td>
                            <td style={{ ...tdS("right"), fontWeight: 700 }}>{fmtBRL(r.valor_protestado)}</td>
                            <td style={{ ...tdS(), whiteSpace: "nowrap" }}>{fmtDate(r.data_protesto)}</td>
                            <td style={tdS()}>
                              <SituacaoBadge situacao={r.situacao} />
                            </td>
                          </tr>
                          {expanded && (
                            <tr>
                              <td colSpan={6} style={{ padding: "12px 12px 16px 36px", background: "var(--surface-2)" }}>
                                <div style={{
                                  display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
                                  gap: "8px 24px", fontSize: 12,
                                }}>
                                  <Campo label="Registro Nº">{r.numero_registro}</Campo>
                                  <Campo label="CNPJ do apresentante">{r.cnpj_apresentante ?? "—"}</Campo>
                                  <Campo label="Espécie">{r.especie ?? "—"}</Campo>
                                  <Campo label="Protocolo e Data">{r.protocolo_e_data ?? "—"}</Campo>
                                  <Campo label="Motivo">{r.motivo ?? "—"}</Campo>
                                  <Campo label="Emissão">{fmtDate(r.emissao)}</Campo>
                                  <Campo label="Vencimento">{r.vencimento ?? "—"}</Campo>
                                  <Campo label="Valor para cancelar">{fmtBRL(r.valor_para_cancelar)}</Campo>
                                  <Campo label="Número do Título">{r.numero_titulo ?? "—"}</Campo>
                                  <Campo label="Tipo de Notificação">{r.tipo_notificacao ?? "—"}</Campo>
                                  <Campo label="Livro/Folha">{r.livro_folha ?? "—"}</Campo>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-3)", margin: "0 0 2px" }}>
        {label}
      </p>
      <p style={{ fontSize: 12, color: "var(--text)", margin: 0 }}>{children}</p>
    </div>
  )
}
