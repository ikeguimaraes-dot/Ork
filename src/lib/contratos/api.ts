import { createFinanceiroClient } from "@/lib/financeiro/db/client";
// Helpers compartilhados pelas rotas /api/contratos/* — segue o padrão das rotas
// lorean/vendas: service role do Supabase (projeto projeto-do-cliente), CORS
// para o shell ork e handler OPTIONS.


export const BUCKET = "contratos";

export const CORS = {
  "Access-Control-Allow-Origin":  "http://localhost:3001",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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

// Pasta no Storage: {unit_id ou 'kph'}/{contrato_id}/{arquivo}
export function unitFolder(unitId: string | null | undefined) {
  return unitId || "kph";
}

// Campos aceitos em create/update de contrato (whitelist).
const CAMPOS = [
  "unit_id", "titulo", "categoria", "contraparte", "contraparte_doc", "responsavel",
  "valor", "recorrencia", "data_inicio", "data_fim", "vigencia_indeterminada",
  "renovacao_automatica", "aviso_previo_dias", "indice_reajuste", "data_proximo_reajuste",
  "multa_rescisoria", "status_manual", "tags", "observacoes",
] as const;

export function pickContrato(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of CAMPOS) if (k in body) out[k] = body[k] === "" ? null : body[k];
  return out;
}

// Sanitiza o nome do arquivo para um path seguro no Storage.
export function safeFileName(nome: string) {
  return (
    nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // remove acentos
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 120) || "arquivo.pdf"
  );
}
