import * as XLSX from "xlsx"

export const text = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim()
export const normalized = (value: unknown): string => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()

export function money(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const raw = text(value).replace(/R\$/gi, "").replace(/\s/g, "").replace(/[^\d,.-]/g, "")
  if (!raw || raw === "-") return 0
  const comma = raw.lastIndexOf(",")
  const dot = raw.lastIndexOf(".")
  const parsed = comma >= 0 && dot >= 0
    ? Number(comma > dot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, ""))
    : comma >= 0 ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw)
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0
}

export function isoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear()
    return year >= 2000 && year <= 2100 ? value.toISOString().slice(0, 10) : null
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`
  }
  const match = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (!match) return null
  let year = Number(match[3]); if (year < 100) year += 2000
  const first = Number(match[1]), second = Number(match[2])
  // As planilhas são brasileiras. Datas textuais ambíguas são sempre DD/MM.
  if (first < 1 || first > 31 || second < 1 || second > 12) return null
  return `${year}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`
}

export function workbook(buffer: Buffer) {
  return XLSX.read(buffer, { type: "buffer", cellDates: true })
}

export function matrix(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true })
}
