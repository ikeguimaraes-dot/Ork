import {
  CATEGORIA_DESPESA_LABELS,
  CATEGORIA_RECEITA_LABELS,
} from "@/lib/financeiro/labels";
import {
  formatBRL,
  formatPct,
  getGapSeverity,
  type Severity,
} from "@/lib/financeiro/utils";
import { SeverityBadge } from "./SeverityBadge";
import type {
  CategoriaDespesa,
  CategoriaReceita,
  GapProjecaoRealizadoRow,
} from "@ork/db/types/database";

type Props = {
  rows: GapProjecaoRealizadoRow[];
};

const SEMAFORO: Record<Severity, string> = {
  ok: "🟢",
  atencao: "🟡",
  critico: "🔴",
};

function categoriaLabel(row: GapProjecaoRealizadoRow): string {
  if (!row.categoria) return "—";
  if (row.natureza === "receita") {
    return (
      CATEGORIA_RECEITA_LABELS[row.categoria as CategoriaReceita] ?? row.categoria
    );
  }
  if (row.natureza === "despesa") {
    return (
      CATEGORIA_DESPESA_LABELS[row.categoria as CategoriaDespesa] ?? row.categoria
    );
  }
  return row.categoria;
}

/**
 * Tabela de gap projeção × realizado com semáforo por linha. Linhas com
 * |gap| > 10% ganham fundo vermelho-suave de destaque.
 */
export function GapTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: "20px 24px",
          fontSize: 12,
          color: "var(--text-3)",
          fontStyle: "italic",
          background: "var(--surface)",
          border: "1px dashed var(--border)",
          borderRadius: 12,
        }}
      >
        Nenhuma projeção cadastrada para esse período.
      </div>
    );
  }

  return (
    <div
      style={{
        overflowX: "auto",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
      }}
    >
      <table
        style={{
          width: "100%",
          fontSize: 12,
          borderCollapse: "collapse",
          minWidth: 720,
        }}
      >
        <thead>
          <tr
            style={{
              color: "var(--text-3)",
              fontWeight: 600,
              textAlign: "left",
              background: "var(--surface-2)",
            }}
          >
            <Th>Categoria</Th>
            <Th>Tipo</Th>
            <Th align="right">Projetado</Th>
            <Th align="right">Realizado</Th>
            <Th align="right">Gap R$</Th>
            <Th align="right">Gap %</Th>
            <Th align="center">Semáforo</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const sev = getGapSeverity(r.gap_pct);
            const isCritical = sev === "critico";
            return (
              <tr
                key={`${r.period_id}:${r.categoria}:${idx}`}
                style={{
                  background: isCritical ? "rgba(239,68,68,0.06)" : undefined,
                }}
              >
                <Td>
                  {categoriaLabel(r)}
                  {r.is_evento && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: 0.4,
                        textTransform: "uppercase",
                        padding: "1px 6px",
                        borderRadius: 99,
                        background: "var(--brand-soft)",
                        color: "var(--brand)",
                      }}
                    >
                      Evento
                    </span>
                  )}
                </Td>
                <Td>{r.natureza === "receita" ? "Receita" : r.natureza === "despesa" ? "Despesa" : "—"}</Td>
                <Td align="right">{formatBRL(r.valor_projetado)}</Td>
                <Td align="right">{formatBRL(r.valor_realizado)}</Td>
                <Td align="right">{formatBRL(r.gap_absoluto)}</Td>
                <Td align="right">
                  <SeverityBadge severity={sev}>{formatPct(r.gap_pct)}</SeverityBadge>
                </Td>
                <Td align="center">
                  <span aria-label={sev} title={sev}>
                    {SEMAFORO[sev]}
                  </span>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "8px 12px",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "8px 12px",
        fontSize: 12,
        color: "var(--text)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {children}
    </td>
  );
}
