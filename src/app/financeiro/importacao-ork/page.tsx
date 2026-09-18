"use client"

import { useState } from "react"
import { useUnit } from "@ork/auth/context"
import type { OrkBatchPreview } from "@/lib/financeiro/importacao/ork/types"

type Result = { name: string; file: File; preview?: OrkBatchPreview; error?: string; imported?: string }
const labels: Record<OrkBatchPreview["kind"], string> = { nf_entrada: "Notas de entrada", contas_pagar: "Contas a pagar", receita: "Receita", folha: "Folha de pagamento", unknown: "Desconhecido" }
const brl = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
const API_BASE = process.env.NEXT_PUBLIC_FINANCEIRO_URL ?? ""

export default function ImportacaoOrkPage() {
  const { unit } = useUnit()
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  async function analyze(files: FileList | null) {
    if (!files?.length) return
    setLoading(true); setResults([])
    const next: Result[] = []
    for (const file of Array.from(files)) {
      try {
        const body = new FormData(); body.append("file", file)
        const response = await fetch(`${API_BASE}/api/financeiro/importacao-ork/preview`, { method: "POST", body })
        const json = await response.json()
        if (!response.ok) throw new Error(json.error ?? "Falha ao analisar arquivo")
        next.push({ name: file.name, file, preview: json })
      } catch (error) { next.push({ name: file.name, file, error: error instanceof Error ? error.message : String(error) }) }
      setResults([...next])
    }
    setLoading(false)
  }
  async function commit(result: Result, replaceExisting = false) {
    if (!unit || !result.preview) return
    setLoading(true)
    try {
      const body = new FormData(); body.append("file", result.file); body.append("commit", "true")
      if (replaceExisting) body.append("replace_existing", "true")
      const response = await fetch(`${API_BASE}/api/financeiro/importacao-ork/preview`, { method: "POST", body })
      const json = await response.json()
      if (response.status === 409 && !replaceExisting) {
        if (window.confirm(`${json.error}\n\nDeseja substituir os registros existentes nessas datas?`)) return commit(result, true)
        return
      }
      if (!response.ok) throw new Error(json.error ?? "Falha ao importar pacote")
      setResults((current) => current.map((item) => item.name === result.name ? { ...item, imported: json.duplicate ? "Arquivo já havia sido importado." : `${json.imported.toLocaleString("pt-BR")} registros importados.` } : item))
    } catch (error) {
      setResults((current) => current.map((item) => item.name === result.name ? { ...item, error: error instanceof Error ? error.message : String(error) } : item))
    } finally { setLoading(false) }
  }
  return <div className="mx-auto max-w-6xl space-y-6">
    <div><p className="text-xs uppercase tracking-widest text-gray-500">Financeiro · importação controlada</p><h1 className="mt-1 text-2xl font-semibold text-gray-100">Importar pacotes Ork</h1><p className="mt-2 text-sm text-gray-400">Unidade selecionada: <span className="font-medium text-gray-200">{unit?.name ?? "nenhuma"}</span>. A análise não altera o banco.</p></div>
    <label className="block cursor-pointer rounded-xl border border-dashed border-gray-700 bg-gray-900/50 p-10 text-center hover:border-purple-500"><span className="text-sm font-medium text-gray-200">{loading ? "Analisando os arquivos…" : "Selecione arquivos ZIP ou Excel"}</span><span className="mt-2 block text-xs text-gray-500">Receita, NF Entrada, Contas a Pagar e Folha de Pagamento</span><input className="hidden" type="file" accept=".zip,.xlsx,application/zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple disabled={loading} onChange={(event) => analyze(event.target.files)} /></label>
    <div className="grid gap-4 md:grid-cols-2">{results.map((result) => <section key={result.name} className="rounded-xl border border-gray-800 bg-gray-900 p-5"><h2 className="break-all text-sm font-semibold text-gray-100">{result.name}</h2>{result.error && <p className="mt-3 text-sm text-red-400">{result.error}</p>}{result.preview && <><div className="mt-3 flex items-center justify-between"><span className="text-sm text-purple-300">{labels[result.preview.kind]}</span><span className="text-sm text-gray-300">{result.preview.records.length.toLocaleString("pt-BR")} registros</span></div><div className="mt-3 space-y-1 text-xs text-gray-400">{Object.entries(result.preview.totals).filter(([key]) => key !== "registros").map(([key, value]) => <div className="flex justify-between" key={key}><span>{key}</span><span className="text-gray-200">{brl(value)}</span></div>)}</div>{result.preview.warnings.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-xs text-amber-400">{result.preview.warnings.length} aviso(s) para revisar</summary><ul className="mt-2 max-h-44 space-y-1 overflow-auto text-xs text-gray-400">{result.preview.warnings.slice(0, 100).map((warning, index) => <li key={index}>• {warning.sheet ? `${warning.sheet}, linha ${warning.row}: ` : ""}{warning.message}</li>)}</ul></details>}{result.imported ? <p className="mt-4 text-sm text-emerald-400">{result.imported}</p> : <button type="button" disabled={loading || !unit || !result.preview.records.length || result.preview.kind === "folha"} onClick={() => commit(result)} className="mt-4 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">Confirmar na unidade {unit?.name ?? ""}</button>}</>}</section>)}</div>
  </div>
}
