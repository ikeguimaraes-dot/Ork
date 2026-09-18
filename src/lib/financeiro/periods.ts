import { createFinanceiroClient } from "./db/client";
import { fetchAllPaginado } from "./razao/gerar";
import { competenciaTitulo } from "./dates";
export async function availablePeriods(): Promise<string[]> {
  const db = await createFinanceiroClient();
  const current = new Date().toISOString().slice(0, 7) + "-01";
  const titles = await fetchAllPaginado((from,to) => db.from("titulos_a_pagar").select("d_competencia,d_lancamento,d_vencimento").range(from,to));
  const snapshots = await fetchAllPaginado((from,to) => db.from("kpi_snapshot").select("competencia").range(from,to));
  return [...new Set([current, ...titles.map(competenciaTitulo).filter((v): v is string => !!v), ...snapshots.map(s => s.competencia as string)])].sort();
}
