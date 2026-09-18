import { createFinanceiroClient } from "@/lib/financeiro/db/client";
// Helpers das rotas /api/dre/* — service role do projeto principal
// (projeto-do-cliente, onde vive titulos_a_pagar) + CORS para o shell ork.


export const CORS = {
  "Access-Control-Allow-Origin":  "http://localhost:3001",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function corsOptions() {
  return new Response(null, { headers: CORS });
}
export function jsonOk(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}
export function jsonError(message: string, status = 500) {
  return Response.json({ error: message }, { status, headers: CORS });
}

export const getServiceClient = createFinanceiroClient;

// Unidades: empresa do Everest ↔ unit_id. Só Restaurante exemplo ("1") por enquanto.
import { unitRules } from "@/lib/instance";
export const EMPRESA_POR_UNIT: Record<string, string> = Object.fromEntries(Object.entries(unitRules).filter(([,rule]) => rule.erpCompany).map(([id,rule]) => [id,rule.erpCompany!]));
// Normaliza o param de unidade (aceita o código "1" ou o uuid da unidade).
export function resolveEmpresa(unidade: string | null): string | null {
  if (!unidade) return null;
  return EMPRESA_POR_UNIT[unidade] ?? null;
}

export const LINHAS_DRE = [
  "Ocupação", "Utilidades", "Operação", "Manutenção", "Administrativo", "CMV",
  "Pessoal", "Impostos", "Despesas Financeiras", "Marketing", "Taxas Cartão",
] as const;

// Empresa Everest ESTRITA por unit_id (sem fallback para o uuid). Usado pelo
// dashboard, onde deixar o filtro de empresa vazio contaminaria uma unidade com
// os títulos de outra. Unidade sem empresa Everest → null (métricas de título
// viram sem_dados, nunca zero).
export function empresaEverestDaUnit(unidade: string | null): string | null {
  if (!unidade) return null;
  return EMPRESA_POR_UNIT[unidade] ?? null;
}

// ── Resolução de linha da DRE (precedência override do título > mapa da conta) ──
// Mesma lógica das rotas /api/dre/despesas e /api/dre/linha-detalhe, extraída
// para não duplicar. Aceita as linhas das 3 tabelas e devolve resolvedores.
type MapaRow = { descricao_c_gerencial: string; linha_dre: string | null; esperada_mensal?: boolean | null };
type OverrideRow = { titulo_id: string; linha_dre_corrigida: string | null };
type TituloRef = { id: string; descricao_c_gerencial: string | null };

export function buildLinhaResolver(mapaRows: MapaRow[] | null | undefined, overrideRows: OverrideRow[] | null | undefined) {
  const linhaDaConta = new Map<string, string | null>();
  const esperadaDaConta = new Map<string, boolean>();
  for (const m of mapaRows ?? []) {
    linhaDaConta.set(m.descricao_c_gerencial, m.linha_dre ?? null);
    esperadaDaConta.set(m.descricao_c_gerencial, !!m.esperada_mensal);
  }
  const overrideDoTitulo = new Map<string, string | null>();
  for (const o of overrideRows ?? []) overrideDoTitulo.set(o.titulo_id, o.linha_dre_corrigida ?? null);

  // Precedência: override do título tem prioridade sobre o mapa da conta.
  const resolve = (t: TituloRef): string | null =>
    (overrideDoTitulo.has(t.id) ? overrideDoTitulo.get(t.id) : linhaDaConta.get(t.descricao_c_gerencial ?? "")) ?? null;

  return { linhaDaConta, esperadaDaConta, overrideDoTitulo, resolve };
}

// ── CORS por allowlist dinâmica (ecoa o Origin quando permitido) ──
const CORS_ALLOWLIST = new Set([
  "http://localhost:3001",
  "http://localhost:3001",
  "http://localhost:3000",
]);

export function corsHeadersFor(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  if (origin && CORS_ALLOWLIST.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
export function corsOptionsFor(origin: string | null) {
  return new Response(null, { headers: corsHeadersFor(origin) });
}
export function jsonOkFor(origin: string | null, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeadersFor(origin) });
}
export function jsonErrorFor(origin: string | null, message: string, status = 500) {
  return Response.json({ error: message }, { status, headers: corsHeadersFor(origin) });
}

// ── Aritmética de mês (ref_mes = 1º dia do mês; datas em ISO YYYY-MM-DD) ──
export function monthRange(mes: string) {
  // mes = "YYYY-MM"
  const [y, m] = mes.split("-").map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, "0");
  const startOf = (yy: number, mm: number) => `${yy}-${pad(mm)}-01`;
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    ano: y, mes: m,
    refMes: startOf(y, m),
    start: startOf(y, m),
    nextStart: startOf(nextY, nextM),
    prevRefMes: startOf(prevY, prevM),
    prevStart: startOf(prevY, prevM),
    prevNextStart: startOf(y, m),
  };
}
