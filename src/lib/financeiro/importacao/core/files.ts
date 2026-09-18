import { createHash } from "node:crypto"
import type { BufferedImportFile, ImportSourceFormat } from "./types"
import { ImportError } from "./errors"

const FORMAT_BY_EXTENSION: Record<string, ImportSourceFormat> = {
  pdf: "pdf",
  xlsx: "xlsx",
  xls: "xls",
  csv: "csv",
}

export function detectSourceFormat(fileName: string): ImportSourceFormat | null {
  const extension = fileName.toLowerCase().split(".").pop() ?? ""
  return FORMAT_BY_EXTENSION[extension] ?? null
}

export async function bufferImportFile(file: File): Promise<BufferedImportFile> {
  const format = detectSourceFormat(file.name)
  if (!format) {
    throw new ImportError(`Formato nao suportado: ${file.name}`, 400, "UNSUPPORTED_FORMAT")
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  return {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    format,
    bytes,
  }
}
