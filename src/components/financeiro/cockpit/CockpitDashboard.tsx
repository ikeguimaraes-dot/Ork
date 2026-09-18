import { refreshUnits } from "@/lib/financeiro/razao/refresh";
import "server-only";
import { requireUser } from "@ork/auth/server";
import { getCurrentUnitComOrigem } from "@ork/auth/unit";
import { createSupabaseServerClient } from "@ork/db/supabase/server";
import { competenciaShift } from "@/lib/financeiro/utils";
import { CockpitHeader } from "@/components/financeiro/cockpit/CockpitHeader";
import { CockpitEmpty } from "@/components/financeiro/cockpit/CockpitPainel";
import { CockpitPainel } from "@/components/financeiro/cockpit/CockpitPainel";
import { AvisoUnidadeFallback } from "@/components/financeiro/AvisoUnidadeFallback";
import type {
  KpiSnapshotRow,
  DreSnapshotRow,
  PlanoContaRow,
  MetaRow,
  FonteSaudeRow,
} from "@/components/financeiro/cockpit/types";

const JANELA_MESES = 6;

export type CockpitSearchParams = Promise<{ consolidado?: string; competencia?: string }>;

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

export async function CockpitDashboard({ searchParams, basePath = "/financeiro" }: { searchParams: CockpitSearchParams; basePath?: "/financeiro" | "/dashboard" }) {
  await requireUser();
  const sp = await searchParams;

  const supabase = await createSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: units, error: unitsError } = await db.from("units").select("id").eq("active", true);
  if (unitsError) throw new Error(unitsError.message);
  const unitIdsTodos: string[] = (units ?? []).map((u: { id: string }) => u.id);

  if (!db) throw new Error("Banco de dados indisponível");
  try { await refreshUnits(db, unitIdsTodos); }
  catch (error) {
    return <div role="alert" style={{ padding: 24 }}>Não foi possível atualizar os indicadores. {error instanceof Error ? error.message : "Tente novamente."}</div>;
  }

  const todasCompetencias = (await fetchAll((from, to) =>
    db.from("kpi_snapshot").select("competencia").in("unit_id", unitIdsTodos).order("competencia").range(from, to),
  )) as Array<{ competencia: string }>;
  const competenciasDisponiveis = [...new Set(todasCompetencias.map((c) => c.competencia))].sort();

  const consolidado = sp.consolidado === "1";
  const { unit, cookiePresente } = await getCurrentUnitComOrigem();
  const unidadeParam = consolidado ? "consolidado" : (unit?.id ?? "consolidado");
  const unidadeNome = consolidado ? "Consolidado" : (unit?.name ?? "Consolidado");
  const competenciaParam = sp.competencia && competenciasDisponiveis.includes(sp.competencia)
    ? sp.competencia
    : (competenciasDisponiveis.at(-1) ?? null);

  return (
    <div style={{ maxWidth: 1440, margin: "0 auto" }}>
      <CockpitHeader unidade={unidadeNome} competencia={competenciaParam} competencias={competenciasDisponiveis} consolidado={consolidado} basePath={basePath} />
      {!consolidado && <AvisoUnidadeFallback cookiePresente={cookiePresente} />}

      {!competenciaParam ? (
        <CockpitEmpty />
      ) : (
        <PainelData
          db={db}
          unidadeParam={unidadeParam}
          competenciaParam={competenciaParam}
          unitIdsTodos={unitIdsTodos}
        />
      )}
    </div>
  );
}

async function PainelData({ db, unidadeParam, competenciaParam, unitIdsTodos }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any; unidadeParam: string; competenciaParam: string; unitIdsTodos: string[];
}) {
  const unitIds = unidadeParam === "consolidado" ? unitIdsTodos : [unidadeParam];

  const janela: string[] = [];
  for (let i = JANELA_MESES - 1; i >= 0; i--) janela.push(competenciaShift(competenciaParam, -i));

  const kpiRows = (await fetchAll((from, to) =>
    db.from("kpi_snapshot").select("*").in("unit_id", unitIds).in("competencia", janela).range(from, to),
  )) as KpiSnapshotRow[];

  // Metas só fazem sentido pra uma unidade específica — combinar metas de
  // duas units num "Consolidado" exigiria uma regra que não foi definida.
  const metas = unidadeParam === "consolidado"
    ? []
    : ((await fetchAll((from, to) =>
        db.from("metas").select("chave,valor,tipo,origem").eq("unit_id", unidadeParam).eq("competencia", competenciaParam).range(from, to),
      )) as MetaRow[]);

  const dreRows = (await fetchAll((from, to) =>
    db.from("dre_snapshot").select("unit_id,conta_codigo,valor,qtd_lancamentos").in("unit_id", unitIds).eq("competencia", competenciaParam).range(from, to),
  )) as DreSnapshotRow[];

  const planoContas = (await fetchAll((from, to) =>
    db.from("plano_contas").select("codigo,nome,grupo,ordem").order("ordem").range(from, to),
  )) as PlanoContaRow[];

  const fontes = (await fetchAll((from, to) =>
    db.from("v_fonte_saude").select("fonte,ultima_escrita,dias_sem_atualizacao,status_fonte").range(from, to),
  )) as FonteSaudeRow[];

  return (
    <CockpitPainel
      unidade={unidadeParam}
      competencia={competenciaParam}
      janela={janela}
      kpiRows={kpiRows}
      metas={metas}
      dreRows={dreRows}
      planoContas={planoContas}
      fontes={fontes}
    />
  );
}
