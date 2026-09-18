"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useUnit } from "@ork/auth/context";

const API_BASE = "/financeiro";

const C = {
  receita: "#34d399", amber: "#fbbf24", alerta: "#f87171",
  text: "var(--text, #F5F0E8)", text2: "var(--text-2, #C8C2B8)", text3: "var(--text-3, #8A8278)",
  surface: "var(--surface, #1A1A18)", surface2: "var(--surface-2, #222220)", surface3: "var(--surface-3, #2C2C2A)",
  border: "var(--border, rgba(245,240,232,0.08))", brand: "var(--brand, #C4622D)",
};
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmt = (n: number) => BRL.format(Math.abs(n)); // despesa positiva
const fmtK = (n: number) => (Math.abs(n) >= 1000 ? `${(Math.abs(n) / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : Math.round(Math.abs(n)).toString());
const selectStyle: React.CSSProperties = { padding: "7px 10px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)", cursor: "pointer" };
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_LONG = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

type Conta = { conta: string; esperada_mensal: boolean; meses: Record<string, number>; total: number };
type Resp = { linha: string; ano: number; empresa: string | null; meses: string[]; contas: Conta[]; esperadas: string[]; total: number; meses_com_dados: string[]; ultimo_mes_unidade: string | null };

export function LinhaDrePage({ linha }: { linha: string }) {
  const { unit } = useUnit();
  const now = useMemo(() => new Date(), []);
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [inic, setInic] = useState(false); // mês inicial já ajustado?
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true); setErro(null);
      try {
        const params = new URLSearchParams({ linha, ano: String(ano) });
        if (unit?.id) params.set("unidade", unit.id);
        const r = await fetch(`${API_BASE}/api/dre/linha-detalhe?${params}`);
        const j = (await r.json()) as Resp & { error?: string };
        if (!vivo) return;
        if (!r.ok) { setErro(j.error ?? `HTTP ${r.status}`); return; }
        setData(j);
        // Mês inicial (uma vez): mês corrente se tiver dados; senão o mais recente
        // com dados da unidade — para não abrir numa tela vazia.
        if (!inic) {
          setInic(true);
          const comDados = j.meses_com_dados ?? [];
          const curRef = `${ano}-${String(mes).padStart(2, "0")}-01`;
          if (comDados.includes(curRef)) {
            /* mantém o mês corrente */
          } else if (comDados.length) {
            setMes(Number(comDados[comDados.length - 1]!.slice(5, 7))); // mais recente do ano (não refaz fetch)
          } else if (j.ultimo_mes_unidade) {
            const y = Number(j.ultimo_mes_unidade.slice(0, 4));
            const m = Number(j.ultimo_mes_unidade.slice(5, 7));
            setMes(m);
            if (y !== ano) setAno(y); // refaz fetch p/ o ano com dados
          }
        }
      } catch (e) { if (vivo) setErro(String(e)); }
      finally { if (vivo) setLoading(false); }
    })();
    return () => { vivo = false; };
  }, [linha, ano, unit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refMes = (m: number) => `${ano}-${String(m).padStart(2, "0")}-01`;
  const mesRef = refMes(mes);
  const mesAntRef = mes > 1 ? refMes(mes - 1) : null;

  // SEÇÃO 1 — detalhe do mês selecionado
  const detalheMes = useMemo(() => {
    if (!data) return { linhas: [] as { conta: string; valor: number; esperada: boolean; falta: boolean }[], total: 0, totalAnt: 0, faltando: 0 };
    const linhasMes = data.contas.map((c) => {
      const valor = c.meses[mesRef] ?? 0;
      const falta = c.esperada_mensal && valor === 0;
      return { conta: c.conta, valor, esperada: c.esperada_mensal, falta };
    }).filter((x) => x.valor > 0 || x.esperada) // mostra quem tem valor + esperadas (mesmo zeradas)
      .sort((a, b) => (a.falta === b.falta ? b.valor - a.valor : a.falta ? 1 : -1));
    const total = data.contas.reduce((s, c) => s + (c.meses[mesRef] ?? 0), 0);
    const totalAnt = mesAntRef ? data.contas.reduce((s, c) => s + (c.meses[mesAntRef] ?? 0), 0) : 0;
    const faltando = linhasMes.filter((x) => x.falta).length;
    return { linhas: linhasMes, total, totalAnt, faltando };
  }, [data, mesRef, mesAntRef]);

  const delta = useMemo(() => {
    if (!mesAntRef || detalheMes.totalAnt === 0) return null;
    const d = detalheMes.total - detalheMes.totalAnt;
    return { abs: d, pct: (d / detalheMes.totalAnt) * 100 };
  }, [detalheMes, mesAntRef]);

  // SEÇÃO 3 — mês a mês (matriz)
  const matriz = useMemo(() => {
    if (!data) return { meses: [] as string[], contas: [] as Conta[], totalPorMes: {} as Record<string, number>, totalAno: 0 };
    const totalPorMes: Record<string, number> = {};
    for (const m of data.meses) totalPorMes[m] = data.contas.reduce((s, c) => s + (c.meses[m] ?? 0), 0);
    const totalAno = data.contas.reduce((s, c) => s + c.total, 0);
    return { meses: data.meses, contas: data.contas, totalPorMes, totalAno };
  }, [data]);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <nav style={{ display: "flex", gap: 16, marginBottom: 14, fontSize: 13 }}>
        <Link href="/financeiro/dre" style={{ color: C.text3, textDecoration: "none" }}>DRE</Link>
        <span style={{ color: C.text3 }}>/</span>
        <span style={{ color: C.text, fontWeight: 600 }}>{linha}</span>
      </nav>

      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.6, margin: 0 }}>{linha}</h1>
          <p style={{ fontSize: 13, color: C.text3, marginTop: 4 }}>{unit?.name ?? "Todas as unidades"} · despesas por competência (regime de caixa)</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} style={selectStyle}>
            {MESES_LONG.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))} style={selectStyle}>
            {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </header>

      {loading ? (
        <div style={{ textAlign: "center", padding: "50px 0", color: C.text3, fontSize: 14 }}>Carregando…</div>
      ) : erro ? (
        <div style={{ textAlign: "center", padding: "50px 0", color: C.alerta, fontSize: 14 }}>Erro: {erro}</div>
      ) : (
        <>
          {/* SEÇÃO 1 — resumo do mês */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: "uppercase", letterSpacing: 0.5 }}>{MESES_LONG[mes - 1]} {ano}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: C.text, marginTop: 6 }}>{fmt(detalheMes.total)}</div>
              {delta ? (
                <div style={{ fontSize: 12, marginTop: 4, color: delta.abs > 0 ? C.alerta : C.receita }}>
                  {delta.abs > 0 ? "↑" : "↓"} {fmt(delta.abs)} ({delta.pct > 0 ? "+" : ""}{delta.pct.toFixed(1)}%) vs {MESES[mes - 2]}
                </div>
              ) : <div style={{ fontSize: 12, marginTop: 4, color: C.text3 }}>{mesAntRef ? "sem base no mês anterior" : "sem mês anterior"}</div>}
            </div>
            <div style={{ background: detalheMes.faltando > 0 ? "rgba(248,113,113,0.06)" : C.surface, border: `1px solid ${detalheMes.faltando > 0 ? "rgba(248,113,113,0.3)" : C.border}`, borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: "uppercase", letterSpacing: 0.5 }}>Contas esperadas faltando</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: detalheMes.faltando > 0 ? C.alerta : C.text, marginTop: 6 }}>{detalheMes.faltando}</div>
              <div style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>neste mês</div>
            </div>
          </div>

          {/* SEÇÃO 1 — tabela do mês */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 28 }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700, color: C.text }}>
              Detalhe de {MESES_LONG[mes - 1]} {ano}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.surface2 }}>
                  <th style={{ padding: "9px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: C.text3, borderBottom: `1px solid ${C.border}` }}>Conta gerencial</th>
                  <th style={{ padding: "9px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: C.text3, borderBottom: `1px solid ${C.border}` }}>Valor</th>
                  <th style={{ padding: "9px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: C.text3, borderBottom: `1px solid ${C.border}`, width: 180 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {detalheMes.linhas.length === 0 ? (
                  <tr><td colSpan={3} style={{ padding: "26px 16px", textAlign: "center", color: C.text3 }}>Sem lançamentos nesta linha no mês.</td></tr>
                ) : detalheMes.linhas.map((x) => (
                  <tr key={x.conta} style={{ borderBottom: `1px solid ${C.border}`, background: x.falta ? "rgba(248,113,113,0.06)" : "transparent" }}>
                    <td style={{ padding: "9px 16px", color: x.falta ? C.alerta : C.text, fontWeight: 500 }}>{x.conta}</td>
                    <td style={{ padding: "9px 16px", textAlign: "right", color: x.falta ? C.alerta : C.text, fontWeight: 600, whiteSpace: "nowrap" }}>{x.falta ? "—" : fmt(x.valor)}</td>
                    <td style={{ padding: "9px 16px", fontSize: 12 }}>
                      {x.falta
                        ? <span style={{ color: C.alerta, fontWeight: 600 }}>— falta lançar</span>
                        : <span style={{ color: C.receita }}>✓{x.esperada ? " esperada" : ""}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: C.surface2 }}>
                  <td style={{ padding: "10px 16px", fontWeight: 700, color: C.text }}>Total do mês</td>
                  <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 700, color: C.text }}>{fmt(detalheMes.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* SEÇÃO 3 — mês a mês */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700, color: C.text }}>Mês a mês · {ano}</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: C.surface2 }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10.5, fontWeight: 600, color: C.text3, borderBottom: `1px solid ${C.border}`, position: "sticky", left: 0, background: C.surface2 }}>Conta</th>
                    {MESES.map((m, i) => <th key={i} style={{ padding: "8px 10px", textAlign: "right", fontSize: 10.5, fontWeight: 600, color: i + 1 === mes ? C.text : C.text3, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{m}</th>)}
                    <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 10.5, fontWeight: 700, color: C.text2, borderBottom: `1px solid ${C.border}` }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matriz.contas.length === 0 ? (
                    <tr><td colSpan={14} style={{ padding: "24px 12px", textAlign: "center", color: C.text3 }}>Sem dados nesta linha em {ano}.</td></tr>
                  ) : matriz.contas.map((c) => (
                    <tr key={c.conta} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "7px 12px", color: C.text, fontWeight: 500, whiteSpace: "nowrap", position: "sticky", left: 0, background: C.surface }}>{c.conta}</td>
                      {matriz.meses.map((m) => {
                        const v = c.meses[m] ?? 0;
                        const falta = c.esperada_mensal && v === 0;
                        return <td key={m} style={{ padding: "7px 10px", textAlign: "right", whiteSpace: "nowrap", color: falta ? C.alerta : v > 0 ? C.text2 : C.text3, background: falta ? "rgba(248,113,113,0.07)" : "transparent", fontWeight: falta ? 700 : 400 }}>{falta ? "falta" : v > 0 ? fmtK(v) : "—"}</td>;
                      })}
                      <td style={{ padding: "7px 12px", textAlign: "right", color: C.text, fontWeight: 600, whiteSpace: "nowrap" }}>{c.total > 0 ? fmt(c.total) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                {matriz.contas.length > 0 && (
                  <tfoot>
                    <tr style={{ background: C.surface2 }}>
                      <td style={{ padding: "9px 12px", fontWeight: 700, color: C.text, position: "sticky", left: 0, background: C.surface2 }}>Total</td>
                      {matriz.meses.map((m) => <td key={m} style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, color: C.text, whiteSpace: "nowrap" }}>{matriz.totalPorMes[m] ? fmtK(matriz.totalPorMes[m]!) : "—"}</td>)}
                      <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, color: C.text, whiteSpace: "nowrap" }}>{fmt(matriz.totalAno)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
