"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseContasAPagarWorkbook, parseNfPedidosWorkbook } from "@/lib/financeiro/importacao/compras/parseComprasXlsx";
import { importarNfPedidos, importarContasPagar, type ImportarComprasResultado } from "@/app/financeiro/pagar/compras-actions";

type Tipo = "nf_pedidos" | "contas_pagar";
type Status = "idle" | "lendo" | "enviando" | "concluido" | "erro";

type Props = { tipo: Tipo; unitIdBase: string; onClose: () => void; onSuccess: () => void };

const TITULO: Record<Tipo, string> = {
  nf_pedidos: "Importar NF_PEDIDOS",
  contas_pagar: "Importar Contas a Pagar",
};

export function ComprasImportModal({ tipo, unitIdBase, onClose, onSuccess }: Props) {
  const [ano, setAno] = useState(new Date().getFullYear());
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<ImportarComprasResultado | null>(null);
  const [linhasLidas, setLinhasLidas] = useState(0);
  const [abasLidas, setAbasLidas] = useState<string[]>([]);
  const [abasIgnoradas, setAbasIgnoradas] = useState<string[]>([]);

  async function processar(file: File) {
    setStatus("lendo");
    setError("");
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const { linhas, abasLidas: lidas, abasIgnoradas: ignoradas } = tipo === "nf_pedidos"
        ? parseNfPedidosWorkbook(buffer, ano)
        : parseContasAPagarWorkbook(buffer, ano);
      setLinhasLidas(linhas.length);
      setAbasLidas(lidas);
      setAbasIgnoradas(ignoradas);
      if (linhas.length === 0) {
        setError("Nenhuma linha de dado reconhecida no arquivo.");
        setStatus("erro");
        return;
      }

      setStatus("enviando");
      const batchSize = linhas.length;
      const acumulado: ImportarComprasResultado = { ok: true, inseridos: 0, roteadosOutraUnidade: 0, valorRoteadoOutraUnidade: 0 };
      for (let i = 0; i < linhas.length; i += batchSize) {
        const lote = linhas.slice(i, i + batchSize);
        const resposta = tipo === "nf_pedidos"
          ? await importarNfPedidos(lote, unitIdBase)
          : await importarContasPagar(lote, unitIdBase);
        if (!resposta.ok) { setError(resposta.error ?? "Falha na importação."); setStatus("erro"); return; }
        acumulado.inseridos += resposta.inseridos;
        acumulado.roteadosOutraUnidade += resposta.roteadosOutraUnidade;
        acumulado.valorRoteadoOutraUnidade += resposta.valorRoteadoOutraUnidade;
      }
      setResultado(acumulado);
      setStatus("concluido");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("erro");
    }
  }

  const busy = status === "lendo" || status === "enviando";
  const box: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, width: 560, maxWidth: "92vw" };
  const button: React.CSSProperties = { padding: "8px 16px", borderRadius: 7, border: "1px solid var(--border)", cursor: "pointer", fontSize: 13, fontWeight: 600 };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.62)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>{TITULO[tipo]}</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-3)" }}>Planilha .xlsx com abas MAIO/JUNHO/JULHO/AGOSTO</p>
          </div>
          {!busy && <button onClick={onClose} aria-label="Fechar" style={{ background: "none", border: 0, color: "var(--text-3)", cursor: "pointer", fontSize: 20 }}>×</button>}
        </div>

        {status === "idle" && (
          <label style={{ display: "grid", placeItems: "center", gap: 8, padding: 28, border: "2px dashed var(--border)", borderRadius: 10, cursor: "pointer" }}>
            <span style={{ fontSize: 30 }}>📊</span>
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>Selecionar planilha .xlsx</span>
            <label>Ano das abas mensais <input type="number" min="2020" max="2100" value={ano} onChange={e => setAno(Number(e.target.value))} /></label>
            <input ref={inputRef} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void processar(f); }} />
          </label>
        )}

        {status === "lendo" && <p style={{ padding: 30, textAlign: "center", color: "var(--text-3)" }}>Lendo {fileName}…</p>}
        {status === "enviando" && <p style={{ padding: 30, textAlign: "center", color: "var(--text-3)" }}>Gravando {linhasLidas} linhas…</p>}

        {error && <div style={{ padding: "9px 12px", marginTop: 12, borderRadius: 7, background: "rgba(239,68,68,.1)", color: "#ef4444", fontSize: 12 }}>{error}</div>}

        {(abasLidas.length > 0 || abasIgnoradas.length > 0) && (
          <div style={{ padding: "9px 12px", marginTop: 12, borderRadius: 7, background: "var(--surface-2)", fontSize: 12, color: "var(--text-2)" }}>
            <div>Abas lidas: {abasLidas.length > 0 ? abasLidas.map((a) => `"${a}"`).join(", ") : "nenhuma"}</div>
            {abasIgnoradas.length > 0 && (
              <div style={{ marginTop: 4, color: "#f59e0b" }}>
                Abas ignoradas (nome não reconhecido): {abasIgnoradas.map((a) => `"${a}"`).join(", ")}
              </div>
            )}
          </div>
        )}

        {status === "concluido" && resultado && (
          <div style={{ padding: "12px 0" }}>
            <h3 style={{ color: "#22c55e", margin: "0 0 8px" }}>Importação concluída</h3>
            <p style={{ fontSize: 13, color: "var(--text-2)" }}>{resultado.inseridos} títulos importados</p>
            {resultado.roteadosOutraUnidade > 0 && (
              <p style={{ fontSize: 12, color: "#f59e0b", marginTop: 6 }}>
                {resultado.roteadosOutraUnidade} linha{resultado.roteadosOutraUnidade !== 1 ? "s" : ""} roteada{resultado.roteadosOutraUnidade !== 1 ? "s" : ""} para outra unidade conforme configuração — R${resultado.valorRoteadoOutraUnidade.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          {status === "concluido" ? (
            <button onClick={() => { onSuccess(); onClose(); }} style={{ ...button, background: "var(--brand)", color: "white", border: 0 }}>Concluir</button>
          ) : (
            <button disabled={busy} onClick={onClose} style={{ ...button, background: "transparent", color: "var(--text-2)" }}>Cancelar</button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
