"use client";
import { instance } from "@/lib/instance";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Minus, ChartNoAxesCombined, ReceiptText, Users, Utensils, Wallet, Percent, Layers, Landmark } from "lucide-react";
import { formatBRL, formatBRLCompact, formatPct } from "@/lib/financeiro/utils";
import { agruparPorCompetencia } from "./consolidar";
import { ConfiancaEClassificar } from "./ConfiancaEClassificar";
import { DreResumida } from "./DreResumida";
import { EvolutionChart } from "./EvolutionChart";
import { metricDelta, metricPresentation, sparklinePaths } from "./presentation";
import type { KpiSnapshotRow, DreSnapshotRow, PlanoContaRow, MetaRow, FonteSaudeRow } from "./types";
import styles from "./cockpit.module.css";

export type CockpitProps = {
  unidade: string; competencia: string; janela: string[]; kpiRows: KpiSnapshotRow[];
  metas: MetaRow[]; dreRows: DreSnapshotRow[]; planoContas: PlanoContaRow[]; fontes: FonteSaudeRow[];
};

const CARDS = [
  { key: "receita_liquida", label: "Receita líquida", icon: Wallet, format: formatBRLCompact, tone: "orange" },
  { key: "resultado_liquido", label: "Resultado líquido", icon: ChartNoAxesCombined, format: formatBRLCompact, tone: "lime" },
  { key: "prime_cost_pct", label: "Prime cost", icon: Layers, format: (v: number) => formatPct(v * 100), tone: "default" },
  { key: "ebitda_pct", label: "Margem EBITDA", icon: Percent, format: (v: number) => formatPct(v * 100), tone: "default" },
  { key: "cmv_compras_pct", label: "CMV de compras", icon: Utensils, format: (v: number) => formatPct(v * 100), tone: "compact" },
  { key: "mo_pct", label: "Mão de obra", icon: Users, format: (v: number) => formatPct(v * 100), tone: "compact" },
  { key: "clientes", label: "Clientes atendidos", icon: Users, format: (v: number) => v.toLocaleString("pt-BR"), tone: "compact" },
  { key: "ticket_medio", label: "Ticket médio", icon: ReceiptText, format: formatBRL, tone: "compact" },
] as const;

export function CockpitPainel({ unidade, competencia, janela, kpiRows, metas, dreRows, planoContas, fontes }: CockpitProps) {
  const rows = agruparPorCompetencia(kpiRows, janela, unidade);
  const current = rows.get(competencia) ?? null;
  const previousMonth = janela[janela.indexOf(competencia) - 1];
  const previous = previousMonth ? rows.get(previousMonth) ?? null : null;
  const metasPorChave = new Map(metas.map((meta) => [meta.chave, meta]));

  if (!current) return <CockpitEmpty />;

  const card = (definition: typeof CARDS[number]) => {
    const presentation = metricPresentation(current, definition.key);
    const before = metricPresentation(previous, definition.key);
    const delta = metricDelta(definition.key, presentation.value, before.value, !presentation.partial && !before.partial);
    const series = janela.map((month) => metricPresentation(rows.get(month), definition.key).value);
    return <MetricCard key={definition.key} definition={definition} presentation={presentation} delta={delta} series={series} meta={metasPorChave.get(definition.key)} />;
  };
  const unclassified = dreRows.filter((row) => row.conta_codigo === "9.99" && (unidade === "consolidado" || row.unit_id === unidade)).reduce((sum, row) => sum + Number(row.valor), 0);

  return <div className={styles.dashboard}>
    <section className={styles.primaryGrid} aria-label="Principais indicadores">{CARDS.slice(0, 4).map(card)}</section>
    <div className={styles.middleGrid}><EvolutionChart janela={janela} rows={rows} /><CostBreakdown row={current} /></div>
    <section className={styles.secondaryGrid} aria-label="Indicadores operacionais">{CARDS.slice(4).map(card)}</section>
    <div className={styles.bottomGrid}>
      <DreResumida dreRows={dreRows} planoContas={planoContas} receitaLiquida={current.receita_liquida ?? 0} />
      <ConfiancaEClassificar unidade={unidade} atual={current} fontes={fontes} competencia={competencia} valorNaoClassificado={unclassified} />
    </div>
    <footer className={styles.footer}><span className={styles.footerMark}>{instance.name}</span><span>Uma visão clara. Decisões melhores.</span><span>Valores em reais · competência selecionada</span></footer>
  </div>;
}

export function CockpitEmpty() {
  return <section className="ork-panel ork-empty ork-enter"><ChartNoAxesCombined size={32} /><h2>Seu próximo resultado começa aqui.</h2><p>Ainda não há resultados disponíveis para esta unidade e período. Confira as importações ou escolha outra competência.</p><Link href="/financeiro/importacao-ork" className="ork-button ork-button-primary">Conferir importações <ArrowUpRight size={16} /></Link></section>;
}

function MetricCard({ definition, presentation, delta, series, meta }: {
  definition: typeof CARDS[number]; presentation: ReturnType<typeof metricPresentation>; delta: ReturnType<typeof metricDelta>; series: Array<number | null>; meta?: MetaRow;
}) {
  const Icon = definition.icon;
  const alert = definition.key === "prime_cost_pct" && presentation.value != null && presentation.value > .65;
  const paths = sparklinePaths(series);
  return <article className={`ork-enter ${styles.metric}`} data-tone={definition.tone}>
    <div className={styles.metricHeading}><span>{definition.label}</span><span className={styles.metricIcon}><Icon size={16} strokeWidth={1.7} /></span></div>
    <div className={styles.metricValue}>{presentation.value == null ? "—" : definition.format(presentation.value)}</div>
    {presentation.missing && <p className={styles.metricNote}>{presentation.missing}</p>}
    {presentation.partial && <p className={styles.partial}>{presentation.partial}</p>}
    <div className={styles.metricBottom}>
      {delta ? <span className={styles.delta} data-tone={delta.tone}>{delta.value === 0 ? <Minus size={12} /> : delta.value < 0 ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}{Math.abs(delta.value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}{delta.unit === "%" ? "%" : ` ${delta.unit}`}<span className="sr-only">{delta.value === 0 ? " sem variação" : delta.value < 0 ? " de redução" : " de aumento"} em relação ao mês anterior</span></span> : <span className={styles.metricNote}>{presentation.partial ? "Resultado em apuração" : "Sem comparação"}</span>}
      {paths.length > 0 && <svg width="76" height="28" viewBox="0 0 100 32" aria-hidden="true">{paths.map((path, index) => <path key={index} d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}</svg>}
    </div>
    <div className={styles.metricMeta}>{alert ? <span className={styles.costAlert}>Acima da referência de 65%</span> : meta ? `Meta ${definition.format(Number(meta.valor))}` : delta ? "Em relação ao mês anterior" : definition.key === "cmv_compras_pct" ? "Participação na receita líquida" : "Acompanhe a evolução mensal"}</div>
  </article>;
}

function CostBreakdown({ row }: { row: KpiSnapshotRow }) {
  const costs = [
    { label: "Mercadorias", value: row.tem_nfe ? row.cmv_compras : null, color: "var(--chart-1)" },
    { label: "Mão de obra", value: row.tem_folha ? row.mao_de_obra : null, color: "var(--chart-2)" },
    { label: "Operacionais", value: row.despesas_operacionais, color: "var(--chart-3)" },
  ];
  const total = costs.reduce((sum, cost) => sum + Math.abs(cost.value ?? 0), 0);
  const incomplete = costs.some((cost) => cost.value == null);
  return <section className={`ork-panel ${styles.costs}`}>
    <div className="ork-panel-heading"><div><h2>Para onde vai?</h2><p>Composição dos custos informados</p></div><Landmark size={18} className={styles.subtleIcon} /></div>
    <div className={styles.costContent}>
      <span className={styles.costCaption}>Custos no período{incomplete ? " · parcial" : ""}</span><strong className={styles.costTotal}>{total > 0 || !incomplete ? formatBRLCompact(total) : "—"}</strong>
      <div className={styles.costBar} aria-hidden="true">{costs.map((cost) => <span key={cost.label} style={{ width: `${total ? Math.abs(cost.value ?? 0) / total * 100 : 0}%`, background: cost.color }} />)}</div>
      <div className={styles.costList}>{costs.map((cost) => <div key={cost.label}><span><i style={{ background: cost.color }} />{cost.label}</span><strong>{cost.value == null ? "Sem dados" : formatBRLCompact(Math.abs(cost.value))}</strong></div>)}</div>
      <p className={styles.costFootnote}>Valores apresentados em módulo. {incomplete ? "A composição será atualizada com as próximas importações." : "Consulte a DRE para o detalhamento completo."}</p>
      <Link href="/financeiro/dre?aba=despesas" className="ork-text-link">Entender minhas despesas <ArrowUpRight size={14} /></Link>
    </div>
  </section>;
}
