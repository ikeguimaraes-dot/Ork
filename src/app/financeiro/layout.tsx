import { createFinanceiroClient } from "@/lib/financeiro/db/client";
import { AuthProvider } from "@ork/auth/context";
import { requireUser } from "@ork/auth/server";
import { getCurrentUnit } from "@ork/auth/unit";
import {  createSupabaseServerClient } from "@ork/db/supabase/server";
import type { Unit } from "@ork/db/types/database";
import { Sidebar } from "@ork/ui/sidebar";
import { fetchNavConfig } from "@ork/ui/nav/fetchNavConfig";

import { FinanceiroTopbar } from "@/components/ui/FinanceiroTopbar";

export const dynamic = "force-dynamic";

export default async function FinanceiroLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const [units, hasRegisteredUnits, navConfig, currentUnit] = await Promise.all([
    loadAccessibleUnits(),
    hasAnyActiveUnit(),
    fetchNavConfig(),
    getCurrentUnit(),
  ]);

  return (
    <AuthProvider user={user} units={units} hasRegisteredUnits={hasRegisteredUnits} initialUnitId={currentUnit?.id}>
      <div className="ork-workspace">
        <a className="ork-skip-link" href="#conteudo">Pular para o conteúdo</a>
        <Sidebar navGroups={navConfig.groups} shellUrl={navConfig.shellUrl} navOffline={navConfig.offline} />
        <div className="ork-workspace-body">
          <FinanceiroTopbar groups={navConfig.groups} shellUrl={navConfig.shellUrl} />
          <main id="conteudo" tabIndex={-1} className="shell-main ork-page-main">
          {children}
        </main>
        </div>
      </div>
    </AuthProvider>
  );
}

async function hasAnyActiveUnit(): Promise<boolean> {
  const service = await createFinanceiroClient();
  if (!service) return false;
  const { count, error } = await service.from("units").select("id", { count: "exact", head: true }).eq("active", true);
  return !error && (count ?? 0) > 0;
}

async function loadAccessibleUnits(): Promise<Unit[]> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("units")
      .select("*")
      .eq("active", true)
      .order("name");
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}
