"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ArrowUpRight, Building2, CalendarDays, Layers, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { competenciaLabel } from "@/lib/financeiro/utils";
import styles from "./cockpit.module.css";

export function CockpitHeader({ unidade, competencia, competencias, consolidado, preview = false, basePath = "/financeiro" }: {
  unidade: string; competencia: string | null; competencias: string[]; consolidado: boolean; preview?: boolean; basePath?: "/financeiro" | "/dashboard";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function navigate(month: string | null, consolidated: boolean) {
    const params = new URLSearchParams();
    if (month) params.set("competencia", month);
    if (consolidated) params.set("consolidado", "1");
    startTransition(() => router.push(`${preview ? "/design-preview.html" : basePath}?${params}`));
  }
  return <>
    <header className="ork-page-heading ork-enter">
      <div><p className="ork-eyebrow">Visão geral · Financeiro</p><h1>Seu negócio, <em>em perspectiva.</em></h1><p>Clareza para acompanhar os resultados. Confiança para decidir o próximo passo.</p></div>
      <Link href="/financeiro/dre" className="ork-button">Explorar DRE <ArrowUpRight size={15} /></Link>
    </header>
    <div className={styles.toolbar} aria-busy={pending}>
      <div className={styles.context}><Building2 size={15} /><strong>{unidade}</strong><span className={styles.contextDivider} /><span>Painel de resultados</span></div>
      <div className={styles.filters}>
        <button type="button" className={styles.consolidated} aria-pressed={consolidado} disabled={pending} onClick={() => navigate(competencia, !consolidado)}><Layers size={14} /> Consolidado</button>
        <label className={styles.month}><CalendarDays size={15} /><span className="sr-only">Competência</span><select value={competencia ?? ""} disabled={pending || !competencias.length} onChange={(event) => navigate(event.target.value, consolidado)}>{!competencias.length && <option value="">Sem períodos</option>}{[...competencias].reverse().map((month) => <option key={month} value={month}>{competenciaLabel(month)}</option>)}</select>{pending && <LoaderCircle size={14} className="animate-spin" />}</label>
      </div>
    </div>
  </>;
}
