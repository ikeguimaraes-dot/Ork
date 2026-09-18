import { extractedRecord, extractedRows, type PdfRecord } from "@/lib/receita/extraction";
import { applyBatch, replacement, type Mutation } from "@/lib/financeiro/db/atomic";
import { createFinanceiroClient } from "@/lib/financeiro/db/client";
// Importação de relatório CONSOLIDADO (período longo) — Venda (produtos) e
// Movimento (resumo operacional + seções consolidadas). Todos os PDFs são
// OPCIONAIS; exige-se ao menos um. O período é UPSERTado por
// (unit_id, data_inicio, data_fim), então subir um PDF depois ANEXA ao período
// existente sem apagar o que já foi importado de outro PDF.
//
// A extração de produtos (Venda) é IDÊNTICA ao import diário (parsePdf
// compartilhada). A única diferença das duas rotas é o DESTINO no banco.

import { PDFDocument } from "pdf-lib";
import { VENDA_PROMPT, parsePdf } from "@/lib/receita/vendaExtract";
import { parseSalesSpreadsheets } from "@/lib/vendas/spreadsheet-parser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const CORS = {
  "Access-Control-Allow-Origin":  "http://localhost:3001",
  "Access-Control-Allow-Methods": "GET, POST",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { headers: CORS });
}

function jsonError(message: string, status = 500) {
  return Response.json({ success: false, error: message, errors: [message] }, { status, headers: CORS });
}
function jsonOk(body: Record<string, unknown>) {
  return Response.json({ success: true, errors: [], ...body }, { headers: CORS });
}

const getServiceClient = createFinanceiroClient;
type Supa = Awaited<ReturnType<typeof getServiceClient>>;

const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => String(v ?? "").trim();
const BLOCO_MAX_TOKENS = 8000; // ~3 páginas cabem com folga; gera rápido (~15-25s/bloco)

// Fatia o PDF em blocos de N páginas (mesma solução usada no PDF de Venda).
async function splitPdfIntoBlocks(
  pdfBytes: Uint8Array,
  pagesPerBlock = 3,
): Promise<{ b64: string; from: number; to: number }[]> {
  const src = await PDFDocument.load(pdfBytes);
  const total = src.getPageCount();
  const blocks: { b64: string; from: number; to: number }[] = [];
  for (let start = 0; start < total; start += pagesPerBlock) {
    const end = Math.min(start + pagesPerBlock, total);
    const sub = await PDFDocument.create();
    const indices: number[] = [];
    for (let p = start; p < end; p++) indices.push(p);
    const copied = await sub.copyPages(src, indices);
    copied.forEach((pg) => sub.addPage(pg));
    const bytes = await sub.save();
    blocks.push({ b64: Buffer.from(bytes).toString("base64"), from: start + 1, to: end });
  }
  return blocks;
}

// Processa um PDF em blocos de 3 páginas, em ondas de 4, chamando parsePdf por bloco.
async function processInBlocks(
  file: File,
  prompt: string,
  tag: string,
): Promise<PdfRecord[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const blocks = await splitPdfIntoBlocks(bytes, 3);
  const totalPaginas = blocks.length ? blocks[blocks.length - 1]!.to : 0;
  console.log(`[${tag}] PDF tem ${totalPaginas} páginas, dividido em ${blocks.length} blocos`);
  const parts: PdfRecord[] = [];
  const CONC = 4;
  for (let i = 0; i < blocks.length; i += CONC) {
    const grupo = blocks.slice(i, i + CONC);
    const resultados = await Promise.all(
      grupo.map(async (blk, j) => {
        const idx = i + j + 1;
        console.log(`[${tag}] processando bloco ${idx}/${blocks.length} (páginas ${blk.from}-${blk.to})`);
        const parsed = await parsePdf(blk.b64, prompt, `${tag}_bloco_${idx}`, BLOCO_MAX_TOKENS);
        return parsed;
      }),
    );
    parts.push(...resultados);
  }
  return parts;
}

// ── Prompt do MOVIMENTO consolidado ───────────────────────────────────────────
const MOVIMENTO_PROMPT = `Este é um trecho (algumas páginas) de um relatório Lorean de MOVIMENTO consolidado de um período (vários meses somados). Extraia APENAS o que estiver presente NESTAS páginas e retorne APENAS JSON válido, sem texto adicional, sem markdown.

Formato esperado:
{
  "resumo": {
    "acessos": number, "permanencia_media": "HH:MM:SS",
    "ticket_medio": number, "ticket_real": number,
    "bruto": number, "produto": number, "custo": number, "desconto": number,
    "gorjeta": number, "convite": number, "lucro": number, "entrada": number,
    "consumo": number, "devedor": number,
    "pgto_fechado": number, "pgto_recebido": number, "pgto_diferenca": number,
    "cash": number, "card": number, "pix": number
  },
  "mensal":     [ { "mes": "Jan/2026", "ordem": 1, "bruto": number, "liquido": number, "clientes": number, "ticket_medio": number } ],
  "turno":      [ { "turno": string, "bruto": number, "clientes": number, "ticket_medio": number } ],
  "dia_semana": [ { "dia_semana": "Seg", "ordem": 2, "bruto": number, "clientes": number, "ticket_medio": number } ],
  "ambiente":   [ { "ambiente": string, "bruto": number, "clientes": number } ],
  "funcionarios":[ { "funcionario": string, "bruto": number, "qtd_vendas": number } ]
}

Regras:
- "resumo": quadro de TOTAIS do período (Acessos/Clientes, Permanência média, Ticket médio e real, Bruto, Produto, Custo/CMV, Desconto, Gorjeta, Convite/Cortesia, Lucro, Entrada, Consumo, Devedor; e o fechamento de pagamentos: Fechado, Recebido, Diferença, e as formas Dinheiro, Cartão, Pix). Se este quadro NÃO aparecer nestas páginas, use "resumo": null.
- "cash"=dinheiro; "card"=cartão (some débito+crédito se vierem separados); "pix"=pix.
- Valores monetários: número decimal sem "R$" e sem separador de milhar (ex: 1234567.89). Use ponto como separador decimal.
- "permanencia_media": string no formato "HH:MM:SS".
- "mensal": faturamento por mês; "ordem" = posição cronológica (Jan=1, Fev=2, ...).
- "turno": por turno (ex: Almoço, Jantar, Tarde, Noite).
- "dia_semana": por dia da semana; use Dom/Seg/Ter/Qua/Qui/Sex/Sáb; "ordem" Dom=1 ... Sáb=7.
- "ambiente": por ambiente/setor/sala.
- "funcionarios": por funcionário/vendedor/garçom (bruto vendido e quantidade de vendas/atendimentos).
- Extraia SOMENTE linhas presentes nestas páginas. Use [] para seção ausente e null para resumo ausente. NÃO invente dados.`;

// ── UPSERT do período por (unit_id, data_inicio, data_fim) ─────────────────────
async function upsertPeriodo(
  supabase: Supa,
  unitId: string,
  dataInicio: string,
  dataFim: string,
  label: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("vendas_consolidado_periodo")
    .select("id")
    .eq("unit_id", unitId)
    .eq("data_inicio", dataInicio)
    .eq("data_fim", dataFim)
    .maybeSingle();
  if (existing) {
    await supabase.from("vendas_consolidado_periodo").update({ label }).eq("id", existing.id);
    console.log("[vc] período existente reaproveitado, id:", existing.id);
    return existing.id;
  }
  const { data: ins, error } = await supabase
    .from("vendas_consolidado_periodo")
    .insert({ unit_id: unitId, data_inicio: dataInicio, data_fim: dataFim, label })
    .select("id")
    .single();
  if (error) throw new Error(`vendas_consolidado_periodo: ${error.message}`);
  console.log("[vc] período criado, id:", ins.id);
  return ins.id;
}

// ── Venda → produtos (substitui os produtos do período) ───────────────────────
async function processVenda(supabase: Supa, periodoId: string, file: File): Promise<number> {
  const parts = await processInBlocks(file, VENDA_PROMPT, "vc");
  const produtosRaw: PdfRecord[] = [];
  for (const p of parts) {
    const prods = extractedRows(p.produtos);
    produtosRaw.push(...prods);
  }
  console.log("[vc] produtos parseados (somados dos blocos):", produtosRaw.length);
  if (!produtosRaw.length) throw new Error("Nenhum produto extraído do PDF de Venda");

  const map = new Map<string, { grupo: string; produto: string; quantidade: number; valor_bruto: number; valor_desconto: number; valor_liquido: number }>();
  for (const p of produtosRaw) {
    const grupo = str(p.grupo) || "—";
    const produto = str(p.produto) || "—";
    const key = `${grupo}::${produto}`;
    const ex = map.get(key);
    const qtd = num(p.qtd), bruto = num(p.bruto), desconto = num(p.desconto), total = num(p.total);
    if (ex) { ex.quantidade += qtd; ex.valor_bruto += bruto; ex.valor_desconto += desconto; ex.valor_liquido += total; }
    else map.set(key, { grupo, produto, quantidade: qtd, valor_bruto: bruto, valor_desconto: desconto, valor_liquido: total });
  }
  const agregados = Array.from(map.values());
  const totalLiquido = agregados.reduce((s, r) => s + r.valor_liquido, 0);
  console.log("[vc] total agregado:", agregados.length, "produtos · totalLiquido:", totalLiquido);

  const rows = agregados.map((r) => ({
    periodo_id: periodoId,
    grupo: r.grupo, produto: r.produto,
    quantidade: r.quantidade, valor_bruto: r.valor_bruto,
    valor_desconto: r.valor_desconto, valor_liquido: r.valor_liquido,
    participacao_pct: totalLiquido > 0 ? (r.valor_liquido / totalLiquido) * 100 : 0,
  }));

  // Substitui os produtos do período (re-upload do Venda regrava sem duplicar).
  await applyBatch(supabase, replacement("vendas_consolidado_produtos", { periodo_id: periodoId }, rows));

  return rows.length;
}

// Agrega linhas de uma seção entre blocos, somando por chave.
function aggSection(parts: PdfRecord[], listKey: string, keyField: string, sumFields: string[]) {
  type Aggregate = { bruto: number; clientes: number; liquido: number; mes: string; turno: string; dia_semana: string; ambiente: string; ordem: number | null; [key: string]: string | number | null };
  const m = new Map<string, Aggregate>();
  for (const part of parts) {
    const list = extractedRows(part[listKey]);
    for (const row of list) {
      const k = str(row[keyField]);
      if (!k) continue;
      let ex = m.get(k);
      if (!ex) {
        ex = { bruto: 0, clientes: 0, liquido: 0, mes: "", turno: "", dia_semana: "", ambiente: "", [keyField]: k, ordem: row.ordem != null ? num(row.ordem) : null };
        for (const f of sumFields) ex[f] = 0;
        m.set(k, ex);
      }
      for (const f of sumFields) ex[f] = num(ex[f]) + num(row[f]);
      if (ex.ordem == null && row.ordem != null) ex.ordem = num(row.ordem);
    }
  }
  return Array.from(m.values());
}

// ── Movimento → resumo + seções consolidadas ──────────────────────────────────
async function processMovimento(supabase: Supa, periodoId: string, file: File) {
  const parts = await processInBlocks(file, MOVIMENTO_PROMPT, "vc-mov");

  // Resumo: 1 quadro de totais — aparece em um bloco só; mescla 1º valor não-vazio.
  const RES_NUM = ["acessos","ticket_medio","ticket_real","bruto","produto","custo","desconto","gorjeta","convite","lucro","entrada","consumo","devedor","pgto_fechado","pgto_recebido","pgto_diferenca","cash","card","pix"];
  const resumo: PdfRecord = { permanencia_media: null };
  for (const f of RES_NUM) resumo[f] = null;
  let temResumo = false;
  for (const part of parts) {
    if (part.resumo == null) continue;
    const r = extractedRecord(part.resumo);
    if (resumo.permanencia_media == null && str(r.permanencia_media)) resumo.permanencia_media = str(r.permanencia_media);
    for (const f of RES_NUM) {
      if (resumo[f] == null || resumo[f] === 0) {
        const v = num(r[f]);
        if (v !== 0) { resumo[f] = v; temResumo = true; }
      }
    }
  }
  console.log("[vc-mov] resumo presente:", temResumo);

  // Seções (somadas por chave; ticket/participação recalculados no fim).
  const mensal = aggSection(parts, "mensal", "mes", ["bruto", "liquido", "clientes"])
    .map((r) => ({ ...r, ticket_medio: r.clientes > 0 ? r.bruto / r.clientes : 0 }))
    .sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99));

  const turnoRaw = aggSection(parts, "turno", "turno", ["bruto", "clientes"]);
  const turnoTotal = turnoRaw.reduce((s, r) => s + r.bruto, 0);
  const turno = turnoRaw.map((r) => ({
    ...r,
    ticket_medio: r.clientes > 0 ? r.bruto / r.clientes : 0,
    participacao_pct: turnoTotal > 0 ? (r.bruto / turnoTotal) * 100 : 0,
  })).sort((a, b) => b.bruto - a.bruto);

  const dia = aggSection(parts, "dia_semana", "dia_semana", ["bruto", "clientes"])
    .map((r) => ({ ...r, ticket_medio: r.clientes > 0 ? r.bruto / r.clientes : 0 }))
    .sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99));

  const ambRaw = aggSection(parts, "ambiente", "ambiente", ["bruto", "clientes"]);
  const ambTotal = ambRaw.reduce((s, r) => s + r.bruto, 0);
  const ambiente = ambRaw.map((r) => ({
    ...r,
    participacao_pct: ambTotal > 0 ? (r.bruto / ambTotal) * 100 : 0,
  })).sort((a, b) => b.bruto - a.bruto);

  const funcionarios = aggSection(parts, "funcionarios", "funcionario", ["bruto", "qtd_vendas"])
    .sort((a, b) => b.bruto - a.bruto)
    .slice(0, 40);

  console.log("[vc-mov] seções:", { mensal: mensal.length, turno: turno.length, dia: dia.length, ambiente: ambiente.length, funcionarios: funcionarios.length });

  // Regrava cada seção do período (delete + insert) sem tocar nos produtos.
  const row: Record<string, unknown> = { periodo_id: periodoId, permanencia_media: resumo.permanencia_media };
  for (const f of RES_NUM) row[f] = resumo[f];
  if (row.acessos != null) row.acessos = Math.round(num(row.acessos));
  const operations: Mutation[] = [
    ...replacement("vendas_consolidado_resumo", { periodo_id: periodoId }, temResumo ? [row] : []),
    ...replacement("vendas_consolidado_mensal", { periodo_id: periodoId }, mensal.map((r) => ({ periodo_id: periodoId, mes: r.mes, ordem: r.ordem, bruto: r.bruto, liquido: r.liquido, clientes: Math.round(num(r.clientes)), ticket_medio: r.ticket_medio }))),
    ...replacement("vendas_consolidado_turno", { periodo_id: periodoId }, turno.map((r) => ({ periodo_id: periodoId, turno: r.turno, bruto: r.bruto, clientes: Math.round(num(r.clientes)), ticket_medio: r.ticket_medio, participacao_pct: r.participacao_pct }))),
    ...replacement("vendas_consolidado_dia_semana", { periodo_id: periodoId }, dia.map((r) => ({ periodo_id: periodoId, dia_semana: r.dia_semana, ordem: r.ordem, bruto: r.bruto, clientes: Math.round(num(r.clientes)), ticket_medio: r.ticket_medio }))),
    ...replacement("vendas_consolidado_ambiente", { periodo_id: periodoId }, ambiente.map((r) => ({ periodo_id: periodoId, ambiente: r.ambiente, bruto: r.bruto, clientes: Math.round(num(r.clientes)), participacao_pct: r.participacao_pct }))),
    ...replacement("vendas_consolidado_funcionarios", { periodo_id: periodoId }, funcionarios.map((r) => ({ periodo_id: periodoId, funcionario: r.funcionario, bruto: r.bruto, qtd_vendas: Math.round(num(r.qtd_vendas)) }))),
  ];
  await applyBatch(supabase, operations);
  console.log("[vc-mov] gravado");
  return { resumo: temResumo, mensal: mensal.length, turno: turno.length, dia_semana: dia.length, ambiente: ambiente.length, funcionarios: funcionarios.length };
}

// ── Route handler ──────────────────────────────────────────────────────────────
async function processSpreadsheets(supabase: Supa, periodoId: string, files: File[]) {
  const parsed = parseSalesSpreadsheets(await Promise.all(files.map(async (file) => ({ name: file.name, data: await file.arrayBuffer() }))));
  const sections: Array<[string, Array<Record<string, unknown>>]> = [
    ["vendas_consolidado_resumo", [{ periodo_id: periodoId, ...parsed.resumo }]],
    ["vendas_consolidado_mensal", parsed.mensal.map((r) => ({ periodo_id: periodoId, ...r }))],
    ["vendas_consolidado_turno", parsed.turno.map((r) => ({ periodo_id: periodoId, ...r }))],
    ["vendas_consolidado_dia_semana", parsed.diaSemana.map((r) => ({ periodo_id: periodoId, ...r }))],
    ["vendas_consolidado_ambiente", parsed.ambiente.map((r) => ({ periodo_id: periodoId, ...r }))],
    ["vendas_consolidado_funcionarios", parsed.funcionarios.map((r) => ({ periodo_id: periodoId, ...r }))],
  ];
  await applyBatch(supabase, [
    ...sections.flatMap(([table, rows]) => replacement(table, { periodo_id: periodoId }, rows)),
    ...replacement("vendas_consolidado_produtos", { periodo_id: periodoId }, parsed.produtos.map(r => ({ periodo_id: periodoId, ...r }))),
  ]);
  return parsed;
}

export async function POST(request: Request) {
  console.log("[vendas-consolidado/import] POST called");
  console.log("[vendas-consolidado] ANTHROPIC_API_KEY:", !!process.env.ANTHROPIC_API_KEY);


  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return jsonError("Supabase (URL/ANON_KEY) não configurado no ambiente", 500);
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (e) {
      return jsonError(`formData: ${String(e)}`, 400);
    }

    const unitId     = formData.get("unit_id") as string | null;
    const dataInicio = formData.get("data_inicio") as string | null;
    const dataFim    = formData.get("data_fim") as string | null;
    const labelRaw   = formData.get("label") as string | null;
    const vendaFile     = formData.get("venda") as File | null;
    const movimentoFile = formData.get("movimento") as File | null;
    const caixaFile     = formData.get("caixa") as File | null;
    const spreadsheetFiles = formData.getAll("planilhas").filter((value): value is File => value instanceof File && value.size > 0);

    console.log("[vendas-consolidado/import] unit_id:", unitId, "inicio:", dataInicio, "fim:", dataFim,
      "venda:", vendaFile?.name, "movimento:", movimentoFile?.name, "caixa:", caixaFile?.name);

    if (!unitId || !dataInicio || !dataFim) {
      return jsonError("unit_id, data_inicio e data_fim são obrigatórios", 400);
    }
    // Todos os PDFs são opcionais — exige ao menos um.
    if (!vendaFile && !movimentoFile && !caixaFile && !spreadsheetFiles.length) {
      return jsonError("Selecione ao menos um PDF ou planilha Excel", 400);
    }
    if ((vendaFile || movimentoFile) && !process.env.ANTHROPIC_API_KEY) return jsonError("ANTHROPIC_API_KEY não configurada no ambiente", 500);

    let supabase: Supa;
    try {
      supabase = await getServiceClient();
    } catch (e) {
      return jsonError(`supabase: ${String(e)}`, 500);
    }

    // UPSERT do período — anexa aos dados já importados, sem duplicar.
    const label = labelRaw?.trim() || `${dataInicio} a ${dataFim}`;
    const periodoId = await upsertPeriodo(supabase, unitId, dataInicio, dataFim, label);

    const resultado: Record<string, unknown> = { periodo_id: periodoId };

    if (spreadsheetFiles.length) {
      const excel = await processSpreadsheets(supabase, periodoId, spreadsheetFiles);
      resultado.planilhas = excel.files;
      resultado.pedidos = excel.orders;
      resultado.produtos = excel.products;
      resultado.movimento = true;
    }

    if (vendaFile) {
      console.log("[vc] processando PDF de Venda");
      resultado.produtos = await processVenda(supabase, periodoId, vendaFile);
    }
    if (movimentoFile) {
      console.log("[vc-mov] processando PDF de Movimento");
      resultado.movimento = await processMovimento(supabase, periodoId, movimentoFile);
    }
    if (caixaFile) {
      // Sem destino definido para o Caixa no consolidado — aceito e ignorado.
      console.log("[vc] PDF de Caixa recebido — sem processamento definido, ignorado");
    }

    console.log("[vc] done —", resultado);
    return jsonOk(resultado);
  } catch (e) {
    console.error("[vendas-consolidado/import] unhandled error:", e);
    return jsonError(String(e), 500);
  }
}
