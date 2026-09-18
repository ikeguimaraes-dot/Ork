import { extractedRows, type PdfRecord } from "@/lib/receita/extraction";
import { persistMovimento, turnoDoMovimento } from "@/lib/receita/persist";
import { applyBatch, replacement } from "@/lib/financeiro/db/atomic";
import { createFinanceiroClient } from "@/lib/financeiro/db/client";
// NextResponse not needed — using native Response.json() throughout

// Extração do PDF de Venda compartilhada com /api/vendas-consolidado/import
import { VENDA_PROMPT, fileToBase64, parsePdf } from "@/lib/receita/vendaExtract";

// ═══════════════════════════════════════════════════════════════════════════
// EQUIVALÊNCIA COM /api/receita/import-xlsx — leia antes de mexer em qualquer
// dos dois parsers.
//
// Esta rota (PDF, via Claude) está validada em produção pra todas as
// unidades (Meet/Restaurante exemplo/Match), com o MESMO prompt pra qualquer uma (zero
// lógica condicional por unidade). import-xlsx/route.ts é o equivalente sem
// IA pra quem tem o Excel — os dois devem gravar o MESMO
// resultado em receita_dias/receita_pagamentos/receita_ambientes/
// receita_turnos/receita_horarios/receita_grupos pro mesmo workday_id. Mudou um
// campo aqui? Confere se o parser XLSX extrai a mesma coisa.
//
// import-xlsx/route.ts já extrai TODOS os campos que este parser grava, exceto
// abertura_at/fechamento_at — confirmado ausente na exportação XLSX (não dá
// pra fabricar; ver comentário equivalente lá pro porquê).
//
// GAP CONHECIDO: a prova de equivalência direta (mesmo workday, campo a
// campo, saída deste parser vs. saída do XLSX) está bloqueada por falta de
// crédito na conta Anthropic — o que existe até agora é validação dos campos
// novos só contra os arquivos XLSX reais (Restaurante exemplo/Match), não lado a lado com
// este parser. Retomar usando o par PDF+XLSX do Match (workday 468) em
// planilhas/ assim que houver crédito.
// ═══════════════════════════════════════════════════════════════════════════

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

// ── Prompts ───────────────────────────────────────────────────────────────────

const WORKDAY_PROMPT = `Extraia os dados deste relatório Lorean Workday e retorne APENAS JSON válido, sem texto adicional, sem markdown.

Formato esperado:
{
  "workday_id": number,
  "data": "YYYY-MM-DD",
  "abertura_at": "YYYY-MM-DD HH:MM:SS",
  "fechamento_at": "YYYY-MM-DD HH:MM:SS",
  "receita_bruta": number,
  "desconto": number,
  "gorjeta": number,
  "receita_liquida": number,
  "custo": number,
  "cmv_pct": number,
  "lucro": number,
  "clientes": number,
  "ticket_medio": number,
  "ticket_real": number,
  "permanencia_media": "HH:MM:SS",
  "previsto": number,
  "devedor": number,
  "pagamentos": [
    { "forma": string, "valor_fechado": number, "valor_recebido": number, "diferenca": number }
  ],
  "ambientes": [
    { "ambiente": string, "clientes": number, "gorjeta": number, "produto": number, "consumo": number }
  ],
  "turnos": [
    { "turno": string, "clientes": number, "gorjeta": number, "produto": number, "consumo": number }
  ],
  "grupos": [
    { "grupo": string, "pct_bruto": number, "bruto": number, "desconto": number, "gorjeta": number, "consumo": number }
  ],
  "descontos": [
    { "motivo": string, "qtd": number, "consumo": number }
  ],
  "descontos_detalhe": [
    { "item": string, "usuario": string, "motivo": string, "qtd": number, "valor": number }
  ],
  "cancelamentos_detalhe": [
    { "item": string, "usuario": string, "motivo": string, "qtd": number, "valor": number }
  ],
  "horarios": [
    { "hora": number, "clientes": number, "gorjeta": number, "produto": number, "consumo": number }
  ],
  "usuarios": [
    { "usuario": string, "qtd": number, "gorjeta": number, "produto": number, "consumo": number }
  ]
}

Regras:
- IMPORTANTE: As datas estão no formato DD.MM.YY (dia.mês.ano brasileiro). Ex: 02.06.26 = 2 de junho de 2026 = 2026-06-02. Converter para ISO 8601: YYYY-MM-DD.
- IMPORTANTE: O horário de abertura e fechamento aparecem no formato "DIA, DD MES AAAA HH:MM" (ex: "SÁB, 09 MAI 2026 18:15"). Converta para ISO 8601: "YYYY-MM-DD HH:MM:00". Ex: "SÁB, 09 MAI 2026 18:15" → "2026-05-09 18:15:00". Meses em português: JAN=01, FEV=02, MAR=03, ABR=04, MAI=05, JUN=06, JUL=07, AGO=08, SET=09, OUT=10, NOV=11, DEZ=12.
- cmv_pct: valor decimal (ex: 0.27 para 27%)
- pct_bruto: valor decimal (ex: 0.17 para 17%)
- permanencia_media: formato "HH:MM:SS"
- Campos não encontrados no PDF: usar null
- Arrays vazios se a seção não existir: []
- descontos_detalhe: extrair da seção detalhada de Desconto que lista cada produto descontado com Usuário, Motivo, Qtde e Consumo (ignorar as linhas de cabeçalho de comanda como '115 - LOREAN DESK'). valor = coluna Consumo.
- cancelamentos_detalhe: extrair da seção detalhada de Cancelado que lista cada produto cancelado com Usuário, Motivo, Qtde e Consumo (ignorar linhas de cabeçalho de comanda como '103 - LOREAN DESK'). valor = coluna Consumo.
- horarios: da seção 'Horário' (hora como inteiro: '20h' → 20). Arrays vazios se a seção não existir: []
- usuarios: da seção 'Usuário'. Arrays vazios se a seção não existir: []
- previsto = receita_bruta: os dois campos têm SEMPRE o mesmo valor — a linha que começa com "=" (ex: "= R$ 60.483,37") logo depois do bloco Convite/Produto/Gorjeta/Pendência Antiga/Diferença Real, no resumo do topo do relatório. NÃO é o FECHADO, nem o RECEBIDO, nem a soma dos pagamentos — representa o total vendido no dia (produto + gorjeta + convite ± pendência antiga).`;

const CAIXA_PROMPT = `Extraia os dados deste relatório de fechamento de caixa Lorean e retorne APENAS JSON válido, sem texto adicional, sem markdown.

Formato esperado:
{
  "caixa_id": number,
  "operador": string,
  "data": "YYYY-MM-DD",
  "abertura_at": "YYYY-MM-DD HH:MM:SS",
  "fechamento_at": "YYYY-MM-DD HH:MM:SS",
  "total_fechado": number,
  "total_recebido": number,
  "diferenca": number,
  "pagamentos": [
    { "forma": string, "valor_fechado": number, "valor_recebido": number, "diferenca": number }
  ]
}

Regras:
- IMPORTANTE: As datas estão no formato DD.MM.YY (dia.mês.ano brasileiro). Ex: 02.06.26 = 2 de junho de 2026 = 2026-06-02. Converter para ISO 8601: YYYY-MM-DD.
- Campos não encontrados: usar null
- pagamentos: array vazio [] se não houver`;

// ── Helpers ───────────────────────────────────────────────────────────────────
// VENDA_PROMPT, fileToBase64 e parsePdf agora vêm de @/lib/receita/vendaExtract
// (compartilhados com a rota consolidada). WORKDAY_PROMPT/CAIXA_PROMPT seguem
// locais por serem exclusivos do import diário.

const getServiceClient = createFinanceiroClient;

function extractDateFromFilename(filename: string): string | null {
  const m = filename.match(/\[(\d{2})\.(\d{2})\.(\d{2})\]/);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  return `20${yy}-${mm}-${dd}`;
}



const MONTHS_PT: Record<string, string> = {
  JAN: "01", FEV: "02", MAR: "03", ABR: "04", MAI: "05", JUN: "06",
  JUL: "07", AGO: "08", SET: "09", OUT: "10", NOV: "11", DEZ: "12",
};

function extractTimestamps(pdfText: string): { abertura_at: string | null; fechamento_at: string | null } {
  const re = /[A-ZÁÉÍÓÚÃÕÊ]{3},\s+(\d{2})\s+([A-Z]{3})\s+(\d{4})\s+(\d{2}:\d{2})/g;
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(pdfText)) !== null && matches.length < 2) {
    const mm = MONTHS_PT[m[2]!];
    if (mm) matches.push(`${m[3]}-${mm}-${m[1]} ${m[4]}:00`);
  }
  return { abertura_at: matches[0] ?? null, fechamento_at: matches[1] ?? null };
}

// ── DB inserts ────────────────────────────────────────────────────────────────

async function insertWorkday(
  supabase: Awaited<ReturnType<typeof getServiceClient>>,
  parsed: PdfRecord,
  unitId: string,
): Promise<string> {
  return persistMovimento(supabase, {
        unit_id: unitId,
        data: parsed.data,
        workday_id: parsed.workday_id,
        turno: turnoDoMovimento(extractedRows(parsed.turnos).map(t => String(t.turno ?? ""))),  // placeholder — reclassificado abaixo
        abertura_at: parsed.abertura_at,
        fechamento_at: parsed.fechamento_at,
        receita_bruta: parsed.receita_bruta,
        desconto: parsed.desconto,
        gorjeta: parsed.gorjeta,
        receita_liquida: parsed.receita_liquida,
        custo: parsed.custo,
        cmv_pct: parsed.cmv_pct,
        lucro: parsed.lucro,
        clientes: parsed.clientes,
        ticket_medio: parsed.ticket_medio,
        ticket_real: parsed.ticket_real,
        permanencia_media: parsed.permanencia_media,
        previsto: parsed.previsto,
        devedor: parsed.devedor,
      }, {
    receita_pagamentos: extractedRows(parsed.pagamentos), receita_ambientes: extractedRows(parsed.ambientes),
    receita_turnos: extractedRows(parsed.turnos), receita_grupos: extractedRows(parsed.grupos), receita_descontos: extractedRows(parsed.descontos),
    receita_descontos_detalhe: extractedRows(parsed.descontos_detalhe), receita_cancelamentos: extractedRows(parsed.cancelamentos),
    receita_cancelamentos_detalhe: extractedRows(parsed.cancelamentos_detalhe), receita_horarios: extractedRows(parsed.horarios), receita_usuarios: extractedRows(parsed.usuarios)
  });
}

async function insertVenda(
  supabase: Awaited<ReturnType<typeof getServiceClient>>,
  parsed: PdfRecord,
  unitId: string,
  workdayUuid: string | null,
  filename: string,
): Promise<void> {
  let wdId = workdayUuid;

  if (!wdId) {
    const wdMatch = filename.match(/\((\d+)/);
    const loreanWorkdayId = wdMatch ? parseInt(wdMatch[1]!, 10) : null;
    if (!loreanWorkdayId) throw new Error(`Cannot extract workday_id from filename: "${filename}"`);
    const { data: wd } = await supabase
      .from("receita_dias")
      .select("id")
      .eq("unit_id", unitId)
      .eq("workday_id", loreanWorkdayId)
      .maybeSingle();
    if (!wd) throw new Error(`Workday não encontrado para workday_id=${loreanWorkdayId} — importe Movimento primeiro`);
    wdId = wd.id;
  }

  if (!wdId) throw new Error("Movimento não encontrado");
  await applyBatch(supabase, replacement("receita_produtos_dia", { workday_id_fk: wdId },
    extractedRows(parsed.produtos).map((r: Record<string, unknown>) => ({ ...r, workday_id_fk: wdId }))));
}

async function insertCaixa(
  supabase: Awaited<ReturnType<typeof getServiceClient>>,
  parsed: PdfRecord,
  unitId: string,
  workdayUuid: string | null,
): Promise<void> {
  const wdId = workdayUuid ?? (await supabase
    .from("receita_dias")
    .select("id")
    .eq("unit_id", unitId)
    .eq("data", parsed.data)
    .maybeSingle()
    .then(({ data }) => data?.id ?? null));

  if (!wdId || parsed.caixa_id == null) throw new Error("Movimento e caixa são obrigatórios");
  await applyBatch(supabase, replacement("receita_caixas", { workday_id_fk: wdId, caixa_id: parsed.caixa_id }, [{
    workday_id_fk: wdId,
    caixa_id: parsed.caixa_id,
    operador: parsed.operador,
    abertura_at: parsed.abertura_at,
    fechamento_at: parsed.fechamento_at,
    total_fechado: parsed.total_fechado,
    total_recebido: parsed.total_recebido,
    diferenca: parsed.diferenca,
  }]));
}

// ── Route handler — processes ONE PDF per call ────────────────────────────────

export async function POST(request: Request) {
  console.log("[lorean/import] POST called");

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (e) {
      return Response.json({ success: false, errors: [`formData: ${String(e)}`] }, { status: 400, headers: CORS });
    }

    const tipo = formData.get("tipo") as string | null;          // "movimento" | "venda" | "venda_produtos" | "caixa"
    const arquivo = formData.get("arquivo") as File | null;
    const unitId = formData.get("unit_id") as string | null;
    const workdayUuid = formData.get("workday_id") as string | null; // Supabase UUID from Movimento step

    console.log("[lorean/import] tipo:", tipo, "unit_id:", unitId, "workday_id:", workdayUuid, "file:", arquivo?.name, arquivo?.size);

    if (!tipo || !arquivo || !unitId) {
      return Response.json({ success: false, errors: ["tipo, arquivo e unit_id são obrigatórios"] }, { status: 400, headers: CORS });
    }
    if (!["movimento", "venda", "venda_produtos", "caixa"].includes(tipo)) {
      return Response.json({ success: false, errors: [`tipo inválido: ${tipo}`] }, { status: 400, headers: CORS });
    }

    let supabase: Awaited<ReturnType<typeof getServiceClient>>;
    try {
      supabase = await getServiceClient();
    } catch (e) {
      return Response.json({ success: false, errors: [`supabase: ${String(e)}`] }, { status: 500, headers: CORS });
    }

    const b64 = await fileToBase64(arquivo);
    console.log("[lorean/import] b64 length:", b64.length);

    let workday_id: string | null = workdayUuid;

    if (tipo === "movimento") {
      const parsed = await parsePdf(b64, WORKDAY_PROMPT, "movimento", 64000);
      const dateOverride = extractDateFromFilename(arquivo.name);
      if (dateOverride) parsed.data = dateOverride;
      // Extract abertura_at / fechamento_at via regex — more reliable than Claude for this field
      const pdfText = Buffer.from(b64, "base64").toString("latin1");
      const { abertura_at, fechamento_at } = extractTimestamps(pdfText);
      if (abertura_at !== null) parsed.abertura_at = abertura_at;
      if (fechamento_at !== null) parsed.fechamento_at = fechamento_at;
      console.log("[lorean/import] timestamps from regex:", abertura_at, fechamento_at);
      console.log("[lorean/import] Movimento parsed —", {
        pagamentos: extractedRows(parsed.pagamentos).length,
        ambientes: extractedRows(parsed.ambientes).length,
        turnos: extractedRows(parsed.turnos).length,
        grupos: extractedRows(parsed.grupos).length,
        descontos: extractedRows(parsed.descontos).length,
        descontos_detalhe: extractedRows(parsed.descontos_detalhe).length,
        cancelamentos_detalhe: extractedRows(parsed.cancelamentos_detalhe).length,
        horarios: extractedRows(parsed.horarios).length,
        usuarios: extractedRows(parsed.usuarios).length,
      });
      workday_id = await insertWorkday(supabase, parsed, unitId);
      console.log("[lorean/import] Movimento done, workday_id:", workday_id);
    }

    else if (tipo === "venda" || tipo === "venda_produtos") {
      const parsed = await parsePdf(b64, VENDA_PROMPT, "venda", 32768);
      await insertVenda(supabase, parsed, unitId, workdayUuid, arquivo.name);
      console.log(`[lorean/import] Venda produtos done: ${extractedRows(parsed.produtos).length} produtos`);
    }

    else if (tipo === "caixa") {
      const parsed = await parsePdf(b64, CAIXA_PROMPT, "caixa");
      const dateOverride = extractDateFromFilename(arquivo.name);
      if (dateOverride) parsed.data = dateOverride;
      await insertCaixa(supabase, parsed, unitId, workdayUuid);
      console.log("[lorean/import] Caixa done");
    }

    return Response.json({ success: true, workday_id, errors: [] }, { headers: CORS });
  } catch (e) {
    console.error("[lorean/import] unhandled error:", e);
    return Response.json({ success: false, workday_id: null, errors: [String(e)] }, { status: 500, headers: CORS });
  }
}
