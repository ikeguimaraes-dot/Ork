import Link from "next/link";
import { Banknote, ArrowUpRight } from "lucide-react";
import { requireUser } from "@ork/auth/server";
import { PageHeading } from "@/components/ui/PageHeading";

export const dynamic = "force-dynamic";
export default async function Page() {
  await requireUser();
  return <div style={{ maxWidth: 1400, margin: "0 auto" }}><PageHeading title="Contas a receber" description="Uma visão dos próximos recebimentos da sua operação." /><section className="ork-panel ork-empty"><Banknote size={32} /><h2>Esta visão está em preparação.</h2><p>Por enquanto, você pode acompanhar os recebimentos previstos e seu impacto no saldo pelo fluxo de caixa.</p><Link href="/financeiro/fluxo" className="ork-button ork-button-primary">Ver fluxo de caixa <ArrowUpRight size={16} /></Link></section></div>;
}
