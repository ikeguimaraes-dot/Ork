"use client"

import { useEffect, useState } from "react"
import { gerarCatalogoAutomatico, getCatalogoGerado, limparCatalogo } from "@/app/financeiro/dre/cmv/actions"
import type { GerarCatalogoResultado, CatalogoItem } from "@/app/financeiro/dre/cmv/actions"

export function CatalogoTab() {
  const [itens, setItens] = useState<CatalogoItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [gerando, setGerando] = useState(false)
  const [limpando, setLimpando] = useState(false)
  const [resultado, setResultado] = useState<GerarCatalogoResultado | null>(null)
  const [erro, setErro] = useState("")

  async function carregar() {
    setLoading(true)
    const r = await getCatalogoGerado()
    setItens(r)
    setLoading(false)
  }

  useEffect(() => { let active = true; getCatalogoGerado().then(r => { if (active) { setItens(r); setLoading(false) } }).catch(e => { if (active) { setErro(String(e)); setLoading(false) } }); return () => { active = false } }, [])

  async function handleGerar() {
    setGerando(true); setErro(""); setResultado(null)
    const r = await gerarCatalogoAutomatico()
    setGerando(false)
    if (!r.ok) { setErro(r.error ?? "Falha ao gerar catálogo."); return }
    setResultado(r)
    await carregar()
  }

  async function handleLimpar() {
    if (!window.confirm("Isso apaga TODO o catálogo gerado e todos os vínculos. produtos_relatorio não é afetado. Confirmar?")) return
    setLimpando(true); setErro(""); setResultado(null)
    const r = await limparCatalogo()
    setLimpando(false)
    if (!r.ok) { setErro(r.error ?? "Falha ao limpar catálogo."); return }
    await carregar()
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: 0 }}>
            Catálogo de produtos
          </p>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: "2px 0 0" }}>
            Já é gerado automaticamente a cada importação de NF-e. Use o botão só como manutenção
            — pra reprocessar todo o histórico depois de mudar uma regra de agrupamento, por exemplo.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={gerando || limpando} onClick={() => void handleLimpar()} style={{
            padding: "9px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: "var(--surface-2)", color: "#ef4444", border: "1px solid var(--border)",
            cursor: (gerando || limpando) ? "default" : "pointer", whiteSpace: "nowrap",
          }}>
            {limpando ? "Limpando…" : "Limpar catálogo"}
          </button>
          <button disabled={gerando || limpando} onClick={() => void handleGerar()} style={{
            padding: "9px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: "var(--brand, #C4622D)", color: "var(--primary-foreground)", border: "none",
            cursor: (gerando || limpando) ? "default" : "pointer", whiteSpace: "nowrap",
          }}>
            {gerando ? "Reprocessando…" : "Reprocessar catálogo completo"}
          </button>
        </div>
      </div>

      {erro && (
        <div style={{ padding: "9px 12px", borderRadius: 7, background: "rgba(239,68,68,.1)",
          color: "#ef4444", fontSize: 12 }}>
          {erro}
        </div>
      )}
      {resultado && (
        <div style={{ padding: "9px 12px", borderRadius: 7, background: "rgba(34,197,94,.1)",
          color: "#22c55e", fontSize: 12 }}>
          {resultado.linhasLidas.toLocaleString("pt-BR")} linhas lidas · {resultado.itensDistintos.toLocaleString("pt-BR")} itens distintos · {resultado.produtosCriados} produto{resultado.produtosCriados !== 1 ? "s" : ""} criado{resultado.produtosCriados !== 1 ? "s" : ""} · {resultado.vinculosCriados} vínculo{resultado.vinculosCriados !== 1 ? "s" : ""} criado{resultado.vinculosCriados !== 1 ? "s" : ""}
          {(resultado.excluidosPorNcm > 0 || resultado.excluidosPorCategoria > 0) && (
            <> · {resultado.excluidosPorNcm} ignorado{resultado.excluidosPorNcm !== 1 ? "s" : ""} por NCM fora da faixa alimentar · {resultado.excluidosPorCategoria} ignorado{resultado.excluidosPorCategoria !== 1 ? "s" : ""} por categoria não-produto</>
          )}
        </div>
      )}

      {loading ? (
        <p style={{ padding: "24px 0", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
          Carregando catálogo…
        </p>
      ) : !itens || itens.length === 0 ? (
        <div style={{ padding: "48px 24px", textAlign: "center",
          background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14 }}>
          <p style={{ fontSize: 14, color: "var(--text-3)", margin: 0 }}>
            Catálogo vazio. Importe uma NF-e de entrada ou clique em &ldquo;Reprocessar catálogo completo&rdquo;.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12,
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)" }}>
                {["Código", "Nome", "NCM", "Unidade", "Itens vinculados", "Status"].map((h, i) => (
                  <th key={h} style={{
                    padding: "8px 12px", textAlign: i > 3 ? "right" : "left",
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
                    color: "var(--text-3)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itens.map(p => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--border)", opacity: p.ativo ? 1 : 0.5 }}>
                  <td style={{ padding: "7px 12px", fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>
                    {p.codigo}
                  </td>
                  <td style={{ padding: "7px 12px", color: "var(--text)" }}>{p.nome}</td>
                  <td style={{ padding: "7px 12px", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                    {p.ncm ?? "—"}
                  </td>
                  <td style={{ padding: "7px 12px", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                    {p.unidadePadrao ?? "—"}
                  </td>
                  <td style={{ padding: "7px 12px", textAlign: "right", color: "var(--text)" }}>
                    {p.itensVinculados}
                  </td>
                  <td style={{ padding: "7px 12px", textAlign: "right" }}>
                    {p.ativo
                      ? <span style={{ fontSize:10,fontWeight:700,color:"#22C55E",background:"rgba(34,197,94,0.12)",padding:"2px 8px",borderRadius:99 }}>ATIVO</span>
                      : <span style={{ fontSize:10,color:"var(--text-3)" }}>MESCLADO</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
