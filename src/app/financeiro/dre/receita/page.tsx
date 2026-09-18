"use client";

import Link from "next/link";
import { Fragment, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  AreaChart, Area,
  ComposedChart, Bar, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useUnit } from "@ork/auth/context";
import { TopProdutosTable } from "@/components/financeiro/TopProdutosTable";

// Pelo shell, as APIs passam pelo rewrite /financeiro/api/*. No domínio direto
// do sub-app (e no dev :3001), os Route Handlers vivem em /api/*.
const API_BASE =
  typeof window !== "undefined" &&
  (window.location.hostname === "ork-financeiro.vercel.app" || window.location.port === "3001")
    ? ""
    : "/financeiro";

async function fetchApiJson<T>(path: string, init?: RequestInit): Promise<{ response: Response; json: T }> {
  const bases = API_BASE ? [API_BASE, ""] : ["", "/financeiro"];
  let lastError = "API indisponível";
  for (const base of bases) {
    const response = await fetch(`${base}${path}`, init);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return { response, json: await response.json() as T };
    }
    lastError = `A API respondeu HTTP ${response.status} em ${base || "direto"}`;
  }
  throw new Error(`${lastError}. Atualize a página e tente novamente.`);
}

// ── Color tokens ─────────────────────────────────────────────────────────────
const C = {
  receita:  "#34d399",
  meta:     "#fbbf24",
  almoco:   "#f59e0b",
  jantar:   "#818cf8",
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

// ── Types ────────────────────────────────────────────────────────────────────
type Workday = {
  id: string;
  data: string;
  turno: string | null;
  receita_bruta_real: number; // PREVISTO no workday inteiro; consumo do turno quando a linha vem de um split almoço/jantar
  recebido_real: number | null; // SUM(valor_recebido) — o que entrou no caixa; null quando não aplicável (split por turno)
  devedor_real: number | null;  // receita_bruta_real - recebido_real; null no split (não há fechado/recebido por turno)
  previsto: number | null; // campo bruto do dia inteiro (mesmo valor nas 2 linhas de um split) — fonte de verdade do total do dia
  devedor: number | null;  // devedor do dia inteiro (idem) — usar este, não devedor_real, pro total do dia
  desconto: number | null;
  gorjeta: number | null;
  custo: number | null;
  cmv_pct: number | null;
  clientes: number | null;
  ticket_medio: number | null;
  _derivado_de_dia_inteiro?: boolean;
};

type DayGroup = {
  date: string;
  rows: Workday[];
  totalReceita: number;
  totalRecebido: number;
  totalDevedor: number;
  totalGorjeta: number;
  totalClientes: number;
  desconto: number;
  cmv_pct: number | null;
  ticketMedio: number | null;
};

type Pagamento     = { workday_id_fk: string; forma: string; valor_recebido: number | null };
type Desconto      = { workday_id_fk: string; motivo: string; qtd: number | null; consumo: number | null };
type Ambiente      = { workday_id_fk: string; ambiente: string; produto: number | null; clientes: number | null };
type Turno         = { turno: string; produto: number | null; clientes: number | null };
type Grupo         = { grupo: string; bruto: number | null; pct_bruto: number | null };
type MetaDiaSemana = { dia_semana: number; meta: number };
type MetaOverride  = { data: string; meta: number };
type Horario         = { workday_id_fk: string; hora: number; clientes: number | null; gorjeta: number | null; produto: number | null; consumo: number | null };
type Usuario         = { workday_id_fk: string; usuario: string; qtd: number | null; gorjeta: number | null; produto: number | null; consumo: number | null };
type Caixa           = { workday_id_fk: string; operador: string; total_fechado: number | null; total_recebido: number | null; diferenca: number | null };
type ProdutoDia           = { workday_id_fk: string; grupo: string; produto: string; qtd: number | null; cmv_pct: number | null; bruto: number | null; desconto: number | null; gorjeta: number | null; total: number | null };
type DescontoDetalhe      = { workday_id_fk: string; item: string; usuario: string; motivo: string; qtd: number | null; valor: number | null };
type Cancelamento         = { workday_id_fk: string; motivo: string; qtd: number | null; consumo: number | null };
type CancelamentoDetalhe  = { workday_id_fk: string; item: string; usuario: string; motivo: string; qtd: number | null; valor: number | null };

// ── Formatters ───────────────────────────────────────────────────────────────
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmt = (n: number) => BRL.format(n);
const pct = (v: number | null | undefined, digits = 1) =>
  v != null ? `${v.toFixed(digits)}%` : "—";
const DIAS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES   = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function aggByKey<T>(rows: T[], keyFn: (r: T) => string, valFn: (r: T) => number) {
  const map = new Map<string, number>();
  for (const r of rows) { const k = keyFn(r); map.set(k, (map.get(k) ?? 0) + valFn(r)); }
  return Array.from(map.entries()).map(([key, total]) => ({ key, total })).sort((a, b) => b.total - a.total);
}

// Um workday "dia_inteiro" vira 2 linhas na API (id "uuid::almoco" / "uuid::jantar"),
// cada uma com receita_bruta_real = consumo DO TURNO — mas previsto/devedor são do
// workday INTEIRO e vêm repetidos nas 2 linhas. Somar receita_bruta_real das 2 linhas
// direto dá o total errado (perde a pendência antiga embutida no previsto). Aqui
// deduplicamos por workday original antes de somar: cada workday entra 1x, usando
// previsto quando existe (senão cai pra soma dos turnos daquele mesmo workday).
function dedupByOrigWorkday(rows: Workday[]): Array<{ receita: number; devedor: number }> {
  const map = new Map<string, { previsto: number | null; devedor: number | null; somaTurnos: number }>();
  for (const r of rows) {
    const origId = r.id.includes("::") ? r.id.split("::")[0]! : r.id;
    if (!map.has(origId)) map.set(origId, { previsto: r.previsto, devedor: r.devedor, somaTurnos: 0 });
    map.get(origId)!.somaTurnos += r.receita_bruta_real;
  }
  return Array.from(map.values()).map((v) => ({
    receita: v.previsto ?? v.somaTurnos,
    devedor: v.devedor ?? 0,
  }));
}

// ── Count-up hook ─────────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 600): number {
  const [val, setVal] = useState(0);
  const rafRef = useRef<number>(0);
  const prevRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevRef.current === target) return;
    prevRef.current = target;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      rafRef.current = requestAnimationFrame(() => setVal(target)); return () => cancelAnimationFrame(rafRef.current);
    }
    cancelAnimationFrame(rafRef.current);
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(target * e);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else setVal(target);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return val;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ReceitaPage() {
  const { unit } = useUnit();
  const today = new Date();
  const [mes, setMes] = useState(today.getMonth() + 1);
  const [ano, setAno] = useState(today.getFullYear());
  const [showImport, setShowImport] = useState(false);
  const [isReloading, setLoading] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loadKey = `${unit?.id}|${ano}|${mes}`;
  const loading = Boolean(unit) && (isReloading || loadedKey !== loadKey);

  const [workdays,       setWorkdays]       = useState<Workday[]>([]);
  const [pagamentos,     setPagamentos]     = useState<Pagamento[]>([]);
  const [descontos,      setDescontos]      = useState<Desconto[]>([]);
  const [ambientes,      setAmbientes]      = useState<Ambiente[]>([]);
  const [turnos,         setTurnos]         = useState<Turno[]>([]);
  const [grupos,         setGrupos]         = useState<Grupo[]>([]);
  const [metaReceita,    setMetaReceita]    = useState<number | null>(null);
  const [metasDiaSemana, setMetasDiaSemana] = useState<MetaDiaSemana[]>([]);
  const [metasOverride,  setMetasOverride]  = useState<MetaOverride[]>([]);
  const [metaEdits,      setMetaEdits]      = useState<Map<string, number | null>>(new Map());
  const [savingMetas,    setSavingMetas]    = useState(false);
  const [metaSaveMsg,    setMetaSaveMsg]    = useState<{ ok: boolean; text: string } | null>(null);
  const [expandedDates,  setExpandedDates]  = useState<Set<string>>(new Set());
  const [horarios,       setHorarios]       = useState<Horario[]>([]);
  const [usuarios,       setUsuarios]       = useState<Usuario[]>([]);
  const [caixas,         setCaixas]         = useState<Caixa[]>([]);
  const [selectedDate,     setSelectedDate]     = useState<string | null>(null);
  const [produtosDia,      setProdutosDia]      = useState<ProdutoDia[]>([]);
  const [descontosDetalhe,    setDescontosDetalhe]    = useState<DescontoDetalhe[]>([]);
  const [cancelamentos,       setCancelamentos]        = useState<Cancelamento[]>([]);
  const [cancelamentosDetalhe, setCancelamentosDetalhe] = useState<CancelamentoDetalhe[]>([]);

  const movRef   = useRef<HTMLInputElement>(null);
  const vendaRef = useRef<HTMLInputElement>(null);
  const caixasRef = useRef<HTMLInputElement>(null);
  const excelRef = useRef<HTMLInputElement>(null);
  const [movFile,   setMovFile]   = useState<File | null>(null);
  const [vendaFile, setVendaFile] = useState<File | null>(null);
  const [caixaFiles, setCaixaFiles] = useState<File[]>([]);
  const [excelFiles, setExcelFiles] = useState<File[]>([]);
  const [importing,     setImporting]     = useState(false);
  const [importMsg,     setImportMsg]     = useState<{ ok: boolean; text: string } | null>(null);
  const [importProgress, setImportProgress] = useState<string>("");
  const [dbError, setDbError] = useState<string | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  const requestIdRef = useRef(0);
  async function loadData(signal?: AbortSignal) {
    const requestId = ++requestIdRef.current;
    if (!unit) return;
    const mm    = String(mes).padStart(2, "0");
    const start = `${ano}-${mm}-01`;
    const end   = new Date(ano, mes, 0).toISOString().split("T")[0]!;
    try {
      const params = new URLSearchParams({ unit_id: unit.id, start, end, mes_ano: `${ano}-${mm}` });
      const { response: res, json } = await fetchApiJson<{ error?: string; latestDataDate?: string; workdays?: Workday[]; pagamentos?: Pagamento[]; descontos?: Desconto[]; ambientes?: Ambiente[]; turnos?: Turno[]; grupos?: Grupo[]; meta?: number; metasDiaSemana?: MetaDiaSemana[]; metasOverride?: MetaOverride[]; horarios?: Horario[]; usuarios?: Usuario[]; caixas?: Caixa[]; produtosDia?: ProdutoDia[]; descontosDetalhe?: DescontoDetalhe[]; cancelamentos?: Cancelamento[]; cancelamentosDetalhe?: CancelamentoDetalhe[] }>(`/api/receita/workdays?${params}`, { signal });
      if (signal?.aborted || requestId !== requestIdRef.current) return;
      if (!res.ok) { setDbError(json.error ?? `HTTP ${res.status}`); setLoading(false); return; }
      if ((json.workdays?.length ?? 0) === 0 && json.latestDataDate) {
        const [latestYear, latestMonth] = String(json.latestDataDate).split("-").map(Number);
        if (latestYear && latestMonth && (latestYear !== ano || latestMonth !== mes)) {
          setAno(latestYear);
          setMes(latestMonth);
          return;
        }
      }
      setWorkdays(json.workdays         ?? []);
      setPagamentos(json.pagamentos     ?? []);
      setDescontos(json.descontos       ?? []);
      setAmbientes(json.ambientes       ?? []);
      setTurnos(json.turnos             ?? []);
      setGrupos(json.grupos             ?? []);
      setMetaReceita(json.meta          ?? null);
      setMetasDiaSemana(json.metasDiaSemana ?? []);
      setMetasOverride(json.metasOverride   ?? []);
      setHorarios(json.horarios             ?? []);
      setUsuarios(json.usuarios             ?? []);
      setCaixas(json.caixas                 ?? []);
      setProdutosDia(json.produtosDia       ?? []);
      setDescontosDetalhe(json.descontosDetalhe       ?? []);
      setCancelamentos(json.cancelamentos             ?? []);
      setCancelamentosDetalhe(json.cancelamentosDetalhe ?? []);
      const initDates = [...new Set<string>((json.workdays as Workday[]).map((w) => w.data))].sort((a, b) => b.localeCompare(a));
      setSelectedDate(initDates[0] ?? null);
      setMetaEdits(new Map()); setMetaSaveMsg(null); setExpandedDates(new Set()); setDbError(null);
    } catch (e) { if (!signal?.aborted && requestId === requestIdRef.current) setDbError(String(e)); }
    finally { if (!signal?.aborted && requestId === requestIdRef.current) { setLoadedKey(loadKey); setLoading(false); } }
  }

  const refreshOnChange = useEffectEvent((signal: AbortSignal) => loadData(signal));
  useEffect(() => {
    const controller = new AbortController();
    // State writes happen after the awaited request; cleanup rejects stale responses.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshOnChange(controller.signal);
    return () => controller.abort();
  }, [unit?.id, mes, ano]);

  // ── Import ─────────────────────────────────────────────────────────────────
  async function handleImport() {
    if (!unit) return;
    setImporting(true); setImportMsg(null);
    const steps: { tipo: string; arquivo: File; label: string }[] = [];
    if (movFile)   steps.push({ tipo: "movimento", arquivo: movFile,   label: "Movimento" });
    if (vendaFile) steps.push({ tipo: "venda",     arquivo: vendaFile, label: "Venda" });
    caixaFiles.forEach((f, i) =>
      steps.push({ tipo: "caixa", arquivo: f, label: `Caixa${caixaFiles.length > 1 ? ` ${i + 1}` : ""}` }));
    const allErrors: string[] = []; const importSummaries: string[] = []; let workdayId: string | null = null;
    try {
      for (let i = 0; i < steps.length; i++) {
        const { tipo, arquivo, label } = steps[i]!;
        setImportProgress(`${i + 1}/${steps.length} — ${label}…`);
        const fd = new FormData();
        fd.append("tipo", tipo); fd.append("arquivo", arquivo); fd.append("unit_id", unit.id);
        if (workdayId) fd.append("workday_id", workdayId);
        let json: { success: boolean; workday_id?: string | null; errors?: string[] };
        try { ({ json } = await fetchApiJson<typeof json>("/api/receita/import", { method: "POST", body: fd })); }
        catch (e) { allErrors.push(`${label}: ${String(e)}`); continue; }
        if (json.errors?.length) allErrors.push(...json.errors);
        if (json.workday_id) workdayId = json.workday_id;
      }
      if (excelFiles.length) {
        setImportProgress(`Importando ${excelFiles.length} planilha(s) Excel…`);
        const fd = new FormData();
        fd.append("unit_id", unit.id);
        excelFiles.forEach((file) => fd.append("arquivos", file));
        const { response, json } = await fetchApiJson<{ error?: string; pedidos?: number; dias?: number; total_bruto?: number }>("/api/receita/import-sales-xlsx", { method: "POST", body: fd });
        if (!response.ok) allErrors.push(json.error ?? `Excel: HTTP ${response.status}`);
        else importSummaries.push(`${json.pedidos ?? 0} pedidos · ${json.dias ?? 0} dias · ${fmt(json.total_bruto ?? 0)}`);
      }
      if (!allErrors.length) {
        setImportMsg({ ok: true, text: importSummaries.length ? `Importado: ${importSummaries.join(" | ")}` : "Importado com sucesso!" });
        setMovFile(null); setVendaFile(null); setCaixaFiles([]); setExcelFiles([]); setShowImport(false);
        await loadData();
      } else { setImportMsg({ ok: false, text: allErrors.join(" | ") }); }
    } catch (e) { setImportMsg({ ok: false, text: String(e) }); }
    finally { setImporting(false); setImportProgress(""); }
  }

  // ── Save metas ─────────────────────────────────────────────────────────────
  async function handleSaveMetas() {
    if (!unit) return;
    setSavingMetas(true); setMetaSaveMsg(null);
    try {
      const overrides = Array.from(metaEdits.entries()).map(([data, meta]) => ({ data, meta }));
      const { response: res, json } = await fetchApiJson<{ error?: string }>("/api/receita/metas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit_id: unit.id, overrides }),
      });
      if (!res.ok) { setMetaSaveMsg({ ok: false, text: json.error ?? `HTTP ${res.status}` }); }
      else { setMetaSaveMsg({ ok: true, text: "Metas salvas!" }); setMetaEdits(new Map()); await loadData(); }
    } catch (e) { setMetaSaveMsg({ ok: false, text: String(e) }); }
    finally { setSavingMetas(false); }
  }

  // ── Aggregations ───────────────────────────────────────────────────────────
  const workdaysDeduped = dedupByOrigWorkday(workdays);
  const totalBruto    = workdaysDeduped.reduce((s, w) => s + w.receita, 0);
  const totalRecebido = workdays.reduce((s, w) => s + (w.recebido_real ?? 0), 0);
  const totalDevedor  = workdaysDeduped.reduce((s, w) => s + w.devedor, 0);
  const totalDesconto = workdays.reduce((s, w) => s + (w.desconto ?? 0), 0);
  const totalGorjeta  = workdays.reduce((s, w) => s + (w.gorjeta  ?? 0), 0);
  const totalLiquida  = totalBruto - totalDesconto;
  const totalClientes = workdays.reduce((s, w) => s + (w.clientes ?? 0), 0);
  const ticketMedio   = totalClientes > 0 ? totalBruto / totalClientes : null;
  const atingMeta     = metaReceita && metaReceita > 0 ? (totalBruto / metaReceita) * 100 : null;

  const metaByDiaSemana   = new Map<number, number>(metasDiaSemana.map((m) => [m.dia_semana, m.meta]));
  const metaOverrideByData = new Map<string, number>(metasOverride.map((o) => [o.data, o.meta]));

  const resolveMetaForDate = (data: string): number | null => {
    if (metaOverrideByData.has(data)) return metaOverrideByData.get(data)!;
    const ds = new Date(data + "T12:00:00").getDay();
    return metaByDiaSemana.get(ds) ?? null;
  };

  const pagAgg  = aggByKey(pagamentos, (p) => p.forma,    (p) => p.valor_recebido ?? 0);
  const descAgg = aggByKey(descontos,  (d) => d.motivo,   (d) => d.consumo ?? 0);
  const ambAgg  = aggByKey(ambientes,  (a) => a.ambiente, (a) => a.produto ?? 0);
  const turAgg  = aggByKey(turnos,     (t) => t.turno,    (t) => t.produto ?? 0);

  const gruposAgg = (() => {
    const map = new Map<string, number>();
    for (const g of grupos) map.set(g.grupo, (map.get(g.grupo) ?? 0) + (g.bruto ?? 0));
    return Array.from(map.entries())
      .map(([grupo, bruto]) => ({ grupo, bruto, pct: totalBruto > 0 ? (bruto / totalBruto) * 100 : 0 }))
      .sort((a, b) => b.bruto - a.bruto).slice(0, 8);
  })();

  // Day groups
  const dayGroups: DayGroup[] = (() => {
    const map = new Map<string, Workday[]>();
    for (const w of workdays) { if (!map.has(w.data)) map.set(w.data, []); map.get(w.data)!.push(w); }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([date, rows]) => {
      const deduped        = dedupByOrigWorkday(rows);
      const totalReceita   = deduped.reduce((s, w) => s + w.receita, 0);
      const totalDevedorDia = deduped.reduce((s, w) => s + w.devedor, 0);
      const totalRecebido  = rows.reduce((s, r) => s + (r.recebido_real ?? 0), 0);
      const totalGorjeta   = rows.reduce((s, r) => s + (r.gorjeta ?? 0), 0);
      const totalClientes  = rows.reduce((s, r) => s + (r.clientes ?? 0), 0);
      const first = rows[0]!;
      return { date, rows, totalReceita, totalRecebido, totalDevedor: totalDevedorDia,
        totalGorjeta, totalClientes,
        desconto: first.desconto ?? 0, cmv_pct: first.cmv_pct ?? null,
        ticketMedio: totalClientes > 0 ? totalReceita / totalClientes : null };
    });
  })();

  // Reaproveita o total já deduplicado de cada dayGroup (não soma turnos direto —
  // mesmo motivo do totalBruto/dayGroups acima).
  const receitaByData = new Map<string, number>(dayGroups.map((g) => [g.date, g.totalReceita]));

  // ── Day detail ─────────────────────────────────────────────────────────────
  const availableDates = [...new Set(workdays.map((w) => w.data))].sort((a, b) => b.localeCompare(a));

  // original workday id (without "::turno" suffix) → turno
  const turnoByOrigId = new Map<string, string | null>();
  for (const w of workdays) {
    const origId = w.id.includes("::") ? w.id.split("::")[0]! : w.id;
    if (!turnoByOrigId.has(origId)) turnoByOrigId.set(origId, w.turno);
  }

  const selOrigIds = new Set<string>(
    workdays
      .filter((w) => w.data === selectedDate)
      .map((w) => (w.id.includes("::") ? w.id.split("::")[0]! : w.id)),
  );

  const dayCaixas          = caixas.filter((c) => selOrigIds.has(c.workday_id_fk));
  const dayHorarios        = horarios.filter((h) => selOrigIds.has(h.workday_id_fk));
  const dayAmbientes       = ambientes.filter((a) => selOrigIds.has(a.workday_id_fk));
  const dayUsuarios        = usuarios.filter((u) => selOrigIds.has(u.workday_id_fk));
  const dayDescontos       = descontos.filter((d) => selOrigIds.has(d.workday_id_fk));
  const dayProdutos        = produtosDia.filter((p) => selOrigIds.has(p.workday_id_fk));

  const top60Mes = useMemo(() => {
    const map = new Map<string, { produto: string; grupo: string; qtd: number; total: number }>();
    for (const p of produtosDia) {
      const key = `${p.grupo}::${p.produto}`;
      const ex = map.get(key);
      if (ex) { ex.qtd += p.qtd ?? 0; ex.total += p.total ?? 0; }
      else map.set(key, { produto: p.produto, grupo: p.grupo, qtd: p.qtd ?? 0, total: p.total ?? 0 });
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 60);
  }, [produtosDia]);
  const dayDescontosDetlh      = descontosDetalhe.filter((d) => selOrigIds.has(d.workday_id_fk));
  const dayCancelamentos       = cancelamentos.filter((c) => selOrigIds.has(c.workday_id_fk));
  const dayCancelamentosDetlh  = cancelamentosDetalhe.filter((c) => selOrigIds.has(c.workday_id_fk));
  const hasMultipleTurnos  = (dayGroups.find((g) => g.date === selectedDate)?.rows.length ?? 0) > 1;

  // Chart + sparkline
  const chartData = Array.from(receitaByData.entries()).sort(([a], [b]) => a.localeCompare(b))
    .map(([data, bruto]) => ({ dia: data.slice(8), data, bruto, meta: resolveMetaForDate(data) }));

  const sparkReceita  = chartData.slice(-14).map((d) => ({ v: d.bruto }));
  const sparkClientes = (() => {
    const m = new Map<string, number>();
    for (const w of workdays) m.set(w.data, (m.get(w.data) ?? 0) + (w.clientes ?? 0));
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([, v]) => ({ v }));
  })();

  // Expansion
  const allDates   = dayGroups.map((g) => g.date);
  const allExpanded = allDates.length > 0 && allDates.every((d) => expandedDates.has(d));
  const toggleAll  = () => setExpandedDates(allExpanded ? new Set() : new Set(allDates));
  const toggleDate = (date: string) => setExpandedDates((prev) => {
    const next = new Set(prev); if (next.has(date)) next.delete(date); else next.add(date); return next;
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  const mesLabel = `${MESES[mes - 1]} ${ano}`;
  const hasData  = workdays.length > 0;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>

      {/* Header */}
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.6, margin: 0 }}>Receita</h1>
          <p style={{ fontSize: 13, color: C.text3, marginTop: 4 }}>{unit?.name ?? "—"} · {mesLabel}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} style={selectStyle}>
            {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))} style={selectStyle}>
            {Array.from({ length: 9 }, (_, i) => new Date().getFullYear() - 7 + i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => { setShowImport((v) => !v); setImportMsg(null); }} style={{
            padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: showImport ? C.surface3 : C.brand, color: showImport ? C.text : "#fff",
            border: "none", cursor: "pointer",
          }}>
            {showImport ? "Fechar" : "Importar arquivos"}
          </button>
          <Link href="/financeiro/dre/receita/import-lote" prefetch={false} style={{
            padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: C.surface3, color: C.text2, border: `1px solid ${C.border}`,
            textDecoration: "none", display: "inline-block",
          }}>
            Importar em lote
          </Link>
        </div>
      </header>

      {/* Import panel */}
      {showImport && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: "0 0 16px" }}>Importar relatórios PDF ou Excel</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 16, marginBottom: 16 }}>
            <FileSlot label="Movimento" accept=".pdf" inputRef={movRef}   file={movFile}   onChange={setMovFile} />
            <FileSlot label="Venda"     accept=".pdf" inputRef={vendaRef} file={vendaFile} onChange={setVendaFile} />
            <MultiFileSlot label="Caixa(s)" accept=".pdf" inputRef={caixasRef} files={caixaFiles} onChange={setCaixaFiles} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <MultiFileSlot label="Relatório Geral de Vendas (Excel)" accept=".xlsx,.xls" inputRef={excelRef} files={excelFiles} onChange={setExcelFiles} />
          </div>
          {importProgress && <p style={{ fontSize: 13, color: C.text3, marginBottom: 12 }}>⏳ {importProgress}</p>}
          {importMsg && (
            <div style={{
              padding: "10px 14px", borderRadius: 8, marginBottom: 12, fontSize: 13,
              background: importMsg.ok ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)",
              color: importMsg.ok ? C.receita : C.alerta,
              border: `1px solid ${importMsg.ok ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
            }}>
              {importMsg.ok ? "✓ " : "✗ "}{importMsg.text}
            </div>
          )}
          <button disabled={importing || (!movFile && !vendaFile && !caixaFiles.length && !excelFiles.length)} onClick={handleImport} style={{
            padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: importing ? C.surface3 : C.brand, color: importing ? C.text3 : "#fff",
            border: "none", cursor: importing ? "not-allowed" : "pointer",
            opacity: (!movFile && !vendaFile && !caixaFiles.length && !excelFiles.length) ? 0.4 : 1,
          }}>
            {importing ? "Processando…" : "Processar e importar"}
          </button>
        </div>
      )}

      {loading && <div style={{ textAlign: "center", padding: "40px 0", color: C.text3, fontSize: 14 }}>Carregando…</div>}

      {!loading && !hasData && (
        <div style={{ textAlign: "center", padding: "60px 0", color: C.text3, fontSize: 14 }}>
          {dbError ? <span style={{ color: C.alerta }}>Erro: {dbError}</span>
            : <>Sem dados para {mesLabel}. Importe PDFs do Lorean ou o Relatório Geral de Vendas em Excel.</>}
        </div>
      )}

      {!loading && hasData && (
        <>
          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 28 }}>
            <KpiCardAnimated label="Receita Bruta"   rawValue={totalBruto}    format={fmt} sparkData={sparkReceita}
              sub={atingMeta != null ? `${atingMeta.toFixed(1)}% da meta` : undefined}
              alert={atingMeta != null && atingMeta < 90} ok={atingMeta != null && atingMeta >= 100} />
            <KpiCardAnimated label="Recebido"        rawValue={totalRecebido} format={fmt} sparkData={sparkReceita}
              sub={totalBruto > 0 ? pct((totalRecebido / totalBruto) * 100) + " do bruto" : undefined} />
            <KpiCardAnimated label="Pendência / Ajuste" rawValue={totalDevedor} format={fmt} sparkData={sparkReceita}
              sub={totalBruto > 0 && totalDevedor > 0 ? pct((totalDevedor / totalBruto) * 100) + " pendente" : undefined}
              alert={totalDevedor > 0} />
            <KpiCardAnimated label="Desconto"        rawValue={totalDesconto} format={fmt} sparkData={sparkReceita}
              sub={totalBruto > 0 ? pct((totalDesconto / totalBruto) * 100) + " da bruta" : undefined}
              alert={totalBruto > 0 && totalDesconto / totalBruto > 0.08} />
            <KpiCardAnimated label="Gorjeta"         rawValue={totalGorjeta}  format={fmt} sparkData={sparkReceita}
              sub={totalBruto > 0 ? pct((totalGorjeta / totalBruto) * 100) + " cobrado" : undefined} />
            <KpiCardAnimated label="Receita Líquida" rawValue={totalLiquida}  format={fmt} sparkData={sparkReceita} />
            <KpiCardAnimated label="Clientes"        rawValue={totalClientes}
              format={(n) => Math.round(n).toLocaleString("pt-BR")} sparkData={sparkClientes} />
            <KpiCardAnimated label="Ticket Médio"    rawValue={ticketMedio ?? 0}
              format={ticketMedio != null ? fmt : () => "—"} sparkData={sparkReceita} />
          </div>

          {/* Tabela agrupada por dia */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 28 }}>
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Dia a dia</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {metaSaveMsg && (
                  <span style={{ fontSize: 12, color: metaSaveMsg.ok ? C.receita : C.alerta }}>
                    {metaSaveMsg.ok ? "✓ " : "✗ "}{metaSaveMsg.text}
                  </span>
                )}
                {metaEdits.size > 0 && (
                  <button onClick={handleSaveMetas} disabled={savingMetas} style={{
                    padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600,
                    background: savingMetas ? C.surface3 : C.brand, color: savingMetas ? C.text3 : "#fff",
                    border: "none", cursor: savingMetas ? "not-allowed" : "pointer",
                  }}>
                    {savingMetas ? "Salvando…" : "Salvar metas"}
                  </button>
                )}
                <button onClick={toggleAll} style={{
                  padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 500,
                  background: C.surface3, color: C.text2, border: "none", cursor: "pointer",
                }}>
                  {allExpanded ? "Recolher todos" : "Expandir todos"}
                </button>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: C.surface2 }}>
                    <th style={{ width: 36, padding: "8px 0 8px 12px", borderBottom: `1px solid ${C.border}` }} />
                    {["Data / Dia", "Bruto", "Devedor", "Meta", "Ating.%", "Desconto", "Gorjeta", "Clientes", "Ticket", "CMV%"].map((h) => (
                      <th key={h} style={{
                        padding: "8px 12px", textAlign: h === "Data / Dia" ? "left" : "right",
                        fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase",
                        color: C.text3, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayGroups.map((g) => {
                    const meta       = resolveMetaForDate(g.date);
                    const atingPct   = meta && meta > 0 ? Math.min((g.totalReceita / meta) * 100, 100) : null;
                    const atingFull  = meta && meta > 0 ? (g.totalReceita / meta) * 100 : null;
                    const isExpanded = expandedDates.has(g.date);
                    const hasMultiple = g.rows.length > 1;

                    const leftBorder = meta == null ? "transparent"
                      : g.totalReceita >= meta ? C.receita
                      : g.totalReceita >= meta * 0.7 ? C.meta : C.alerta;

                    const rowBg = atingPct != null
                      ? "linear-gradient(90deg, rgba(52,211,153,0.10) 0%, rgba(52,211,153,0.04) 100%)"
                      : undefined;

                    const pendingMeta = metaEdits.get(g.date);
                    const inputVal    = pendingMeta !== undefined
                      ? (pendingMeta == null ? "" : String(pendingMeta))
                      : (meta != null ? String(meta) : "");

                    const dt = new Date(g.date + "T12:00:00");

                    return (
                      <Fragment key={g.date}>
                        {/* Master row */}
                        <tr style={{ borderBottom: `1px solid ${C.border}`, background: rowBg }}>
                          <td style={{ padding: "10px 0 10px 12px", width: 36, verticalAlign: "middle" }}>
                            {hasMultiple && (
                              <button aria-expanded={isExpanded} onClick={() => toggleDate(g.date)} style={{
                                background: "none", border: "none", cursor: "pointer",
                                color: C.text3, fontSize: 16, padding: "2px 4px", lineHeight: 1,
                                display: "inline-block",
                                transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                                transition: "transform 200ms ease",
                              }}>›</button>
                            )}
                          </td>
                          <td style={{ padding: "10px 12px", borderLeft: `2px solid ${leftBorder}`, fontWeight: 600, color: C.text2, whiteSpace: "nowrap" }}>
                            {g.date.split("-").reverse().join("/")} <span style={{ color: C.text3, fontWeight: 400, marginLeft: 4 }}>{DIAS_PT[dt.getDay()]}</span>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: C.text2, fontWeight: 600 }}>{fmt(g.totalReceita)}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: g.totalDevedor > 0 ? 700 : 400,
                            color: g.totalDevedor > 0 ? C.alerta : C.text3 }}>
                            {g.totalDevedor > 0 ? fmt(g.totalDevedor) : "—"}
                          </td>
                          <td style={{ padding: "6px 12px", textAlign: "right" }}>
                            <input type="number" min="0" step="100" value={inputVal}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const n   = raw === "" ? null : parseFloat(raw);
                                setMetaEdits((prev) => { const next = new Map(prev); next.set(g.date, (n == null || isNaN(n)) ? null : n); return next; });
                              }}
                              style={{
                                width: 88, textAlign: "right", fontSize: 12,
                                background: "transparent", border: "none",
                                borderBottom: `1px dashed ${pendingMeta !== undefined ? C.brand : "rgba(245,240,232,0.15)"}`,
                                color: pendingMeta !== undefined ? C.brand : (meta != null ? C.text2 : C.text3),
                                padding: "2px 0", outline: "none",
                              }} />
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700,
                            color: atingFull == null ? C.text3 : atingFull >= 100 ? C.receita : atingFull >= 70 ? C.meta : C.alerta }}>
                            {atingFull != null ? `${atingFull.toFixed(0)}%` : "—"}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: C.text2 }}>{fmt(g.desconto)}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: C.text2 }}>{fmt(g.totalGorjeta)}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: C.text2 }}>{g.totalClientes || "—"}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: C.text2 }}>
                            {g.ticketMedio != null ? fmt(g.ticketMedio) : "—"}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right",
                            color: g.cmv_pct != null && g.cmv_pct > 0.32 ? C.alerta : g.cmv_pct != null && g.cmv_pct > 0.28 ? C.meta : C.text2 }}>
                            {g.cmv_pct != null ? pct(g.cmv_pct * 100) : "—"}
                          </td>
                        </tr>

                        {/* Expansion row */}
                        {hasMultiple && (
                          <tr key={`${g.date}-exp`}>
                            <td colSpan={11} style={{ padding: 0, border: "none" }}>
                              <div style={{
                                maxHeight: isExpanded ? `${g.rows.length * 52}px` : "0",
                                opacity: isExpanded ? 1 : 0,
                                overflow: "hidden",
                                transition: "max-height 250ms ease-out, opacity 200ms ease-out",
                                background: C.surface2,
                              }}>
                                {g.rows.map((row) => {
                                  const tc = row.turno === "almoco" ? C.almoco : row.turno === "jantar" ? C.jantar : C.text3;
                                  const tl = row.turno === "almoco" ? "Almoço" : row.turno === "jantar" ? "Jantar" : (row.turno ?? "—");
                                  const tBg = row.turno === "almoco" ? "rgba(245,158,11,0.14)" : row.turno === "jantar" ? "rgba(129,140,248,0.14)" : "rgba(138,130,120,0.14)";
                                  return (
                                    <div key={row.id} style={{
                                      display: "flex", alignItems: "center", gap: 0,
                                      padding: "9px 12px 9px 48px",
                                      borderTop: `1px solid ${C.border}`, fontSize: 12,
                                    }}>
                                      <span style={{
                                        display: "inline-flex", alignItems: "center", padding: "2px 8px",
                                        borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                                        background: tBg, color: tc, marginRight: 16, flexShrink: 0, width: 60,
                                      }}>{tl}</span>
                                      <span style={{ color: C.text2, fontWeight: 600, width: 110, textAlign: "right", marginRight: 20 }}>
                                        {fmt(row.receita_bruta_real)}
                                      </span>
                                      <span style={{ color: C.text3, marginRight: 16 }}>Gorjeta: {fmt(row.gorjeta ?? 0)}</span>
                                      <span style={{ color: C.text3, marginRight: 16 }}>Clientes: {row.clientes ?? "—"}</span>
                                      <span style={{ color: C.text3 }}>
                                        Ticket: {row.clientes && row.clientes > 0 ? fmt(row.receita_bruta_real / row.clientes) : "—"}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: C.surface2, fontWeight: 700, borderTop: `1px solid ${C.border}` }}>
                    <td colSpan={2} style={{ padding: "10px 12px", color: C.text, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 }}>TOTAL</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: C.text }}>{fmt(totalBruto)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: totalDevedor > 0 ? C.alerta : C.text3 }}>
                      {totalDevedor > 0 ? fmt(totalDevedor) : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: C.text3 }}>{metaReceita ? fmt(metaReceita) : "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: atingMeta == null ? C.text3 : atingMeta >= 100 ? C.receita : atingMeta >= 70 ? C.meta : C.alerta }}>
                      {atingMeta != null ? `${atingMeta.toFixed(0)}%` : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: C.text }}>{fmt(totalDesconto)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: C.text }}>{fmt(totalGorjeta)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: C.text }}>{totalClientes}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: C.text }}>{ticketMedio != null ? fmt(ticketMedio) : "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: C.text3 }}>—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ── Detalhes do dia ──────────────────────────────────────────── */}
          {selectedDate && (
            <div style={{ marginBottom: 28 }}>
              {/* Seletor de dia */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Detalhes do dia</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {availableDates.map((date) => {
                    const dt = new Date(date + "T12:00:00");
                    return (
                      <button key={date} onClick={() => setSelectedDate(date)} style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                        background: selectedDate === date ? C.brand : C.surface3,
                        color: selectedDate === date ? "#fff" : C.text2,
                        border: `1px solid ${selectedDate === date ? C.brand : C.border}`,
                        cursor: "pointer",
                      }}>
                        {date.slice(8)}/{date.slice(5, 7)} {DIAS_PT[dt.getDay()]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Cards grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: 16 }}>
                <CaixaCard           caixas={dayCaixas}         turnoByOrigId={turnoByOrigId} hasMultiple={hasMultipleTurnos} />
                <TopHorariosCard     horarios={dayHorarios} />
                <AmbientesDetailCard ambientes={dayAmbientes} />
                <EquipeCard          usuarios={dayUsuarios} />
                <DescontosDetailCard descontos={dayDescontos} />
                <DescontosDetalhadosCard descontos={dayDescontosDetlh} />
                <CancelamentosCard cancelamentos={dayCancelamentos} detalhe={dayCancelamentosDetlh} />
                <div style={{ gridColumn: "1 / -1" }}>
                  <ProdutosVendidosCard produtos={dayProdutos} />
                </div>
              </div>
            </div>
          )}

          {/* Gráfico */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 20px", marginBottom: 28 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 16px" }}>Receita diária vs meta</p>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={chartData} barSize={20} margin={{ top: 4, right: 8, bottom: 0, left: 40 }}>
                <defs>
                  <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.receita} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={C.receita} stopOpacity={0.15} />
                  </linearGradient>
                  <linearGradient id="gM" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.meta} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={C.meta} stopOpacity={0.15} />
                  </linearGradient>
                  <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.alerta} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={C.alerta} stopOpacity={0.15} />
                  </linearGradient>
                  <linearGradient id="gN" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.neutro} stopOpacity={0.8} />
                    <stop offset="100%" stopColor={C.neutro} stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: C.text3 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: C.text3 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="bruto" radius={[6, 6, 0, 0]} animationDuration={800} animationEasing="ease-out">
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={
                      d.meta == null ? "url(#gN)"
                        : d.bruto >= d.meta ? "url(#gR)"
                        : d.bruto >= d.meta * 0.7 ? "url(#gM)"
                        : "url(#gA)"
                    } />
                  ))}
                </Bar>
                <Line dataKey="meta" type="monotone" stroke={C.meta} strokeDasharray="4 3" strokeWidth={1.5}
                  dot={(props: { cx?: number; cy?: number; index?: number; payload?: { meta?: number; bruto?: number } }) => {
                    const item = chartData[props.index ?? -1];
                    if (!item || !metaOverrideByData.has(item.data)) return <g />;
                    return <circle cx={props.cx} cy={props.cy} r={4} fill={C.meta} stroke="#1A1A18" strokeWidth={1.5} />;
                  }}
                  connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Pagamentos + Descontos */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
            <DonutCard title="Por forma de pagamento" rows={pagAgg} />
            <AnimHBarCard title="Desconto por motivo"  rows={descAgg} />
          </div>

          {/* Ambientes + Turnos */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
            <AnimHBarCard title="Por ambiente" rows={ambAgg} />
            <AnimHBarCard title="Por turno"    rows={turAgg} />
          </div>

          {/* Grupos */}
          {gruposAgg.length > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 20px", marginBottom: 28 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 16px" }}>Top grupos de produto</p>
              <AnimHBarRows rows={gruposAgg.map((g) => ({ key: g.grupo, total: g.bruto }))} total={totalBruto} />
            </div>
          )}

          {/* Top 60 produtos do mês */}
          <div style={{ marginBottom: 28 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>
              Top 60 produtos · {mesLabel}
            </p>
            <TopProdutosTable produtos={top60Mes} />
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCardAnimated({ label, rawValue, format, sparkData, sub, alert, ok }: {
  label: string; rawValue: number; format: (n: number) => string;
  sparkData: { v: number }[]; sub?: string; alert?: boolean; ok?: boolean;
}) {
  const animVal    = useCountUp(rawValue);
  const color      = alert ? C.alerta : ok ? C.receita : C.text;
  const sparkColor = alert ? C.alerta : ok ? C.receita : C.text3;

  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${alert ? "rgba(248,113,113,0.3)" : ok ? "rgba(52,211,153,0.3)" : C.border}`,
        borderRadius: 10, padding: "16px 18px",
        transition: "transform 200ms ease, box-shadow 200ms ease", cursor: "default",
      }}
      onMouseEnter={(e) => { const el = e.currentTarget; el.style.transform = "translateY(-2px)"; el.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)"; }}
      onMouseLeave={(e) => { const el = e.currentTarget; el.style.transform = ""; el.style.boxShadow = ""; }}
    >
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: C.text3, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, letterSpacing: -0.4 }}>{format(animVal)}</div>
      {sub && <div style={{ fontSize: 11, color: C.text3, marginTop: 3 }}>{sub}</div>}
      {sparkData.length > 1 && (
        <div style={{ height: 40, marginTop: 8 }}>
          <SparklineChart data={sparkData} color={sparkColor} id={label} />
        </div>
      )}
    </div>
  );
}

function SparklineChart({ data, color, id }: { data: { v: number }[]; color: string; id: string }) {
  const gradId = `sp-${id.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ dataKey?: string | number; value?: number | null }> }) {
  if (!active || !payload?.length) return null;
  const bruto = payload.find((p) => p.dataKey === "bruto")?.value as number ?? 0;
  const meta  = payload.find((p) => p.dataKey === "meta")?.value as number | null ?? null;
  const ating = meta && meta > 0 ? (bruto / meta) * 100 : null;
  return (
    <div style={{
      background: "rgba(13,13,12,0.88)", backdropFilter: "blur(12px)",
      border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 16px", fontSize: 12, minWidth: 155,
    }}>
      <TRow label="Receita" value={fmt(bruto)} color={C.receita} />
      {meta != null && <TRow label="Meta" value={fmt(meta)} color={C.meta} />}
      {ating != null && (
        <TRow label="Ating." value={`${ating.toFixed(0)}%`}
          color={ating >= 100 ? C.receita : ating >= 70 ? C.meta : C.alerta} />
      )}
    </div>
  );
}
function TRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 4 }}>
      <span style={{ color: C.text3 }}>{label}</span>
      <span style={{ color, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const PIE_COLORS = [C.receita, C.meta, C.jantar, C.almoco, C.alerta, C.neutro];

function DonutCard({ title, rows }: { title: string; rows: { key: string; total: number }[] }) {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const data  = rows.slice(0, 6);
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 20px" }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>{title}</p>
      {!data.length ? <p style={{ fontSize: 12, color: C.text3 }}>Sem dados</p> : (
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ position: "relative", flexShrink: 0, width: 140, height: 140 }}>
            <PieChart width={140} height={140}>
              <Pie data={data} dataKey="total" cx="50%" cy="50%" innerRadius={46} outerRadius={64} paddingAngle={2} strokeWidth={0}>
                {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
            </PieChart>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                {total > 0 ? `${((data[0]?.total ?? 0) / total * 100).toFixed(0)}%` : "—"}
              </span>
              <span style={{ fontSize: 9, color: C.text3, textAlign: "center", maxWidth: 52, lineHeight: 1.2 }}>
                {data[0]?.key ?? ""}
              </span>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
            {data.map((r, i) => (
              <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: C.text2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.key}</span>
                <span style={{ fontSize: 11, color: C.text, fontWeight: 600, flexShrink: 0 }}>
                  {total > 0 ? `${(r.total / total * 100).toFixed(1)}%` : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AnimHBarCard({ title, rows }: { title: string; rows: { key: string; total: number }[] }) {
  const total = rows.reduce((s, r) => s + r.total, 0);
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 20px" }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>{title}</p>
      {!rows.length ? <p style={{ fontSize: 12, color: C.text3 }}>Sem dados</p>
        : <AnimHBarRows rows={rows} total={total} />}
    </div>
  );
}

function AnimHBarRows({ rows, total }: { rows: { key: string; total: number }[]; total: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), 60); return () => clearTimeout(t); }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r, i) => (
        <div key={r.key}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: C.text2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{r.key}</span>
            <span style={{ fontSize: 11, color: C.text, fontWeight: 600, marginLeft: 8, flexShrink: 0 }}>{fmt(r.total)}</span>
          </div>
          <div style={{ height: 5, background: C.surface3, borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: visible ? `${total > 0 ? (r.total / total * 100).toFixed(1) : 0}%` : "0%",
              background: `linear-gradient(90deg, ${C.brand}, rgba(196,98,45,0.5))`,
              borderRadius: 3,
              transition: `width 600ms ${i * 60}ms ease-out`,
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function FileSlot({ label, accept, inputRef, file, onChange }: {
  label: string; accept: string; inputRef: React.RefObject<HTMLInputElement | null>;
  file: File | null; onChange: (f: File | null) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
      <div onClick={() => inputRef.current?.click()} style={{
        border: `1px dashed ${file ? C.brand : C.border}`, borderRadius: 8, padding: "14px 12px",
        cursor: "pointer", background: file ? "rgba(196,98,45,0.08)" : C.surface2,
        textAlign: "center", fontSize: 12, color: file ? C.brand : C.text3,
      }}>
        {file ? `✓ ${file.name}` : "Clique para selecionar PDF"}
      </div>
      <input ref={inputRef} type="file" accept={accept} style={{ display: "none" }}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </div>
  );
}

function MultiFileSlot({ label, accept, inputRef, files, onChange }: {
  label: string; accept: string; inputRef: React.RefObject<HTMLInputElement | null>;
  files: File[]; onChange: (fs: File[]) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
      <div onClick={() => inputRef.current?.click()} style={{
        border: `1px dashed ${files.length ? C.brand : C.border}`, borderRadius: 8, padding: "14px 12px",
        cursor: "pointer", background: files.length ? "rgba(196,98,45,0.08)" : C.surface2,
        textAlign: "center", fontSize: 12, color: files.length ? C.brand : C.text3,
      }}>
        {files.length ? `✓ ${files.length} arquivo(s)` : "Clique para selecionar PDFs"}
      </div>
      <input ref={inputRef} type="file" accept={accept} multiple style={{ display: "none" }}
        onChange={(e) => onChange(Array.from(e.target.files ?? []))} />
    </div>
  );
}

// ── Detail sub-components ────────────────────────────────────────────────────

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
        padding: "16px 20px", transition: "transform 200ms ease, box-shadow 200ms ease",
      }}
      onMouseEnter={(e) => { const el = e.currentTarget; el.style.transform = "translateY(-2px)"; el.style.boxShadow = "0 8px 24px rgba(0,0,0,0.3)"; }}
      onMouseLeave={(e) => { const el = e.currentTarget; el.style.transform = ""; el.style.boxShadow = ""; }}
    >
      <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 14px" }}>{title}</p>
      {children}
    </div>
  );
}

function EmptyDetail() {
  return <p style={{ fontSize: 12, color: C.text3, margin: 0 }}>Sem dados para este dia</p>;
}

function TurnoBadge({ turno }: { turno: string | null | undefined }) {
  if (!turno || turno === "dia_inteiro") return null;
  const color = turno === "almoco" ? C.almoco : C.jantar;
  const bg    = turno === "almoco" ? "rgba(245,158,11,0.14)" : "rgba(129,140,248,0.14)";
  const label = turno === "almoco" ? "Almoço" : "Jantar";
  return (
    <span style={{ display: "inline-flex", padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: bg, color }}>
      {label}
    </span>
  );
}

function CaixaCard({ caixas, turnoByOrigId, hasMultiple }: {
  caixas: Caixa[];
  turnoByOrigId: Map<string, string | null>;
  hasMultiple: boolean;
}) {
  const totFechado   = caixas.reduce((s, c) => s + (c.total_fechado   ?? 0), 0);
  const totRecebido  = caixas.reduce((s, c) => s + (c.total_recebido  ?? 0), 0);
  const totDiferenca = caixas.reduce((s, c) => s + (c.diferenca       ?? 0), 0);
  const difColor = (v: number | null) => {
    if (v == null) return C.text3;
    const a = Math.abs(v);
    return a < 1 ? C.receita : a <= 50 ? C.meta : C.alerta;
  };
  return (
    <DetailCard title="Fechamento de Caixa">
      {!caixas.length ? <EmptyDetail /> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.surface2 }}>
                {["Operador", ...(hasMultiple ? ["Turno"] : []), "Fechado", "Recebido", "Diferença"].map((h) => (
                  <th key={h} style={{ padding: "7px 10px", textAlign: h === "Operador" || h === "Turno" ? "left" : "right",
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.7, textTransform: "uppercase",
                    color: C.text3, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {caixas.map((c, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 10px", color: C.text2 }}>{c.operador}</td>
                  {hasMultiple && (
                    <td style={{ padding: "8px 10px" }}>
                      <TurnoBadge turno={turnoByOrigId.get(c.workday_id_fk)} />
                    </td>
                  )}
                  <td style={{ padding: "8px 10px", textAlign: "right", color: C.text2 }}>{fmt(c.total_fechado ?? 0)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: C.text2 }}>{fmt(c.total_recebido ?? 0)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: difColor(c.diferenca) }}>{fmt(c.diferenca ?? 0)}</td>
                </tr>
              ))}
            </tbody>
            {caixas.length > 1 && (
              <tfoot>
                <tr style={{ background: C.surface2, fontWeight: 700 }}>
                  <td colSpan={hasMultiple ? 2 : 1} style={{ padding: "8px 10px", color: C.text, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 }}>TOTAL</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: C.text }}>{fmt(totFechado)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: C.text }}>{fmt(totRecebido)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: difColor(totDiferenca) }}>{fmt(totDiferenca)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </DetailCard>
  );
}

function TopHorariosCard({ horarios }: { horarios: Horario[] }) {
  const agg = new Map<number, { clientes: number; consumo: number }>();
  for (const h of horarios) {
    const cur = agg.get(h.hora) ?? { clientes: 0, consumo: 0 };
    agg.set(h.hora, { clientes: cur.clientes + (h.clientes ?? 0), consumo: cur.consumo + (h.consumo ?? 0) });
  }
  const sorted = Array.from(agg.entries())
    .sort(([, a], [, b]) => b.consumo - a.consumo)
    .slice(0, 5);
  const maxConsumo = sorted[0]?.[1].consumo ?? 0;
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), 60); return () => clearTimeout(t); }, [horarios]);
  return (
    <DetailCard title="Top 5 Horários">
      {!sorted.length ? <EmptyDetail /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map(([hora, v], i) => (
            <div key={hora}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text2, width: 36 }}>{hora}h</span>
                <span style={{ fontSize: 11, color: C.text3 }}>{v.clientes} pax</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{fmt(v.consumo)}</span>
              </div>
              <div style={{ height: 5, background: C.surface3, borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: visible ? `${maxConsumo > 0 ? (v.consumo / maxConsumo * 100).toFixed(1) : 0}%` : "0%",
                  background: `linear-gradient(90deg, ${C.receita}, rgba(52,211,153,0.4))`,
                  borderRadius: 3,
                  transition: `width 600ms ${i * 80}ms ease-out`,
                }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </DetailCard>
  );
}

function AmbientesDetailCard({ ambientes }: { ambientes: Ambiente[] }) {
  const agg = new Map<string, { consumo: number; clientes: number }>();
  for (const a of ambientes) {
    const cur = agg.get(a.ambiente) ?? { consumo: 0, clientes: 0 };
    agg.set(a.ambiente, { consumo: cur.consumo + (a.produto ?? 0), clientes: cur.clientes + (a.clientes ?? 0) });
  }
  const data = Array.from(agg.entries())
    .map(([nome, v]) => ({ key: nome, total: v.consumo, clientes: v.clientes }))
    .sort((a, b) => b.total - a.total);
  return (
    <DetailCard title="Ambientes">
      {!data.length ? <EmptyDetail /> : (
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ position: "relative", flexShrink: 0, width: 120, height: 120 }}>
            <PieChart width={120} height={120}>
              <Pie data={data} dataKey="total" cx="50%" cy="50%" innerRadius={38} outerRadius={54} paddingAngle={2} strokeWidth={0}>
                {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
            </PieChart>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <span style={{ fontSize: 10, color: C.text3, textAlign: "center" }}>{data.length} amb.</span>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            {data.map((d, i) => (
              <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12, color: C.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.key}</span>
                <span style={{ fontSize: 11, color: C.text3, marginRight: 6 }}>{d.clientes} pax</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.text, flexShrink: 0 }}>{fmt(d.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </DetailCard>
  );
}

function EquipeCard({ usuarios }: { usuarios: Usuario[] }) {
  const agg = new Map<string, { qtd: number; gorjeta: number; consumo: number }>();
  for (const u of usuarios) {
    const cur = agg.get(u.usuario) ?? { qtd: 0, gorjeta: 0, consumo: 0 };
    agg.set(u.usuario, { qtd: cur.qtd + (u.qtd ?? 0), gorjeta: cur.gorjeta + (u.gorjeta ?? 0), consumo: cur.consumo + (u.consumo ?? 0) });
  }
  const data = Array.from(agg.entries())
    .map(([nome, v]) => ({ nome, ...v }))
    .sort((a, b) => b.consumo - a.consumo);
  const maxConsumo = data[0]?.consumo ?? 0;
  return (
    <DetailCard title="Equipe">
      {!data.length ? <EmptyDetail /> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.surface2 }}>
                {["Usuário", "Qtd", "Gorjeta", "Consumo"].map((h) => (
                  <th key={h} style={{ padding: "7px 10px", textAlign: h === "Usuário" ? "left" : "right",
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.7, textTransform: "uppercase",
                    color: C.text3, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((u, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 10px", color: C.text2 }}>{u.nome}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: C.text3 }}>{u.qtd}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: C.text3 }}>{fmt(u.gorjeta)}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                      <span style={{ fontWeight: 600, color: C.text, whiteSpace: "nowrap" }}>{fmt(u.consumo)}</span>
                      <div style={{ width: 60, height: 4, background: C.surface3, borderRadius: 2, flexShrink: 0 }}>
                        <div style={{ width: `${maxConsumo > 0 ? (u.consumo / maxConsumo * 100).toFixed(1) : 0}%`, height: "100%", background: C.brand, borderRadius: 2 }} />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DetailCard>
  );
}

function DescontosDetailCard({ descontos }: { descontos: Desconto[] }) {
  const agg = new Map<string, { qtd: number; consumo: number }>();
  for (const d of descontos) {
    const cur = agg.get(d.motivo) ?? { qtd: 0, consumo: 0 };
    agg.set(d.motivo, { qtd: cur.qtd + (d.qtd ?? 1), consumo: cur.consumo + (d.consumo ?? 0) });
  }
  const data = Array.from(agg.entries())
    .map(([motivo, v]) => ({ motivo, ...v }))
    .sort((a, b) => b.consumo - a.consumo);
  const totals = data.reduce((acc, d) => ({ qtd: acc.qtd + d.qtd, consumo: acc.consumo + d.consumo }), { qtd: 0, consumo: 0 });
  return (
    <DetailCard title="Descontos">
      {!data.length ? <EmptyDetail /> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.surface2 }}>
                {["Motivo", "Qtd", "Valor"].map((h) => (
                  <th key={h} style={{ padding: "7px 10px", textAlign: h === "Motivo" ? "left" : "right",
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.7, textTransform: "uppercase",
                    color: C.text3, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 10px", color: C.text2 }}>{d.motivo}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: C.text3 }}>{d.qtd}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: C.alerta }}>{fmt(d.consumo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: C.surface2, fontWeight: 700 }}>
                <td style={{ padding: "8px 10px", color: C.text, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 }}>TOTAL</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: C.text }}>{totals.qtd}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: C.alerta }}>{fmt(totals.consumo)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </DetailCard>
  );
}

function CancelamentosCard({ cancelamentos, detalhe }: { cancelamentos: Cancelamento[]; detalhe: CancelamentoDetalhe[] }) {
  const resumo = [...cancelamentos].sort((a, b) => (b.consumo ?? 0) - (a.consumo ?? 0));
  const detSorted = [...detalhe].sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0));
  const totResumo = { qtd: resumo.reduce((s, c) => s + (c.qtd ?? 0), 0), val: resumo.reduce((s, c) => s + (c.consumo ?? 0), 0) };
  const totDet    = { qtd: detSorted.reduce((s, c) => s + (c.qtd ?? 0), 0), val: detSorted.reduce((s, c) => s + (c.valor ?? 0), 0) };

  const thStyle = (align: "left" | "right" = "left"): React.CSSProperties => ({
    padding: "7px 10px", textAlign: align, fontSize: 10, fontWeight: 700,
    letterSpacing: 0.7, textTransform: "uppercase", color: C.text3,
    borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
  });

  if (!resumo.length && !detSorted.length) {
    return <DetailCard title="Cancelamentos"><EmptyDetail /></DetailCard>;
  }

  return (
    <DetailCard title="Cancelamentos">
      {resumo.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: "uppercase", letterSpacing: 0.7, margin: "0 0 8px" }}>Por motivo</p>
          <div style={{ overflowX: "auto", marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.surface2 }}>
                  <th style={thStyle()}>Motivo</th>
                  <th style={thStyle("right")}>Qtd</th>
                  <th style={thStyle("right")}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {resumo.map((c, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "7px 10px", color: C.text2 }}>{c.motivo}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: C.text3 }}>{c.qtd ?? "—"}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, color: C.alerta }}>{fmt(c.consumo ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: C.surface2, fontWeight: 700 }}>
                  <td style={{ padding: "7px 10px", color: C.text, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 }}>TOTAL</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.text }}>{totResumo.qtd}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.alerta }}>{fmt(totResumo.val)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      {detSorted.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: "uppercase", letterSpacing: 0.7, margin: "0 0 8px" }}>Itens cancelados</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.surface2 }}>
                  <th style={thStyle()}>Item</th>
                  <th style={thStyle()}>Usuário</th>
                  <th style={thStyle()}>Motivo</th>
                  <th style={thStyle("right")}>Qtd</th>
                  <th style={thStyle("right")}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {detSorted.map((d, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "7px 10px", color: C.text2, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.item}</td>
                    <td style={{ padding: "7px 10px", color: C.text3 }}>{d.usuario}</td>
                    <td style={{ padding: "7px 10px", color: C.text3 }}>{d.motivo}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: C.text3 }}>{d.qtd ?? "—"}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, color: C.alerta }}>{fmt(d.valor ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: C.surface2, fontWeight: 700 }}>
                  <td colSpan={3} style={{ padding: "7px 10px", color: C.text, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 }}>TOTAL</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.text }}>{totDet.qtd}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.alerta }}>{fmt(totDet.val)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </DetailCard>
  );
}

function DescontosDetalhadosCard({ descontos }: { descontos: DescontoDetalhe[] }) {
  const sorted = [...descontos].sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0));
  const totQtd  = sorted.reduce((s, d) => s + (d.qtd  ?? 0), 0);
  const totVal  = sorted.reduce((s, d) => s + (d.valor ?? 0), 0);
  return (
    <DetailCard title="Descontos Detalhados">
      {!sorted.length ? <EmptyDetail /> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.surface2 }}>
                {["Item", "Usuário", "Motivo", "Qtd", "Valor"].map((h) => (
                  <th key={h} style={{ padding: "7px 10px", textAlign: h === "Qtd" || h === "Valor" ? "right" : "left",
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.7, textTransform: "uppercase",
                    color: C.text3, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "7px 10px", color: C.text2, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.item}</td>
                  <td style={{ padding: "7px 10px", color: C.text3 }}>{d.usuario}</td>
                  <td style={{ padding: "7px 10px", color: C.text3 }}>{d.motivo}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.text3 }}>{d.qtd ?? "—"}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, color: C.alerta }}>{fmt(d.valor ?? 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: C.surface2, fontWeight: 700 }}>
                <td colSpan={3} style={{ padding: "7px 10px", color: C.text, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 }}>TOTAL</td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: C.text }}>{totQtd}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: C.alerta }}>{fmt(totVal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </DetailCard>
  );
}

function ChipBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, flexShrink: 0,
      background: active ? "rgba(52,211,153,0.15)" : C.surface3,
      border: `1px solid ${active ? C.receita : C.border}`,
      color: active ? C.receita : C.text3,
      cursor: "pointer", whiteSpace: "nowrap",
      transition: "background 150ms ease, border-color 150ms ease, color 150ms ease",
    }}>
      {children}
    </button>
  );
}

const RANK_COLORS = ["#fbbf24", "#94a3b8", "#b45309"] as const;

function ProdutosVendidosCard({ produtos }: { produtos: ProdutoDia[] }) {
  const [query,        setQuery]        = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeGrupos, setActiveGrupos] = useState<Set<string>>(new Set());
  const [sortCol,      setSortCol]      = useState<"qtd" | "cmv" | "bruto" | "total">("total");
  const [sortDir,      setSortDir]      = useState<"asc" | "desc">("desc");
  const [minVal,       setMinVal]       = useState(0);
  const [barsVisible,  setBarsVisible]  = useState(false);
  const injectedRef = useRef(false);
  const prevFKey    = useRef("");

  useEffect(() => {
    if (injectedRef.current || typeof document === "undefined") return;
    injectedRef.current = true;
    const s = document.createElement("style");
    s.textContent = "@keyframes _pfIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}";
    document.head.appendChild(s);
  }, []);

  // Aggregate by produto+grupo across turnos
  const agg = new Map<string, { grupo: string; produto: string; qtd: number; bruto: number; desconto: number; total: number; cmv_pct: number | null }>();
  for (const p of produtos) {
    const k   = `${p.grupo}||${p.produto}`;
    const cur = agg.get(k) ?? { grupo: p.grupo, produto: p.produto, qtd: 0, bruto: 0, desconto: 0, total: 0, cmv_pct: p.cmv_pct ?? null };
    agg.set(k, { ...cur, qtd: cur.qtd + (p.qtd ?? 0), bruto: cur.bruto + (p.bruto ?? 0), desconto: cur.desconto + (p.desconto ?? 0), total: cur.total + (p.total ?? 0) });
  }
  const all = Array.from(agg.values());

  // Groups with product counts
  const grupoMap = new Map<string, number>();
  for (const r of all) grupoMap.set(r.grupo, (grupoMap.get(r.grupo) ?? 0) + 1);
  const grupos = Array.from(grupoMap.entries()).sort(([a], [b]) => a.localeCompare(b));

  // Top 3 by total across all data (before filtering)
  const top3Keys = [...all].sort((a, b) => b.total - a.total).slice(0, 3).map((r) => `${r.grupo}||${r.produto}`);

  // Filter
  const q = query.trim().toLowerCase();
  const filtered = all.filter((r) => {
    if (q && !r.produto.toLowerCase().includes(q) && !r.grupo.toLowerCase().includes(q)) return false;
    if (activeGrupos.size > 0 && !activeGrupos.has(r.grupo)) return false;
    if (r.total < minVal) return false;
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const va = sortCol === "qtd" ? a.qtd : sortCol === "cmv" ? (a.cmv_pct ?? 0) : sortCol === "bruto" ? a.bruto : a.total;
    const vb = sortCol === "qtd" ? b.qtd : sortCol === "cmv" ? (b.cmv_pct ?? 0) : sortCol === "bruto" ? b.bruto : b.total;
    return sortDir === "desc" ? vb - va : va - vb;
  });

  const maxTotal = sorted[0]?.total ?? 0;
  const totQtd   = filtered.reduce((s, r) => s + r.qtd,   0);
  const totBruto = filtered.reduce((s, r) => s + r.bruto,  0);
  const totTotal = filtered.reduce((s, r) => s + r.total,  0);

  const animUnidades = useCountUp(totQtd,   300);
  const animTotal    = useCountUp(totTotal, 300);

  // Animate bars on filter/sort change
  const filterKey = `${q}|${[...activeGrupos].sort().join(",")}|${minVal}|${sortCol}|${sortDir}`;
  useEffect(() => {
    if (prevFKey.current === filterKey) return;
    prevFKey.current = filterKey;
    setBarsVisible(false);
    const t = setTimeout(() => setBarsVisible(true), 50);
    return () => clearTimeout(t);
  }, [filterKey]);

  function clearFilters() { setQuery(""); setActiveGrupos(new Set()); setMinVal(0); }

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortCol(col); setSortDir("desc"); }
  }

  const sortArrow = (col: typeof sortCol) =>
    sortCol !== col
      ? <span style={{ color: C.text3, opacity: 0.4, marginLeft: 2 }}>↕</span>
      : <span style={{ color: C.receita, marginLeft: 2 }}>{sortDir === "desc" ? "↓" : "↑"}</span>;

  const thSort = (col: typeof sortCol): React.CSSProperties => ({
    padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 700,
    letterSpacing: 0.7, textTransform: "uppercase",
    color: sortCol === col ? C.receita : C.text3,
    borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
    cursor: "pointer", userSelect: "none",
  });

  if (!all.length) return <DetailCard title="Produtos Vendidos"><EmptyDetail /></DetailCard>;

  return (
    <DetailCard title="Produtos Vendidos">
      {/* ── Filtros ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
        {/* Search com ícone de lupa */}
        <div style={{ position: "relative" }}>
          <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: searchFocused ? C.receita : C.text3, pointerEvents: "none", transition: "color 200ms ease" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" strokeWidth="2" /><path d="m16 16 4 4" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="text" placeholder="Buscar produto ou grupo…"
            value={query} onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
            style={{
              width: "100%", padding: "7px 10px 7px 32px", borderRadius: 7, fontSize: 12,
              background: C.surface2, border: `1px solid ${searchFocused ? C.receita : C.border}`,
              color: C.text, outline: "none", boxSizing: "border-box",
              transition: "border-color 200ms ease",
            }}
          />
        </div>
        {/* Chips de grupo + filtro de valor */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", flex: 1, paddingBottom: 2 }}>
            <ChipBtn active={activeGrupos.size === 0} onClick={() => setActiveGrupos(new Set())}>Todos</ChipBtn>
            {grupos.map(([g, cnt]) => (
              <ChipBtn key={g} active={activeGrupos.has(g)} onClick={() => setActiveGrupos((prev) => {
                const n = new Set(prev); if (n.has(g)) n.delete(g); else n.add(g); return n;
              })}>
                {g} <span style={{ opacity: 0.65 }}>({cnt})</span>
              </ChipBtn>
            ))}
          </div>
          <select value={minVal} onChange={(e) => setMinVal(Number(e.target.value))} style={{
            padding: "4px 8px", borderRadius: 6, fontSize: 11, flexShrink: 0,
            background: C.surface2, border: `1px solid ${minVal > 0 ? C.receita : C.border}`,
            color: minVal > 0 ? C.receita : C.text3, cursor: "pointer",
          }}>
            <option value={0}>Todos</option>
            <option value={100}>&gt; R$ 100</option>
            <option value={500}>&gt; R$ 500</option>
            <option value={1000}>&gt; R$ 1.000</option>
          </select>
        </div>
      </div>

      {/* ── Mini-resumo ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          `${filtered.length} produto${filtered.length !== 1 ? "s" : ""}`,
          `${Math.round(animUnidades)} unid.`,
          fmt(animTotal),
        ].map((t, i) => (
          <span key={i} style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: C.surface3, color: C.text2, border: `1px solid ${C.border}` }}>{t}</span>
        ))}
      </div>

      {/* ── Empty state ── */}
      {sorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <p style={{ fontSize: 13, color: C.text3, margin: "0 0 10px" }}>Nenhum produto encontrado</p>
          <button onClick={clearFilters} style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, background: C.surface3, color: C.text2, border: `1px solid ${C.border}`, cursor: "pointer" }}>
            Limpar filtros
          </button>
        </div>
      ) : (
        <div style={{ overflowY: "auto", maxHeight: 520 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr style={{ background: C.surface2 }}>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: 0.7, textTransform: "uppercase", color: C.text3, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>Produto</th>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: 0.7, textTransform: "uppercase", color: C.text3, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>Grupo</th>
                <th onClick={() => toggleSort("qtd")}   style={thSort("qtd")}>Qtd {sortArrow("qtd")}</th>
                <th onClick={() => toggleSort("cmv")}   style={thSort("cmv")}>CMV% {sortArrow("cmv")}</th>
                <th onClick={() => toggleSort("bruto")} style={thSort("bruto")}>Bruto {sortArrow("bruto")}</th>
                <th onClick={() => toggleSort("total")} style={thSort("total")}>Total {sortArrow("total")}</th>
              </tr>
            </thead>
            <tbody key={filterKey}>
              {sorted.slice(0, 15).map((r, i) => {
                const rkey    = `${r.grupo}||${r.produto}`;
                const rankIdx = top3Keys.indexOf(rkey);
                const isEven  = i % 2 === 1;
                const bw      = barsVisible && maxTotal > 0 ? `${(r.total / maxTotal * 100).toFixed(1)}%` : "0%";
                const cmvVal  = r.cmv_pct != null ? r.cmv_pct * 100 : null;
                const cmvClr  = cmvVal == null ? C.text3 : cmvVal < 25 ? C.receita : cmvVal <= 35 ? C.meta : C.alerta;
                const cmvBg   = cmvVal == null ? "rgba(138,130,120,0.14)" : cmvVal < 25 ? "rgba(52,211,153,0.14)" : cmvVal <= 35 ? "rgba(251,191,36,0.14)" : "rgba(248,113,113,0.14)";
                return (
                  <tr key={rkey}
                    style={{ borderBottom: `1px solid ${C.border}`, background: isEven ? "rgba(255,255,255,0.02)" : "transparent", animation: "_pfIn 200ms ease both" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(52,211,153,0.04)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = isEven ? "rgba(255,255,255,0.02)" : "transparent"; }}
                  >
                    <td style={{ padding: "8px 10px", maxWidth: 220 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {rankIdx >= 0 && (
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: RANK_COLORS[rankIdx], flexShrink: 0, display: "inline-block" }} />
                        )}
                        <span style={{ color: C.text2, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.produto}</span>
                      </div>
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <span title={r.grupo} style={{ display: "inline-block", padding: "2px 7px", borderRadius: 4, fontSize: 10, background: C.surface3, color: C.text3, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.grupo}</span>
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: C.text3 }}>{r.qtd}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>
                      <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: cmvBg, color: cmvClr }}>
                        {cmvVal != null ? pct(cmvVal) : "—"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: C.text2 }}>{fmt(r.bruto)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", minWidth: 110 }}>
                      <span style={{ fontWeight: 600, color: C.text, display: "block" }}>{fmt(r.total)}</span>
                      <div style={{ height: 3, background: C.surface3, borderRadius: 2, marginTop: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: bw, background: `linear-gradient(90deg, ${C.receita}, rgba(52,211,153,0.4))`, borderRadius: 2, transition: `width 500ms ${i * 30}ms ease-out` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: C.surface2, fontWeight: 700, borderTop: `1px solid ${C.border}` }}>
                <td colSpan={2} style={{ padding: "8px 10px", color: C.text, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 }}>
                  TOTAL {filtered.length < all.length ? `(${filtered.length}/${all.length})` : `(${all.length})`}
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: C.text }}>{totQtd}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: C.text3 }}>—</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: C.text }}>{fmt(totBruto)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: C.text }}>{fmt(totTotal)}</td>
              </tr>
            </tfoot>
          </table>
          {sorted.length > 15 && (
            <p style={{ textAlign: "center", padding: "8px 0", fontSize: 11, color: C.text3, margin: 0 }}>
              +{sorted.length - 15} produtos · refine os filtros para ver mais
            </p>
          )}
        </div>
      )}
    </DetailCard>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "7px 10px", borderRadius: 8, fontSize: 13, fontWeight: 500,
  background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: "pointer",
};
