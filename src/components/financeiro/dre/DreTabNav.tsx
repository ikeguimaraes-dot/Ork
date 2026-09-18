import Link from "next/link"

const TABS = [
  { key: "dre",         label: "DRE" },
  { key: "indicadores", label: "Indicadores" },
  { key: "receita",     label: "Receita" },
  { key: "despesas",    label: "Despesas" },
  { key: "folha",       label: "Folha" },
  { key: "gorjeta",     label: "Gorjeta" },
  { key: "historico",   label: "Histórico" },
  { key: "auditoria",   label: "Auditoria" },
]

export function DreTabNav({ aba, mes }: { aba: string; mes?: string }) {
  return <nav className="ork-tabs" aria-label="Visões da DRE">{TABS.map((tab) => {
    const params = new URLSearchParams({ aba: tab.key });
    if (mes) params.set("mes", mes);
    return <Link key={tab.key} href={`/financeiro/dre?${params}`} aria-current={aba === tab.key ? "page" : undefined}>{tab.label}</Link>;
  })}</nav>;
}
