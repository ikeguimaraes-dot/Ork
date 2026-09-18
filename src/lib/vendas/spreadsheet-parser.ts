import * as XLSX from "xlsx";

type Row = Record<string, unknown>;
type Sale = {
  key: string; date: string; hour: number; source: string; store: string;
  operator: string; channel: string; gross: number; net: number; discount: number;
  tip: number; payment: string; paymentValue: number; items?: string;
  clients?: number;
};

export type SpreadsheetSales = {
  files: number; rows: number; orders: number; products: number;
  dateStart: string; dateEnd: string;
  resumo: Record<string, number | null>;
  mensal: Array<Record<string, unknown>>;
  turno: Array<Record<string, unknown>>;
  diaSemana: Array<Record<string, unknown>>;
  ambiente: Array<Record<string, unknown>>;
  funcionarios: Array<Record<string, unknown>>;
  produtos: Array<Record<string, unknown>>;
};

const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const s = (v: unknown) => String(v ?? "").trim();

function isoDate(value: unknown): string {
  const x = s(value);
  const br = x.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const compact = x.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return "";
}

function rowsFromSheet(ws: XLSX.WorkSheet): Row[] {
  // Alguns exports da Keeta declaram !ref=A1:A..., apesar de possuírem 20 colunas.
  const cells = Object.keys(ws).filter((key) => /^[A-Z]+\d+$/.test(key));
  let maxColumn = 0;
  let maxRow = 0;
  for (const cell of cells) {
    const decoded = XLSX.utils.decode_cell(cell);
    maxColumn = Math.max(maxColumn, decoded.c);
    maxRow = Math.max(maxRow, decoded.r);
  }
  const copy = { ...ws, "!ref": XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: maxColumn, r: maxRow } }) };
  return XLSX.utils.sheet_to_json<Row>(copy, { defval: null, raw: true });
}

function parseItems(detail: string): Array<{ name: string; qty: number }> {
  return detail.split(",").map((part) => {
    const match = part.trim().match(/^(.*?)\*(\d+(?:[.,]\d+)?)$/);
    return match ? { name: match[1]!.trim(), qty: n(match[2]!.replace(",", ".")) } : { name: part.trim(), qty: 1 };
  }).filter((item) => item.name && item.qty > 0);
}

type Aggregate = { bruto: number; liquido: number; clientes: number; ordem: number; [key: string]: string | number };
type Product = { grupo: string; produto: string; quantidade: number; valor_bruto: number; valor_desconto: number; valor_liquido: number; participacao_pct?: number };

function add(map: Map<string, Aggregate>, key: string, seed: Record<string, string | number>, sale: Sale) {
  const row = map.get(key) ?? { ordem: 0, ...seed, bruto: 0, liquido: 0, clientes: 0 };
  row.bruto += sale.gross; row.liquido += sale.net; row.clientes += sale.clients ?? 1;
  map.set(key, row);
}

export function parseSalesSpreadsheets(buffers: Array<{ name: string; data: ArrayBuffer }>): SpreadsheetSales {
  const sales = new Map<string, Sale>();
  const restaurantDaily = new Map<string, Sale>();
  let sourceRows = 0;

  for (const file of buffers) {
    const wb = XLSX.read(file.data, { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames.includes("Relatório") ? "Relatório" : wb.SheetNames[0]!];
    if (!ws) throw new Error(`${file.name}: nenhuma aba encontrada`);
    const rows = rowsFromSheet(ws); sourceRows += rows.length;
    if (!rows.length) continue;
    const headers = new Set(Object.keys(rows[0]!));

    if (headers.has("Pedido") && headers.has("Venda Bruta")) {
      for (const r of rows) {
        if (s(r["Status da Venda"]).toLowerCase() !== "pago" || s(r["NFe/CFe Cancelado?"]).toLowerCase() === "sim") continue;
        const key = `general:${s(r.Pedido) || s(r["Cupom Fiscal"])}`;
        const existing = sales.get(key);
        const date = isoDate(r["Data de Negócio"] || r["Data Fiscal"]);
        const hour = n(s(r["Horário (Criação)"]).split(":")[0]);
        if (existing) {
          const form = s(r["Forma de pagamento"]);
          existing.payment += form ? `, ${form}` : "";
          existing.paymentValue += n(r["Valor Pagamento"]);
          continue;
        }
        sales.set(key, { key, date, hour, source: "Geral", store: s(r.Marca) || s(r.Loja), operator: s(r.Operador),
          channel: s(r.Plataforma) || s(r.Tipo) || "Loja", gross: n(r["Venda Bruta"]), net: n(r["Venda Líquida"]),
          discount: n(r.Desconto), tip: n(r.Gorjeta), payment: s(r["Forma de pagamento"]), paymentValue: n(r["Valor Pagamento"]) });
      }
    } else if (headers.has("ID do pedido") && headers.has("Detalhe do item")) {
      for (const r of rows) {
        const status = s(r["Status do pedido"]).toLowerCase();
        if (!status.startsWith("concluído") && status !== "reembolso parcial") continue;
        const key = `keeta:${s(r["ID do pedido"])}`;
        if (sales.has(key)) continue; // arquivos repetidos são idempotentes
        const date = isoDate(r.Data);
        const hour = n(s(r["Horário do pedido"]).slice(9, 11));
        sales.set(key, { key, date, hour, source: "Keeta", store: s(r["Nome da loja"]), operator: "Keeta",
          channel: s(r["Tipo de pedido"]) || "Keeta", gross: n(r["Vendas de itens"]), net: n(r["Ganhos líquidos"]),
          discount: Math.max(0, n(r["Vendas de itens"]) - n(r["Ganhos líquidos"])), tip: 0,
          payment: "Keeta", paymentValue: n(r["Ganhos líquidos"]), items: s(r["Detalhe do item"]) });
      }
    } else if (headers.has("Pedidos válidos") && headers.has("Valor médio do pedido")) {
      for (const r of rows) {
        const date = isoDate(r.Data), store = s(r["Nome da loja"]), count = Math.max(0, Math.round(n(r["Pedidos válidos"])));
        if (!date || !count) continue;
        restaurantDaily.set(`keeta-summary:${store}:${date}`, { key: `summary:${store}:${date}`, date, hour: 12,
          source: "Keeta", store, operator: "Keeta", channel: "Keeta", gross: n(r["Vendas de itens"]),
          net: n(r["Ganhos líquidos"]), discount: Math.max(0, n(r["Vendas de itens"]) - n(r["Ganhos líquidos"])),
          tip: 0, payment: "Keeta", paymentValue: n(r["Ganhos líquidos"]), clients: count });
      }
    } else throw new Error(`${file.name}: formato de planilha não reconhecido`);
  }

  // Resumos diários entram apenas quando não existe o relatório detalhado da mesma loja/data.
  const detailedDays = new Set([...sales.values()].filter((x) => x.source === "Keeta").map((x) => `${x.store}:${x.date}`));
  for (const row of restaurantDaily.values()) if (!detailedDays.has(`${row.store}:${row.date}`)) sales.set(row.key, row);
  const list = [...sales.values()].filter((x) => x.date).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) throw new Error("Nenhuma venda válida encontrada nas planilhas");

  const mensal = new Map<string, Aggregate>(), turno = new Map<string, Aggregate>(), dia = new Map<string, Aggregate>(), ambiente = new Map<string, Aggregate>(), funcs = new Map<string, Aggregate>();
  const productMap = new Map<string, Product>();
  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  for (const sale of list) {
    const month = sale.date.slice(0, 7), [year, mon] = month.split("-").map(Number);
    add(mensal, month, { mes: new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year!, mon! - 1, 1))).replace(" de ", "/"), ordem: year! * 12 + mon! }, sale);
    const shift = sale.hour < 16 ? "Almoço" : "Jantar"; add(turno, shift, { turno: shift }, sale);
    const dow = new Date(`${sale.date}T12:00:00Z`).getUTCDay(); add(dia, String(dow), { dia_semana: weekdays[dow]!, ordem: dow + 1 }, sale);
    add(ambiente, sale.channel, { ambiente: sale.channel }, sale); add(funcs, sale.operator || sale.store, { funcionario: sale.operator || sale.store }, sale);
    if (sale.items) {
      const items = parseItems(sale.items), totalQty = items.reduce((sum, item) => sum + item.qty, 0) || 1;
      for (const item of items) {
        const key = `${sale.store}::${item.name}`, row = productMap.get(key) ?? { grupo: sale.store, produto: item.name, quantidade: 0, valor_bruto: 0, valor_desconto: 0, valor_liquido: 0 };
        const share = item.qty / totalQty; row.quantidade += item.qty; row.valor_bruto += sale.gross * share; row.valor_desconto += sale.discount * share; row.valor_liquido += sale.net * share; productMap.set(key, row);
      }
    }
  }
  const gross = list.reduce((x, r) => x + r.gross, 0), net = list.reduce((x, r) => x + r.net, 0), tips = list.reduce((x, r) => x + r.tip, 0);
  const clients = list.reduce((x, r) => x + (r.clients ?? 1), 0);
  const finish = (map: Map<string, Aggregate>, pct = false): Array<Aggregate & { ticket_medio: number; participacao_pct?: number }> => { const total = [...map.values()].reduce((x, r) => x + r.bruto, 0); return [...map.values()].map((r) => ({ ...r, ticket_medio: r.clientes ? r.bruto / r.clientes : 0, ...(pct ? { participacao_pct: total ? r.bruto / total * 100 : 0 } : {}) })); };
  const produtos = [...productMap.values()]; const productTotal = produtos.reduce((x, r) => x + r.valor_liquido, 0);
  for (const p of produtos) p.participacao_pct = productTotal ? p.valor_liquido / productTotal * 100 : 0;
  return { files: buffers.length, rows: sourceRows, orders: clients, products: produtos.length, dateStart: list[0]!.date, dateEnd: list.at(-1)!.date,
    resumo: { acessos: clients, ticket_medio: gross / clients, ticket_real: net / clients, bruto: gross, produto: gross, custo: null,
      desconto: gross - net, gorjeta: tips, convite: 0, lucro: net, entrada: 0, consumo: 0, devedor: 0, pgto_fechado: gross, pgto_recebido: net,
      pgto_diferenca: gross - net, cash: list.filter((r) => /dinheiro/i.test(r.payment)).reduce((x, r) => x + r.paymentValue, 0),
      card: list.filter((r) => /cart|crédito|débito/i.test(r.payment)).reduce((x, r) => x + r.paymentValue, 0),
      pix: list.filter((r) => /pix/i.test(r.payment)).reduce((x, r) => x + r.paymentValue, 0) },
    mensal: finish(mensal).sort((a, b) => a.ordem - b.ordem), turno: finish(turno, true),
    diaSemana: finish(dia).sort((a, b) => a.ordem - b.ordem), ambiente: finish(ambiente, true),
    funcionarios: finish(funcs).map((r) => ({ funcionario: r.funcionario, bruto: r.bruto, qtd_vendas: r.clientes })).sort((a, b) => b.bruto - a.bruto).slice(0, 40), produtos };
}
