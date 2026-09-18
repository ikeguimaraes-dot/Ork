"use client";
import { useAuth } from "@ork/auth/context";
import { getBrowserClient } from "@ork/db/supabase/client";

import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = "/financeiro";

// ── Tokens exatos do protótipo ──────────────────────────────────────────────
const VARS = {
  "--bg": "#0E1014", "--surface": "#15181F", "--surface-2": "#1B1F28", "--surface-3": "#222734",
  "--border": "#272C37", "--border-soft": "#1F2530",
  "--text": "#ECEEF1", "--text-2": "#AAB1BD", "--muted": "#727A88",
  "--gold": "#C9A24B", "--gold-2": "#E0BE72", "--gold-soft": "rgba(201,162,75,.13)",
  "--green": "#48BC8C", "--green-soft": "rgba(72,188,140,.13)",
  "--amber": "#E3A93C", "--amber-soft": "rgba(227,169,60,.14)",
  "--red": "#E2594E", "--red-soft": "rgba(226,89,78,.13)",
  "--blue": "#6E8BFB", "--blue-soft": "rgba(110,139,251,.13)",
} as React.CSSProperties;
const R = 14;
const C = {
  bg: "var(--bg)", surface: "var(--surface)", surface2: "var(--surface-2)", surface3: "var(--surface-3)",
  border: "var(--border)", borderSoft: "var(--border-soft)",
  text: "var(--text)", text2: "var(--text-2)", muted: "var(--muted)",
  gold: "var(--gold)", gold2: "var(--gold-2)", goldSoft: "var(--gold-soft)",
  green: "var(--green)", greenSoft: "var(--green-soft)",
  amber: "var(--amber)", amberSoft: "var(--amber-soft)",
  red: "var(--red)", redSoft: "var(--red-soft)",
  blue: "var(--blue)", blueSoft: "var(--blue-soft)",
};
const serif: React.CSSProperties = { fontFamily: "var(--font-fraunces), Georgia, serif" };

type Tone = "gold" | "green" | "amber" | "red" | "blue" | "muted";
function tone(t: Tone): { color: string; soft: string } {
  switch (t) {
    case "gold":  return { color: C.gold,  soft: C.goldSoft };
    case "green": return { color: C.green, soft: C.greenSoft };
    case "amber": return { color: C.amber, soft: C.amberSoft };
    case "red":   return { color: C.red,   soft: C.redSoft };
    case "blue":  return { color: C.blue,  soft: C.blueSoft };
    default:      return { color: C.text2, soft: C.surface2 };
  }
}

// ── Domínio ─────────────────────────────────────────────────────────────────
function UnitLabel({ id }: { id: string | null }) { const { units } = useAuth(); return <>{units.find(u => u.id === id)?.name ?? "Sem unidade"}</>; }

const CATS: Record<string, { label: string; tone: Tone }> = {
  locacao: { label: "Locação", tone: "gold" }, seguro: { label: "Seguro", tone: "blue" },
  software: { label: "Software", tone: "blue" }, servico: { label: "Serviço", tone: "green" },
  consultoria: { label: "Consultoria", tone: "gold" }, fornecimento: { label: "Fornecimento", tone: "green" },
  manutencao: { label: "Manutenção", tone: "amber" }, marketing: { label: "Marketing", tone: "blue" },
  sociedade: { label: "Sociedade", tone: "red" }, financiamento: { label: "Financiamento", tone: "blue" },
  licenca: { label: "Licença", tone: "gold" }, outro: { label: "Outro", tone: "muted" },
};
const catInfo = (k: string) => CATS[k] ?? { label: k, tone: "muted" as Tone };
const CAT_KEYS = Object.keys(CATS);

const RECORRENCIAS: [string, string][] = [["mensal", "Mensal"], ["anual", "Anual"], ["trimestral", "Trimestral"], ["unico", "Único"], ["consignacao", "Consignação"], ["nenhuma", "Nenhuma"]];
const recAbrev = (r: string | null) => ({ mensal: "mês", anual: "ano", trimestral: "tri", unico: "único", consignacao: "consignação", nenhuma: "—" }[r ?? "nenhuma"] ?? r ?? "—");
const INDICES: [string, string][] = [["nenhum", "Nenhum"], ["IGP-M", "IGP-M"], ["IPCA", "IPCA"], ["INPC", "INPC"], ["fixo", "Fixo"]];
const STATUS_MANUAL: [string, string][] = [["", "Automático (por data)"], ["em_negociacao", "Em negociação"], ["encerrado", "Encerrado"], ["rascunho", "Rascunho"]];
const TIPOS_ARQ: [string, string][] = [["principal", "Principal"], ["aditivo", "Aditivo"], ["anexo", "Anexo"]];

// ── Tipos ───────────────────────────────────────────────────────────────────
type Contrato = {
  id: string; unit_id: string | null; titulo: string; categoria: string;
  contraparte: string; contraparte_doc: string | null; responsavel: string | null;
  valor: number | null; recorrencia: string | null; data_inicio: string | null;
  data_fim: string | null; vigencia_indeterminada: boolean | null;
  renovacao_automatica: boolean | null; aviso_previo_dias: number | null;
  indice_reajuste: string | null; data_proximo_reajuste: string | null;
  multa_rescisoria: string | null; status_manual: string | null;
  tags: string[] | null; observacoes: string | null; arquivos_count?: number;
};
type Arquivo = { id: string; tipo: string; nome: string; storage_path: string; tamanho_bytes: number | null; content_type: string | null; uploaded_at: string };

// ── Formatters / datas ──────────────────────────────────────────────────────
const BRLn = new Intl.NumberFormat("pt-BR");
const fmtRS = (n: number) => `R$ ${BRLn.format(Math.round(n))}`;
const fmtData = (s: string | null) => {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  const mes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(m) - 1];
  return `${d} ${mes} ${y}`;
};
const parseD = (s: string) => new Date(`${s}T12:00:00`);
const dDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 864e5);
const fmtBytes = (b: number | null) => (b == null ? "" : b >= 1e6 ? `${(b / 1e6).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

// Status derivado conforme o protótipo (badge usa green p/ Ativo; barra usa gold).
type Derivado = { stLabel: string; stTone: Tone; days: number | null; avisoDays: number | null };
function derive(c: Contrato, hoje: Date): Derivado {
  if (c.status_manual === "em_negociacao") return { stLabel: "Em negociação", stTone: "blue", days: null, avisoDays: null };
  if (c.status_manual === "encerrado") return { stLabel: "Encerrado", stTone: "muted", days: null, avisoDays: null };
  if (c.status_manual === "rascunho") return { stLabel: "Rascunho", stTone: "blue", days: null, avisoDays: null };
  if (c.vigencia_indeterminada || !c.data_fim) return { stLabel: "Indeterminado", stTone: "green", days: null, avisoDays: null };
  const fim = parseD(c.data_fim);
  const days = dDays(hoje, fim);
  const aviso = c.aviso_previo_dias ?? 0;
  const avisoDays = days - aviso; // dias até a janela de aviso abrir
  if (days < 0) return { stLabel: "Vencido", stTone: "red", days, avisoDays };
  if (days <= 60) return { stLabel: "Vencendo", stTone: "amber", days, avisoDays };
  if (aviso > 0 && avisoDays <= 60) return { stLabel: "Aviso prévio", stTone: "amber", days, avisoDays };
  return { stLabel: "Ativo", stTone: "green", days, avisoDays };
}
// Cor da BARRA de vigência (independente do badge): vermelho/âmbar/dourado.
function barTone(c: Contrato, d: Derivado): Tone {
  if (c.status_manual || c.vigencia_indeterminada || !c.data_fim) return "green";
  if (d.days != null && d.days < 0) return "red";
  if (d.days != null && d.days <= 60) return "amber";
  return "gold";
}

// ── Supabase browser client (upload direto via signed URL) ──────────────────
const sb = () => { const client = getBrowserClient(); if (!client) throw new Error("Supabase não configurado"); return client; };

// ── CSS (animações/hover que inline não cobre) ──────────────────────────────
const CSS = `
@keyframes ctrPulse{0%{box-shadow:0 0 0 0 rgba(227,169,60,.45)}70%{box-shadow:0 0 0 7px rgba(227,169,60,0)}100%{box-shadow:0 0 0 0 rgba(227,169,60,0)}}
.ctr-row{position:relative;transition:.14s}
.ctr-row::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:transparent;transition:.14s}
.ctr-row:hover{background:var(--surface-2)}
.ctr-row:hover::before{background:var(--gold)}
.ctr-alert{transition:.14s}
.ctr-alert:hover{padding-left:10px}
.ctr-file{transition:.14s}
.ctr-file:hover{border-color:var(--gold);background:var(--surface-3)}
.ctr-in{transition:.15s}
.ctr-in:focus{border-color:rgba(201,162,75,.5);background:var(--surface-2)}
.ctr-chip{transition:.15s}
.ctr-chip:hover{color:var(--text);border-color:var(--muted)}
.ctr-prim{transition:.16s}
.ctr-prim:hover{transform:translateY(-1px);box-shadow:0 10px 24px -6px rgba(201,162,75,.6)}
.ctr-tl-row{transition:.14s}
.ctr-tl-row:hover{background:var(--surface-2)}
`;

// ── Página ──────────────────────────────────────────────────────────────────
export default function ContratosPage() {
  const { units } = useAuth();
  const UNITS = units.map(u => ({ key: u.id, label: u.name }));
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [unitFiltro, setUnitFiltro] = useState<string>("all");
  const [busca, setBusca] = useState("");
  const [catFiltro, setCatFiltro] = useState("all");
  const [vista, setVista] = useState<"list" | "timeline">("list");
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const hoje = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  async function load() {
    setLoading(true); setErro(null);
    try {
      const r = await fetch(`${API_BASE}/api/contratos`);
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? `HTTP ${r.status}`); return; }
      setContratos(j.contratos ?? []);
    } catch (e) { setErro(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/contratos`, { signal: controller.signal }).then(async response => {
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
      if (!controller.signal.aborted) setContratos(json.contratos ?? []);
    }).catch(error => { if (!controller.signal.aborted) setErro(String(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setDetalheId(null); setNovoAberto(false); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  const porUnidade = useMemo(() => {
    if (unitFiltro === "all") return contratos;
    const alvo = unitFiltro === "kph" ? null : unitFiltro;
    return contratos.filter((c) => c.unit_id === alvo);
  }, [contratos, unitFiltro]);

  const stats = useMemo(() => {
    let ativos = 0, mensal = 0, venc = 0, acao = 0;
    for (const c of porUnidade) {
      const d = derive(c, hoje);
      if (d.stLabel !== "Vencido" && d.stLabel !== "Em negociação") ativos += 1;
      if (c.recorrencia === "mensal" && d.stLabel !== "Em negociação") mensal += c.valor ?? 0;
      if (d.days != null && d.days >= 0 && d.days <= 90) venc += 1;
      if (["Vencendo", "Vencido", "Aviso prévio"].includes(d.stLabel)) acao += 1;
    }
    return { ativos, mensal, venc, acao, total: porUnidade.length };
  }, [porUnidade, hoje]);

  // Ação necessária — replica a lógica do protótipo
  const alertas = useMemo(() => {
    return porUnidade
      .map((c) => ({ c, d: derive(c, hoje) }))
      .filter(({ d, c }) => d.days != null && (d.days <= 90 || ((c.aviso_previo_dias ?? 0) > 0 && (d.avisoDays ?? 99) <= 75)))
      .map(({ c, d }) => {
        const aviso = (c.aviso_previo_dias ?? 0) > 0 && (d.avisoDays ?? 99) <= 75 && (d.avisoDays ?? -1) >= 0 && (d.avisoDays ?? 0) < (d.days ?? 0);
        return { c, d, key: aviso ? (d.avisoDays as number) : (d.days as number), aviso };
      })
      .sort((a, b) => a.key - b.key)
      .slice(0, 4);
  }, [porUnidade, hoje]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return porUnidade.filter((c) =>
      (catFiltro === "all" || c.categoria === catFiltro) &&
      (!q || `${c.titulo} ${c.contraparte} ${c.responsavel ?? ""}`.toLowerCase().includes(q)),
    );
  }, [porUnidade, busca, catFiltro]);

  return (
    <div style={{ ...VARS, margin: "-32px -28px", minHeight: "100vh", padding: "0 0 80px", color: C.text, fontFamily: "var(--font-inter), system-ui, sans-serif", fontSize: 14, lineHeight: 1.5, background: C.bg, backgroundImage: "radial-gradient(900px 400px at 88% -8%, rgba(201,162,75,.07), transparent 60%), radial-gradient(700px 500px at -5% 110%, rgba(110,139,251,.05), transparent 55%)" }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 32px" }}>
        {/* Header */}
        <header style={{ padding: "34px 0 24px" }}>
          <div style={{ fontSize: 11.5, letterSpacing: ".16em", textTransform: "uppercase", color: C.muted, marginBottom: 10 }}>
            ORK &nbsp;/&nbsp; Financeiro &nbsp;/&nbsp; <b style={{ color: C.gold, fontWeight: 600 }}>Contratos</b>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ ...serif, fontWeight: 500, fontSize: 40, letterSpacing: "-.01em", lineHeight: 1, margin: 0 }}>Contratos</h1>
              <p style={{ color: C.text2, marginTop: 9, fontSize: 14, maxWidth: 520 }}>Todos os acordos do grupo em um lugar — com aviso antes de cada vencimento, não depois.</p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Seg value={unitFiltro} onChange={setUnitFiltro} options={[{ key: "all", label: "Todas" }, ...UNITS.map((u) => ({ key: u.key, label: u.label }))]} />
              <button className="ctr-prim" onClick={() => setNovoAberto(true)} style={btnPrimary}>
                <Icon name="plus" /> Novo contrato
              </button>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, margin: "26px 0 18px" }}>
            <Stat dot={C.green} lab="Contratos ativos" val={String(stats.ativos)} sub={<>de <b style={{ color: C.text }}>{stats.total}</b> no grupo</>} />
            <Stat dot={C.gold} lab="Compromisso mensal" val={<><small style={{ fontSize: 14, color: C.text2, fontWeight: 500, marginRight: 1 }}>R$ </small>{BRLn.format(Math.round(stats.mensal))}</>} sub="recorrente em contratos" />
            <Stat dot={C.amber} lab="Vencem em 90 dias" val={String(stats.venc)} sub="renovar ou encerrar" />
            <Stat dot={C.red} lab="Ação necessária" val={String(stats.acao)} valColor={C.red} sub="prazo de aviso ou vencimento próximo" alert />
          </div>

          {/* Ação necessária */}
          <div style={{ background: C.surface, border: `1px solid ${C.borderSoft}`, borderRadius: R, padding: "16px 18px" }}>
            <h3 style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: C.text2, marginBottom: 13, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.amber, animation: "ctrPulse 2.2s infinite" }} /> Ação necessária
            </h3>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {alertas.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 13, padding: "6px 4px" }}>Nenhum prazo crítico nesta seleção. 👌</div>
              ) : alertas.map(({ c, d, key, aviso }, i) => {
                const urgent = key <= 30;
                const tg = urgent ? tone("red") : tone("amber");
                return (
                  <div key={c.id} className="ctr-alert" onClick={() => setDetalheId(c.id)}
                    style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 4px", cursor: "pointer", borderTop: i === 0 ? "none" : `1px solid ${C.borderSoft}` }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 7, whiteSpace: "nowrap", minWidth: 78, textAlign: "center", background: tg.soft, color: tg.color }}>
                      {aviso ? "Aviso prévio" : (d.days != null && d.days < 0 ? "Vencido" : "Vencimento")}
                    </span>
                    <span style={{ flex: 1, fontSize: 13.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <b style={{ fontWeight: 600 }}>{c.titulo}</b> · {<UnitLabel id={c.unit_id} />}{aviso ? ` — exige ${c.aviso_previo_dias} dias de aviso para encerrar` : ""}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", color: urgent ? "#EE8077" : "#E8B84F" }}>
                      {key < 0 ? `${Math.abs(key)} dias atrás` : `em ${key} dias`}
                    </span>
                    <span style={{ color: C.muted }}>→</span>
                  </div>
                );
              })}
            </div>
          </div>
        </header>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
            <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: C.muted, display: "flex" }}><Icon name="search" /></span>
            <input className="ctr-in" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por contrato, contraparte, responsável..."
              style={{ width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 11, color: C.text, fontFamily: "inherit", fontSize: 13.5, padding: "10px 14px 10px 38px", outline: "none" }} />
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <Chip on={catFiltro === "all"} onClick={() => setCatFiltro("all")}>Todas</Chip>
            {CAT_KEYS.map((k) => <Chip key={k} on={catFiltro === k} onClick={() => setCatFiltro(k)}>{CATS[k]!.label}</Chip>)}
          </div>
          <div style={{ display: "flex", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 3, marginLeft: "auto" }}>
            {(["list", "timeline"] as const).map((v) => (
              <button key={v} onClick={() => setVista(v)} title={v === "list" ? "Lista" : "Linha do tempo"}
                style={{ background: vista === v ? C.surface3 : "none", border: "none", color: vista === v ? C.text : C.muted, cursor: "pointer", padding: "7px 9px", borderRadius: 7, display: "flex" }}>
                <Icon name={v === "list" ? "list" : "timeline"} />
              </button>
            ))}
          </div>
        </div>

        {/* Conteúdo */}
        {loading ? (
          <Empty>Carregando…</Empty>
        ) : erro ? (
          <Empty color={C.red}>Erro: {erro}</Empty>
        ) : vista === "list" ? (
          <div style={{ background: C.surface, border: `1px solid ${C.borderSoft}`, borderRadius: R, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "2.4fr 1.5fr 1.1fr 1.9fr", gap: 16, padding: "12px 22px", fontSize: 11, letterSpacing: ".07em", textTransform: "uppercase", color: C.muted, borderBottom: `1px solid ${C.borderSoft}` }}>
              <span>Contrato</span><span>Contraparte</span><span>Valor</span><span>Vigência</span>
            </div>
            {lista.length === 0 ? (
              <Empty>Nenhum contrato {contratos.length ? "encontrado com esses filtros." : "ainda. Clique em “Novo contrato” para começar."}</Empty>
            ) : lista.map((c, i) => <Row key={c.id} c={c} hoje={hoje} last={i === lista.length - 1} onClick={() => setDetalheId(c.id)} />)}
          </div>
        ) : (
          <Timeline lista={lista} hoje={hoje} onClick={setDetalheId} />
        )}
      </div>

      {detalheId && <Drawer id={detalheId} hoje={hoje} onClose={() => setDetalheId(null)} onChanged={load} />}
      {novoAberto && <Modal onClose={() => setNovoAberto(false)} onCreated={() => { setNovoAberto(false); load(); }} />}
    </div>
  );
}

// ── Linha ───────────────────────────────────────────────────────────────────
function Row({ c, hoje, last, onClick }: { c: Contrato; hoje: Date; last: boolean; onClick: () => void }) {
  const d = derive(c, hoje);
  const st = tone(d.stTone);
  const ct = catInfo(c.categoria); const cc = tone(ct.tone);
  const sub = d.days != null ? (d.days < 0 ? `${Math.abs(d.days)}d vencido` : `vence em ${d.days}d`) : (c.status_manual === "em_negociacao" ? "em negociação" : "sem prazo final");
  return (
    <div className="ctr-row" onClick={onClick} style={{ display: "grid", gridTemplateColumns: "2.4fr 1.5fr 1.1fr 1.9fr", gap: 16, alignItems: "center", padding: "16px 22px", borderBottom: last ? "none" : `1px solid ${C.borderSoft}`, cursor: "pointer" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.titulo}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap", background: cc.soft, color: cc.color }}>{ct.label}</span>
          <span style={{ fontSize: 11.5, color: C.muted }}>{<UnitLabel id={c.unit_id} />}</span>
          {c.arquivos_count ? <span style={{ fontSize: 11.5, color: C.muted }}>· 📎 {c.arquivos_count}</span> : null}
        </div>
      </div>
      <div style={{ fontSize: 13.5, color: C.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {c.contraparte}<div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>{c.responsavel ?? "—"}</div>
      </div>
      <div style={{ fontWeight: 600, fontSize: 14 }}>
        {c.valor && c.valor > 0 ? fmtRS(c.valor) : "—"}
        <small style={{ display: "block", fontSize: 11.5, color: C.muted, fontWeight: 500, marginTop: 3 }}>{c.valor && c.valor > 0 ? `/ ${recAbrev(c.recorrencia)}` : recAbrev(c.recorrencia)}</small>
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, marginBottom: 6 }}>
          <span style={{ fontWeight: 600, color: st.color }}>{d.stLabel}</span><span>{sub}</span>
        </div>
        <VigBar c={c} d={d} hoje={hoje} />
      </div>
    </div>
  );
}

// Barra de vigência — fração decorrida + faixa âmbar do aviso + marcador de hoje
function VigBar({ c, d, hoje }: { c: Contrato; d: Derivado; hoje: Date }) {
  const track: React.CSSProperties = { height: 7, background: C.surface3, borderRadius: 4, position: "relative", overflow: "hidden" };
  if (c.status_manual === "em_negociacao") {
    return <div style={track}><div style={{ position: "absolute", inset: 0, width: "100%", opacity: .6, background: "repeating-linear-gradient(90deg, var(--surface-3), var(--surface-3) 4px, transparent 4px, transparent 8px)" }} /></div>;
  }
  if (c.vigencia_indeterminada || !c.data_fim || !c.data_inicio) {
    return (
      <div style={track}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "64%", borderRadius: 4, background: `linear-gradient(90deg, ${C.greenSoft}, ${C.green})` }} />
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "34%", background: "repeating-linear-gradient(90deg, var(--surface-3), var(--surface-3) 4px, transparent 4px, transparent 8px)", borderRadius: 4 }} />
      </div>
    );
  }
  const ini = parseD(c.data_inicio).getTime(), fim = parseD(c.data_fim).getTime();
  const total = Math.max(1, fim - ini);
  const elapsed = Math.max(0, Math.min(1, (hoje.getTime() - ini) / total));
  const aviso = c.aviso_previo_dias ?? 0;
  const avFrac = Math.max(0, Math.min(1, (aviso * 864e5) / total));
  const bt = tone(barTone(c, d));
  return (
    <div style={track}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${elapsed * 100}%`, borderRadius: 4, background: `linear-gradient(90deg, ${bt.soft}, ${bt.color})` }} />
      {aviso > 0 && <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${avFrac * 100}%`, background: C.amberSoft, opacity: .85 }} />}
      <div style={{ position: "absolute", top: -3, bottom: -3, left: `${elapsed * 100}%`, width: 2, background: C.text, borderRadius: 2, boxShadow: `0 0 0 2px ${C.surface}` }} />
    </div>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────
function Timeline({ lista, hoje, onClick }: { lista: Contrato[]; hoje: Date; onClick: (id: string) => void }) {
  const com = lista.filter((c) => c.data_inicio);
  const anos = com.flatMap((c) => [Number(c.data_inicio!.slice(0, 4)), c.data_fim ? Number(c.data_fim.slice(0, 4)) : Number(c.data_inicio!.slice(0, 4)) + 4]);
  const minY = Math.min(hoje.getFullYear() - 1, ...(anos.length ? anos : [hoje.getFullYear()]));
  const maxY = Math.max(hoje.getFullYear() + 1, ...(anos.length ? anos : [hoje.getFullYear()])) + 1;
  const min = new Date(`${minY}-01-01T12:00:00`).getTime();
  const max = new Date(`${maxY}-01-01T12:00:00`).getTime();
  const span = Math.max(1, max - min);
  const pos = (t: number) => ((t - min) / span) * 100;
  const years: number[] = []; for (let y = minY; y < maxY; y++) years.push(y);
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.borderSoft}`, borderRadius: R, padding: "8px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", padding: "10px 22px 14px", borderBottom: `1px solid ${C.borderSoft}` }}>
        <div />
        <div style={{ position: "relative", height: 16, fontSize: 11, color: C.muted }}>
          {years.map((y) => <span key={y} style={{ position: "absolute", left: `${pos(new Date(`${y}-01-01T12:00:00`).getTime())}%` }}>{y}</span>)}
          <span style={{ position: "absolute", left: `${pos(hoje.getTime())}%`, fontSize: 10.5, color: C.text, fontWeight: 600, transform: "translateX(-50%)" }}>hoje</span>
        </div>
      </div>
      {com.length === 0 ? <Empty>Sem contratos com vigência para exibir.</Empty> : com.map((c) => {
        const d = derive(c, hoje); const bt = tone(d.stTone);
        const ini = parseD(c.data_inicio!).getTime();
        const fim = c.data_fim ? parseD(c.data_fim).getTime() : max;
        const left = pos(ini), width = Math.max(2, pos(fim) - left);
        return (
          <div key={c.id} className="ctr-tl-row" onClick={() => onClick(c.id)} style={{ display: "grid", gridTemplateColumns: "200px 1fr", alignItems: "center", padding: "11px 22px", cursor: "pointer" }}>
            <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 14 }}>{c.titulo}</div>
            <div style={{ position: "relative", height: 24 }}>
              <div style={{ position: "absolute", top: -6, bottom: -6, left: `${pos(hoje.getTime())}%`, width: 2, background: C.text, opacity: .55, zIndex: 3 }} />
              <div style={{ position: "absolute", height: 24, borderRadius: 6, display: "flex", alignItems: "center", padding: "0 9px", fontSize: 11, fontWeight: 600, color: "#0E1014", overflow: "hidden", whiteSpace: "nowrap", left: `${left}%`, width: `${width}%`, background: bt.color, opacity: .92 }}>
                {c.valor && c.valor > 0 ? fmtRS(c.valor) : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Drawer ──────────────────────────────────────────────────────────────────
function Drawer({ id, hoje, onClose, onChanged }: { id: string; hoje: Date; onClose: () => void; onChanged: () => void }) {
  const [c, setC] = useState<Contrato | null>(null);
  const [arquivos, setArquivos] = useState<Arquivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [apagando, setApagando] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`${API_BASE}/api/contratos/${id}`);
        const j = await r.json();
        setC(j.contrato ?? null);
        setArquivos(j.contrato?.contratos_arquivos ?? []);
      } finally { setLoading(false); }
    })();
    const t = setTimeout(() => setShow(true), 10);
    return () => clearTimeout(t);
  }, [id]);

  async function baixar(arqId: string) {
    const r = await fetch(`${API_BASE}/api/contratos/arquivos/${arqId}/download`);
    const j = await r.json(); if (j.url) window.open(j.url, "_blank");
  }
  async function apagar() {
    if (!confirm("Apagar este contrato e todos os arquivos?")) return;
    setApagando(true);
    await fetch(`${API_BASE}/api/contratos/${id}`, { method: "DELETE" });
    onChanged(); onClose();
  }
  const d = c ? derive(c, hoje) : null;
  const ct = c ? catInfo(c.categoria) : null; const cc = ct ? tone(ct.tone) : null;
  const st = d ? tone(d.stTone) : null;
  const avisoWin = c && d && (c.aviso_previo_dias ?? 0) > 0 && d.days != null && (d.avisoDays ?? 99) <= 75 && d.days >= 0;

  return (
    <>
      <div onClick={onClose} style={{ ...scrim, opacity: show ? 1 : 0 }} />
      <aside style={{ ...drawer, transform: show ? "translateX(0)" : "translateX(100%)" }}>
        <div style={{ padding: "24px 26px 20px", borderBottom: `1px solid ${C.borderSoft}`, position: "sticky", top: 0, background: C.surface, zIndex: 2 }}>
          <button onClick={onClose} style={drClose}><Icon name="x" /></button>
          {loading || !c ? (
            <span style={{ color: C.muted, fontSize: 13 }}>Carregando…</span>
          ) : (
            <>
              {cc && ct && <span style={{ display: "inline-block", marginBottom: 11, fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: cc.soft, color: cc.color }}>{ct.label}</span>}
              <h2 style={{ ...serif, fontWeight: 500, fontSize: 25, letterSpacing: "-.01em", lineHeight: 1.15, paddingRight: 40, margin: 0 }}>{c.titulo}</h2>
              <div style={{ color: C.text2, marginTop: 6, fontSize: 13.5 }}>{c.contraparte} &nbsp;·&nbsp; {<UnitLabel id={c.unit_id} />}</div>
            </>
          )}
        </div>
        {!loading && c && d && (
          <div style={{ padding: "22px 26px" }}>
            <div style={{ background: C.surface2, border: `1px solid ${C.borderSoft}`, borderRadius: 12, padding: "16px 18px", marginBottom: 20 }}>
              <div style={{ fontSize: 11, letterSpacing: ".07em", textTransform: "uppercase", color: C.muted, marginBottom: 13 }}>
                Vigência &nbsp;—&nbsp; <span style={{ color: st?.color }}>{d.stLabel}</span>
              </div>
              <VigBar c={c} d={d} hoje={hoje} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.text2, marginTop: 9 }}>
                <span>{fmtData(c.data_inicio)}</span><span>{c.vigencia_indeterminada || !c.data_fim ? "sem término definido" : fmtData(c.data_fim)}</span>
              </div>
              {avisoWin && (
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: C.amberSoft, border: "1px solid rgba(227,169,60,.28)", borderRadius: 10, padding: "12px 14px", marginTop: 14, fontSize: 12.5, color: "#EFC368" }}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}><Icon name="warn" /></span>
                  <span>Para encerrar este contrato é preciso avisar com <b>{c.aviso_previo_dias} dias</b> de antecedência. A janela {(d.avisoDays ?? 0) < 0 ? `já abriu há ${Math.abs(d.avisoDays ?? 0)} dias` : `abre em ${d.avisoDays} dias`}.</span>
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: C.borderSoft, border: `1px solid ${C.borderSoft}`, borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
              <Field k="Valor" v={c.valor && c.valor > 0 ? `${fmtRS(c.valor)} / ${recAbrev(c.recorrencia)}` : recAbrev(c.recorrencia)} />
              <Field k="Reajuste" v={c.indice_reajuste ?? "—"} />
              <Field k="Aviso prévio" v={c.aviso_previo_dias ? `${c.aviso_previo_dias} dias` : "—"} />
              <Field k="Multa rescisória" v={c.multa_rescisoria ?? "—"} />
              <Field k="Responsável" v={c.responsavel ?? "—"} />
              <Field k="Renovação" v={c.renovacao_automatica ? "Automática" : "Manual"} />
              <Field k="CNPJ / CPF" v={c.contraparte_doc ?? "—"} />
              <Field k="Próximo reajuste" v={fmtData(c.data_proximo_reajuste)} />
            </div>

            {c.observacoes && (
              <div style={{ marginBottom: 20 }}>
                <div style={drSecLab}>Observações</div>
                <p style={{ fontSize: 13, color: C.text2, whiteSpace: "pre-wrap", margin: 0 }}>{c.observacoes}</p>
              </div>
            )}

            <div style={drSecLab}>Documentos &nbsp;({arquivos.length})</div>
            {arquivos.length === 0 ? <p style={{ fontSize: 12.5, color: C.muted }}>Nenhum arquivo anexado.</p> : arquivos.map((a) => (
              <div key={a.id} className="ctr-file" onClick={() => baixar(a.id)} style={{ display: "flex", alignItems: "center", gap: 12, background: C.surface2, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: "12px 14px", marginBottom: 8, cursor: "pointer" }}>
                <span style={{ width: 34, height: 34, borderRadius: 8, background: C.redSoft, color: "#EE8077", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 10, fontWeight: 700 }}>PDF</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.nome}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{a.tipo === "aditivo" ? "Aditivo · " : a.tipo === "anexo" ? "Anexo · " : ""}{fmtBytes(a.tamanho_bytes)}</div>
                </div>
                <span style={{ color: C.muted }}><Icon name="download" /></span>
              </div>
            ))}

            <button onClick={apagar} disabled={apagando} style={{ marginTop: 22, background: "none", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", padding: 4 }}>
              {apagando ? "Apagando…" : "Apagar contrato"}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

// ── Modal: novo contrato ────────────────────────────────────────────────────
type Form = {
  titulo: string; contraparte: string; contraparte_doc: string; unitKey: string; categoria: string;
  responsavel: string; valor: string; recorrencia: string; data_inicio: string; data_fim: string;
  vigencia_indeterminada: boolean; renovacao_automatica: boolean; aviso_previo_dias: string;
  indice_reajuste: string; data_proximo_reajuste: string; multa_rescisoria: string; observacoes: string; tags: string; status_manual: string;
};
const FORM0: Form = {
  titulo: "", contraparte: "", contraparte_doc: "", unitKey: "", categoria: "locacao",
  responsavel: "", valor: "", recorrencia: "mensal", data_inicio: "", data_fim: "", vigencia_indeterminada: false,
  renovacao_automatica: false, aviso_previo_dias: "", indice_reajuste: "nenhum", data_proximo_reajuste: "", multa_rescisoria: "", observacoes: "", tags: "", status_manual: "",
};

function Modal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { units } = useAuth();
  const [f, setF] = useState<Form>(() => ({ ...FORM0, unitKey: units[0]?.id ?? "" }));
  const [files, setFiles] = useState<{ file: File; tipo: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof Form, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => { const t = setTimeout(() => setShow(true), 10); return () => clearTimeout(t); }, []);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const novos = Array.from(list).filter((x) => x.type === "application/pdf" || x.name.toLowerCase().endsWith(".pdf"))
      .map((file) => ({ file, tipo: files.length === 0 ? "principal" : "aditivo" }));
    setFiles((p) => [...p, ...novos]);
  }
  async function salvar() {
    if (!f.titulo.trim() || !f.contraparte.trim()) { setMsg("Título e contraparte são obrigatórios."); return; }
    setSalvando(true); setMsg(null);
    try {
      const payload = {
        unit_id: f.unitKey === "kph" ? null : f.unitKey, titulo: f.titulo.trim(), categoria: f.categoria, contraparte: f.contraparte.trim(),
        contraparte_doc: f.contraparte_doc || null, responsavel: f.responsavel || null, valor: f.valor ? Number(f.valor) : 0, recorrencia: f.recorrencia,
        data_inicio: f.data_inicio || null, data_fim: f.vigencia_indeterminada ? null : (f.data_fim || null), vigencia_indeterminada: f.vigencia_indeterminada,
        renovacao_automatica: f.renovacao_automatica, aviso_previo_dias: f.aviso_previo_dias ? Number(f.aviso_previo_dias) : 0,
        indice_reajuste: f.indice_reajuste, data_proximo_reajuste: f.data_proximo_reajuste || null, multa_rescisoria: f.multa_rescisoria || null,
        status_manual: f.status_manual || null, observacoes: f.observacoes || null, tags: f.tags ? f.tags.split(",").map((t) => t.trim()).filter(Boolean) : null,
      };
      const rc = await fetch(`${API_BASE}/api/contratos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const jc = await rc.json();
      if (!rc.ok || !jc.id) throw new Error(jc.error ?? "Falha ao criar contrato");
      const id = jc.id as string;
      for (let i = 0; i < files.length; i++) {
        const { file, tipo } = files[i]!;
        setMsg(`Enviando ${i + 1}/${files.length}: ${file.name}…`);
        const ru = await fetch(`${API_BASE}/api/contratos/${id}/arquivos/upload-url`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: file.name }) });
        const ju = await ru.json();
        if (!ru.ok || !ju.path) throw new Error(ju.error ?? "Falha ao gerar URL de upload");
        const up = await sb().storage.from("contratos").uploadToSignedUrl(ju.path, ju.token, file, { contentType: file.type || "application/pdf" });
        if (up.error) throw new Error(`Upload ${file.name}: ${up.error.message}`);
        const rm = await fetch(`${API_BASE}/api/contratos/${id}/arquivos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo, nome: file.name, storage_path: ju.path, tamanho_bytes: file.size, content_type: file.type || "application/pdf" }) });
        if (!rm.ok) { const jm = await rm.json(); throw new Error(jm.error ?? "Falha ao registrar arquivo"); }
      }
      onCreated();
    } catch (e) { setMsg(String(e instanceof Error ? e.message : e)); }
    finally { setSalvando(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{ ...scrim, opacity: show ? 1 : 0 }} />
      <div style={{ ...modal, opacity: show ? 1 : 0, transform: show ? "translate(-50%,-50%) scale(1)" : "translate(-50%,-46%) scale(.97)" }}>
        <div style={{ padding: "24px 26px 0" }}>
          <h2 style={{ ...serif, fontWeight: 500, fontSize: 24, margin: 0 }}>Novo contrato</h2>
          <p style={{ color: C.text2, fontSize: 13, marginTop: 5 }}>Suba os PDFs e preencha os dados do contrato.</p>
        </div>
        <div style={{ padding: "22px 26px 26px" }}>
          {/* Dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
            style={{ border: `1.5px dashed ${dragOver ? C.gold : C.border}`, borderRadius: 14, padding: "30px 20px", textAlign: "center", cursor: "pointer", background: dragOver ? C.goldSoft : C.surface2, marginBottom: 18 }}>
            <input ref={inputRef} type="file" accept="application/pdf" multiple style={{ display: "none" }} onChange={(e) => addFiles(e.target.files)} />
            <div style={{ width: 48, height: 48, borderRadius: 12, background: C.surface3, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", color: C.gold }}><Icon name="upload" big /></div>
            <b style={{ fontSize: 14 }}>Arraste os contratos em PDF</b>
            <span style={{ display: "block", color: C.muted, fontSize: 12.5, marginTop: 5 }}>ou clique para selecionar &nbsp;·&nbsp; upload direto ao Storage (suporta &gt; 5 MB)</span>
          </div>
          {files.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
              {files.map((x, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.text2 }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {x.file.name} · {fmtBytes(x.file.size)}</span>
                  <select className="ctr-in" value={x.tipo} onChange={(e) => setFiles((p) => p.map((y, j) => j === i ? { ...y, tipo: e.target.value } : y))} style={{ ...fgInput, width: "auto", padding: "5px 8px", fontSize: 11.5 }}>
                    {TIPOS_ARQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Form */}
          <Fg label="Título do contrato"><input className="ctr-in" style={fgInput} value={f.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="Ex: Locação Comercial — Itaim" /></Fg>
          <FgRow>
            <Fg label="Contraparte"><input className="ctr-in" style={fgInput} value={f.contraparte} onChange={(e) => set("contraparte", e.target.value)} /></Fg>
            <Fg label="Unidade"><select className="ctr-in" style={fgInput} value={f.unitKey} onChange={(e) => set("unitKey", e.target.value)}>{units.map((unit) => ({ key: unit.id, label: unit.name })).map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}</select></Fg>
          </FgRow>
          <FgRow>
            <Fg label="CNPJ / CPF"><input className="ctr-in" style={fgInput} value={f.contraparte_doc} onChange={(e) => set("contraparte_doc", e.target.value)} /></Fg>
            <Fg label="Categoria"><select className="ctr-in" style={fgInput} value={f.categoria} onChange={(e) => set("categoria", e.target.value)}>{CAT_KEYS.map((k) => <option key={k} value={k}>{CATS[k]!.label}</option>)}</select></Fg>
          </FgRow>
          <FgRow>
            <Fg label="Valor"><input className="ctr-in" style={fgInput} type="number" value={f.valor} onChange={(e) => set("valor", e.target.value)} placeholder="0,00" /></Fg>
            <Fg label="Recorrência"><select className="ctr-in" style={fgInput} value={f.recorrencia} onChange={(e) => set("recorrencia", e.target.value)}>{RECORRENCIAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Fg>
          </FgRow>
          <FgRow>
            <Fg label="Início da vigência"><input className="ctr-in" style={fgInput} type="date" value={f.data_inicio} onChange={(e) => set("data_inicio", e.target.value)} /></Fg>
            <Fg label="Fim da vigência"><input className="ctr-in" style={{ ...fgInput, opacity: f.vigencia_indeterminada ? .4 : 1 }} type="date" disabled={f.vigencia_indeterminada} value={f.data_fim} onChange={(e) => set("data_fim", e.target.value)} /></Fg>
          </FgRow>
          <FgRow>
            <label style={chk}><input type="checkbox" checked={f.vigencia_indeterminada} onChange={(e) => set("vigencia_indeterminada", e.target.checked)} /> Vigência indeterminada</label>
            <label style={chk}><input type="checkbox" checked={f.renovacao_automatica} onChange={(e) => set("renovacao_automatica", e.target.checked)} /> Renovação automática</label>
          </FgRow>
          <FgRow>
            <Fg label="Índice de reajuste"><select className="ctr-in" style={fgInput} value={f.indice_reajuste} onChange={(e) => set("indice_reajuste", e.target.value)}>{INDICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Fg>
            <Fg label="Aviso prévio (dias)"><input className="ctr-in" style={fgInput} type="number" value={f.aviso_previo_dias} onChange={(e) => set("aviso_previo_dias", e.target.value)} /></Fg>
          </FgRow>
          <FgRow>
            <Fg label="Próximo reajuste"><input className="ctr-in" style={fgInput} type="date" value={f.data_proximo_reajuste} onChange={(e) => set("data_proximo_reajuste", e.target.value)} /></Fg>
            <Fg label="Status"><select className="ctr-in" style={fgInput} value={f.status_manual} onChange={(e) => set("status_manual", e.target.value)}>{STATUS_MANUAL.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Fg>
          </FgRow>
          <Fg label="Responsável"><input className="ctr-in" style={fgInput} value={f.responsavel} onChange={(e) => set("responsavel", e.target.value)} /></Fg>
          <Fg label="Multa rescisória"><input className="ctr-in" style={fgInput} value={f.multa_rescisoria} onChange={(e) => set("multa_rescisoria", e.target.value)} placeholder="Ex: 3 aluguéis" /></Fg>
          <Fg label="Tags (separadas por vírgula)"><input className="ctr-in" style={fgInput} value={f.tags} onChange={(e) => set("tags", e.target.value)} placeholder="aluguel, matriz" /></Fg>
          <Fg label="Observações"><textarea className="ctr-in" style={{ ...fgInput, minHeight: 60, resize: "vertical" }} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} /></Fg>

          {msg && <div style={{ fontSize: 12.5, marginTop: 6, color: msg.toLowerCase().includes("envia") ? C.text2 : C.red }}>{msg}</div>}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
            <button onClick={onClose} style={btnGhost}>Cancelar</button>
            <button className="ctr-prim" onClick={salvar} disabled={salvando} style={{ ...btnPrimary, opacity: salvando ? .6 : 1 }}>{salvando ? "Salvando…" : "Salvar contrato"}</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Pequenos componentes ────────────────────────────────────────────────────
function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { key: string; label: string }[] }) {
  return (
    <div style={{ display: "flex", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 11, padding: 3 }}>
      {options.map((o) => (
        <button key={o.key} onClick={() => onChange(o.key)} style={{ background: value === o.key ? C.surface3 : "none", border: "none", color: value === o.key ? C.text : C.text2, fontFamily: "inherit", fontSize: 12.5, fontWeight: 500, padding: "7px 13px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>{o.label}</button>
      ))}
    </div>
  );
}
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="ctr-chip" onClick={onClick} style={{ background: on ? C.goldSoft : C.surface, border: `1px solid ${on ? "rgba(201,162,75,.45)" : C.border}`, color: on ? C.gold2 : C.text2, fontFamily: "inherit", fontSize: 12.5, fontWeight: 500, padding: "8px 13px", borderRadius: 9, cursor: "pointer", whiteSpace: "nowrap" }}>{children}</button>
  );
}
function Stat({ dot, lab, val, sub, valColor, alert }: { dot: string; lab: string; val: React.ReactNode; sub: React.ReactNode; valColor?: string; alert?: boolean }) {
  return (
    <div style={{ background: alert ? `linear-gradient(180deg, ${C.redSoft}, transparent), ${C.surface}` : C.surface, border: `1px solid ${alert ? "rgba(226,89,78,.3)" : C.borderSoft}`, borderRadius: R, padding: "17px 18px 16px", overflow: "hidden" }}>
      <div style={{ fontSize: 11.5, color: C.muted, letterSpacing: ".04em", display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />{lab}
      </div>
      <div style={{ fontSize: 27, fontWeight: 600, letterSpacing: "-.02em", marginTop: 11, lineHeight: 1, color: valColor ?? C.text, fontVariantNumeric: "tabular-nums" }}>{val}</div>
      <div style={{ fontSize: 12, color: C.text2, marginTop: 7 }}>{sub}</div>
    </div>
  );
}
function Field({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ background: C.surface, padding: "13px 15px" }}>
      <div style={{ fontSize: 11, color: C.muted, letterSpacing: ".03em" }}>{k}</div>
      <div style={{ fontSize: 13.5, fontWeight: 500, marginTop: 5 }}>{v}</div>
    </div>
  );
}
function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return <div style={{ padding: "60px 20px", textAlign: "center", color: color ?? C.muted, fontSize: 14 }}>{children}</div>;
}
function Fg({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 14 }}><label style={{ display: "block", fontSize: 11.5, color: C.text2, marginBottom: 6, fontWeight: 500 }}>{label}</label>{children}</div>;
}
function FgRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>{children}</div>;
}

function Icon({ name, big }: { name: string; big?: boolean }) {
  const s = big ? 24 : 16;
  const p: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" strokeLinecap="round" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" /></>,
    list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" />,
    timeline: <><path d="M4 7h10M4 12h16M4 17h7" strokeLinecap="round" /><circle cx="18" cy="7" r="1.6" fill="currentColor" stroke="none" /><circle cx="14" cy="17" r="1.6" fill="currentColor" stroke="none" /></>,
    x: <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />,
    download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />,
    warn: <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round" />,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" strokeLinecap="round" /></>,
  };
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{p[name]}</svg>;
}

// ── Estilos compartilhados ──────────────────────────────────────────────────
const btnPrimary: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", background: "linear-gradient(180deg,#D7B25E,#C19736)", color: "#1A1407", border: "none", fontFamily: "inherit", fontWeight: 600, fontSize: 13.5, padding: "10px 17px", borderRadius: 11, boxShadow: "0 6px 18px -6px rgba(201,162,75,.5)" };
const btnGhost: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.border}`, color: C.text2, fontFamily: "inherit", fontWeight: 500, fontSize: 13.5, padding: "10px 17px", borderRadius: 11, cursor: "pointer" };
const fgInput: React.CSSProperties = { width: "100%", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, fontFamily: "inherit", fontSize: 13.5, padding: "9px 12px", outline: "none", boxSizing: "border-box" };
const chk: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.text2, alignSelf: "end", paddingBottom: 14 };
const drSecLab: React.CSSProperties = { fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: C.muted, margin: "4px 0 12px" };
const drClose: React.CSSProperties = { position: "absolute", top: 22, right: 22, background: C.surface2, border: `1px solid ${C.border}`, color: C.text2, width: 34, height: 34, borderRadius: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
const scrim: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(8,9,12,.6)", backdropFilter: "blur(2px)", zIndex: 40, transition: "opacity .25s" };
const drawer: React.CSSProperties = { position: "fixed", top: 0, right: 0, bottom: 0, width: "min(540px, 94vw)", background: C.surface, borderLeft: `1px solid ${C.border}`, boxShadow: "0 18px 50px -12px rgba(0,0,0,.55)", transition: "transform .28s cubic-bezier(.4,0,.2,1)", zIndex: 50, overflowY: "auto", ...VARS };
const modal: React.CSSProperties = { position: "fixed", top: "50%", left: "50%", width: "min(560px, 94vw)", maxHeight: "90vh", overflowY: "auto", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, boxShadow: "0 18px 50px -12px rgba(0,0,0,.55)", zIndex: 50, transition: ".24s cubic-bezier(.4,0,.2,1)", color: C.text, fontFamily: "var(--font-inter), system-ui, sans-serif", ...VARS };
