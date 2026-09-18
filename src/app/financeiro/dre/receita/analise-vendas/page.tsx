"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  PieChart, Pie, Cell,
  BarChart, Bar,
  XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useUnit } from "@ork/auth/context";

const API_BASE = "/financeiro";

// ── Color tokens ─────────────────────────────────────────────────────────────
const C = {
  receita:  "#34d399",
  meta:     "#fbbf24",
  alerta:   "#f87171",
  a:        "#34d399",
  b:        "#fbbf24",
  c:        "#f87171",
  text:     "var(--text, #F5F0E8)",
  text2:    "var(--text-2, #C8C2B8)",
  text3:    "var(--text-3, #8A8278)",
  surface:  "var(--surface, #1A1A18)",
  surface2: "var(--surface-2, #222220)",
  surface3: "var(--surface-3, #2C2C2A)",
  border:   "var(--border, rgba(245,240,232,0.08))",
  brand:    "var(--brand, #C4622D)",
} as const;

const PIE_COLORS = ["#34d399", "#818cf8", "#fbbf24", "#f87171", "#22d3ee", "#f472b6", "#a3e635", "#fb923c", "#c084fc", "#2dd4bf"];

// ── Types ────────────────────────────────────────────────────────────────────
type Periodo = {
  id: string;
  unit_id: string;
  data_inicio: string;
  data_fim: string;
  label: string;
  importado_em: string;
};
type Produto = {
  id: string;
  periodo_id: string;
  grupo: string | null;
  produto: string;
  quantidade: number | null;
  valor_bruto: number | null;
  valor_desconto: number | null;
  valor_liquido: number | null;
  participacao_pct: number | null;
};
type Curva = "A" | "B" | "C";

type Resumo = {
  acessos: number | null; permanencia_media: string | null;
  ticket_medio: number | null; ticket_real: number | null;
  bruto: number | null; produto: number | null; custo: number | null; desconto: number | null;
  gorjeta: number | null; convite: number | null; lucro: number | null; entrada: number | null;
  consumo: number | null; devedor: number | null;
  pgto_fechado: number | null; pgto_recebido: number | null; pgto_diferenca: number | null;
  cash: number | null; card: number | null; pix: number | null;
};
type Mensal       = { id: string; mes: string; ordem: number | null; bruto: number | null; liquido: number | null; clientes: number | null; ticket_medio: number | null };
type TurnoRow     = { id: string; turno: string; bruto: number | null; clientes: number | null; ticket_medio: number | null; participacao_pct: number | null };
type DiaSemanaRow = { id: string; dia_semana: string; ordem: number | null; bruto: number | null; clientes: number | null; ticket_medio: number | null };
type AmbienteRow  = { id: string; ambiente: string; bruto: number | null; clientes: number | null; participacao_pct: number | null };
type Funcionario  = { id: string; funcionario: string; bruto: number | null; qtd_vendas: number | null };

// ── Formatters ───────────────────────────────────────────────────────────────
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmt = (n: number) => BRL.format(n);
const fmtInt = (n: number) => Math.round(n).toLocaleString("pt-BR");
const pct = (v: number | null | undefined, d = 1) => (v != null ? `${v.toFixed(d)}%` : "—");
const fmtData = (s: string) => {
  const [y, m, d] = s.split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
};

const selectStyle: React.CSSProperties = {
  padding: "8px 12px", borderRadius: 8, fontSize: 13, fontWeight: 500,
  background: "var(--surface-2)", color: "var(--text)",
  border: "1px solid var(--border)", cursor: "pointer",
};

type ProdutoABC = Produto & { _part: number; _acc: number; _curva: Curva };

function sortProdutos(arr: ProdutoABC[], ord: "valor" | "qtd" | "nome"): ProdutoABC[] {
  const a = [...arr];
  if (ord === "qtd") a.sort((x, y) => (y.quantidade ?? 0) - (x.quantidade ?? 0));
  else if (ord === "nome") a.sort((x, y) => x.produto.localeCompare(y.produto, "pt-BR"));
  else a.sort((x, y) => (y.valor_liquido ?? 0) - (x.valor_liquido ?? 0));
  return a;
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AnaliseVendasPage() {
  const { unit } = useUnit();

  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [periodoSel, setPeriodoSel] = useState<string | null>(null);
  const [periodoAtual, setPeriodoAtual] = useState<Periodo | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [mensal, setMensal] = useState<Mensal[]>([]);
  const [turno, setTurno] = useState<TurnoRow[]>([]);
  const [diaSemana, setDiaSemana] = useState<DiaSemanaRow[]>([]);
  const [ambiente, setAmbiente] = useState<AmbienteRow[]>([]);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [funcBusca, setFuncBusca] = useState("");
  const [isReloading, setLoading] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loadKey = String(unit?.id);
  const loading = Boolean(unit) && (isReloading || loadedKey !== loadKey);
  const [dbError, setDbError] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  // Filtros / ordenação / accordion da seção Produtos (tudo client-side)
  const [filtroClasse, setFiltroClasse] = useState<"Todas" | Curva>("Todas");
  const [filtroGrupo, setFiltroGrupo] = useState<string>("Todos");
  const [ordenacao, setOrdenacao] = useState<"valor" | "qtd" | "nome">("valor");
  const [classesAbertas, setClassesAbertas] = useState<Record<Curva, boolean>>({ A: false, B: false, C: false });

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [movFile, setMovFile] = useState<File | null>(null);
  const [vendaFile, setVendaFile] = useState<File | null>(null);
  const [caixaFile, setCaixaFile] = useState<File | null>(null);
  const [spreadsheetFiles, setSpreadsheetFiles] = useState<File[]>([]);
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [label, setLabel] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const movRef = useRef<HTMLInputElement>(null);
  const vendaRef = useRef<HTMLInputElement>(null);
  const caixaRef = useRef<HTMLInputElement>(null);
  const spreadsheetsRef = useRef<HTMLInputElement>(null);

  const requestIdRef = useRef(0);
  async function loadData(periodoId?: string | null, signal?: AbortSignal) {
    const requestId = ++requestIdRef.current;
    if (!unit) return;
    try {
      const params = new URLSearchParams({ unit_id: unit.id });
      if (periodoId) params.set("periodo_id", periodoId);
      const res = await fetch(`${API_BASE}/api/vendas-consolidado/dados?${params}`, { signal });
      const json = await res.json();
      if (signal?.aborted || requestId !== requestIdRef.current) return;
      if (!res.ok) { setDbError(json.error ?? `HTTP ${res.status}`); setLoading(false); return; }
      setDbError(null);
      setPeriodos(json.periodos ?? []);
      setPeriodoAtual(json.periodo ?? null);
      setPeriodoSel(json.periodo?.id ?? null);
      setProdutos(json.produtos ?? []);
      setResumo(json.resumo ?? null);
      setMensal(json.mensal ?? []);
      setTurno(json.turno ?? []);
      setDiaSemana(json.dia_semana ?? []);
      setAmbiente(json.ambiente ?? []);
      setFuncionarios(json.funcionarios ?? []);
    } catch (e) {
      if (!signal?.aborted && requestId === requestIdRef.current) setDbError(String(e));
    } finally {
      if (!signal?.aborted && requestId === requestIdRef.current) { setLoadedKey(loadKey); setLoading(false); }
    }
  }

  const refreshOnChange = useEffectEvent((signal: AbortSignal) => loadData(undefined, signal));
  useEffect(() => {
    const controller = new AbortController();
    // State writes happen after the awaited request; cleanup rejects stale responses.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshOnChange(controller.signal);
    return () => controller.abort();
  }, [unit?.id]);

  function onSelectPeriodo(id: string) {
    setPeriodoSel(id);
    loadData(id);
  }

  const algumArquivo = !!movFile || !!vendaFile || !!caixaFile || spreadsheetFiles.length > 0;

  async function handleImport() {
    if (!unit) return;
    if (!algumArquivo) { setImportMsg({ ok: false, text: "Selecione ao menos um PDF ou planilha Excel." }); return; }
    if (!dataInicio || !dataFim) { setImportMsg({ ok: false, text: "Informe data de início e fim." }); return; }
    setImporting(true); setImportMsg(null);
    try {
      const fd = new FormData();
      fd.append("unit_id", unit.id);
      fd.append("data_inicio", dataInicio);
      fd.append("data_fim", dataFim);
      if (label.trim()) fd.append("label", label.trim());
      if (vendaFile) fd.append("venda", vendaFile);
      if (movFile) fd.append("movimento", movFile);
      if (caixaFile) fd.append("caixa", caixaFile);
      spreadsheetFiles.forEach((file) => fd.append("planilhas", file));
      const res = await fetch(`${API_BASE}/api/vendas-consolidado/import`, { method: "POST", body: fd });
      const json = await res.json();
      if (json.success) {
        const partes: string[] = [];
        if (json.produtos != null) partes.push(`${json.produtos} produtos`);
        if (json.movimento) partes.push("resumo operacional");
        setImportMsg({ ok: true, text: `Importado: ${partes.join(" + ") || "ok"}.` });
        setMovFile(null); setVendaFile(null); setCaixaFile(null); setSpreadsheetFiles([]);
        setDataInicio(""); setDataFim(""); setLabel("");
        setShowImport(false);
        await loadData(json.periodo_id);
      } else {
        setImportMsg({ ok: false, text: (json.errors ?? []).join(" | ") || json.error || "Falha na importação" });
      }
    } catch (e) {
      setImportMsg({ ok: false, text: String(e) });
    } finally {
      setImporting(false);
    }
  }

  // ── Derivados ────────────────────────────────────────────────────────────────
  const totalLiquido = useMemo(() => produtos.reduce((s, p) => s + (p.valor_liquido ?? 0), 0), [produtos]);
  const totalQtd     = useMemo(() => produtos.reduce((s, p) => s + (p.quantidade ?? 0), 0), [produtos]);

  // Curva ABC: ordena por valor desc, acumula % e classifica.
  const produtosABC = useMemo(() => {
    const ord = [...produtos].sort((a, b) => (b.valor_liquido ?? 0) - (a.valor_liquido ?? 0));
    let acc = 0;
    const result = [];
    for (const p of ord) {
      const part = totalLiquido > 0 ? ((p.valor_liquido ?? 0) / totalLiquido) * 100 : 0;
      acc += part;
      const curva: Curva = acc <= 80 ? "A" : acc <= 95 ? "B" : "C";
      result.push({ ...p, _part: part, _acc: acc, _curva: curva });
    }
    return result;
  }, [produtos, totalLiquido]);

  const resumoABC = useMemo(() => {
    const base = { A: { n: 0, valor: 0 }, B: { n: 0, valor: 0 }, C: { n: 0, valor: 0 } };
    for (const p of produtosABC) { base[p._curva].n += 1; base[p._curva].valor += p.valor_liquido ?? 0; }
    return base;
  }, [produtosABC]);

  // Grupos distintos para o dropdown
  const gruposDistintos = useMemo(() => {
    const s = new Set<string>();
    for (const p of produtos) s.add(p.grupo ?? "—");
    return Array.from(s).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [produtos]);

  const filtrosAtivos = filtroClasse !== "Todas" || filtroGrupo !== "Todos" || busca.trim() !== "";

  // MODO FILTRADO: lista única filtrada + ordenada (desfaz o agrupamento ABC)
  const listaFiltrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const arr = produtosABC.filter((p) =>
      (filtroClasse === "Todas" || p._curva === filtroClasse) &&
      (filtroGrupo === "Todos" || (p.grupo ?? "—") === filtroGrupo) &&
      (!q || p.produto.toLowerCase().includes(q) || (p.grupo ?? "").toLowerCase().includes(q)),
    );
    return sortProdutos(arr, ordenacao);
  }, [produtosABC, filtroClasse, filtroGrupo, busca, ordenacao]);

  const resumoFiltrado = useMemo(() => ({
    n: listaFiltrada.length,
    valor: listaFiltrada.reduce((s, p) => s + (p.valor_liquido ?? 0), 0),
    qtd: listaFiltrada.reduce((s, p) => s + (p.quantidade ?? 0), 0),
  }), [listaFiltrada]);

  // MODO PADRÃO: agrupado por classe ABC (cada classe é um accordion)
  const gruposABC = useMemo(() => {
    return (["A", "B", "C"] as Curva[]).map((cls) => {
      const itens = sortProdutos(produtosABC.filter((p) => p._curva === cls), ordenacao);
      return {
        classe: cls,
        itens,
        n: itens.length,
        valor: itens.reduce((s, p) => s + (p.valor_liquido ?? 0), 0),
        qtd: itens.reduce((s, p) => s + (p.quantidade ?? 0), 0),
      };
    });
  }, [produtosABC, ordenacao]);

  function limparFiltros() {
    setFiltroClasse("Todas");
    setFiltroGrupo("Todos");
    setBusca("");
  }
  function toggleClasse(cls: Curva) {
    setClassesAbertas((prev) => ({ ...prev, [cls]: !prev[cls] }));
  }

  // Participação por grupo
  const porGrupo = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of produtos) {
      const g = p.grupo ?? "—";
      map.set(g, (map.get(g) ?? 0) + (p.valor_liquido ?? 0));
    }
    return Array.from(map.entries())
      .map(([grupo, valor]) => ({ grupo, valor, pct: totalLiquido > 0 ? (valor / totalLiquido) * 100 : 0 }))
      .sort((a, b) => b.valor - a.valor);
  }, [produtos, totalLiquido]);

  const topPorValor = useMemo(
    () => [...produtos].sort((a, b) => (b.valor_liquido ?? 0) - (a.valor_liquido ?? 0)).slice(0, 10),
    [produtos],
  );
  const topPorQtd = useMemo(
    () => [...produtos].sort((a, b) => (b.quantidade ?? 0) - (a.quantidade ?? 0)).slice(0, 10),
    [produtos],
  );

  // Funcionários (busca client-side em useMemo)
  const funcsFiltrados = useMemo(() => {
    const q = funcBusca.trim().toLowerCase();
    if (!q) return funcionarios;
    return funcionarios.filter((f) => f.funcionario.toLowerCase().includes(q));
  }, [funcionarios, funcBusca]);

  const hasProdutos = produtos.length > 0;
  const hasMovimento = !!resumo || mensal.length > 0 || turno.length > 0 || diaSemana.length > 0 || ambiente.length > 0 || funcionarios.length > 0;
  const hasData = hasProdutos || hasMovimento;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.6, margin: 0 }}>Análise de Vendas</h1>
          <p style={{ fontSize: 13, color: C.text3, marginTop: 4 }}>
            {unit?.name ?? "—"} · relatório consolidado por período
            {periodoAtual ? ` · ${periodoAtual.label}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {periodos.length > 0 && (
            <select value={periodoSel ?? ""} onChange={(e) => onSelectPeriodo(e.target.value)} style={selectStyle}>
              {periodos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({fmtData(p.data_inicio)}–{fmtData(p.data_fim)})
                </option>
              ))}
            </select>
          )}
          <button onClick={() => { setShowImport((v) => !v); setImportMsg(null); }} style={{
            padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: showImport ? C.surface3 : C.brand, color: showImport ? C.text : "#fff",
            border: "none", cursor: "pointer",
          }}>
            {showImport ? "Fechar" : "Importar relatório do período"}
          </button>
        </div>
      </header>

      {/* Breadcrumb / sub-nav dentro de Receita */}
      <nav style={{ display: "flex", gap: 16, marginBottom: 24, fontSize: 13 }}>
        <Link href="/financeiro/dre/receita" style={{ color: C.text3, textDecoration: "none" }}>Receita</Link>
        <span style={{ color: C.text3 }}>/</span>
        <span style={{ color: C.text, fontWeight: 600 }}>Análise de Vendas</span>
      </nav>

      {/* Import panel */}
      {showImport && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: "0 0 16px" }}>
            Importar relatório consolidado (período longo)
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Data início</label>
              <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} style={selectStyle} />
            </div>
            <div>
              <label style={labelStyle}>Data fim</label>
              <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={selectStyle} />
            </div>
            <div>
              <label style={labelStyle}>Rótulo (opcional)</label>
              <input type="text" placeholder="Ex: Jan-Jun 2026" value={label} onChange={(e) => setLabel(e.target.value)}
                style={{ ...selectStyle, cursor: "text", width: "100%" }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 16 }}>
            <SpreadsheetSlot inputRef={spreadsheetsRef} files={spreadsheetFiles} onChange={setSpreadsheetFiles} />
            <FileSlot label="Movimento (opcional)" inputRef={movRef}   file={movFile}   onChange={setMovFile} />
            <FileSlot label="Venda (opcional)"     inputRef={vendaRef} file={vendaFile} onChange={setVendaFile} />
            <FileSlot label="Caixa (opcional)"     inputRef={caixaRef} file={caixaFile} onChange={setCaixaFile} />
          </div>
          <p style={{ fontSize: 11, color: C.text3, margin: "0 0 12px" }}>
            Selecione várias planilhas de uma vez. O sistema reconhece Relatório Geral de Vendas e relatórios Keeta de pedido/restaurante, elimina arquivos e pedidos repetidos e consolida o período.
            PDFs continuam opcionais: Venda → produtos; Movimento → resumo operacional e seções.
            Subir um PDF depois anexa ao mesmo período sem apagar o que já foi importado.
          </p>
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
          <button disabled={importing || !algumArquivo || !dataInicio || !dataFim} onClick={handleImport} style={{
            padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: importing ? C.surface3 : C.brand, color: importing ? C.text3 : "#fff",
            border: "none", cursor: importing ? "not-allowed" : "pointer",
            opacity: (!algumArquivo || !dataInicio || !dataFim) ? 0.4 : 1,
          }}>
            {importing ? "Processando…" : "Processar e importar"}
          </button>
        </div>
      )}

      {loading && <div style={{ textAlign: "center", padding: "40px 0", color: C.text3, fontSize: 14 }}>Carregando…</div>}

      {!loading && !hasData && (
        <div style={{ textAlign: "center", padding: "60px 0", color: C.text3, fontSize: 14 }}>
          {dbError ? <span style={{ color: C.alerta }}>Erro: {dbError}</span>
            : <>Sem dados consolidados. Importe o relatório de um período.</>}
        </div>
      )}

      {!loading && hasProdutos && (
        <>
          <h2 style={sectionTitle}>Produtos</h2>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 28 }}>
            <Kpi label="Valor Líquido"    value={fmt(totalLiquido)} />
            <Kpi label="Quantidade"       value={fmtInt(totalQtd)} />
            <Kpi label="Produtos"         value={fmtInt(produtos.length)} />
            <Kpi label="Grupos"           value={fmtInt(porGrupo.length)} />
            <Kpi label="Itens Curva A"    value={`${resumoABC.A.n}`} sub={`${pct(totalLiquido > 0 ? resumoABC.A.valor / totalLiquido * 100 : 0)} do valor`} />
          </div>

          {/* Curva ABC + Participação por grupo */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 16, marginBottom: 28 }}>
            <CurvaABCCard resumo={resumoABC} total={totalLiquido} />
            <GrupoPieCard rows={porGrupo} total={totalLiquido} />
          </div>

          {/* Top produtos */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 16, marginBottom: 28 }}>
            <TopBarCard title="Top 10 por Valor" rows={topPorValor.map((p) => ({ nome: p.produto, valor: p.valor_liquido ?? 0 }))} fmtVal={fmt} color={C.receita} />
            <TopBarCard title="Top 10 por Quantidade" rows={topPorQtd.map((p) => ({ nome: p.produto, valor: p.quantidade ?? 0 }))} fmtVal={fmtInt} color="#818cf8" />
          </div>

          {/* Produtos — controles + lista (agrupada por ABC ou filtrada) */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
            {/* Controles de filtro/ordenação */}
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text, marginRight: "auto" }}>Produtos · {produtos.length}</span>
              <select value={filtroClasse} onChange={(e) => setFiltroClasse(e.target.value as "Todas" | Curva)} style={selectStyle}>
                <option value="Todas">Classe: Todas</option>
                <option value="A">Classe A</option>
                <option value="B">Classe B</option>
                <option value="C">Classe C</option>
              </select>
              <select value={filtroGrupo} onChange={(e) => setFiltroGrupo(e.target.value)} style={selectStyle}>
                <option value="Todos">Grupo: Todos</option>
                {gruposDistintos.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <select value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as "valor" | "qtd" | "nome")} style={selectStyle}>
                <option value="valor">Valor (maior→menor)</option>
                <option value="qtd">Quantidade (maior→menor)</option>
                <option value="nome">Nome (A→Z)</option>
              </select>
              <input
                type="text" placeholder="Buscar…" value={busca}
                onChange={(e) => setBusca(e.target.value)}
                style={{ ...selectStyle, cursor: "text", minWidth: 160 }}
              />
              {filtrosAtivos && (
                <button onClick={limparFiltros} style={{ padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: C.surface3, color: C.text2, border: "none", cursor: "pointer" }}>
                  Limpar filtros
                </button>
              )}
            </div>

            {filtrosAtivos ? (
              /* MODO FILTRADO — lista única ordenada */
              <>
                <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: C.text3 }}>
                  <span><b style={{ color: C.text }}>{resumoFiltrado.n}</b> produtos filtrados</span>
                  <span>Valor <b style={{ color: C.text }}>{fmt(resumoFiltrado.valor)}</b></span>
                  <span>Qtd <b style={{ color: C.text }}>{fmtInt(resumoFiltrado.qtd)}</b></span>
                </div>
                {resumoFiltrado.n === 0
                  ? <div style={{ padding: "30px 16px", textAlign: "center", color: C.text3, fontSize: 13 }}>Nenhum produto nos filtros.</div>
                  : <ProdutosTable itens={listaFiltrada} showClasse />}
              </>
            ) : (
              /* MODO PADRÃO — accordion por classe ABC */
              <div>
                {gruposABC.map((g, gi) => {
                  const aberto = classesAbertas[g.classe];
                  const col = g.classe === "A" ? C.a : g.classe === "B" ? C.b : C.c;
                  return (
                    <div key={g.classe} style={{ borderBottom: gi < 2 ? `1px solid ${C.border}` : "none" }}>
                      <button onClick={() => toggleClasse(g.classe)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                        <span style={{ color: C.text3, fontSize: 11, transform: aberto ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
                        <CurvaBadge curva={g.classe} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Curva {g.classe}</span>
                        <span style={{ fontSize: 12, color: C.text3 }}>· {g.n} produtos</span>
                        <span style={{ marginLeft: "auto", display: "flex", gap: 18, fontSize: 12 }}>
                          <span style={{ color: C.text3 }}>Qtd <b style={{ color: C.text2 }}>{fmtInt(g.qtd)}</b></span>
                          <span style={{ color: C.text3 }}>Valor <b style={{ color: col }}>{fmt(g.valor)}</b></span>
                        </span>
                      </button>
                      {aberto && (g.n === 0
                        ? <div style={{ padding: "0 16px 16px", color: C.text3, fontSize: 12 }}>Sem produtos nesta classe.</div>
                        : <ProdutosTable itens={g.itens} />)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {!loading && hasMovimento && (
        <div style={{ marginTop: hasProdutos ? 40 : 0 }}>
          <h2 style={sectionTitle}>Resumo Operacional do Período</h2>
          <p style={{ fontSize: 11, color: C.text3, margin: "-8px 0 16px" }}>
            Fonte: PDF de Movimento. A Receita Bruta abaixo (Recebido) pode diferir levemente do líquido dos
            produtos (PDF de Venda){hasProdutos ? ` — ${fmt(totalLiquido)}` : ""} — são fontes diferentes.
          </p>

          {resumo && <ResumoCards r={resumo} />}
          {resumo && <PagamentoBreakdown r={resumo} />}

          {mensal.length > 0 && (
            <ColBarChart
              title="Faturamento mês a mês"
              data={mensal.map((m) => ({ nome: m.mes, valor: m.bruto ?? 0 }))}
              color={C.receita}
            />
          )}

          {turno.length > 0 && (
            <ParticipacaoCards
              title="Por turno"
              rows={turno.map((t) => ({ nome: t.turno, bruto: t.bruto ?? 0, pct: t.participacao_pct ?? 0, ticket: t.ticket_medio, clientes: t.clientes }))}
            />
          )}

          {diaSemana.length > 0 && (
            <ColBarChart
              title="Por dia da semana"
              data={diaSemana.map((d) => ({ nome: d.dia_semana, valor: d.bruto ?? 0 }))}
              color="#818cf8"
            />
          )}

          {ambiente.length > 0 && (
            <ParticipacaoCards
              title="Por ambiente"
              rows={ambiente.map((a) => ({ nome: a.ambiente, bruto: a.bruto ?? 0, pct: a.participacao_pct ?? 0, clientes: a.clientes }))}
            />
          )}

          {funcionarios.length > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 28 }}>
              <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                  Top {funcionarios.length} funcionários · {funcsFiltrados.length}{funcBusca ? ` de ${funcionarios.length}` : ""}
                </span>
                <input
                  type="text" placeholder="Buscar funcionário…" value={funcBusca}
                  onChange={(e) => setFuncBusca(e.target.value)}
                  style={{ ...selectStyle, cursor: "text", minWidth: 220 }}
                />
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: C.surface2 }}>
                      {["#", "Funcionário", "Faturamento", "Vendas", "Ticket"].map((h, i) => (
                        <th key={h} style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 600, color: C.text3, textAlign: i <= 1 ? "left" : "right", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {funcsFiltrados.map((f, i) => {
                      const tk = (f.qtd_vendas ?? 0) > 0 ? (f.bruto ?? 0) / (f.qtd_vendas ?? 1) : 0;
                      return (
                        <tr key={f.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: "8px 12px", color: C.text3 }}>{i + 1}</td>
                          <td style={{ padding: "8px 12px", color: C.text, fontWeight: 500 }}>{f.funcionario}</td>
                          <td style={{ ...tdNum, color: C.text, fontWeight: 600 }}>{fmt(f.bruto ?? 0)}</td>
                          <td style={tdNum}>{fmtInt(f.qtd_vendas ?? 0)}</td>
                          <td style={tdNum}>{tk > 0 ? fmt(tk) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: C.text3, marginBottom: 6 };
const tdNum: React.CSSProperties = { padding: "8px 12px", textAlign: "right", color: C.text2, whiteSpace: "nowrap" };
const sectionTitle: React.CSSProperties = { fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: -0.3, margin: "0 0 16px" };

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ProdutosTable({ itens, showClasse }: { itens: ProdutoABC[]; showClasse?: boolean }) {
  const heads = showClasse
    ? ["Produto", "Grupo", "Classe", "Qtd", "Valor", "Part.%"]
    : ["Produto", "Grupo", "Qtd", "Valor", "Part.%"];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: C.surface2 }}>
            {heads.map((h) => {
              const leftAlign = h === "Produto" || h === "Grupo" || h === "Classe";
              return (
                <th key={h} style={{
                  padding: "9px 12px", borderBottom: `1px solid ${C.border}`,
                  fontSize: 11, fontWeight: 600, color: C.text3,
                  textAlign: leftAlign ? "left" : "right", whiteSpace: "nowrap",
                }}>{h}</th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {itens.map((p) => (
            <tr key={p.id} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px 12px", color: C.text, fontWeight: 500 }}>{p.produto}</td>
              <td style={{ padding: "8px 12px", color: C.text3 }}>{p.grupo ?? "—"}</td>
              {showClasse && <td style={{ padding: "8px 12px" }}><CurvaBadge curva={p._curva} /></td>}
              <td style={tdNum}>{fmtInt(p.quantidade ?? 0)}</td>
              <td style={{ ...tdNum, color: C.text, fontWeight: 600 }}>{fmt(p.valor_liquido ?? 0)}</td>
              <td style={tdNum}>{pct(p._part)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CurvaBadge({ curva }: { curva: Curva }) {
  const col = curva === "A" ? C.a : curva === "B" ? C.b : C.c;
  return (
    <span style={{
      display: "inline-block", minWidth: 18, textAlign: "center",
      padding: "1px 7px", borderRadius: 6, fontSize: 11, fontWeight: 700,
      color: col, background: `${col}1f`, border: `1px solid ${col}55`,
    }}>{curva}</span>
  );
}

function CurvaABCCard({ resumo, total }: { resumo: Record<Curva, { n: number; valor: number }>; total: number }) {
  const rows: { curva: Curva; faixa: string; n: number; valor: number }[] = [
    { curva: "A", faixa: "até 80%",   n: resumo.A.n, valor: resumo.A.valor },
    { curva: "B", faixa: "80–95%",    n: resumo.B.n, valor: resumo.B.valor },
    { curva: "C", faixa: "95–100%",   n: resumo.C.n, valor: resumo.C.valor },
  ];
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 20px" }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 14px" }}>Curva ABC</p>
      {rows.map((r) => {
        const col = r.curva === "A" ? C.a : r.curva === "B" ? C.b : C.c;
        const part = total > 0 ? (r.valor / total) * 100 : 0;
        return (
          <div key={r.curva} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: C.text2 }}>
                <CurvaBadge curva={r.curva} /> <span style={{ marginLeft: 6, color: C.text3 }}>{r.faixa} · {r.n} itens</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{fmt(r.valor)} · {pct(part)}</span>
            </div>
            <div style={{ height: 6, borderRadius: 4, background: C.surface3, overflow: "hidden" }}>
              <div style={{ width: `${part}%`, height: "100%", background: col }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GrupoPieCard({ rows }: { rows: { grupo: string; valor: number; pct: number }[]; total: number }) {
  const data = rows.slice(0, 8);
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 20px" }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>Participação por grupo</p>
      {!data.length ? <p style={{ fontSize: 12, color: C.text3 }}>Sem dados</p> : (
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flexShrink: 0, width: 140, height: 140 }}>
            <PieChart width={140} height={140}>
              <Pie data={data} dataKey="valor" cx="50%" cy="50%" innerRadius={42} outerRadius={64} paddingAngle={2} strokeWidth={0}>
                {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: "#1A1A18", border: "1px solid rgba(245,240,232,0.12)", borderRadius: 8, fontSize: 12 }}
                formatter={(v) => fmt(Number(v))}
              />
            </PieChart>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {data.map((r, i) => (
              <div key={r.grupo} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: C.text2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.grupo}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{pct(r.pct)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TopBarCard({ title, rows, fmtVal, color }: {
  title: string; rows: { nome: string; valor: number }[]; fmtVal: (n: number) => string; color: string;
}) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 20px" }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>{title}</p>
      {!rows.length ? <p style={{ fontSize: 12, color: C.text3 }}>Sem dados</p> : (
        <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 26)}>
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barSize={14}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="nome" width={120} tick={{ fontSize: 11, fill: C.text3 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              contentStyle={{ background: "#1A1A18", border: "1px solid rgba(245,240,232,0.12)", borderRadius: 8, fontSize: 12 }}
              formatter={(v) => fmtVal(Number(v))}
            />
            <Bar dataKey="valor" radius={[0, 4, 4, 0]} fill={color} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Movimento (resumo operacional) ─────────────────────────────────────────────
function ResumoCards({ r }: { r: Resumo }) {
  const cmvPct  = (r.produto ?? 0) > 0 ? ((r.custo ?? 0) / (r.produto ?? 1)) * 100 : null;
  const descPct = (r.bruto ?? 0) > 0 ? ((r.desconto ?? 0) / (r.bruto ?? 1)) * 100 : null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 }}>
      <Kpi label="Acessos"           value={r.acessos != null ? fmtInt(r.acessos) : "—"} />
      <Kpi label="Ticket Médio"      value={r.ticket_medio != null ? fmt(r.ticket_medio) : "—"} sub={r.ticket_real != null ? `Real ${fmt(r.ticket_real)}` : undefined} />
      <Kpi label="Receita Bruta"     value={r.pgto_recebido != null ? fmt(r.pgto_recebido) : "—"} sub="Recebido (Movimento)" />
      <Kpi label="CMV"               value={r.custo != null ? fmt(r.custo) : "—"} sub={cmvPct != null ? `${cmvPct.toFixed(1)}% do produto` : undefined} />
      <Kpi label="Desconto"          value={r.desconto != null ? fmt(r.desconto) : "—"} sub={descPct != null ? `${descPct.toFixed(1)}% da bruta` : undefined} />
      <Kpi label="Gorjeta"           value={r.gorjeta != null ? fmt(r.gorjeta) : "—"} />
      <Kpi label="Lucro"             value={r.lucro != null ? fmt(r.lucro) : "—"} />
      <Kpi label="Permanência média" value={r.permanencia_media || "—"} />
      <Kpi label="Devedor"           value={r.devedor != null ? fmt(r.devedor) : "—"} />
    </div>
  );
}

function PagamentoBreakdown({ r }: { r: Resumo }) {
  const items = [
    { nome: "Dinheiro", v: r.cash ?? 0, col: "#34d399" },
    { nome: "Cartão",   v: r.card ?? 0, col: "#818cf8" },
    { nome: "PIX",      v: r.pix ?? 0,  col: "#22d3ee" },
  ];
  const total = items.reduce((s, i) => s + i.v, 0);
  if (total <= 0) return null;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 20px", marginBottom: 28 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 14px" }}>Formas de pagamento</p>
      {items.map((it) => {
        const p = total > 0 ? (it.v / total) * 100 : 0;
        return (
          <div key={it.nome} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: C.text2 }}>{it.nome}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{fmt(it.v)} · {p.toFixed(1)}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 4, background: C.surface3, overflow: "hidden" }}>
              <div style={{ width: `${p}%`, height: "100%", background: it.col }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ColBarChart({ title, data, color }: { title: string; data: { nome: string; valor: number }[]; color: string }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 20px", marginBottom: 28 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>{title}</p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <XAxis dataKey="nome" tick={{ fontSize: 11, fill: C.text3 }} axisLine={false} tickLine={false} interval={0} />
          <YAxis tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: C.text3 }} axisLine={false} tickLine={false} width={42} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={{ background: "#1A1A18", border: "1px solid rgba(245,240,232,0.12)", borderRadius: 8, fontSize: 12 }} formatter={(v) => fmt(Number(v))} />
          <Bar dataKey="valor" radius={[6, 6, 0, 0]} fill={color} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ParticipacaoCards({ title, rows }: {
  title: string;
  rows: { nome: string; bruto: number; pct: number; ticket?: number | null; clientes?: number | null }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.pct));
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 20px", marginBottom: 28 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 14px" }}>{title}</p>
      {rows.map((r, i) => (
        <div key={r.nome + i} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 8 }}>
            <span style={{ fontSize: 12, color: C.text2 }}>
              {r.nome}
              {r.clientes != null ? <span style={{ color: C.text3 }}> · {fmtInt(r.clientes)} cli</span> : null}
              {r.ticket != null ? <span style={{ color: C.text3 }}> · {fmt(r.ticket)}</span> : null}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{fmt(r.bruto)} · {r.pct.toFixed(1)}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 4, background: C.surface3, overflow: "hidden" }}>
            <div style={{ width: `${(r.pct / max) * 100}%`, height: "100%", background: PIE_COLORS[i % PIE_COLORS.length] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SpreadsheetSlot({ inputRef, files, onChange }: {
  inputRef: React.RefObject<HTMLInputElement | null>; files: File[]; onChange: (files: File[]) => void;
}) {
  return (
    <div>
      <label style={labelStyle}>Planilhas de vendas</label>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" multiple style={{ display: "none" }}
        onChange={(e) => onChange(Array.from(e.target.files ?? []))} />
      <button onClick={() => inputRef.current?.click()} style={{
        width: "100%", padding: "16px 12px", borderRadius: 8, fontSize: 12,
        background: files.length ? "rgba(52,211,153,0.08)" : C.surface2,
        color: files.length ? C.receita : C.text3,
        border: `1px dashed ${files.length ? "rgba(52,211,153,0.4)" : C.border}`,
        cursor: "pointer", textAlign: "center",
      }}>
        {files.length ? `✓ ${files.length} planilha${files.length > 1 ? "s" : ""} selecionada${files.length > 1 ? "s" : ""}` : "Selecionar planilhas Excel"}
      </button>
    </div>
  );
}

function FileSlot({ label, inputRef, file, onChange }: {
  label: string; inputRef: React.RefObject<HTMLInputElement | null>; file: File | null; onChange: (f: File | null) => void;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input ref={inputRef} type="file" accept=".pdf" style={{ display: "none" }}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      <button onClick={() => inputRef.current?.click()} style={{
        width: "100%", padding: "16px 12px", borderRadius: 8, fontSize: 12,
        background: file ? "rgba(52,211,153,0.08)" : C.surface2,
        color: file ? C.receita : C.text3,
        border: `1px dashed ${file ? "rgba(52,211,153,0.4)" : C.border}`,
        cursor: "pointer", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {file ? `✓ ${file.name}` : "Selecionar PDF"}
      </button>
    </div>
  );
}
