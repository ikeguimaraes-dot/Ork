"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { formatBRL } from "@/lib/financeiro/utils"
import { createContaBancaria, updateSaldoInicial, type ContaBancaria } from "@/app/financeiro/fluxo/actions"

type Props = {
  unitId: string
  contas: ContaBancaria[]
}

function formatData(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function ContasBancariasPainel({ unitId, contas }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editando, setEditando] = useState<string | null>(null)
  const [cadastrando, setCadastrando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function salvarNovaConta(formData: FormData) {
    setErro(null)
    const banco = String(formData.get("banco") ?? "")
    const apelido = String(formData.get("apelido") ?? "")
    const saldoInicial = Number(formData.get("saldoInicial") ?? 0)
    const dataSaldoInicial = String(formData.get("dataSaldoInicial") ?? "")
    startTransition(async () => {
      const r = await createContaBancaria({ unitId, banco, apelido: apelido || null, saldoInicial, dataSaldoInicial })
      if (!r.ok) { setErro(r.error); return }
      setCadastrando(false)
      router.refresh()
    })
  }

  function salvarSaldo(contaId: string, formData: FormData) {
    setErro(null)
    const saldoInicial = Number(formData.get("saldoInicial") ?? 0)
    const dataSaldoInicial = String(formData.get("dataSaldoInicial") ?? "")
    startTransition(async () => {
      const r = await updateSaldoInicial(contaId, saldoInicial, dataSaldoInicial)
      if (!r.ok) { setErro(r.error); return }
      setEditando(null)
      router.refresh()
    })
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={sectionTitle}>Contas bancárias</h2>
        <button onClick={() => setCadastrando((v) => !v)} style={linkBtn}>
          {cadastrando ? "Cancelar" : "+ Cadastrar conta"}
        </button>
      </div>

      {erro && (
        <div style={{ padding: "8px 12px", marginBottom: 10, borderRadius: 8, border: "1px solid #EF4444", background: "rgba(239,68,68,0.08)", color: "#EF4444", fontSize: 12 }}>
          {erro}
        </div>
      )}

      {contas.length === 0 && !cadastrando && (
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
          Nenhuma conta bancária cadastrada para esta unidade.
        </p>
      )}

      {contas.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: cadastrando ? 12 : 0 }}>
          {contas.map((c) => (
            <div key={c.id} style={rowBox}>
              {editando === c.id ? (
                <form
                  action={(fd) => salvarSaldo(c.id, fd)}
                  style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 10, padding: "10px 14px" }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginRight: "auto" }}>
                    {c.apelido ?? c.banco}
                  </span>
                  <Field label="Saldo inicial">
                    <input name="saldoInicial" type="number" step="0.01" defaultValue={c.saldoInicial} style={inputStyle} />
                  </Field>
                  <Field label="Data do saldo">
                    <input name="dataSaldoInicial" type="date" defaultValue={c.dataSaldoInicial} style={inputStyle} />
                  </Field>
                  <button type="submit" disabled={pending} style={primaryBtn}>Salvar</button>
                  <button type="button" onClick={() => setEditando(null)} style={linkBtn}>Cancelar</button>
                </form>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px" }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{c.apelido ?? c.banco}</span>
                    {c.apelido && <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: 8 }}>{c.banco}</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                      {formatBRL(c.saldoInicial)} em {formatData(c.dataSaldoInicial)}
                    </span>
                    <button onClick={() => setEditando(c.id)} style={linkBtn}>Editar saldo</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {cadastrando && (
        <form action={salvarNovaConta} style={{ ...rowBox, display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 10, padding: "12px 14px" }}>
          <Field label="Banco *">
            <input name="banco" type="text" placeholder="Ex.: Itaú" required style={inputStyle} />
          </Field>
          <Field label="Apelido">
            <input name="apelido" type="text" placeholder="Opcional" style={inputStyle} />
          </Field>
          <Field label="Saldo inicial">
            <input name="saldoInicial" type="number" step="0.01" defaultValue={0} style={inputStyle} />
          </Field>
          <Field label="Data do saldo">
            <input name="dataSaldoInicial" type="date" required style={inputStyle} />
          </Field>
          <button type="submit" disabled={pending} style={primaryBtn}>Cadastrar</button>
        </form>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>
      {label}
      {children}
    </label>
  )
}

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "var(--text-3)",
  margin: 0,
}

const rowBox: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
}

const inputStyle: React.CSSProperties = {
  height: 30,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
  padding: "0 8px",
  fontSize: 12,
  minWidth: 120,
}

const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--brand, #D4A574)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
}

const primaryBtn: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 8,
  border: "none",
  background: "var(--brand, #D4A574)",
  color: "var(--primary-foreground, #1A1208)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
}
