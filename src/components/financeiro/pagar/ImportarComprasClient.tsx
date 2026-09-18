"use client";

import { useState } from "react";
import Link from "next/link";
import { ComprasImportModal } from "@/components/financeiro/compras/ComprasImportModal";
import { LimparHistoricoButton } from "@/components/financeiro/compras/LimparHistoricoButton";

import { useAuth } from "@ork/auth/context";

type Props = { unitIdInicial: string };

// Diferente das telas de leitura: aqui a unidade é o DESTINO de um upload,
// não "o que estou vendo" — subir o arquivo de uma unidade diferente da
// que está ativa no shell é uma necessidade legítima (ex.: revisando o
// dashboard da Restaurante e precisa importar o arquivo da UNIDADE). Por isso
// mantém o seletor, só pré-selecionado conforme o shell em vez de sempre
// abrir na Restaurante.
export function ImportarComprasClient({ unitIdInicial }: Props) {
  const { units } = useAuth();
  const UNIDADES = units.map(u => ({ id: u.id, nome: u.name }));
  const [unitIdBase, setUnitIdBase] = useState<string>(unitIdInicial);
  const [modalAberto, setModalAberto] = useState<"nf_pedidos" | "contas_pagar" | null>(null);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <nav style={{ display: "flex", gap: 16, marginBottom: 14, fontSize: 13 }}>
        <Link href="/financeiro/pagar" style={{ color: "var(--text-3)", textDecoration: "none" }}>Contas a pagar</Link>
        <span style={{ color: "var(--text-3)" }}>/</span>
        <span style={{ color: "var(--text)", fontWeight: 600 }}>Importar compras</span>
      </nav>

      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--text)", letterSpacing: -0.5, margin: "0 0 4px" }}>
          Importar NF_PEDIDOS e Contas a Pagar
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-2)", maxWidth: 600, margin: 0 }}>
          A unidade abaixo é a &quot;unidade base&quot; do arquivo — vale pra toda a planilha, exceto
          linhas que correspondam a uma regra de roteamento configurada para outra unidade.
        </p>
      </header>

      <div style={{ display: "grid", gap: 20 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-3)", display: "block", marginBottom: 6 }}>
            Unidade base do arquivo
          </label>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: "0 0 8px" }}>
            Pré-selecionada conforme a unidade ativa no shell — troque aqui só se este upload específico
            for de outra unidade.
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            {UNIDADES.map((u) => (
              <button
                key={u.id}
                onClick={() => setUnitIdBase(u.id)}
                style={{
                  padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: u.id === unitIdBase ? 700 : 500,
                  background: u.id === unitIdBase ? "var(--brand, #C4622D)" : "var(--surface-2)",
                  color: u.id === unitIdBase ? "var(--primary-foreground)" : "var(--text-3)",
                  border: "1px solid var(--border)", cursor: "pointer",
                }}
              >
                {u.nome}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            onClick={() => setModalAberto("nf_pedidos")}
            style={{ padding: "10px 18px", borderRadius: 8, border: 0, background: "var(--brand)", color: "white", fontWeight: 600, cursor: "pointer" }}
          >
            Importar NF_PEDIDOS
          </button>
          <button
            onClick={() => setModalAberto("contas_pagar")}
            style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontWeight: 600, cursor: "pointer" }}
          >
            Importar Contas a Pagar
          </button>
        </div>

        <LimparHistoricoButton onSuccess={() => { /* nada a recarregar nesta página */ }} />
      </div>

      {modalAberto && (
        <ComprasImportModal
          tipo={modalAberto}
          unitIdBase={unitIdBase}
          onClose={() => setModalAberto(null)}
          onSuccess={() => setModalAberto(null)}
        />
      )}
    </div>
  );
}
