import JSZip from "jszip"
import { workbook } from "./normalizers"
import { parseContasPagar, parseNfEntrada, parseReceita } from "./parsers"
import type { ImportWarning, OrkBatchPreview } from "./types"

function sourceKind(name: string): OrkBatchPreview["kind"] {
  const key = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
  return key.includes("NF ENTRADA") || key.includes("NF DE ENTRADA") || key.includes("NF PEDIDOS") ? "nf_entrada"
    : key.includes("CONTAS A PAGAR") ? "contas_pagar"
      : key.includes("RECEITA") || key.includes("FATURAMENTO") ? "receita"
        : key.includes("FOLHA") ? "folha" : "unknown"
}

function previewWorkbooks(kind: OrkBatchPreview["kind"], entries: Array<{ name: string; bytes: Buffer }>): OrkBatchPreview {
  const warnings: ImportWarning[] = []
  const records: Array<OrkBatchPreview["records"][number]> = []
  for (const entry of entries) {
    const wb = workbook(entry.bytes)
    if (kind === "nf_entrada") records.push(...parseNfEntrada(wb, entry.name, warnings))
    else if (kind === "contas_pagar") records.push(...parseContasPagar(wb, entry.name, warnings))
    else if (kind === "receita") records.push(...parseReceita(wb, entry.name, warnings))
    else warnings.push({ code: "UNSUPPORTED_ARCHIVE", message: "Layout do pacote não reconhecido.", file: entry.name })
  }
  const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
  const totals: Record<string, number> = { registros: records.length }
  if (kind === "nf_entrada") totals.valor = cents(records.reduce((sum, row) => sum + ("valorTotal" in row ? row.valorTotal : 0), 0))
  if (kind === "contas_pagar") totals.valor = cents(records.reduce((sum, row) => sum + ("valorParcela" in row ? row.valorParcela : 0), 0))
  if (kind === "receita") {
    totals.receitaBruta = cents(records.reduce((sum, row) => sum + ("receitaBruta" in row ? row.receitaBruta : 0), 0))
    totals.receitaLiquida = cents(records.reduce((sum, row) => sum + ("receitaLiquida" in row ? row.receitaLiquida : 0), 0))
    totals.taxaServico = cents(records.reduce((sum, row) => sum + ("taxaServico" in row ? row.taxaServico : 0), 0))
  }
  return { kind, files: entries.map((entry) => entry.name), records: records as OrkBatchPreview["records"], warnings, totals }
}

export function previewOrkSpreadsheet(name: string, bytes: Buffer): OrkBatchPreview {
  return previewWorkbooks(sourceKind(name), [{ name, bytes }])
}

export async function previewOrkArchive(name: string, bytes: Buffer): Promise<OrkBatchPreview> {
  const zip = await JSZip.loadAsync(bytes)
  const excelEntries = Object.values(zip.files).filter((entry) => !entry.dir && /\.xlsx?$/i.test(entry.name))
  const kind = sourceKind(name)
  if (!excelEntries.length) return { kind, files: [], records: [], warnings: [{ code: "EMPTY_ARCHIVE", message: "O ZIP não contém arquivos Excel para leitura." }], totals: {} }
  const entries = await Promise.all(excelEntries.map(async (entry) => ({ name: entry.name, bytes: await entry.async("nodebuffer") })))
  return previewWorkbooks(kind, entries)
}
