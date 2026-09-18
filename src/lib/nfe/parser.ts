import { XMLParser } from "fast-xml-parser"

export type NfeDirection = "entrada" | "saida"

export type NfeItem = {
  codigo: string | null
  descricao: string | null
  ncm: string | null
  cfop: string | null
  unidade: string | null
  quantidade: number | null
  valorUnitario: number | null
  valorTotal: number | null
}

export type ParsedNfe = {
  arquivo: string
  chave: string
  numero: string | null
  serie: string | null
  emissao: string
  emitenteCnpj: string | null
  emitenteNome: string | null
  destinatarioCnpj: string | null
  destinatarioNome: string | null
  valorTotal: number
  statusSefaz: string | null
  cancelada: boolean
  itens: NfeItem[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
})

const str = (value: unknown): string | null => {
  if (value === undefined || value === null || value === "") return null
  return String(value).trim()
}

const num = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const digits = (value: unknown): string | null => {
  const result = str(value)?.replace(/\D/g, "") ?? ""
  return result || null
}

// Lê tanto nfeProc (NF-e autorizada) quanto NFe isolada.
export function parseNfeXml(xml: string, arquivo: string): ParsedNfe {
  const root = parser.parse(xml)
  const nfe = root?.nfeProc?.NFe ?? root?.NFe
  const inf = nfe?.infNFe
  if (!inf?.ide || !inf?.emit) throw new Error("XML não contém uma NF-e válida")

  const protocolo = root?.nfeProc?.protNFe?.infProt
  const status = str(protocolo?.cStat)
  const id = str(inf?.["@_Id"])
  const chave = digits(protocolo?.chNFe) ?? digits(id?.replace(/^NFe/i, ""))
  if (!chave || chave.length !== 44) throw new Error("Chave de acesso da NF-e não encontrada")

  const det = Array.isArray(inf.det) ? inf.det : inf.det ? [inf.det] : []
  const emissao = str(inf.ide.dhEmi ?? inf.ide.dEmi)
  if (!emissao) throw new Error("Data de emissão não encontrada")

  return {
    arquivo,
    chave,
    numero: str(inf.ide.nNF),
    serie: str(inf.ide.serie),
    emissao,
    emitenteCnpj: digits(inf.emit.CNPJ ?? inf.emit.CPF),
    emitenteNome: str(inf.emit.xFant ?? inf.emit.xNome),
    destinatarioCnpj: digits(inf.dest?.CNPJ ?? inf.dest?.CPF),
    destinatarioNome: str(inf.dest?.xNome),
    valorTotal: num(inf.total?.ICMSTot?.vNF) ?? 0,
    statusSefaz: status,
    cancelada: status === "101" || status === "135" || status === "155",
    itens: det.map((entry: Record<string, unknown>) => {
      const prod = (entry.prod ?? {}) as Record<string, unknown>
      return {
        codigo: str(prod.cProd),
        descricao: str(prod.xProd),
        ncm: str(prod.NCM),
        cfop: str(prod.CFOP),
        unidade: str(prod.uCom),
        quantidade: num(prod.qCom),
        valorUnitario: num(prod.vUnCom),
        valorTotal: num(prod.vProd),
      }
    }),
  }
}

export function inferDirection(notes: ParsedNfe[]): NfeDirection | null {
  const active = notes.filter(note => !note.cancelada)
  if (!active.length) return null
  const threshold = Math.max(2, Math.ceil(active.length * 0.7))
  const mostFrequent = (values: Array<string | null>) => {
    const counts = new Map<string, number>()
    for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
    return Math.max(0, ...counts.values())
  }
  if (mostFrequent(active.map(note => note.emitenteCnpj)) >= threshold) return "saida"
  if (mostFrequent(active.map(note => note.destinatarioCnpj)) >= threshold) return "entrada"
  return null
}
