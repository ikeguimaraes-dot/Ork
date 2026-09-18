import { formatBRL, competenciaLabel } from "@/lib/financeiro/utils"
import type { ResultadoFluxo } from "@/lib/financeiro/fluxo/calcularFluxo"

function pctFmt(v: number | null): string {
  if (v === null) return "—"
  return `${(v * 100).toFixed(0)}%`
}

export function ConfiancaIndex({ confianca }: { confianca: ResultadoFluxo["confianca"] }) {
  const semExtrato = confianca.pctDiasComExtrato === 0

  return (
    <div style={{ marginBottom: 8 }}>
      <h2 style={sectionTitle}>Índice de confiança</h2>

      {semExtrato && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 12,
            borderRadius: 10,
            border: "1px solid #F59E0B",
            background: "rgba(245,158,11,0.08)",
            color: "#F59E0B",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Saldo não confirmado — importe o extrato bancário.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <Item label="Títulos com vencimento preenchido" value={pctFmt(confianca.pctTitulosComVencimento)} />
        <Item label="Dias do período com extrato importado" value={pctFmt(confianca.pctDiasComExtrato)} />
        <Item label="Último extrato importado" value={confianca.dataUltimoExtrato ? formatData(confianca.dataUltimoExtrato) : "Nenhum"} />
        <Item
          label="Dias de venda sem detalhe de forma"
          value={`${confianca.diasSemDetalheForma} dia${confianca.diasSemDetalheForma === 1 ? "" : "s"} · ${formatBRL(confianca.valorSemDetalheForma)}`}
        />
        <Item
          label="Títulos sem confirmação de pagamento (indefinido)"
          value={`${formatBRL(confianca.valorIndefinido)} (${pctFmt(confianca.pctValorIndefinido)})`}
        />
        <Item
          label="Linhas de resumo ignoradas na importação de receita"
          value={`${confianca.diasSemDetalheForma} dia${confianca.diasSemDetalheForma === 1 ? "" : "s"} · ${formatBRL(confianca.valorSemDetalheForma)}`}
        />
      </div>

      {confianca.vencimentoPorCompetencia.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: "0 0 8px" }}>
            % de títulos com vencimento preenchido por competência — onde a planilha de origem está incompleta:
          </p>
          <div style={{ overflowX: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 420 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)", textAlign: "left" }}>
                  <th style={th}>Competência</th>
                  <th style={{ ...th, textAlign: "right" }}>Com vencimento</th>
                  <th style={{ ...th, textAlign: "right" }}>Total de títulos</th>
                  <th style={{ ...th, textAlign: "right" }}>%</th>
                </tr>
              </thead>
              <tbody>
                {confianca.vencimentoPorCompetencia.map((v) => (
                  <tr key={v.competencia} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>{v.competencia === "sem-competencia" ? "Sem competência" : competenciaLabel(v.competencia)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{v.comVencimento}</td>
                    <td style={{ ...td, textAlign: "right" }}>{v.total}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600, color: v.pct < 0.7 ? "#F59E0B" : "var(--text)" }}>
                      {(v.pct * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function formatData(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "10px 12px",
      }}
    >
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-3)", margin: "0 0 4px" }}>
        {label}
      </p>
      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: 0 }}>{value}</p>
    </div>
  )
}

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "var(--text-3)",
  margin: "0 0 10px",
}

const th: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
}

const td: React.CSSProperties = {
  padding: "7px 12px",
  color: "var(--text)",
  whiteSpace: "nowrap",
}
