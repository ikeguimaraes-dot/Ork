"use client"

import { useRef, useState } from "react"
import { createPortal } from "react-dom"
import JSZip from "jszip"
import { importNfe, type NfeImportResult } from "@/app/financeiro/dre/cmv/actions"
import { inferDirection, parseNfeXml, type NfeDirection, type ParsedNfe } from "@/lib/nfe/parser"

type Props = { direction: NfeDirection; onClose: () => void; onSuccess: () => void }
type Status = "idle" | "reading" | "ready" | "uploading" | "done" | "error"

export function NfeImportModal({ direction: fixedDirection, onClose, onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [fileName, setFileName] = useState("")
  const [notes, setNotes] = useState<ParsedNfe[]>([])
  const [rejected, setRejected] = useState(0)
  const direction = fixedDirection
  const [error, setError] = useState("")
  const [result, setResult] = useState<NfeImportResult | null>(null)

  async function readZip(file: File) {
    setStatus("reading"); setError(""); setFileName(file.name)
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer())
      const xmlFiles = Object.values(zip.files).filter(entry => !entry.dir && entry.name.toLowerCase().endsWith(".xml"))
      if (!xmlFiles.length) throw new Error("O ZIP não contém arquivos XML.")
      const parsed: ParsedNfe[] = []
      let invalid = 0
      for (const entry of xmlFiles) {
        try { parsed.push(parseNfeXml(await entry.async("string"), entry.name)) }
        catch { invalid++ }
      }
      if (!parsed.length) throw new Error("Nenhum XML de NF-e válido foi encontrado.")
      const inferred = inferDirection(parsed)
      if (inferred && inferred !== fixedDirection) {
        throw new Error(`Este pacote parece ser de ${inferred === "entrada" ? "entrada" : "saída"}. Envie-o na página correta.`)
      }
      setNotes(parsed); setRejected(invalid); setStatus("ready")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setStatus("error")
    }
  }

  async function submit() {
    if (!direction) { setError("Confirme se o pacote é de entrada ou de saída."); return }
    setStatus("uploading"); setError("")
    // Mantém cada Server Action pequena: pacotes de saída podem ter milhares de XMLs.
    const aggregate: NfeImportResult = { ok: true, importadas: 0, duplicadas: 0, canceladas: 0, itens: 0, naoImportadas: 0, cnpjsDesconhecidos: [], produtosCriados: 0, vinculosCriados: 0 }
    const cnpjMap = new Map<string, { nome: string | null; notas: number; valor: number }>()
    const batchSize = 75
    for (let i = 0; i < notes.length; i += batchSize) {
      const response = await importNfe({
        arquivo: fileName,
        direcao: direction,
        notas: notes.slice(i, i + batchSize),
        rejeitadas: i === 0 ? rejected : 0,
      })
      if (!response.ok) { setError(response.error ?? "Falha na importação."); setStatus("error"); return }
      aggregate.importadas += response.importadas
      aggregate.duplicadas += response.duplicadas
      aggregate.canceladas += response.canceladas
      aggregate.itens += response.itens
      aggregate.naoImportadas += response.naoImportadas
      aggregate.produtosCriados += response.produtosCriados
      aggregate.vinculosCriados += response.vinculosCriados
      for (const item of response.cnpjsDesconhecidos) {
        const acc = cnpjMap.get(item.cnpj) ?? { nome: item.nome, notas: 0, valor: 0 }
        acc.notas += item.notas
        acc.valor += item.valor
        if (!acc.nome && item.nome) acc.nome = item.nome
        cnpjMap.set(item.cnpj, acc)
      }
    }
    aggregate.cnpjsDesconhecidos = [...cnpjMap.entries()].map(([cnpj, v]) => ({ cnpj, ...v }))
    setResult(aggregate); setStatus("done")
  }

  const active = notes.filter(note => !note.cancelada)
  const total = active.reduce((sum, note) => sum + note.valorTotal, 0)
  const busy = status === "reading" || status === "uploading"
  const box: React.CSSProperties = { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:12, padding:24, width:560, maxWidth:"92vw" }
  const button: React.CSSProperties = { padding:"8px 16px", borderRadius:7, border:"1px solid var(--border)", cursor:"pointer", fontSize:13, fontWeight:600 }

  return createPortal(<div style={{ position:"fixed", inset:0, zIndex:1000, background:"rgba(0,0,0,.62)", display:"flex", alignItems:"center", justifyContent:"center" }} onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <div style={box}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div><h2 style={{ margin:0, fontSize:18 }}>Importar NF-e</h2><p style={{ margin:"4px 0 0", fontSize:12, color:"var(--text-3)" }}>Pacote ZIP com XMLs de entrada ou saída</p></div>
        {!busy && <button onClick={onClose} aria-label="Fechar" style={{ background:"none", border:0, color:"var(--text-3)", cursor:"pointer", fontSize:20 }}>×</button>}
      </div>

      {(status === "idle" || status === "error") && notes.length === 0 && <label style={{ display:"grid", placeItems:"center", gap:8, padding:28, border:"2px dashed var(--border)", borderRadius:10, cursor:"pointer" }}>
        <span style={{ fontSize:30 }}>📦</span><span style={{ fontSize:13, color:"var(--text-2)" }}>{fileName || "Selecionar pacote .zip"}</span>
        <input ref={inputRef} type="file" accept=".zip,application/zip" hidden onChange={e => { const file=e.target.files?.[0]; if(file) void readZip(file) }} />
      </label>}

      {status === "reading" && <p style={{ padding:30, textAlign:"center", color:"var(--text-3)" }}>Lendo e validando os XMLs…</p>}

      {(status === "ready" || status === "error") && notes.length > 0 && <>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:16 }}>
          {[["XMLs", notes.length], ["Válidas", active.length], ["Canceladas", notes.length-active.length], ["Total", total.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})]].map(([label,value]) => <div key={String(label)} style={{ padding:10, background:"var(--surface-2)", borderRadius:8 }}><div style={{ fontSize:9, color:"var(--text-3)", textTransform:"uppercase", fontWeight:700 }}>{label}</div><div style={{ fontSize:14, fontWeight:700, marginTop:3 }}>{value}</div></div>)}
        </div>
        <div style={{ padding:9, borderRadius:7, border:"1px solid var(--border)", background:"var(--surface-2)", fontSize:12 }}>
          {direction === "entrada" ? "Entrada — compras recebidas" : "Saída — vendas emitidas"}
        </div>
        <p style={{ fontSize:11, lineHeight:1.5, color:"var(--text-3)" }}>{direction === "entrada" ? "As notas válidas alimentarão o relatório de compras/CMV. Itens entram como “NF-e sem classificação” para revisão." : direction === "saida" ? "As notas serão registradas para auditoria e não serão somadas ao CMV." : "O sistema tentou detectar automaticamente; confirme antes de importar."}</p>
      </>}

      {error && <div style={{ padding:"9px 12px", marginTop:12, borderRadius:7, background:"rgba(239,68,68,.1)", color:"#ef4444", fontSize:12 }}>{error}</div>}
      {status === "uploading" && <p style={{ padding:28, textAlign:"center", color:"var(--text-3)" }}>Salvando notas e atualizando o CMV…</p>}
      {status === "done" && result && <div style={{ padding:"12px 0" }}>
        <h3 style={{ color:"#22c55e", margin:"0 0 8px" }}>Importação concluída</h3>
        <p style={{ fontSize:13, color:"var(--text-2)" }}>{result.importadas} notas importadas · {result.itens} itens · {result.duplicadas} duplicadas ignoradas · {result.canceladas} canceladas{result.naoImportadas > 0 ? ` · ${result.naoImportadas} não importadas` : ""}</p>
        {(result.produtosCriados > 0 || result.vinculosCriados > 0) && (
          <p style={{ fontSize:12, color:"var(--text-3)", marginTop: 4 }}>
            Catálogo: {result.produtosCriados} produto{result.produtosCriados !== 1 ? "s" : ""} novo{result.produtosCriados !== 1 ? "s" : ""} · {result.vinculosCriados} item{result.vinculosCriados !== 1 ? "s" : ""} vinculado{result.vinculosCriados !== 1 ? "s" : ""}
          </p>
        )}
        {result.cnpjsDesconhecidos.length > 0 && (
          <div style={{ marginTop:12, padding:"10px 12px", borderRadius:7, background:"rgba(245,158,11,.12)", color:"#f59e0b", fontSize:12 }}>
            <p style={{ margin:"0 0 6px", fontWeight:700 }}>CNPJ(s) sem unidade cadastrada</p>
            <ul style={{ margin:0, paddingLeft:18, display:"grid", gap:4 }}>
              {result.cnpjsDesconhecidos.map(c => (
                <li key={c.cnpj}>
                  {c.cnpj}{c.nome ? ` — ${c.nome}` : ""}: {c.notas} nota{c.notas !== 1 ? "s" : ""} ignorada{c.notas !== 1 ? "s" : ""} ({c.valor.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})})
                </li>
              ))}
            </ul>
            <p style={{ margin:"8px 0 0" }}>Cadastre a unidade com este CNPJ e reimporte o pacote.</p>
          </div>
        )}
      </div>}

      <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:18 }}>
        {status === "done" ? <button onClick={() => { onSuccess(); onClose() }} style={{ ...button, background:"var(--brand)", color:"white", border:0 }}>Concluir</button> : <><button disabled={busy} onClick={onClose} style={{ ...button, background:"transparent", color:"var(--text-2)" }}>Cancelar</button>{notes.length > 0 && <button disabled={busy || !direction} onClick={() => void submit()} style={{ ...button, background:direction?"var(--brand)":"var(--surface-2)", color:direction?"white":"var(--text-3)", border:0 }}>Importar NF-e</button>}</>}
      </div>
    </div>
  </div>, document.body)
}
