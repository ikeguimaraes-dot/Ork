export type ImportSourceFormat = "pdf" | "xlsx" | "xls" | "csv"

export type ImportWarning = {
  code: string
  message: string
  fileName?: string
}

export type ImportSourceFile = {
  name: string
  mimeType: string
  size: number
  checksum: string
}

export type ImportDocument<TDocumentType extends string, TPayload> = {
  schemaVersion: 1
  documentType: TDocumentType
  sourceFormat: ImportSourceFormat
  unitId: string
  competence: string
  sourceFiles: ImportSourceFile[]
  payload: TPayload
  warnings: ImportWarning[]
}

export type BufferedImportFile = ImportSourceFile & {
  format: ImportSourceFormat
  bytes: Uint8Array
}
