import Link from "next/link";

import { requireUser } from "@ork/auth/server";
import { getCurrentUnitComOrigem } from "@ork/auth/unit";
import { createSupabaseServerClient } from "@ork/db/supabase/server";
import { competenciaLabel } from "@/lib/financeiro/utils";
import { getLancamentosNaoClassificados, listarRegras } from "@/app/financeiro/razao/actions";
import { ClassificacaoPainel } from "@/components/financeiro/classificacao/ClassificacaoPainel";
import { AvisoUnidadeFallback } from "@/components/financeiro/AvisoUnidadeFallback";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ competencia?: string }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(buildQuery: (from: number, to: number) => any) {
  const pageSize = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    result.push(...page);
    if (page.length < pageSize) return result;
  }
}

export default async function ClassificacaoPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const sp = await searchParams;

  const supabase = await createSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Unidade é contexto global (cookie do shell) — uma regra de
  // classificação é sempre escopada a uma unidade específica, mas QUAL
  // unidade é decidido no menu, não aqui.
  const { unit, cookiePresente } = await getCurrentUnitComOrigem();
  const unitId = unit?.id ?? null;
  const unitName = unit?.name ?? "—";

  const competenciasRows = unitId ? (await fetchAll((from, to) =>
    db.from("kpi_snapshot").select("competencia").eq("unit_id", unitId).order("competencia").range(from, to),
  )) as Array<{ competencia: string }> : [];
  const competenciasDisponiveis = [...new Set(competenciasRows.map((c) => c.competencia))].sort();
  const competencia = sp.competencia && competenciasDisponiveis.includes(sp.competencia)
    ? sp.competencia
    : (competenciasDisponiveis.at(-1) ?? null);

  const href = (competenciaVal: string | null) => {
    const params = new URLSearchParams();
    if (competenciaVal) params.set("competencia", competenciaVal);
    return `/financeiro/dre/classificacao?${params.toString()}`;
  };
  const linkStyle = (ativo: boolean): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: ativo ? 700 : 500,
    textDecoration: "none", whiteSpace: "nowrap",
    background: ativo ? "var(--brand, #C4622D)" : "var(--surface-2)",
    color: ativo ? "var(--primary-foreground)" : "var(--text-3)",
    border: "1px solid var(--border)",
  });

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <nav style={{ display: "flex", gap: 16, marginBottom: 14, fontSize: 13 }}>
        <Link href="/financeiro" style={{ color: "var(--text-3)", textDecoration: "none" }}>Financeiro</Link>
        <span style={{ color: "var(--text-3)" }}>/</span>
        <span style={{ color: "var(--text)", fontWeight: 600 }}>Classificação de lançamentos</span>
      </nav>

      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--text)", letterSpacing: -0.5, margin: "0 0 4px" }}>
          Classificação · {unitName}{competencia ? ` · ${competenciaLabel(competencia)}` : ""}
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-2)", maxWidth: 640, margin: "0 0 8px" }}>
          Lançamentos em 9.99 (a classificar) agrupados por fornecedor. Uma decisão classifica todo o
          histórico e o futuro daquele fornecedor — gerarLancamentosTitulos() aplica a regra em toda execução.
        </p>
        <AvisoUnidadeFallback cookiePresente={cookiePresente} />
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          {competenciasDisponiveis.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {competenciasDisponiveis.map((c) => (
                <Link key={c} href={href(c)} style={linkStyle(c === competencia)}>
                  {competenciaLabel(c)}
                </Link>
              ))}
            </div>
          )}
        </div>
      </header>

      {!unitId || !competencia ? (
        <div style={{ padding: 48, textAlign: "center", background: "var(--surface)",
          border: "1px dashed var(--border)", borderRadius: 14, color: "var(--text-3)", fontSize: 13 }}>
          Nenhum snapshot gerado ainda pra essa unidade.
        </div>
      ) : (
        <PainelData unitId={unitId} competencia={competencia} />
      )}
    </div>
  );
}

async function PainelData({ unitId, competencia }: { unitId: string; competencia: string }) {
  const [naoClassificados, regrasResultado] = await Promise.all([
    getLancamentosNaoClassificados(unitId, competencia),
    listarRegras(unitId),
  ]);

  if (!naoClassificados.ok) {
    return (
      <div style={{ padding: 24, background: "rgba(239,68,68,.1)", borderRadius: 12, color: "#ef4444", fontSize: 13 }}>
        Erro ao carregar lançamentos: {naoClassificados.error}
      </div>
    );
  }

  return (
    <ClassificacaoPainel
      unitId={unitId}
      competencia={competencia}
      totalNaoClassificado={naoClassificados.totalNaoClassificado}
      fornecedores={naoClassificados.fornecedores}
      planoContas={naoClassificados.planoContas}
      regrasIniciais={regrasResultado.ok ? regrasResultado.regras : []}
    />
  );
}
