import type { RemoteNavGroup } from "./types";
export type NavConfig = { groups: RemoteNavGroup[]; shellUrl: string; offline: boolean };
export async function fetchNavConfig(): Promise<NavConfig> {
  const links: Array<[string, string, string]> = [
    ["/financeiro", "Cockpit", "Gauge"], ["/financeiro/fluxo", "Fluxo de Caixa", "ArrowLeftRight"],
    ["/financeiro/dre", "DRE", "Sheet"], ["/financeiro/dre/receita", "Receita", "Banknote"],
    ["/financeiro/dre/folha", "Folha", "Users"], ["/financeiro/dre/cmv", "Produtos e NF-e", "Package"],
    ["/financeiro/pagar", "Contas a Pagar", "CreditCard"], ["/financeiro/pagar/importar", "Importar compras", "Upload"],
    ["/financeiro/importacao-ork", "Importar pacote", "Upload"], ["/financeiro/receber", "Contas a Receber", "Banknote"],
    ["/financeiro/aprovacoes", "Conferência", "CheckSquare"], ["/financeiro/conciliacao", "Conciliação", "RefreshCw"],
    ["/financeiro/contratos", "Contratos", "FileText"], ["/financeiro/dre/classificacao", "Classificação", "Tags"],
    ["/financeiro/orcamento", "Orçamento", "PiggyBank"],
  ];
  return { shellUrl: "", offline: false, groups: [{ id: "financeiro", label: "Financeiro", icon: "Wallet", defaultOpen: true, habilitado: true, items: links.map(([href,label,icon]) => ({href,label,icon})) }] };
}
