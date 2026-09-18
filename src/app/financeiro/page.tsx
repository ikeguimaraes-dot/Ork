import { CockpitDashboard, type CockpitSearchParams } from "@/components/financeiro/cockpit/CockpitDashboard";

export const dynamic = "force-dynamic";

export default function FinanceiroHubPage({ searchParams }: { searchParams: CockpitSearchParams }) {
  return <CockpitDashboard searchParams={searchParams} />;
}
