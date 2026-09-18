import * as XLSX from "xlsx";
import { createFinanceiroClient } from "@/lib/financeiro/db/client";
import { applyBatch, replacement, type Mutation } from "@/lib/financeiro/db/atomic";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Sale = { date: string; gross: number; discount: number; billed: number };

function parseFile(buffer: Buffer): Map<string, Sale> {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) throw new Error("planilha sem abas");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  const header = (rows[0] ?? []).map((value) => String(value ?? "").trim());
  const col = (name: string) => header.indexOf(name);
  const indexes = {
    date: col("Data de Negócio"), status: col("Status da Venda"), cancelled: col("NFe/CFe Cancelado?"),
    order: col("Pedido"), receipt: col("Cupom Fiscal"), gross: col("Venda Bruta"),
    discount: col("Desconto"), billed: col("Total faturado"),
  };
  if (Object.values(indexes).some((index) => index < 0)) {
    throw new Error("formato não reconhecido: selecione o Relatório Geral de Vendas");
  }
  const sales = new Map<string, Sale>();
  for (const row of rows.slice(1)) {
    if (String(row[indexes.status] ?? "").trim().toLowerCase() !== "pago") continue;
    if (String(row[indexes.cancelled] ?? "").trim().toLowerCase() === "sim") continue;
    const key = String(row[indexes.order] ?? row[indexes.receipt] ?? "").trim();
    if (!key || sales.has(key)) continue;
    const rawDate = row[indexes.date];
    let date = "";
    if (rawDate instanceof Date) date = rawDate.toISOString().slice(0, 10);
    else {
      const match = String(rawDate ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (match) date = `${match[3]}-${match[2]}-${match[1]}`;
    }
    if (!date) continue;
    sales.set(key, {
      date, gross: Number(row[indexes.gross] ?? 0), discount: Number(row[indexes.discount] ?? 0),
      billed: Number(row[indexes.billed] ?? 0),
    });
  }
  return sales;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const unitId = String(formData.get("unit_id") ?? "");
    const files = formData.getAll("arquivos").filter((value): value is File => value instanceof File && value.size > 0);
    if (!unitId || !files.length) return Response.json({ error: "unidade e arquivos são obrigatórios" }, { status: 400 });

    const sales = new Map<string, Sale>();
    for (const file of files) {
      const parsed = parseFile(Buffer.from(await file.arrayBuffer()));
      for (const [key, sale] of parsed) if (!sales.has(key)) sales.set(key, sale);
    }
    if (!sales.size) throw new Error("nenhuma venda paga encontrada");

    const days = new Map<string, { orders: number; gross: number; discount: number; billed: number }>();
    for (const sale of sales.values()) {
      const day = days.get(sale.date) ?? { orders: 0, gross: 0, discount: 0, billed: 0 };
      day.orders++; day.gross += sale.gross; day.discount += sale.discount; day.billed += sale.billed;
      days.set(sale.date, day);
    }
    const rows = [...days].map(([data, day]) => ({
      unit_id: unitId, data, workday_id: 90_000_000 + Number(data.replaceAll("-", "")), turno: "dia_inteiro",
      receita_bruta: Number(day.gross.toFixed(2)), desconto: Number(day.discount.toFixed(2)), gorjeta: 0,
      receita_liquida: Number(day.billed.toFixed(2)), custo: null, lucro: Number(day.billed.toFixed(2)), cmv_pct: null,
      ticket_medio: Number((day.gross / day.orders).toFixed(2)), ticket_real: Number((day.billed / day.orders).toFixed(2)),
      previsto: Number(day.gross.toFixed(2)), devedor: 0, clientes: day.orders,
    }));

    const db = await createFinanceiroClient();
    const operations: Mutation[] = [];
    for (const row of rows) {
      const id = crypto.randomUUID();
      operations.push(...replacement("receita_dias", { unit_id: unitId, data: row.data }, [{ ...row, id }]));
      operations.push({ table: "receita_pagamentos", operation: "insert", rows: [{ workday_id_fk: id, forma: "Relatório Geral de Vendas", valor_fechado: row.receita_liquida, valor_recebido: row.receita_liquida }] });
    }
    await applyBatch(db, operations);
    const dates = [...days.keys()].sort();
    return Response.json({
      success: true,
      arquivos: files.length,
      pedidos: sales.size,
      dias: days.size,
      data_inicio: dates[0],
      data_fim: dates.at(-1),
      total_bruto: rows.reduce((sum, row) => sum + row.receita_bruta, 0),
      total_faturado: rows.reduce((sum, row) => sum + row.receita_liquida, 0),
      dados: rows.map((row) => ({
        data: row.data,
        receita_bruta: row.receita_bruta,
        receita_liquida: row.receita_liquida,
        desconto: row.desconto,
        clientes: row.clientes,
        ticket_medio: row.ticket_medio,
      })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
