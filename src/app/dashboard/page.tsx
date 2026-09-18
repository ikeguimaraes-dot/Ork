import { CockpitDashboard, type CockpitSearchParams } from "@/components/financeiro/cockpit/CockpitDashboard";

export const dynamic = "force-dynamic";

export default function DashboardPage({ searchParams }: { searchParams: CockpitSearchParams }) {
  return <CockpitDashboard searchParams={searchParams} basePath="/dashboard" />;
}
