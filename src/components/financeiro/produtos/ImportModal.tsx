"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import * as XLSX from "xlsx"
import { substituirProdutosPlanilha, getProdutoImportUnits } from "@/app/financeiro/dre/cmv/actions"
import type { ProdutoInsert } from "@/app/financeiro/dre/cmv/actions"

interface ImportModalProps {
  unitId: string | null
  onClose: () => void
  onSuccess: () => void
}



function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const raw = String(v).trim().replace(/[^\d,.-]/g, "")
  const comma = raw.lastIndexOf(",")
  const dot = raw.lastIndexOf(".")
  let normalized = raw
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "")
  } else {
    const separator = comma >= 0 ? "," : dot >= 0 ? "." : null
    if (separator) {
      const parts = raw.split(separator)
      normalized = parts.length > 2 || parts[1]?.length === 3
        ? parts.join("")
        : separator === "," ? raw.replace(",", ".") : raw
    }
  }
  const n = Number(normalized)
  return isNaN(n) ? null : n
}

function normalizeUnitName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, " ")
}

function getCol(raw: Record<string, unknown>, ...names: string[]): unknown {
  const expected = new Set(names.map(name => normalizeUnitName(name.replace(/\./g, " "))))
  const key = Object.keys(raw).find(name => expected.has(normalizeUnitName(name.replace(/\./g, " "))))
  return key ? raw[key] : undefined
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null
  return String(v).trim()
}

function parseBool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === "") return null
  const s = String(v).trim().toLowerCase()
  if (s === "sim" || s === "s" || s === "true" || s === "1") return true
  if (s === "não" || s === "nao" || s === "n" || s === "false" || s === "0") return false
  return null
}

function parseSheet(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  })
  return raw
}

type MappedRow = { row: ProdutoInsert | null; unknownUnit?: string }

function mapRow(raw: Record<string, unknown>, units: Map<string, string>): MappedRow {
  const mes = toNum(raw["Mês Lançamento"])
  const ano = toNum(raw["Ano Lançamento"])
  if (!mes || !ano) return { row: null }

  const fantasia = toStr(raw["Fantasia Empresa"])
  const unitId = fantasia ? units.get(normalizeUnitName(fantasia)) : null
  if (!unitId) return { row: null, unknownUnit: fantasia ?? "vazio" }

  const q_embalagem = toNum(raw["Q. Estoque"])
  const v_embalagem = toNum(raw["V. Embalagem"])
  const vtRaw       = toNum(raw["V. Total Embalagem"])
  // Fallback: recalculate when column is absent or zero
  const v_total_embalagem =
    vtRaw != null && vtRaw !== 0 ? vtRaw
    : q_embalagem != null && v_embalagem != null ? q_embalagem * v_embalagem
    : vtRaw

  return { row: {
    unit_id:            unitId,
    fornecedor_nome:    toStr(raw["Fantasia Fornecedor"]),
    nr_danfe:           toStr(raw["Nr. DANFE"]),
    v_total_danfe:      toNum(getCol(raw, "V Total DANFE", "Vlr Total DANFE", "Valor Total DANFE")),
    dt_emissao:         toStr(raw["D. Emissão"]),
    item_codigo:        toStr(raw["Item"]),
    item_descricao:     toStr(raw["Descrição do Item"]),
    unidade_medida:     toStr(raw["Unidade Medida"]),
    tipo_item:          toStr(raw["Tipo Item"]),
    q_embalagem,
    q_estoque:          toNum(raw["Q. Estoque"]),
    v_embalagem,
    v_total_embalagem,
    v_custo_medio:      toNum(raw["V. Custo Médio"]),
    v_custo_compra:     toNum(raw["V. Custo Compra"]),
    v_custo_total:      toNum(raw["V. Custo Total"]),
    perc_variacao:      toNum(raw["% Variação"]),
    calcula_cmv:        parseBool(raw["Calcula CMV"]),
    fornecedor_codigo:  toStr(raw["Fornecedor"]),
    codigo_gerencial:   toStr(raw["C. Gerencial"]),
    desc_gerencial:     toStr(raw["Descrição C. Gerencial"]),
    mes_lancamento:     mes,
    ano_lancamento:     ano,
  } }
}

export function ImportModal({ unitId, onClose, onSuccess }: ImportModalProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "done" | "error">("idle")
  const [progress, setProgress] = useState(0)
  const [totalRows, setTotalRows] = useState(0)
  const [importedRows, setImportedRows] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [importUnits, setImportUnits] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    getProdutoImportUnits()
      .then(units => setImportUnits(new Map(units.map(unit => [normalizeUnitName(unit.name), unit.id]))))
      .catch(error => setErrorMsg(error instanceof Error ? error.message : String(error)))
  }, [])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) {
      setFileName(f.name)
      setErrorMsg(null)
    }
  }

  async function handleImport() {
    const f = inputRef.current?.files?.[0]
    if (!f) return

    setErrorMsg(null)

    if (!unitId) {
      setErrorMsg("Unidade não identificada. Faça login novamente.")
      setStatus("error")
      return
    }

    setStatus("parsing")

    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: "array" })

      // Planilhas internas de NF-e Entrada têm um layout diferente do
      // Relatório de Produtos do ERP. Detecta pelo cabeçalho e encaminha ao
      // importador financeiro controlado, mantendo este mesmo botão para o usuário.
      const isControlledNf = wb.SheetNames.some((sheetName) => {
        const sheet = wb.Sheets[sheetName]
        if (!sheet) return false
        const sample = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: false }).slice(0, 10)
        return sample.some((row) => {
          const cells = row.map((cell) => normalizeUnitName(String(cell ?? "")))
          return cells.some((cell) => cell.startsWith("FORNECEDOR"))
            && cells.some((cell) => cell.includes("DATA ENTRADA"))
            && cells.some((cell) => cell === "PRODUTO")
            && cells.some((cell) => cell.includes("VALOR TOTAL"))
        })
      })
      if (isControlledNf) {
        setStatus("uploading")
        const body = new FormData()
        body.append("file", f)
        body.append("commit", "true")
        const response = await fetch("/financeiro/api/financeiro/importacao-ork/preview", { method: "POST", body })
        const responseText = await response.text()
        let result: { error?: string; imported?: number; preview?: { records?: unknown[] } }
        try { result = JSON.parse(responseText) }
        catch { throw new Error(`O servidor respondeu em formato inválido (HTTP ${response.status}).`) }
        if (!response.ok) throw new Error(result.error ?? "Erro ao importar NF-e Entrada.")
        const imported = result.imported ?? result.preview?.records?.length ?? 0
        setTotalRows(imported)
        setImportedRows(imported)
        setProgress(100)
        setStatus("done")
        setTimeout(() => { onSuccess(); onClose() }, 1500)
        return
      }

      const allRows: ProdutoInsert[] = []
      const unknownUnits = new Set<string>()
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName]
        if (!sheet) continue
        const rawRows = parseSheet(sheet)
        for (const raw of rawRows) {
          const mapped = mapRow(raw, importUnits)
          if (mapped.row) allRows.push(mapped.row)
          if (mapped.unknownUnit) unknownUnits.add(mapped.unknownUnit)
        }
      }

      if (unknownUnits.size) {
        setErrorMsg(`Importação cancelada. Unidades não reconhecidas: ${[...unknownUnits].join(", ")}`)
        setStatus("error")
        return
      }

      if (allRows.length === 0) {
        setErrorMsg("Nenhuma linha válida encontrada no arquivo.")
        setStatus("error")
        return
      }

      setTotalRows(allRows.length)
      setStatus("uploading")
      const result = await substituirProdutosPlanilha(allRows)
      if (!result.ok) throw new Error(result.error ?? "Erro ao importar planilha.")
      setImportedRows(result.count)
      setProgress(100)

      setStatus("done")
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 1500)
    } catch (e) {
      setErrorMsg(String(e))
      setStatus("error")
    }
  }

  const busy = status === "parsing" || status === "uploading"

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 28,
        width: 480,
        maxWidth: "90vw",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
            Importar Produtos (.xlsx)
          </span>
          {!busy && (
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", fontSize: 18 }}
            >
              ✕
            </button>
          )}
        </div>

        {status === "idle" || status === "error" ? (
          <>
            <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 16, lineHeight: 1.5 }}>
              Selecione o arquivo de Relatório de Produtos. Todas as abas (Janeiro, Fevereiro…) serão lidas automaticamente.
            </p>

            <label
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                border: "2px dashed var(--border)", borderRadius: 8, padding: "24px 16px",
                cursor: "pointer", gap: 8, marginBottom: 16,
                background: fileName ? "var(--surface-2)" : "transparent",
              }}
            >
              <span style={{ fontSize: 28 }}>📂</span>
              <span style={{ fontSize: 13, color: "var(--text-3)" }}>
                {fileName ?? "Clique ou arraste o arquivo .xlsx"}
              </span>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
            </label>

            {errorMsg && (
              <div style={{
                background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 6, padding: "10px 14px", marginBottom: 16,
                fontSize: 13, color: "#f87171",
              }}>
                {errorMsg}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={onClose}
                style={{
                  padding: "8px 18px", borderRadius: 6, border: "1px solid var(--border)",
                  background: "transparent", color: "var(--text-3)", cursor: "pointer", fontSize: 13,
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={!fileName}
                style={{
                  padding: "8px 20px", borderRadius: 6, border: "none",
                  background: fileName ? "var(--brand)" : "var(--surface-2)",
                  color: fileName ? "#fff" : "var(--text-3)",
                  cursor: fileName ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600,
                }}
              >
                Importar
              </button>
            </div>
          </>
        ) : status === "parsing" ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-3)", fontSize: 14 }}>
            Lendo arquivo…
          </div>
        ) : status === "uploading" ? (
          <div style={{ padding: "8px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13, color: "var(--text-3)" }}>
              <span>Importando linhas…</span>
              <span>{importedRows} / {totalRows}</span>
            </div>
            <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%", background: "var(--brand)",
                width: `${progress}%`, transition: "width 0.3s ease",
              }} />
            </div>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 10, textAlign: "center" }}>
              {progress}% concluído
            </p>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
              {importedRows} linhas importadas
            </p>
            <p style={{ fontSize: 13, color: "var(--text-3)" }}>
              Página será atualizada automaticamente.
            </p>
          </div>
        )}
      </div>
    </div>
  , document.body)
}
