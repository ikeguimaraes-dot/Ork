"use client";

import { useState } from "react";
import { DominioImportModal } from "@/components/financeiro/folha/DominioImportModal";

export default function ImportarExtratoDominioPage() {
  const [aberto, setAberto] = useState(false);

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Importar Extrato Domínio</h1>
      <p style={{ fontSize: 13, color: "var(--text-3)", margin: "0 0 20px" }}>
        Envie o PDF &quot;EXTRATO MENSAL&quot; do Domínio. A unidade é resolvida automaticamente
        pelo CNPJ da empresa dentro do PDF (nunca por seleção manual) — CNPJs sem
        unidade de folha cadastrada em <code>unit_cnpjs</code> são reportados e ignorados,
        sem gravação parcial.
      </p>
      <button
        onClick={() => setAberto(true)}
        style={{ padding: "10px 18px", borderRadius: 8, border: 0, background: "var(--brand)", color: "white", fontWeight: 600, cursor: "pointer" }}
      >
        Importar PDF(s)
      </button>
      {aberto && (
        <DominioImportModal onClose={() => setAberto(false)} onSuccess={() => setAberto(false)} />
      )}
    </div>
  );
}
