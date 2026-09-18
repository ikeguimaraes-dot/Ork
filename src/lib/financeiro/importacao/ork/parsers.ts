import type * as XLSX from "xlsx"
import { isoDate, matrix, money, normalized, text } from "./normalizers"
import type { ContaPagarRow, ImportWarning, NfEntradaRow, ReceitaCaixaRow } from "./types"

export function parseNfEntrada(wb: XLSX.WorkBook, file: string, warnings: ImportWarning[]): NfEntradaRow[] {
  const result: NfEntradaRow[] = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]; if (!sheet) continue
    const rows = matrix(sheet)
    const validDates = rows.map((row) => isoDate(row[1])).filter((date): date is string => !!date)
    const year = validDates[0]?.slice(0, 4)
    const months: Record<string, string> = { JANEIRO: "01", FEVEREIRO: "02", MARCO: "03", ABRIL: "04", MAIO: "05", JUNHO: "06",
      JULHO: "07", AGOSTO: "08", SETEMBRO: "09", OUTUBRO: "10", NOVEMBRO: "11", DEZEMBRO: "12" }
    const sheetMonth = months[normalized(sheetName)]
    const dateFromLabel = (value: unknown) => {
      if (!year) return null
      if (value instanceof Date && !Number.isNaN(value.getTime()) && value.getUTCFullYear() > 2100) {
        return `${String(value.getUTCFullYear()).slice(0, 4)}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`
      }
      const label = normalized(value)
      if (months[label]) return `${year}-${months[label]}-01`
      const range = label.match(/\d{1,2}\/\d{1,2}\s*A\s*(\d{1,2})\/(\d{1,2})/)
      const endDay = range?.[1], endMonth = range?.[2]
      return endDay && endMonth ? `${year}-${endMonth.padStart(2, "0")}-${endDay.padStart(2, "0")}` : null
    }
    for (const [index, row] of rows.entries()) {
      const fornecedor = text(row[0]), dataEntrada = isoDate(row[1]) ?? dateFromLabel(row[1]), produto = text(row[3])
      if (!fornecedor || !dataEntrada || !produto || normalized(fornecedor) === "FORNECEDOR") continue
      const valorTotal = money(row[4])
      if (valorTotal <= 0) {
        warnings.push({ code: "NF_WITHOUT_VALUE", message: "Entrada ignorada por não possuir valor positivo.", file, sheet: sheetName, row: index + 1 })
        continue
      }
      const competencia = year && sheetMonth ? `${year}-${sheetMonth}-01` : `${dataEntrada.slice(0, 7)}-01`
      result.push({ file, sheet: sheetName, row: index + 1, fornecedor, dataEntrada, competencia, numeroNf: text(row[2]) || null,
        produto, valorTotal, observacao: text(row[5]) || null, desconto: money(row[6]), pedido: text(row[7]) || null })
    }
  }
  return result
}

export function parseContasPagar(wb: XLSX.WorkBook, file: string, warnings: ImportWarning[]): ContaPagarRow[] {
  const result: ContaPagarRow[] = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]; if (!sheet) continue
    const rows = matrix(sheet)
    const years = rows.map((row) => isoDate(row[6])?.slice(0, 4)).filter((year): year is string => !!year)
    const year = [...new Set(years)].sort((a, b) => years.filter((value) => value === b).length - years.filter((value) => value === a).length)[0]
    const monthNames: Record<string, string> = { JANEIRO: "01", FEVEREIRO: "02", MARCO: "03", ABRIL: "04", MAIO: "05", JUNHO: "06",
      JULHO: "07", AGOSTO: "08", SETEMBRO: "09", OUTUBRO: "10", NOVEMBRO: "11", DEZEMBRO: "12" }
    const sheetMonth = monthNames[normalized(sheetName)]
    for (const [index, row] of rows.entries()) {
      const fornecedorInformado = text(row[0]), vencimento = isoDate(row[6])
      if (!vencimento || normalized(fornecedorInformado).startsWith("FORNECEDOR")) continue
      const valorParcela = money(row[7])
      if (valorParcela <= 0) {
        warnings.push({ code: "PAYABLE_WITHOUT_VALUE", message: "Conta ignorada por não possuir valor de parcela positivo.", file, sheet: sheetName, row: index + 1 })
        continue
      }
      const fornecedor = fornecedorInformado || "NÃO INFORMADO"
      if (!fornecedorInformado) {
        warnings.push({ code: "PAYABLE_WITHOUT_SUPPLIER", message: "Conta importada com fornecedor NÃO INFORMADO.", file, sheet: sheetName, row: index + 1 })
      }
      result.push({ file, sheet: sheetName, row: index + 1, fornecedor, dataEntrada: isoDate(row[1]), numeroNf: text(row[2]) || null,
        categoria: text(row[3]) || null, valorTotalNf: money(row[4]), parcela: text(row[5]) || null,
        vencimento, competencia: year && sheetMonth ? `${year}-${sheetMonth}-01` : `${vencimento.slice(0, 7)}-01`,
        valorParcela, liquidacao: text(row[8]) || null })
    }
  }
  return result
}

function shift(value: unknown): ReceitaCaixaRow["turno"] {
  const key = normalized(value)
  if (key.includes("ALMOCO")) return "almoco"
  if (key.includes("JANT")) return "jantar"
  return "nao_informado"
}

function expectedPeriod(file: string): string | null {
  const key = normalized(file)
  const months: Array<[string, string]> = [["JANEIRO", "01"], ["FEVEREIRO", "02"], ["MARCO", "03"], ["ABRIL", "04"],
    ["MAIO", "05"], ["JUNHO", "06"], ["JULHO", "07"], ["AGOSTO", "08"], ["SETEMBRO", "09"], ["OUTUBRO", "10"],
    ["NOVEMBRO", "11"], ["DEZEMBRO", "12"]]
  const month = months.find(([name]) => key.includes(name))?.[1]
  const year = key.match(/20\d{2}/)?.[0]
  return month && year ? `${year}-${month}` : null
}

export function parseReceita(wb: XLSX.WorkBook, file: string, warnings: ImportWarning[]): ReceitaCaixaRow[] {
  const result: ReceitaCaixaRow[] = []
  const period = expectedPeriod(file)
  for (const sheetName of wb.SheetNames.filter((name) => normalized(name) !== "RESUMO")) {
    const sheet = wb.Sheets[sheetName]; if (!sheet) continue
    const rows = matrix(sheet)
    const isShiftStart = (index: number) => !!isoDate(rows[index]?.[0]) && shift(rows[index + 1]?.[0]) !== "nao_informado"
    for (let start = 0; start < rows.length; start++) {
      if (!isShiftStart(start)) continue
      let data = isoDate(rows[start]?.[0]); if (!data) continue
      let end = start + 1
      while (end < rows.length && !isShiftStart(end)) end++
      const block = rows.slice(start, end)
      const turno = shift(block[1]?.[0])
      if (period && !data.startsWith(period)) {
        const corrected = `${period}-${data.slice(-2)}`
        const parsed = new Date(`${corrected}T12:00:00Z`)
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== corrected) {
          warnings.push({ code: "INVALID_DATE_FOR_PERIOD", message: `Data ${data} não pode ser ajustada para a competência ${period}; turno ignorado.`, file, sheet: sheetName, row: start + 1 })
          start = end - 1
          continue
        }
        warnings.push({ code: "DATE_PERIOD_CORRECTED", message: `Competência da data corrigida de ${data} para ${corrected} conforme o nome do arquivo.`, file, sheet: sheetName, row: start + 1 })
        data = corrected
      }
      const total = (label: RegExp) => {
        const row = block.find((item) => label.test(normalized(item[3])))
        return row ? money(row[2]) : 0
      }
      const serviceRow = block.find((item) => /TOTAL VENDA S\/ EXTRAS/.test(normalized(item[3])))
      const pagamentos = block
        .filter((item) => /^VENDA /.test(normalized(item[1])) && money(item[2]) !== 0)
        .map((item) => ({ descricao: text(item[1]), valor: money(item[2]) }))
      const receitaBruta = total(/^TOTAL GERAL VENDA \(COM DELIVERY\)$/)
      const receitaLiquida = total(/^TOTAL VENDA \(FAT\. \+ DELIVERY\)$/)
      if (!receitaBruta && !receitaLiquida) {
        warnings.push({ code: "REVENUE_WITHOUT_TOTAL", message: "Turno ignorado porque os totais não foram encontrados.", file, sheet: sheetName, row: start + 1 })
        start = end - 1
        continue
      }
      const sistemaIndex = block.findIndex((item) => normalized(item[0]) === "SISTEMA")
      const clientes = sistemaIndex >= 0 ? Number(text(block[sistemaIndex + 1]?.[0]).replace(/\D/g, "")) || null : null
      result.push({ file, sheet: sheetName, row: start + 1, data, turno, clientes,
        receitaBruta, receitaLiquida, taxaServico: money(serviceRow?.[4]), taxaColaborador: money(serviceRow?.[5]),
        taxaCasa: money(serviceRow?.[6]), taxaTerceiro: money(serviceRow?.[7]), pagamentos })
      start = end - 1
    }
  }
  return result
}
