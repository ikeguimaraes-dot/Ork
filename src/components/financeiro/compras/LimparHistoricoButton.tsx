"use client";

import { useState } from "react";
import { limparHistoricoTitulos } from "@/app/financeiro/pagar/compras-actions";

// Botão separado do fluxo de importação (GATE 2, FASE 7) — apaga as
// ~2.000 linhas de origem='PLANILHA ORK' (export de ERP de origem
// desconhecida). Autorizado pelo Ike, mas é uma ação destrutiva e
// irreversível: confirmação dupla antes de chamar a action.
export function LimparHistoricoButton({ onSuccess }: { onSuccess: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  async function confirmar() {
    setProcessando(true);
    setResultado(null);
    try {
      const r = await limparHistoricoTitulos();
      if (!r.ok) { setResultado({ ok: false, texto: r.error ?? "Falha ao limpar histórico." }); return; }
      setResultado({ ok: true, texto: `${r.removidos} linhas removidas.` });
      onSuccess();
    } finally {
      setProcessando(false);
      setConfirmando(false);
    }
  }

  return (
    <div style={{ border: "1px solid #ef4444", borderRadius: 10, padding: "14px 16px", background: "rgba(239,68,68,.06)" }}>
      <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "#ef4444" }}>Zona de risco</p>
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-3)" }}>
        Remove as ~2.000 linhas antigas de <code>titulos_a_pagar</code> (origem &quot;PLANILHA ORK&quot;,
        de fonte desconhecida) — irreversível. Faça isso só depois de importar NF_PEDIDOS e Contas a
        Pagar, pra poder comparar antes de apagar.
      </p>
      {!confirmando ? (
        <button
          onClick={() => setConfirmando(true)}
          style={{ padding: "8px 16px", borderRadius: 7, border: "1px solid #ef4444", background: "transparent", color: "#ef4444", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >
          Limpar histórico de títulos
        </button>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text)" }}>Confirma a remoção definitiva?</span>
          <button
            disabled={processando}
            onClick={() => void confirmar()}
            style={{ padding: "7px 14px", borderRadius: 7, border: 0, background: "#ef4444", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            {processando ? "Removendo…" : "Sim, remover"}
          </button>
          <button
            disabled={processando}
            onClick={() => setConfirmando(false)}
            style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text-2)", fontSize: 12, cursor: "pointer" }}
          >
            Cancelar
          </button>
        </div>
      )}
      {resultado && (
        <p style={{ marginTop: 10, fontSize: 12, color: resultado.ok ? "#22c55e" : "#ef4444" }}>{resultado.texto}</p>
      )}
    </div>
  );
}
