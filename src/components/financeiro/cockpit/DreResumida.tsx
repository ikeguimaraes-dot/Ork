"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import styles from "./cockpit.module.css";
import { formatBRL, formatPct } from "@/lib/financeiro/utils";
import type { DreSnapshotRow, PlanoContaRow } from "./types";

type Props = {
  dreRows: DreSnapshotRow[];
  planoContas: PlanoContaRow[];
  receitaLiquida: number;
};

const GRUPO_LABEL: Record<string, string> = {
  receita: "Receita",
  deducao: "Deduções",
  cmv: "CMV",
  mao_de_obra: "Mão de obra",
  despesa_operacional: "Despesas operacionais",
  financeiro: "Financeiro",
  investimento: "Investimento",
};

const GRUPO_ORDEM = ["receita", "deducao", "cmv", "mao_de_obra", "despesa_operacional", "financeiro", "investimento"];

export function DreResumida({ dreRows, planoContas, receitaLiquida }: Props) {
  const id = useId();
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const contaPorCodigo = new Map(planoContas.map((p) => [p.codigo, p]));

  const totalPorConta = new Map<string, { valor: number; qtd: number }>();
  for (const r of dreRows) {
    const cur = totalPorConta.get(r.conta_codigo) ?? { valor: 0, qtd: 0 };
    cur.valor += Number(r.valor);
    cur.qtd += r.qtd_lancamentos;
    totalPorConta.set(r.conta_codigo, cur);
  }

  const porGrupo = new Map<string, Array<{ codigo: string; nome: string; valor: number; qtd: number }>>();
  for (const [codigo, v] of totalPorConta) {
    const conta = contaPorCodigo.get(codigo);
    const grupo = conta?.grupo ?? "despesa_operacional";
    const lista = porGrupo.get(grupo) ?? [];
    lista.push({ codigo, nome: conta?.nome ?? codigo, valor: v.valor, qtd: v.qtd });
    porGrupo.set(grupo, lista);
  }
  for (const lista of porGrupo.values()) {
    lista.sort((a, b) => (contaPorCodigo.get(a.codigo)?.ordem ?? 9999) - (contaPorCodigo.get(b.codigo)?.ordem ?? 9999));
  }

  function toggle(grupo: string) {
    setExpandido((prev) => {
      const next = new Set(prev);
      if (next.has(grupo)) next.delete(grupo);
      else next.add(grupo);
      return next;
    });
  }

  return <section className={`ork-panel ${styles.dre}`}>
    <div className="ork-panel-heading"><div><h2>Do faturamento ao resultado</h2><p>DRE resumida · abra uma categoria para explorar</p></div><Link href="/financeiro/dre" className="ork-text-link" aria-label="Abrir DRE completa"><ArrowUpRight size={18} /></Link></div>
    {GRUPO_ORDEM.filter((g) => porGrupo.has(g)).map((grupo) => {
      const contas = porGrupo.get(grupo)!;
      const total = contas.reduce((sum, account) => sum + account.valor, 0);
      const percentage = receitaLiquida > 0 ? total / receitaLiquida : null;
      const aberto = expandido.has(grupo);
      return <div key={grupo} className={styles.dreRow}>
        <button type="button" className={styles.dreButton} aria-expanded={aberto} aria-controls={`${id}-${grupo}`} onClick={() => toggle(grupo)}>
          <span className={styles.dreLabel}><ChevronRight size={14} />{GRUPO_LABEL[grupo] ?? grupo}</span>
          <span className={styles.dreAmounts}><strong>{formatBRL(total)}</strong><small>{percentage != null ? `${formatPct(percentage * 100)} da receita líquida` : "Base de comparação indisponível"}</small></span>
        </button>
        <div id={`${id}-${grupo}`} hidden={!aberto} className={styles.dreDetails}>
          {contas.map((account) => <div key={account.codigo}><span>{account.nome}{account.codigo === "9.99" && <span className="ork-badge" data-tone="warning">A classificar</span>}<small>{account.codigo} · {account.qtd} lançamentos</small></span><strong>{formatBRL(account.valor)}</strong></div>)}
        </div>
      </div>;
    })}
    {porGrupo.size === 0 && <p className={styles.chartEmpty}>Nenhum lançamento disponível nesta competência.</p>}
  </section>;
}
