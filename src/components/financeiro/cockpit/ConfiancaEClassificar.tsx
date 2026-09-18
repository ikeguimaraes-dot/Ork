import Link from "next/link";
import { ArrowUpRight, ShieldCheck, ListChecks } from "lucide-react";
import { formatBRL, formatPct } from "@/lib/financeiro/utils";
import type { KpiSnapshotRow, FonteSaudeRow } from "./types";
import styles from "./cockpit.module.css";

type Props = { unidade: string; atual: KpiSnapshotRow; fontes: FonteSaudeRow[]; competencia: string; valorNaoClassificado: number };
const SOURCE_STATUS: Record<string, { label: string; color: string }> = {
  viva: { label: "Atualizada", color: "var(--color-success)" },
  atrasada: { label: "Atrasada", color: "var(--color-warning)" },
  morta: { label: "Sem atualização", color: "var(--color-danger)" },
};

export function ConfiancaEClassificar({ atual, fontes, valorNaoClassificado }: Props) {
  const confidence = atual.confianca_pct;
  const classified = atual.pct_classificado;
  const low = confidence != null && confidence < .7;
  const percentage = Math.max(0, Math.min(100, (confidence ?? 0) * 100));
  const color = low ? "var(--color-warning)" : "var(--chart-2)";
  return <div className={styles.healthStack}>
    <section className="ork-panel">
      <div className="ork-panel-heading"><div><h2>Confiança nos números</h2><p>Qualidade e atualização dos dados</p></div><ShieldCheck size={19} className={styles.subtleIcon} /></div>
      <div className={styles.healthBody}>
        <div className={styles.healthOverview}>
          <div className={styles.healthRing} style={{ background: `conic-gradient(${color} ${percentage}%, var(--surface-2) 0)` }}><strong>{confidence == null ? "—" : formatPct(confidence * 100, 0)}</strong></div>
          <div><span className="ork-badge" data-tone={confidence == null ? undefined : low ? "warning" : "success"}>{confidence == null ? "Em apuração" : low ? "Requer atenção" : "Boa cobertura"}</span><p>{classified == null ? "Classificação em apuração" : `${formatPct(classified * 100, 0)} dos lançamentos classificados`}<br />{atual.fontes_ok ?? "—"} de {atual.fontes_total ?? "—"} fontes atualizadas</p></div>
        </div>
        <details className={styles.sources}><summary>Consultar fontes de dados ({fontes.length})</summary>{fontes.map((source) => <div key={source.fonte}><span>{source.fonte.replace(/_/g, " ")}</span><span style={{ color: SOURCE_STATUS[source.status_fonte]?.color ?? "var(--text-3)" }}>{SOURCE_STATUS[source.status_fonte]?.label ?? source.status_fonte}{source.dias_sem_atualizacao != null ? ` · ${source.dias_sem_atualizacao}d` : ""}</span></div>)}</details>
      </div>
    </section>
    <section className="ork-panel">
      <div className="ork-panel-heading"><div><h2>Próximos passos</h2><p>O que merece sua atenção</p></div><ListChecks size={19} className={styles.subtleIcon} /></div>
      <div className={styles.healthBody}>
        <div className={styles.pending}><div><p>Aguardando classificação</p><strong>{formatBRL(valorNaoClassificado)}</strong></div><Link href="/financeiro/dre/classificacao" className="ork-icon-button" aria-label="Classificar lançamentos"><ArrowUpRight size={17} /></Link></div>
        <div className={styles.pending}><div><p>Possível dupla contagem</p><strong style={{ color: (atual.possivel_dupla_contagem ?? 0) > 0 ? "var(--color-warning)" : undefined }}>{atual.possivel_dupla_contagem == null ? "—" : formatBRL(atual.possivel_dupla_contagem)}</strong>{(atual.possivel_dupla_contagem ?? 0) > 0 && <small>Há títulos com notas fiscais a confirmar. O resultado pode mudar após a conferência.</small>}</div></div>
      </div>
    </section>
  </div>;
}
