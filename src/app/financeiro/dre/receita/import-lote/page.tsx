"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useUnit } from "@ork/auth/context";

const API_BASE = "/financeiro";

// ── Color tokens (mesmos de /financeiro/dre/receita) ────────────────────────
const C = {
  receita:  "#34d399",
  meta:     "#fbbf24",
  alerta:   "#f87171",
  neutro:   "#8A8278",
  text:     "var(--text, #F5F0E8)",
  text2:    "var(--text-2, #C8C2B8)",
  text3:    "var(--text-3, #8A8278)",
  surface:  "var(--surface, #1A1A18)",
  surface2: "var(--surface-2, #222220)",
  surface3: "var(--surface-3, #2C2C2A)",
  border:   "var(--border, rgba(245,240,232,0.08))",
  brand:    "var(--brand, #C4622D)",
} as const;

const fmtDateBR = (iso: string) => iso.split("-").reverse().join("/");

function csvEscape(v: string): string {
  if (/[;"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function baixarCsv(filename: string, header: string[], rows: string[][]) {
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type Fase = "selecao" | "processando" | "concluido";

// ── Página ────────────────────────────────────────────────────────────────────
// Dois formatos de import em lote do histórico Lorean: PDF (via Anthropic, mesma
// rota do import diário) e XLSX (parsing por regex, sem chamar IA — mais rápido
// e mais barato quando a planilha está disponível).
export default function ImportLotePage() {
  const { unit, units } = useUnit();
  const [selectedUnitId, setSelectedUnitId] = useState<string>(unit?.id ?? units[0]?.id ?? "");
  const [formato, setFormato] = useState<"pdf" | "xlsx">("xlsx");

  const unitLabel = units.find((u) => u.id === selectedUnitId)?.name ?? "—";

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <Link href="/financeiro/dre/receita" style={{
        fontSize: 11, color: C.text3, textDecoration: "none", fontWeight: 600,
        letterSpacing: 0.6, textTransform: "uppercase",
      }}>
        ← Receita
      </Link>

      <header style={{ margin: "10px 0 24px" }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: C.text, letterSpacing: -0.5, margin: "0 0 4px" }}>
          Importar em Lote
        </h1>
        <p style={{ fontSize: 13, color: C.text3, margin: 0 }}>
          Importa histórico de múltiplos dias do Lorean de uma vez.
        </p>
      </header>

      {/* ── Unidade + formato ── */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: C.text3, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 }}>
            Unidade
          </label>
          <select
            value={selectedUnitId}
            onChange={(e) => setSelectedUnitId(e.target.value)}
            style={{
              padding: "8px 12px", borderRadius: 8, fontSize: 13, fontWeight: 500,
              background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
              cursor: "pointer", minWidth: 240,
            }}
          >
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: C.text3, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 }}>
            Formato
          </label>
          <div style={{ display: "flex", borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            {([["xlsx", "Excel (sem IA)"], ["pdf", "PDF"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setFormato(v)} style={{
                padding: "8px 16px", fontSize: 12, fontWeight: formato === v ? 700 : 500,
                background: formato === v ? C.brand : C.surface2,
                color: formato === v ? "#fff" : C.text3,
                border: "none", cursor: "pointer", whiteSpace: "nowrap",
              }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {formato === "xlsx"
        ? <ImportLoteXlsx selectedUnitId={selectedUnitId} unitLabel={unitLabel} />
        : <ImportLotePdf selectedUnitId={selectedUnitId} unitLabel={unitLabel} />}
    </div>
  );
}

// ── Sub-components compartilhados ────────────────────────────────────────────
function Chip({ label, color }: { label: string; color?: string }) {
  return (
    <span style={{
      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: C.surface3, color: color ?? C.text2, border: `1px solid ${C.border}`,
    }}>
      {label}
    </span>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{ height: 8, background: C.surface3, borderRadius: 4, overflow: "hidden" }}>
      <div style={{
        height: "100%", width: `${pct}%`, background: C.brand,
        borderRadius: 4, transition: "width 300ms ease-out",
      }} />
    </div>
  );
}

function Dropzone({ label, sub, accept, onFiles }: {
  label: string; sub: string; accept: string; onFiles: (list: FileList) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputId = `dropzone-${accept.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
      onClick={() => document.getElementById(inputId)?.click()}
      style={{
        border: `2px dashed ${dragOver ? C.brand : C.border}`, borderRadius: 14,
        padding: "48px 24px", textAlign: "center", cursor: "pointer",
        background: dragOver ? "rgba(196,98,45,0.08)" : C.surface,
        transition: "border-color 150ms ease, background 150ms ease",
        marginBottom: 16,
      }}
    >
      <p style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>{label}</p>
      <p style={{ fontSize: 12, color: C.text3, margin: 0 }}>{sub}</p>
      <input
        id={inputId} type="file" accept={accept} multiple
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── XLSX: import direto, sem IA, via /api/receita/import-xlsx ──────────────────
// ══════════════════════════════════════════════════════════════════════════════

type ProcessState = "pendente" | "processando" | "sucesso" | "erro";

type XlsxTipo = "movimento" | "venda" | "faturamento";

type ParsedXlsxFile = {
  file: File;
  key: string;
  data: string | null;   // YYYY-MM-DD extraído do nome — Venda normalmente não tem
  tipo: XlsxTipo | null; // detectado pelo nome — mesma lógica da API (detectTipo)
  loreanCode: string | null;
};

type XlsxStatus = { state: ProcessState; mensagem?: string; resumo?: Record<string, unknown> };

function parseXlsxFilename(file: File): ParsedXlsxFile {
  const name = file.name;
  const dateMatch = name.match(/\[(\d{2})\.(\d{2})\.(\d{2})\]/);
  const codeMatch = name.match(/LOREAN\s*\[(\d+)\]/i);
  const lower = name.toLowerCase();
  const tipo: XlsxTipo | null =
    lower.includes("movimento") ? "movimento" :
    lower.includes("faturamento") ? "faturamento" :
    lower.includes("venda") ? "venda" : null;
  const periodMatch = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\s+(20\d{2})/i);
  const monthNumber: Record<string, string> = { JANEIRO: "01", FEVEREIRO: "02", MARCO: "03", ABRIL: "04", MAIO: "05", JUNHO: "06", JULHO: "07", AGOSTO: "08", SETEMBRO: "09", OUTUBRO: "10", NOVEMBRO: "11", DEZEMBRO: "12" };
  return {
    file,
    key: `${name}::${file.size}`,
    data: dateMatch ? `20${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : periodMatch ? `${periodMatch[2]}-${monthNumber[periodMatch[1]!.toUpperCase()]}-01` : null,
    tipo,
    loreanCode: codeMatch ? codeMatch[1]! : null,
  };
}

// 1 arquivo por chamada. Se for uma Venda cujo Movimento ainda não foi
// importado, a API responde com erro ("Workday não encontrado") — esperado
// e aceitável: o arquivo fica marcado como erro no relatório, sem travar o lote.
async function enviarArquivoXlsx(
  file: File, unitId: string, tipo: XlsxTipo,
): Promise<{ resumo?: Record<string, unknown> }> {
  const fd = new FormData();
  if (tipo === "faturamento") {
    fd.append("file", file);
    fd.append("commit", "true");
    const res = await fetch(`${API_BASE}/api/financeiro/importacao-ork/preview`, { method: "POST", body: fd });
    const json = await res.json().catch(() => null) as { error?: string; imported?: number; preview?: { totals?: Record<string, number> } } | null;
    if (!res.ok || !json) throw new Error(json?.error ?? `HTTP ${res.status}`);
    return { resumo: { registros: json.imported, ...json.preview?.totals } };
  }
  fd.append("unit_id", unitId);
  fd.append("arquivos", file);
  const res = await fetch(`${API_BASE}/api/receita/import-xlsx`, { method: "POST", body: fd });
  let json: { processados: number; erros: string[]; detalhes: Array<{ arquivo: string; tipo: string | null; sucesso: boolean; erro?: string; resumo?: Record<string, unknown> }> };
  try { json = await res.json(); }
  catch (e) { throw new Error(`resposta inválida: ${String(e)}`); }
  const d = json.detalhes?.[0];
  if (!res.ok || !d || !d.sucesso) {
    throw new Error(d?.erro ?? json.erros?.[0] ?? `HTTP ${res.status}`);
  }
  return { resumo: d.resumo };
}

function ImportLoteXlsx({ selectedUnitId, unitLabel }: { selectedUnitId: string; unitLabel: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [ignoredMsg, setIgnoredMsg] = useState<string | null>(null);
  const [fase, setFase] = useState<Fase>("selecao");
  const [progressLabel, setProgressLabel] = useState("");
  const [status, setStatus] = useState<Record<string, XlsxStatus>>({}); // keyed por file.key

  function addFiles(list: FileList) {
    const arr = Array.from(list);
    const xlsxs = arr.filter((f) => f.name.toLowerCase().endsWith(".xlsx"));
    const ignored = arr.length - xlsxs.length;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}::${f.size}`));
      const merged = [...prev];
      for (const f of xlsxs) {
        const k = `${f.name}::${f.size}`;
        if (!seen.has(k)) { seen.add(k); merged.push(f); }
      }
      return merged;
    });
    setIgnoredMsg(ignored > 0 ? `${ignored} arquivo(s) ignorado(s) (não são .xlsx)` : null);
  }

  function limparSelecao() {
    setFiles([]); setIgnoredMsg(null); setFase("selecao"); setStatus({}); setProgressLabel("");
  }

  // Cada arquivo é uma linha independente — sem agrupar por dia/workday.
  const parsed = useMemo(
    () => files.map(parseXlsxFilename).sort((a, b) => (a.data ?? "").localeCompare(b.data ?? "")),
    [files],
  );
  const reconhecidos = parsed.filter((f) => f.tipo != null);
  const naoReconhecidos = parsed.filter((f) => f.tipo == null);

  const codigosDetectados = useMemo(
    () => [...new Set(parsed.map((f) => f.loreanCode).filter((c): c is string => !!c))],
    [parsed],
  );

  async function iniciarImportacao() {
    if (!selectedUnitId || reconhecidos.length === 0) return;
    setFase("processando");
    setStatus({});
    for (let i = 0; i < reconhecidos.length; i++) {
      const f = reconhecidos[i]!;
      setProgressLabel(`Processando ${i + 1}/${reconhecidos.length} — ${unitLabel} ${f.file.name}…`);
      setStatus((prev) => ({ ...prev, [f.key]: { state: "processando" } }));
      try {
        const res = await enviarArquivoXlsx(f.file, selectedUnitId, f.tipo!);
        setStatus((prev) => ({ ...prev, [f.key]: { state: "sucesso", resumo: res.resumo } }));
      } catch (e) {
        setStatus((prev) => ({ ...prev, [f.key]: { state: "erro", mensagem: String(e instanceof Error ? e.message : e) } }));
        // não interrompe — segue pro próximo arquivo (ex: Venda antes do Movimento — reimporta depois)
      }
    }
    setProgressLabel("");
    setFase("concluido");
  }

  const totalSucesso = Object.values(status).filter((s) => s.state === "sucesso").length;
  const totalErro = Object.values(status).filter((s) => s.state === "erro").length;
  const errosLista = reconhecidos.filter((f) => status[f.key]?.state === "erro");
  const progressoPct = reconhecidos.length > 0
    ? (Object.values(status).filter((s) => s.state === "sucesso" || s.state === "erro").length / reconhecidos.length) * 100
    : 0;
  const processando = fase === "processando";

  function baixarRelatorio() {
    const header = ["Arquivo", "Tipo", "Data", "Status", "Mensagem"];
    const rows = parsed.map((f) => {
      const st = status[f.key];
      const statusLabel =
        st?.state === "sucesso" ? "Sucesso" :
        st?.state === "erro" ? "Erro" :
        st?.state === "processando" ? "Processando" :
        f.tipo ? "Não processado" : "Tipo não reconhecido (pulado)";
      return [
        f.file.name, f.tipo === "movimento" ? "Movimento" : f.tipo === "venda" ? "Venda" : f.tipo === "faturamento" ? "Faturamento Ork" : "—",
        f.data ? fmtDateBR(f.data) : "—", statusLabel, st?.mensagem ?? "",
      ];
    });
    baixarCsv(`import-lote-xlsx-${unitLabel.replace(/\s+/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
  }

  return (
    <>
      {fase === "selecao" && (
        <Dropzone
          label="Arraste os arquivos Excel (.xlsx) aqui"
          sub="Movimento e Venda do Lorean ou Faturamento Ork — sem chamar IA"
          accept=".xlsx"
          onFiles={addFiles}
        />
      )}

      {ignoredMsg && <p style={{ fontSize: 12, color: C.meta, marginTop: -8, marginBottom: 16 }}>⚠ {ignoredMsg}</p>}

      {files.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Chip label={`${files.length} arquivo${files.length !== 1 ? "s" : ""}`} />
              <Chip label={`${reconhecidos.length} pronto${reconhecidos.length !== 1 ? "s" : ""}`} color={C.receita} />
              {naoReconhecidos.length > 0 && <Chip label={`${naoReconhecidos.length} não reconhecido(s)`} color={C.alerta} />}
            </div>
            {fase === "selecao" && (
              <button onClick={limparSelecao} style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: "transparent", color: C.text3, border: `1px solid ${C.border}`, cursor: "pointer",
              }}>
                Limpar seleção
              </button>
            )}
          </div>

          {codigosDetectados.length > 1 && (
            <div style={{
              padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 12,
              background: "rgba(251,191,36,0.08)", color: C.meta, border: "1px solid rgba(251,191,36,0.25)",
            }}>
              ⚠ Códigos Lorean distintos detectados nos arquivos: {codigosDetectados.map((c) => `[${c}]`).join(", ")}
              {" "}— confira se todos os arquivos são realmente da unidade selecionada ({unitLabel}).
            </div>
          )}

          <div style={{
            padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 12,
            background: "rgba(96,165,250,0.08)", color: C.text2, border: "1px solid rgba(96,165,250,0.2)",
          }}>
            ℹ Cada arquivo é importado independentemente. Se uma Venda vier antes do Movimento do mesmo dia,
            ela falha com &quot;Workday não encontrado&quot; — reimporte só ela depois de importar o Movimento correspondente.
          </div>

          {naoReconhecidos.length > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: C.alerta, margin: "0 0 8px" }}>
                Arquivos sem tipo reconhecível no nome (esperado &quot;Movimento&quot;, &quot;Venda&quot; ou &quot;Faturamento&quot;) — não serão processados
              </p>
              {naoReconhecidos.map((f) => (
                <p key={f.key} style={{ fontSize: 12, color: C.text3, margin: "2px 0" }}>{f.file.name}</p>
              ))}
            </div>
          )}

          <div style={{ overflowX: "auto", marginBottom: 20 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <thead>
                <tr style={{ background: C.surface2 }}>
                  {["Arquivo", "Tipo", "Data", "Status"].map((h, i) => (
                    <th key={h} style={{
                      padding: "8px 12px", textAlign: i === 0 ? "left" : i === 3 ? "right" : "left",
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                      color: C.text3, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.map((f) => {
                  const live = status[f.key];
                  const cell =
                    live?.state === "processando" ? { label: "⏳ processando", color: C.meta } :
                    live?.state === "sucesso"     ? { label: "✓ sucesso", color: C.receita } :
                    live?.state === "erro"        ? { label: "✗ erro", color: C.alerta } :
                    f.tipo                        ? { label: "pronto", color: C.receita } :
                                                     { label: "não reconhecido", color: C.alerta };
                  return (
                    <tr key={f.key} style={{ borderTop: `1px solid ${C.border}` }} title={live?.mensagem}>
                      <td style={{ padding: "8px 12px", color: C.text2, maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file.name}</td>
                      <td style={{ padding: "8px 12px", color: C.text2, whiteSpace: "nowrap" }}>
                        {f.tipo === "movimento" ? "Movimento" : f.tipo === "venda" ? "Venda" : f.tipo === "faturamento" ? "Faturamento Ork" : "—"}
                      </td>
                      <td style={{ padding: "8px 12px", color: C.text2, whiteSpace: "nowrap" }}>{f.data ? fmtDateBR(f.data) : "—"}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: cell.color }}>{cell.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {fase === "selecao" && (
            <button
              onClick={iniciarImportacao}
              disabled={reconhecidos.length === 0 || !selectedUnitId}
              style={{
                padding: "10px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: reconhecidos.length === 0 ? C.surface3 : C.brand,
                color: reconhecidos.length === 0 ? C.text3 : "#fff",
                border: "none", cursor: reconhecidos.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              Importar tudo {reconhecidos.length > 0 ? `(${reconhecidos.length} arquivo${reconhecidos.length !== 1 ? "s" : ""})` : ""}
            </button>
          )}

          {processando && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: C.text2, marginBottom: 8 }}>⏳ {progressLabel}</p>
              <ProgressBar pct={progressoPct} />
            </div>
          )}

          {fase === "concluido" && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "18px 20px" }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: "0 0 10px" }}>
                Concluído — {totalSucesso} arquivo{totalSucesso !== 1 ? "s" : ""} importado{totalSucesso !== 1 ? "s" : ""} com sucesso
                {totalErro > 0 && `, ${totalErro} com erro`}
              </p>

              {errosLista.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: C.alerta, margin: "0 0 6px" }}>Arquivos com erro:</p>
                  {errosLista.map((f) => (
                    <p key={f.key} style={{ fontSize: 12, color: C.text2, margin: "3px 0" }}>
                      <strong>{f.file.name}</strong> — {status[f.key]?.mensagem}
                    </p>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={baixarRelatorio} style={{
                  padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: C.surface3, color: C.text, border: `1px solid ${C.border}`, cursor: "pointer",
                }}>
                  Baixar relatório (CSV)
                </button>
                <button onClick={limparSelecao} style={{
                  padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: C.brand, color: "#fff", border: "none", cursor: "pointer",
                }}>
                  Nova importação
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── PDF: import via Anthropic, mesma rota do import diário ────────────────────
// ══════════════════════════════════════════════════════════════════════════════

type Tipo = "movimento" | "venda" | "caixa";

type ParsedFile = {
  file: File;
  key: string;              // nome+tamanho, p/ dedupe
  loreanCode: string | null;
  data: string | null;      // YYYY-MM-DD (null se não extraível do nome — comum em Caixa)
  tipo: Tipo | null;
};

// Regex idêntica à extractDateFromFilename de /api/receita/import — garante que
// o agrupamento client-side bate com a data que a API vai gravar no banco.
function parseFilename(file: File): ParsedFile {
  const name = file.name;
  const codeMatch = name.match(/LOREAN\s*\[(\d+)\]/i);
  const dateMatch = name.match(/\[(\d{2})\.(\d{2})\.(\d{2})\]/);
  const lower = name.toLowerCase();
  const tipo: Tipo | null =
    lower.includes("movimento") ? "movimento" :
    lower.includes("venda")     ? "venda" :
    lower.includes("caixa")     ? "caixa" : null;
  return {
    file,
    key: `${name}::${file.size}`,
    loreanCode: codeMatch ? codeMatch[1]! : null,
    data: dateMatch ? `20${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null,
    tipo,
  };
}

type Pacote = {
  data: string; // YYYY-MM-DD
  movimento: ParsedFile | null;
  venda: ParsedFile | null;
  caixas: ParsedFile[];
  codigos: Set<string>;
  status: "pronto" | "incompleto";
};

type PacoteStatus = { state: ProcessState; mensagem?: string };

// Chamada individual à API (1 PDF por request, mesmo contrato do import diário).
async function enviarArquivo(
  file: File, tipo: Tipo, unitId: string, workdayId: string | null,
): Promise<string | null> {
  const fd = new FormData();
  fd.append("tipo", tipo); fd.append("arquivo", file); fd.append("unit_id", unitId);
  if (workdayId) fd.append("workday_id", workdayId);
  const res = await fetch(`${API_BASE}/api/receita/import`, { method: "POST", body: fd });
  let json: { success: boolean; workday_id?: string | null; errors?: string[] };
  try { json = await res.json(); }
  catch (e) { throw new Error(`resposta inválida: ${String(e)}`); }
  if (!res.ok || !json.success) {
    throw new Error(json.errors?.length ? json.errors.join(" | ") : `HTTP ${res.status}`);
  }
  return json.workday_id ?? null;
}

function ImportLotePdf({ selectedUnitId, unitLabel }: { selectedUnitId: string; unitLabel: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [ignoredMsg, setIgnoredMsg] = useState<string | null>(null);
  const [caixaAssignments, setCaixaAssignments] = useState<Record<string, string>>({});
  const [fase, setFase] = useState<Fase>("selecao");
  const [progressLabel, setProgressLabel] = useState("");
  const [pacoteStatus, setPacoteStatus] = useState<Record<string, PacoteStatus>>({});

  function addFiles(list: FileList) {
    const arr = Array.from(list);
    const pdfs = arr.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    const ignored = arr.length - pdfs.length;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}::${f.size}`));
      const merged = [...prev];
      for (const f of pdfs) {
        const k = `${f.name}::${f.size}`;
        if (!seen.has(k)) { seen.add(k); merged.push(f); }
      }
      return merged;
    });
    setIgnoredMsg(ignored > 0 ? `${ignored} arquivo(s) ignorado(s) (não são PDF)` : null);
  }

  function limparSelecao() {
    setFiles([]); setCaixaAssignments({}); setIgnoredMsg(null);
    setFase("selecao"); setPacoteStatus({}); setProgressLabel("");
  }

  const parsedFiles = useMemo(() => files.map(parseFilename), [files]);
  const semTipo = useMemo(() => parsedFiles.filter((f) => !f.tipo), [parsedFiles]);
  const caixasSemData = useMemo(
    () => parsedFiles.filter((f) => f.tipo === "caixa" && !f.data && !caixaAssignments[f.key]),
    [parsedFiles, caixaAssignments],
  );
  const codigosDetectados = useMemo(
    () => [...new Set(parsedFiles.map((f) => f.loreanCode).filter((c): c is string => !!c))],
    [parsedFiles],
  );

  const pacotes: Pacote[] = useMemo(() => {
    const map = new Map<string, { movimento: ParsedFile | null; venda: ParsedFile | null; caixas: ParsedFile[]; codigos: Set<string> }>();
    const ensure = (data: string) => {
      if (!map.has(data)) map.set(data, { movimento: null, venda: null, caixas: [], codigos: new Set() });
      return map.get(data)!;
    };
    for (const f of parsedFiles) {
      if (!f.tipo) continue;
      const data = f.tipo === "caixa" && !f.data ? caixaAssignments[f.key] ?? null : f.data;
      if (!data) continue;
      const bucket = ensure(data);
      if (f.loreanCode) bucket.codigos.add(f.loreanCode);
      if (f.tipo === "movimento") bucket.movimento = f;
      else if (f.tipo === "venda") bucket.venda = f;
      else bucket.caixas.push(f);
    }
    return Array.from(map.entries())
      .map(([data, b]) => ({
        data, movimento: b.movimento, venda: b.venda, caixas: b.caixas, codigos: b.codigos,
        status: (b.movimento ? "pronto" : "incompleto") as Pacote["status"],
      }))
      .sort((a, b) => a.data.localeCompare(b.data));
  }, [parsedFiles, caixaAssignments]);

  const prontos = pacotes.filter((p) => p.status === "pronto");
  const incompletos = pacotes.filter((p) => p.status === "incompleto");

  async function iniciarImportacao() {
    if (!selectedUnitId || prontos.length === 0) return;
    setFase("processando");
    setPacoteStatus({});
    for (let i = 0; i < prontos.length; i++) {
      const p = prontos[i]!;
      setProgressLabel(`Processando ${i + 1}/${prontos.length} — ${unitLabel} ${fmtDateBR(p.data)}…`);
      setPacoteStatus((prev) => ({ ...prev, [p.data]: { state: "processando" } }));
      try {
        const workdayId = await enviarArquivo(p.movimento!.file, "movimento", selectedUnitId, null);
        if (p.venda) await enviarArquivo(p.venda.file, "venda", selectedUnitId, workdayId);
        for (const c of p.caixas) await enviarArquivo(c.file, "caixa", selectedUnitId, workdayId);
        setPacoteStatus((prev) => ({ ...prev, [p.data]: { state: "sucesso" } }));
      } catch (e) {
        setPacoteStatus((prev) => ({ ...prev, [p.data]: { state: "erro", mensagem: String(e instanceof Error ? e.message : e) } }));
        // não interrompe — segue pro próximo pacote
      }
    }
    setProgressLabel("");
    setFase("concluido");
  }

  const totalProcessados = Object.keys(pacoteStatus).length;
  const totalSucesso = Object.values(pacoteStatus).filter((s) => s.state === "sucesso").length;
  const totalErro = Object.values(pacoteStatus).filter((s) => s.state === "erro").length;
  const errosLista = pacotes.filter((p) => pacoteStatus[p.data]?.state === "erro");
  const progressoPct = prontos.length > 0
    ? (Object.values(pacoteStatus).filter((s) => s.state === "sucesso" || s.state === "erro").length / prontos.length) * 100
    : 0;
  const processando = fase === "processando";

  function baixarRelatorio() {
    const header = ["Data", "Unidade", "Status", "Movimento", "Venda", "Caixas", "Mensagem"];
    const rows = pacotes.map((p) => {
      const st = pacoteStatus[p.data];
      const statusLabel =
        st?.state === "sucesso" ? "Sucesso" :
        st?.state === "erro" ? "Erro" :
        st?.state === "processando" ? "Processando" :
        p.status === "pronto" ? "Não processado" : "Incompleto (pulado)";
      return [
        fmtDateBR(p.data), unitLabel, statusLabel,
        p.movimento ? "Sim" : "Não", p.venda ? "Sim" : "Não",
        String(p.caixas.length), st?.mensagem ?? "",
      ];
    });
    baixarCsv(`import-lote-pdf-${unitLabel.replace(/\s+/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
  }

  return (
    <>
      {fase === "selecao" && (
        <Dropzone
          label="Arraste os PDFs aqui"
          sub="ou clique para selecionar — Movimento, Venda e Caixa, sem limite de quantidade"
          accept=".pdf"
          onFiles={addFiles}
        />
      )}

      {ignoredMsg && <p style={{ fontSize: 12, color: C.meta, marginTop: -8, marginBottom: 16 }}>⚠ {ignoredMsg}</p>}

      {files.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Chip label={`${files.length} arquivo${files.length !== 1 ? "s" : ""}`} />
              <Chip label={`${pacotes.length} dia${pacotes.length !== 1 ? "s" : ""}`} />
              <Chip label={`${prontos.length} pronto${prontos.length !== 1 ? "s" : ""}`} color={C.receita} />
              {incompletos.length > 0 && <Chip label={`${incompletos.length} incompleto${incompletos.length !== 1 ? "s" : ""}`} color={C.alerta} />}
              {caixasSemData.length > 0 && <Chip label={`${caixasSemData.length} caixa(s) sem data`} color={C.meta} />}
              {semTipo.length > 0 && <Chip label={`${semTipo.length} não reconhecido(s)`} color={C.alerta} />}
            </div>
            {fase === "selecao" && (
              <button onClick={limparSelecao} style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: "transparent", color: C.text3, border: `1px solid ${C.border}`, cursor: "pointer",
              }}>
                Limpar seleção
              </button>
            )}
          </div>

          {codigosDetectados.length > 1 && (
            <div style={{
              padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 12,
              background: "rgba(251,191,36,0.08)", color: C.meta, border: "1px solid rgba(251,191,36,0.25)",
            }}>
              ⚠ Códigos Lorean distintos detectados nos arquivos: {codigosDetectados.map((c) => `[${c}]`).join(", ")}
              {" "}— confira se todos os PDFs são realmente da unidade selecionada ({unitLabel}).
            </div>
          )}

          {semTipo.length > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: C.alerta, margin: "0 0 8px" }}>
                Arquivos não reconhecidos (nome não contém &quot;Movimento&quot;, &quot;Venda&quot; ou &quot;Caixa&quot;)
              </p>
              {semTipo.map((f) => (
                <p key={f.key} style={{ fontSize: 12, color: C.text3, margin: "2px 0" }}>{f.file.name}</p>
              ))}
            </div>
          )}

          {caixasSemData.length > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: C.meta, margin: "0 0 8px" }}>
                Caixas sem data no nome do arquivo — atribua manualmente
              </p>
              {caixasSemData.map((f) => (
                <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                  <span style={{ fontSize: 12, color: C.text2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.file.name}
                  </span>
                  <input
                    type="date"
                    onChange={(e) => setCaixaAssignments((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    style={{
                      padding: "5px 8px", borderRadius: 6, fontSize: 12,
                      background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          <div style={{ overflowX: "auto", marginBottom: 20 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <thead>
                <tr style={{ background: C.surface2 }}>
                  {["Data", "Unidade", "Movimento", "Venda", "Caixas", "Status"].map((h, i) => (
                    <th key={h} style={{
                      padding: "8px 12px", textAlign: i === 0 || i === 1 ? "left" : "right",
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                      color: C.text3, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pacotes.map((p) => {
                  const live = pacoteStatus[p.data];
                  const cell =
                    live?.state === "processando" ? { label: "⏳ processando", color: C.meta } :
                    live?.state === "sucesso"     ? { label: "✓ sucesso", color: C.receita } :
                    live?.state === "erro"        ? { label: "✗ erro", color: C.alerta } :
                    p.status === "pronto"         ? { label: "pronto", color: C.receita } :
                                                     { label: "incompleto", color: C.alerta };
                  return (
                    <tr key={p.data} style={{ borderTop: `1px solid ${C.border}` }} title={live?.mensagem}>
                      <td style={{ padding: "8px 12px", color: C.text, fontWeight: 600, whiteSpace: "nowrap" }}>{fmtDateBR(p.data)}</td>
                      <td style={{ padding: "8px 12px", color: C.text2, whiteSpace: "nowrap" }}>{unitLabel}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: p.movimento ? C.receita : C.alerta }}>{p.movimento ? "✓" : "✗"}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: p.venda ? C.receita : C.text3 }}>{p.venda ? "✓" : "✗"}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: p.caixas.length ? C.text2 : C.text3 }}>{p.caixas.length}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: cell.color }}>{cell.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {fase === "selecao" && (
            <button
              onClick={iniciarImportacao}
              disabled={prontos.length === 0 || !selectedUnitId}
              style={{
                padding: "10px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: prontos.length === 0 ? C.surface3 : C.brand,
                color: prontos.length === 0 ? C.text3 : "#fff",
                border: "none", cursor: prontos.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              Iniciar importação {prontos.length > 0 ? `(${prontos.length} dia${prontos.length !== 1 ? "s" : ""})` : ""}
            </button>
          )}

          {processando && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: C.text2, marginBottom: 8 }}>⏳ {progressLabel}</p>
              <ProgressBar pct={progressoPct} />
            </div>
          )}

          {fase === "concluido" && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "18px 20px" }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: "0 0 10px" }}>
                Concluído — {totalSucesso} dia{totalSucesso !== 1 ? "s" : ""} importado{totalSucesso !== 1 ? "s" : ""} com sucesso
                {totalErro > 0 && `, ${totalErro} com erro`}
                {totalProcessados < prontos.length && ` (${prontos.length - totalProcessados} não processado(s))`}
              </p>

              {errosLista.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: C.alerta, margin: "0 0 6px" }}>Dias com erro:</p>
                  {errosLista.map((p) => (
                    <p key={p.data} style={{ fontSize: 12, color: C.text2, margin: "3px 0" }}>
                      <strong>{fmtDateBR(p.data)}</strong> — {pacoteStatus[p.data]?.mensagem}
                    </p>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={baixarRelatorio} style={{
                  padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: C.surface3, color: C.text, border: `1px solid ${C.border}`, cursor: "pointer",
                }}>
                  Baixar relatório (CSV)
                </button>
                <button onClick={limparSelecao} style={{
                  padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: C.brand, color: "#fff", border: "none", cursor: "pointer",
                }}>
                  Nova importação
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
