import { persistMovimento, turnoDoMovimento } from "@/lib/receita/persist";
import { applyBatch, replacement } from "@/lib/financeiro/db/atomic";
import { createFinanceiroClient } from "@/lib/financeiro/db/client";

import * as XLSX from "xlsx";

// ═══════════════════════════════════════════════════════════════════════════
// EQUIVALÊNCIA COM /api/receita/import (PDF) — leia antes de mexer em qualquer
// dos dois parsers.
//
// PDF e XLSX são o MESMO relatório do Lorean em formatos diferentes. Esta
// rota é o equivalente pra quem tem o Excel em mãos — sem chamar IA, por
// regex. Os dois devem gravar o MESMO
// resultado em receita_dias/receita_pagamentos/receita_ambientes/
// receita_turnos/receita_horarios/receita_grupos pro mesmo workday_id.
//
// Nenhum dos dois parsers tem lógica condicional por unidade (Meet/Restaurante exemplo/
// Match) — o relatório é idêntico pra qualquer uma; qualquer variação de
// layout encontrada num arquivo real deve virar lógica ÚNICA que lida com
// os dois casos (ver comentário de extractVendaGrupos abaixo pra um exemplo),
// nunca um `if (unidade === X)`.
//
// Campos já validados batendo entre os dois formatos (cross-check: soma dos
// grupos = resumo do Movimento, nos arquivos reais disponíveis em planilhas/):
// receita_bruta (PREVISTO), devedor, clientes, gorjeta, desconto, custo,
// lucro, cmv_pct, ticket_medio, ticket_real, permanencia_media, pagamentos
// (forma/fechado/recebido/diferença), ambientes, turnos, horários, grupos
// (bruto/desconto/gorjeta/consumo), descontos (agregado por motivo),
// descontos_detalhe, cancelamentos_detalhe, usuarios (vendas por operador).
//
// GAP CONHECIDO — únicos campos que o PDF extrai via WORKDAY_PROMPT e este
// parser XLSX genuinamente NÃO tem como ler (ficam null no banco quando
// importado por XLSX): abertura_at, fechamento_at. Confirmado por busca
// exaustiva (inclusive pelas palavras literais "abertura"/"fechamento"/
// "abriu"/"fechou") nos 2 arquivos reais disponíveis — esse timestamp não
// existe em lugar nenhum da exportação XLSX. NÃO fabricar/aproximar esse
// valor a partir de outros dados; a classificação de turno (almoco/jantar)
// usa os nomes da seção "Turno" do próprio arquivo, que já resolve isso sem
// precisar de abertura_at.
//
// A prova de equivalência DIRETA PDF-vs-XLSX (mesmo workday, campo a campo)
// ficou bloqueada por falta de crédito na conta Anthropic; retomar quando
// houver crédito, usando o par de arquivos reais do Match (workday 468) em
// planilhas/ como caso de teste. Os itens acima foram validados só entre
// arquivos XLSX reais (Restaurante exemplo/Match) e pela lógica de extração — não ainda
// contra a saída real do parser de PDF lado a lado.
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

// ── Helpers de texto/número ──────────────────────────────────────────────────

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Aceita "R$ 6.613,00" (BR: '.' milhar, ',' decimal) e números crus tipo "6613" ou
// "6613.5". Só trata '.' como milhar quando há vírgula decimal na string.
function parseNumBR(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/^R\$\s*/i, "").replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

// Mesma regex usada em /api/receita/import (extractDateFromFilename) — garante
// que a data extraída do nome bate com o que o import de PDF já grava.
function extractDateFromFilename(filename: string): string | null {
  const m = filename.match(/\[(\d{2})\.(\d{2})\.(\d{2})\]/);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  return `20${yy}-${mm}-${dd}`;
}

function isBlankRow(row: string[]): boolean {
  return row.every((c) => !c || !String(c).trim());
}

// Índice da 1ª linha cuja concatenação (maiúscula, sem acento) satisfaz `matches`.
function findHeaderRowIndex(rows: string[][], matches: (upperJoined: string) => boolean): number {
  for (let i = 0; i < rows.length; i++) {
    const joined = stripAccents(rows[i]!.join(" ")).toUpperCase();
    if (matches(joined)) return i;
  }
  return -1;
}

function extractLabelValue(text: string, label: string): number | null {
  const re = new RegExp(`${label}\\s*R?\\$?\\s*([\\d.,]+)`, "i");
  const m = text.match(re);
  return m ? parseNumBR(m[1]) : null;
}

// O relatório mistura 2 layouts pro MESMO tipo de dado: às vezes os valores estão
// em células separadas, às vezes crus numa única célula com múltiplos espaços
// como separador de coluna. Achatar a linha inteira (join " ") e cortar em blocos
// de 2+ espaços normaliza os dois casos pro mesmo formato de tokens.
function tokenizeRow(row: string[]): string[] {
  return row.join(" ").split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
}

// Bloco de indicadores do topo do dia: 2 linhas dentro da MESMA célula — uma
// linha de valores, uma linha de labels logo abaixo, pareadas por posição
// (ex: "012  00:56:58  00%  003  R$350,80  R$300,69\nACESSO PERMANÊNCIA CMV
// TICKET ZERO TICKET REAL TICKET MÉDIO"). Um único parse dá clientes,
// permanência, CMV%, ticket real e ticket médio — todos nessa mesma linha.
function extractResumoTopo(rows: string[][]): Record<string, string> {
  for (const row of rows) {
    const cellText = String(row.find((c) => c && c.trim()) ?? "");
    if (!cellText.includes("\n")) continue;
    const lines = cellText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const labels = lines[1]!.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
    if (!labels.some((l) => stripAccents(l).toUpperCase() === "ACESSO")) continue; // garante que é o bloco certo
    const values = lines[0]!.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
    const map: Record<string, string> = {};
    for (let i = 0; i < labels.length; i++) {
      const key = stripAccents(labels[i]!).toUpperCase();
      if (values[i] != null) map[key] = values[i]!;
    }
    return map;
  }
  return {};
}

// CMV/pct_bruto vêm como "00%"/"38%" — divide por 100 pro formato decimal que
// o schema usa (0.27 para 27%), igual o prompt do PDF já pede.
function parsePctBR(v: string | null | undefined): number | null {
  const n = parseNumBR(v);
  return n != null ? n / 100 : null;
}

// PREVISTO = receita do dia (o que foi vendido: convite + produto + gorjeta ±
// pendência antiga de dia anterior). É a linha "=  R$ X,XX" logo depois do bloco
// Convite/Produto/Gorjeta/Pendência/Diferença Real — não é o mesmo que FECHADO
// (o que foi de fato reconciliado no caixa) nem RECEBIDO (o que entrou via
// pagamento); os três só coincidem quando não há devedor nem pendência antiga.
function extractPrevisto(rows: string[][]): number | null {
  for (const row of rows) {
    const text = row.join(" ").trim();
    if (text.startsWith("=")) return parseNumBR(text);
  }
  return null;
}

// Pagamento / Ambiente / Turno / Horário: linhas de dado começam com um ordinal
// "0Nº" — às vezes fundido ao nome no mesmo token ("01º Dinheiro"), às vezes
// separado ("01º" + "Salao"). Para de ler no 1º token sem ordinal (nova seção,
// linha de totais, ou a linha "espelho" com só números que o relatório repete).
function extractOrdinalRows(rows: string[][], headerIdx: number, maxRows = 60): Array<{ nome: string; nums: number[] }> {
  if (headerIdx === -1) return [];
  const out: Array<{ nome: string; nums: number[] }> = [];
  for (let i = headerIdx + 1; i < rows.length && out.length < maxRows; i++) {
    const row = rows[i]!;
    if (isBlankRow(row)) break;
    let tokens = tokenizeRow(row);
    if (tokens.length === 0) break;
    const ordMatch = tokens[0]!.match(/^(\d{1,3})º\s*(.*)$/);
    if (!ordMatch) break;
    const rest = ordMatch[2]!.trim();
    tokens = rest ? [rest, ...tokens.slice(1)] : tokens.slice(1);
    const nome = tokens.find((t) => /[A-Za-zÀ-ÿ]/.test(t) && !/^R\$/i.test(t));
    if (!nome) continue;
    const nums = tokens.filter((t) => t !== nome).map(parseNumBR).filter((n): n is number => n != null);
    out.push({ nome, nums });
  }
  return out;
}

type MotivoRow = { motivo: string; qtd: number | null; consumo: number | null };

// Desconto/Cancelado AGREGADOS por motivo: sem ordinal "0Nº" — 1 linha por
// motivo (motivo, qtd, consumo), termina numa linha de totais cujo primeiro
// token é um número puro (ex: "Staff Sócio  009  R$803,00" ... "012  R$1.025,00").
function extractMotivoRows(rows: string[][], headerIdx: number): MotivoRow[] {
  if (headerIdx === -1) return [];
  const out: MotivoRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (isBlankRow(row)) break;
    const tokens = tokenizeRow(row);
    if (tokens.length === 0) break;
    if (/^\d+$/.test(tokens[0]!)) break; // linha de totais da seção
    if (tokens.length < 3) break;
    const qtd = parseInt(tokens[1]!, 10);
    out.push({ motivo: tokens[0]!, qtd: isNaN(qtd) ? null : qtd, consumo: parseNumBR(tokens[tokens.length - 1]!) });
  }
  return out;
}

type DetalheRow = { item: string; usuario: string; motivo: string; qtd: number | null; valor: number | null };

// Desconto/Cancelado DETALHADO por item: alterna linhas de "cabeçalho de
// comanda" (ex: "21 - LOREAN DESK ... R$803,00" — ignoradas, mesma regra do
// prompt do PDF: "ignorar linhas de cabeçalho de comanda") com linhas de item:
// item, usuário, motivo, qtd, valor. Usuário e motivo aparecem ora como 2
// tokens (nome/motivo em células adjacentes, separadas por células vazias:
// "Alex" + "Pereira"), ora como 1 token só (nome/motivo cru numa única célula:
// "Maicon Borges") — os DOIS formatos aparecem no MESMO arquivo real (Match/
// 468: desconto_detalhe vem partido, cancelado_detalhe vem cru), então uma
// contagem fixa de tokens erra um dos dois. Por isso o motivo é identificado
// por MATCH contra a lista de motivos já extraída da tabela agregada da mesma
// seção (sempre impressa antes da detalhada) — o que sobra antes dele é o
// usuário. Se a linha não tiver motivo algum batendo a lista conhecida, é
// DESCARTADA em vez de gravar errado. Blanks aparecem ENTRE blocos de comanda
// — não são fim de seção; só para na linha de totais (1 valor sozinho) ou fim
// da planilha.
function extractDetalheRows(rows: string[][], headerIdx: number, knownMotivos: string[]): DetalheRow[] {
  if (headerIdx === -1) return [];
  const motivoSet = new Set(knownMotivos.map((m) => m.toLowerCase()));
  const out: DetalheRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (isBlankRow(row)) continue;
    const tokens = tokenizeRow(row);
    if (tokens.length === 0) continue;
    if (tokens.length === 1 && parseNumBR(tokens[0]) != null) break; // linha de totais da seção
    if (/^\d+\s*-/.test(tokens[0]!)) continue; // cabeçalho de comanda — ignora
    if (tokens.length < 4) continue; // não bate o mínimo (item, motivo, qtd, valor) — descarta
    const valor = parseNumBR(tokens[tokens.length - 1]!);
    const qtdRaw = tokens[tokens.length - 2]!;
    const qtd = /^\d+$/.test(qtdRaw) ? parseInt(qtdRaw, 10) : null;
    if (qtd == null) continue; // formato inesperado — descarta
    const item = tokens[0]!;
    const middle = tokens.slice(1, tokens.length - 2);
    let motivo: string | null = null;
    let usuario: string | null = null;
    for (let len = Math.min(2, middle.length); len >= 1; len--) {
      const candidate = middle.slice(middle.length - len).join(" ");
      if (motivoSet.has(candidate.toLowerCase())) {
        motivo = candidate;
        usuario = middle.slice(0, middle.length - len).join(" ");
        break;
      }
    }
    if (motivo == null || !usuario) continue; // motivo não bate a lista conhecida — descarta em vez de gravar errado
    out.push({ item, usuario, motivo, qtd, valor });
  }
  return out;
}

// ── Row parsers específicos (nums já vêm de extractOrdinalRows) ────────────────

type PagamentoRow = { forma: string; valor_fechado: number | null; valor_recebido: number | null; diferenca: number | null };

function toPagamentoRow(r: { nome: string; nums: number[] }): PagamentoRow {
  return { forma: r.nome, valor_fechado: r.nums[0] ?? null, valor_recebido: r.nums[1] ?? null, diferenca: r.nums[2] ?? null };
}

type NomeQuadRow = { nome: string; clientes: number | null; gorjeta: number | null; produto: number | null; consumo: number | null };

// Colunas reais: Nome | Qtde | Gorjeta | Convite | Produto | Consumo — pula Convite
// (não faz parte do schema de destino, index 2 é descartado de propósito).
function toNomeQuadRow(r: { nome: string; nums: number[] }): NomeQuadRow {
  return { nome: r.nome, clientes: r.nums[0] ?? null, gorjeta: r.nums[1] ?? null, produto: r.nums[3] ?? null, consumo: r.nums[4] ?? null };
}

type HorarioRow = { hora: number; clientes: number | null; gorjeta: number | null; produto: number | null; consumo: number | null };

function toHorarioRow(r: { nome: string; nums: number[] }): HorarioRow | null {
  const hora = parseInt(r.nome, 10);
  if (isNaN(hora)) return null;
  return { hora, clientes: r.nums[0] ?? null, gorjeta: r.nums[1] ?? null, produto: r.nums[3] ?? null, consumo: r.nums[4] ?? null };
}

type UsuarioRow = { usuario: string; qtd: number | null; gorjeta: number | null; produto: number | null; consumo: number | null };

// Seção "Usuário" — mesmo formato de coluna (Qtde|Gorjeta|Convite|Produto|
// Consumo) e mesmo padrão ordinal de ambientes/turnos/horários.
function toUsuarioRow(r: { nome: string; nums: number[] }): UsuarioRow {
  return { usuario: r.nome, qtd: r.nums[0] ?? null, gorjeta: r.nums[1] ?? null, produto: r.nums[3] ?? null, consumo: r.nums[4] ?? null };
}

type GrupoRow = { grupo: string; qtde: number | null; bruto: number | null; desconto: number | null; gorjeta: number | null; consumo: number | null };

// Cada grupo (Venda) tem: linha de cabeçalho "<Nome>  Qtde  Garrafa  CMV  <Bruto
// ou Média>  Desconto  Gorjeta  Total", N linhas de produto, e uma linha de
// totais cujo primeiro token é um número puro (sem "º").
//
// IMPORTANTE — isto NÃO é lógica por unidade, é a MESMA função rodando pra
// qualquer arquivo. O relatório do Lorean, em exportações diferentes, pode
// imprimir essa coluna de preço unitário como "Bruto" (somável, aparece na linha
// de totais) ou como "Média" (preço médio — NÃO somável, a linha de totais
// simplesmente não soma essa coluna). Por isso a linha de totais tem 3 ou 4
// valores numéricos, mas os 3 ÚLTIMOS são sempre, nessa ordem, [desconto,
// gorjeta, consumo] — verificado em todos os arquivos reais disponíveis no
// momento desta escrita (2 exportações distintas, 4 vs 3 valores). bruto é
// DERIVADO (consumo + desconto - gorjeta, a mesma identidade contábil que o
// próprio relatório usa: total pago = bruto - desconto + gorjeta) em vez de
// lido direto — funciona nos dois casos sem precisar detectar qual coluna
// existe nem qual arquivo é. Qualquer novo caso real que quebre essa leitura
// deve ser corrigido AQUI, na mesma função — nunca com um `if` de unidade.
function extractVendaGrupos(rows: string[][]): GrupoRow[] {
  const grupos: GrupoRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rowText = rows[i]!.join(" ");
    const m = rowText.match(/^\s*(.+?)\s+Qtde\b/i);
    if (!m) continue;
    const grupo = m[1]!.trim();
    if (!grupo) continue;
    // Sem limite de distância — grupos grandes (20+ produtos) têm a linha de
    // totais muitas linhas depois do cabeçalho. Para no próximo cabeçalho "Qtde".
    for (let j = i + 1; j < rows.length; j++) {
      const tokens = tokenizeRow(rows[j]!);
      if (tokens.length === 0) continue;
      if (/^\d+$/.test(tokens[0]!)) {
        const nums = tokens.slice(1).map(parseNumBR).filter((n): n is number => n != null);
        const n = nums.length;
        const desconto = n >= 3 ? nums[n - 3]! : null;
        const gorjeta  = n >= 2 ? nums[n - 2]! : null;
        const consumo  = n >= 1 ? nums[n - 1]! : null;
        const bruto = consumo != null && desconto != null && gorjeta != null
          ? consumo + desconto - gorjeta : null;
        grupos.push({ grupo, qtde: parseInt(tokens[0]!, 10), bruto, desconto, gorjeta, consumo });
        break;
      }
      if (/Qtde\b/i.test(rows[j]!.join(" "))) break; // achou outro cabeçalho antes da linha de totais — desiste deste grupo
    }
  }
  return grupos;
}

type ProdutoRow = {
  grupo: string; produto: string; qtd: number | null; cmv_pct: number | null;
  bruto: number | null; desconto: number | null; gorjeta: number | null; total: number | null;
};

// Tokenizador dedicado pras linhas de PRODUTO individual dentro de um grupo de
// Venda (ex: "Lasagna La Donna  008  00%  R$1.192,00  R$0,00  R$154,96
// R$1.346,96"). Diferente de tokenizeRow (que junta a linha inteira com espaço
// único e só depois corta em 2+ espaços — o que gruda 2 valores quando eles
// caem em células ADJACENTES sem nenhuma célula vazia entre elas, ex:
// "R$ 0,00" + "R$ 0,00" em células vizinhas viram um token só "R$ 0,00 R$
// 0,00"), aqui cada célula não-vazia vira token(s) por si só — primeiro corta
// CADA célula individualmente (cobre o caso raro em que uma linha inteira vem
// crua numa célula única, com padding largo entre colunas), sem juntar
// células vizinhas antes. Resolve os dois formatos reais (valores em células
// separadas vs. linha inteira crua numa célula) sem string mágica por unidade.
function tokenizeProdutoRow(row: string[]): string[] {
  const out: string[] = [];
  for (const cell of row) {
    const s = String(cell ?? "").trim();
    if (!s) continue;
    for (const part of s.split(/\s{2,}/)) {
      const p = part.trim();
      if (p) out.push(p);
    }
  }
  return out;
}

// Uma linha de produto é: nome, qtde, [garrafa — só existe pra doses/bebidas
// dosadas, ignorado, sem coluna própria no schema], CMV%, Bruto/Média,
// Desconto, Gorjeta, Total. Localiza o token "NN%" (CMV) como âncora: tudo
// ANTES dele até o primeiro token numérico é o nome, esse primeiro numérico é
// a qtde (ignora um 2º numérico entre qtde e CMV — é a coluna Garrafa);
// os 4 valores em R$ logo DEPOIS do CMV são, nessa ordem, bruto, desconto,
// gorjeta, total. Item cancelado (linha vira "Cancelado" em vez de valor em
// TODAS as colunas de preço, sem CMV%) não tem "NN%" pra ancorar — cai no
// `cmvIdx === -1` e é descartado (consumo real da linha é zero mesmo).
function parseProdutoLine(tokens: string[]): Omit<ProdutoRow, "grupo"> | null {
  const cmvIdx = tokens.findIndex((t) => /^\d{1,3}%$/.test(t));
  if (cmvIdx < 1) return null;
  const valores = tokens.slice(cmvIdx + 1).filter((t) => /^R\$/i.test(t)).slice(0, 4).map(parseNumBR);
  if (valores.length < 4) return null;
  const [bruto, desconto, gorjeta, total] = valores as [number | null, number | null, number | null, number | null];
  const antes = tokens.slice(0, cmvIdx);
  const qtdIdx = antes.findIndex((t) => /^[\d.,]+$/.test(t));
  if (qtdIdx === -1) return null;
  const produto = antes.slice(0, qtdIdx).join(" ").trim();
  if (!produto) return null;
  return { produto, qtd: parseNumBR(antes[qtdIdx]!), cmv_pct: parsePctBR(tokens[cmvIdx]), bruto, desconto, gorjeta, total };
}

// Mesma varredura de cabeçalhos de grupo que extractVendaGrupos (linha
// "<Nome>  Qtde  ..."), mas coletando cada linha de PRODUTO individual entre o
// cabeçalho e a linha de totais, em vez de só o total do grupo. Fonte dos
// produtos individuais é o arquivo de VENDA — mesmo arquivo que já fornece os
// grupos, e mesma fonte que o parser de PDF usa (VENDA_PROMPT em
// vendaExtract.ts: "Extraia TODOS os produtos vendidos ... deste relatório
// Lorean de Venda"), não o Movimento.
// Item cancelado NÃO entra (sem CMV%/valores reais pra ancorar — ver
// parseProdutoLine). Validado nos 2 arquivos reais: a soma de `total` bate
// EXATO (diferença 0.00) com o consumo agregado de cada grupo em todos os
// grupos, mesmo quando a QTDE do grupo conta itens cancelados que o parser
// não lista individualmente (ex: Match/468 grupo "Pratos": qtde=10 no grupo,
// mas só 4 produtos aqui — os 6 que faltam são 2 itens cancelados de qtde 5+1
// cada, sem consumo real).
function extractVendaProdutos(rows: string[][]): ProdutoRow[] {
  const produtos: ProdutoRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rowText = rows[i]!.join(" ");
    const m = rowText.match(/^\s*(.+?)\s+Qtde\b/i);
    if (!m) continue;
    const grupo = m[1]!.trim();
    if (!grupo) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const tokens = tokenizeProdutoRow(rows[j]!);
      if (tokens.length === 0) continue;
      if (/^\d+$/.test(tokens[0]!)) break; // linha de totais do grupo
      if (/Qtde\b/i.test(rows[j]!.join(" "))) break; // achou outro cabeçalho antes da linha de totais — desiste
      const parsed = parseProdutoLine(tokens);
      if (parsed) produtos.push({ grupo, ...parsed });
    }
  }
  return produtos;
}

// ── Parsing dos arquivos ─────────────────────────────────────────────────────

type ParsedMovimento = {
  workday_id: number | null;
  data: string | null;
  clientes: number | null;
  receita_bruta: number | null; // PREVISTO — receita do dia (o que foi vendido)
  devedor: number | null;       // campo DEVEDOR do resumo
  bruto: number | null;         // campo BRUTO do resumo — informativo, sem coluna própria
  gorjeta: number | null;
  desconto: number | null;
  custo: number | null;
  lucro: number | null;
  cmv_pct: number | null;
  ticket_medio: number | null;
  ticket_real: number | null;
  permanencia_media: string | null;
  pagamentos: PagamentoRow[];
  ambientes: NomeQuadRow[];
  turnos: NomeQuadRow[];
  horarios: HorarioRow[];
  descontos: MotivoRow[];
  descontos_detalhe: DetalheRow[];
  cancelamentos_detalhe: DetalheRow[];
  usuarios: UsuarioRow[];
};

function sheetRows(buffer: Buffer): string[][] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  if (!sheet) throw new Error("planilha sem sheets");
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
}

function parseMovimento(buffer: Buffer, filename: string): ParsedMovimento {
  const rows = sheetRows(buffer);
  const flatText = rows.map((r) => (r ?? []).join(" ")).join("\n");

  const workdayIdMatch = flatText.match(/Workday:?\s*(\d+)/i);
  const workday_id = workdayIdMatch ? parseInt(workdayIdMatch[1]!, 10) : null;
  const data = extractDateFromFilename(filename);

  const resumoTopo = extractResumoTopo(rows);
  const clientes = resumoTopo["ACESSO"] != null ? parseInt(resumoTopo["ACESSO"]!, 10) : null;
  const permanencia_media = resumoTopo["PERMANENCIA"] ?? null; // já vem "HH:MM:SS"
  // cmv_pct: o rótulo CMV está sempre presente no bloco do topo — quando o
  // valor é "00%" (unidade sem custo cadastrado no Lorean) vira 0, nunca null,
  // porque o campo EXISTE, só o valor é zero.
  const cmv_pct     = resumoTopo["CMV"] != null ? (parsePctBR(resumoTopo["CMV"]) ?? 0) : null;
  const ticket_real  = resumoTopo["TICKET REAL"]  != null ? parseNumBR(resumoTopo["TICKET REAL"])  : null;
  const ticket_medio = resumoTopo["TICKET MEDIO"] != null ? parseNumBR(resumoTopo["TICKET MEDIO"]) : null;

  const bruto    = extractLabelValue(flatText, "BRUTO");
  const gorjeta  = extractLabelValue(flatText, "GORJETA");
  const desconto = extractLabelValue(flatText, "DESCONTO");
  const custo    = extractLabelValue(flatText, "CUSTO");
  const lucro    = extractLabelValue(flatText, "LUCRO");
  const devedor  = extractLabelValue(flatText, "DEVEDOR:?");

  // Receita bruta = PREVISTO, não a soma dos pagamentos — PREVISTO já contabiliza
  // pendência antiga (devedor de dia anterior que caiu nesse caixa), que uma soma
  // de pagamentos do dia nunca capturaria.
  const receita_bruta = extractPrevisto(rows);

  // "Pagamento" (não "Método", que é a versão agrupada) — exige os dois tokens
  // no cabeçalho pra não confundir com a outra tabela.
  const pagIdx = findHeaderRowIndex(rows, (t) => t.includes("PAGAMENTO") && t.includes("RECEBIDO"));
  const pagamentos = extractOrdinalRows(rows, pagIdx).map(toPagamentoRow);

  // "Ambiente" tem prioridade sobre "Módulo" — são seções distintas no relatório,
  // mas o schema de destino só tem uma; ambiente é a mais próxima semanticamente.
  let ambIdx = findHeaderRowIndex(rows, (t) => t.includes("AMBIENTE"));
  if (ambIdx === -1) ambIdx = findHeaderRowIndex(rows, (t) => t.includes("MODULO"));
  const ambientes = extractOrdinalRows(rows, ambIdx).map(toNomeQuadRow);

  const turIdx = findHeaderRowIndex(rows, (t) => t.includes("TURNO"));
  const turnos = extractOrdinalRows(rows, turIdx).map(toNomeQuadRow);

  const horIdx = findHeaderRowIndex(rows, (t) => t.includes("HORARIO"));
  const horarios = extractOrdinalRows(rows, horIdx).map(toHorarioRow).filter((h): h is HorarioRow => h != null);

  // Desconto agregado (por motivo) — exige "MOTIVO" mas exclui a versão
  // detalhada (que também tem "USUARIO" no cabeçalho).
  const descIdx = findHeaderRowIndex(rows, (t) => t.includes("DESCONTO") && t.includes("MOTIVO") && !t.includes("USUARIO"));
  const descontos = extractMotivoRows(rows, descIdx);

  const descDetIdx = findHeaderRowIndex(rows, (t) => t.includes("DESCONTO") && t.includes("USUARIO") && t.includes("MOTIVO"));
  const descontos_detalhe = extractDetalheRows(rows, descDetIdx, descontos.map((d) => d.motivo));

  // Cancelamento: só a versão detalhada é gravada (mesmo comportamento do PDF —
  // WORKDAY_PROMPT não tem campo "cancelamentos" agregado, só "cancelamentos_detalhe").
  // A agregada "Cancelado (Motivo)" existe no arquivo mas não é persistida — só
  // serve aqui pra fornecer a lista de motivos conhecidos que desambigua as
  // linhas detalhadas (ver comentário de extractDetalheRows).
  const cancelAggIdx = findHeaderRowIndex(rows, (t) => t.includes("CANCELADO") && t.includes("MOTIVO") && !t.includes("USUARIO"));
  const cancelamentosMotivos = extractMotivoRows(rows, cancelAggIdx).map((m) => m.motivo);

  const cancelDetIdx = findHeaderRowIndex(rows, (t) => t.includes("CANCELADO") && t.includes("USUARIO") && t.includes("MOTIVO"));
  const cancelamentos_detalhe = extractDetalheRows(rows, cancelDetIdx, cancelamentosMotivos);

  // "Usuário" tem cabeçalho igual ao de ambientes/turnos/horários (Qtde|Gorjeta|
  // Convite|Produto|Consumo) — exige QTDE+GORJETA+PRODUTO pra não confundir com
  // "Convite Edit"/"Gorjeta Edit"/"Consumo Move"/o desconto detalhado (que também
  // menciona "Usuário" mas começa com "Desconto").
  const usuIdx = findHeaderRowIndex(rows, (t) => t.startsWith("USUARIO") && t.includes("QTDE") && t.includes("GORJETA") && t.includes("PRODUTO"));
  const usuarios = extractOrdinalRows(rows, usuIdx).map(toUsuarioRow);

  return {
    workday_id, data, clientes, receita_bruta, devedor, bruto, gorjeta, desconto, custo, lucro,
    cmv_pct, ticket_medio, ticket_real, permanencia_media,
    pagamentos, ambientes, turnos, horarios, descontos, descontos_detalhe, cancelamentos_detalhe, usuarios,
  };
}

type ParsedVenda = {
  workday_id: number | null;
  data: string | null;
  grupos: GrupoRow[];
  produtos: ProdutoRow[];
};

function parseVenda(buffer: Buffer, filename: string): ParsedVenda {
  const rows = sheetRows(buffer);
  const flatText = rows.map((r) => (r ?? []).join(" ")).join("\n");
  const workdayIdMatch = flatText.match(/Workday:?\s*(\d+)/i);
  const workday_id = workdayIdMatch ? parseInt(workdayIdMatch[1]!, 10) : null;
  const data = extractDateFromFilename(filename);
  const grupos = extractVendaGrupos(rows);
  const produtos = extractVendaProdutos(rows);
  return { workday_id, data, grupos, produtos };
}

// ── DB ────────────────────────────────────────────────────────────────────────

const getServiceClient = createFinanceiroClient;

async function insertMovimento(
  supabase: Awaited<ReturnType<typeof getServiceClient>>, parsed: ParsedMovimento, unitId: string,
): Promise<string> {
  if (parsed.workday_id == null) throw new Error("workday_id não encontrado no arquivo (esperado 'Workday: <n>')");
  if (!parsed.data) throw new Error("data não encontrada no nome do arquivo (esperado [DD.MM.YY])");

  const receitaLiquida =
    parsed.receita_bruta != null && parsed.desconto != null ? parsed.receita_bruta - parsed.desconto : null;

  return persistMovimento(supabase, {
        unit_id: unitId,
        data: parsed.data,
        workday_id: parsed.workday_id,
        turno: turnoDoMovimento(parsed.turnos.map(t => t.nome)), // placeholder — reclassificado abaixo
        receita_bruta: parsed.receita_bruta,
        desconto: parsed.desconto,
        gorjeta: parsed.gorjeta,
        receita_liquida: receitaLiquida,
        custo: parsed.custo,
        lucro: parsed.lucro,
        cmv_pct: parsed.cmv_pct,
        ticket_medio: parsed.ticket_medio,
        ticket_real: parsed.ticket_real,
        permanencia_media: parsed.permanencia_media,
        previsto: parsed.receita_bruta, // mesmo valor — receita_bruta É o previsto
        devedor: parsed.devedor,
        clientes: parsed.clientes,
        // abertura_at/fechamento_at não existem no XLSX (só no PDF) — null
        // explícito pra não deixar um valor de um import anterior por PDF
        // parecer que veio deste import.
        abertura_at: null,
        fechamento_at: null,
      }, {
    receita_pagamentos: parsed.pagamentos.map(p => ({ ...p })),
    receita_ambientes: parsed.ambientes.map(a => ({ ambiente: a.nome, clientes: a.clientes, gorjeta: a.gorjeta, produto: a.produto, consumo: a.consumo })),
    receita_turnos: parsed.turnos.map(t => ({ turno: t.nome, clientes: t.clientes, gorjeta: t.gorjeta, produto: t.produto, consumo: t.consumo })),
    receita_horarios: parsed.horarios.map(h => ({ ...h })), receita_descontos: parsed.descontos.map(d => ({ ...d })),
    receita_descontos_detalhe: parsed.descontos_detalhe.map(d => ({ ...d })), receita_cancelamentos: [],
    receita_cancelamentos_detalhe: parsed.cancelamentos_detalhe.map(c => ({ ...c })), receita_usuarios: parsed.usuarios.map(u => ({ ...u }))
  });
}

async function insertVenda(
  supabase: Awaited<ReturnType<typeof getServiceClient>>, parsed: ParsedVenda, unitId: string,
): Promise<void> {
  if (parsed.workday_id == null) throw new Error("workday_id não encontrado no arquivo (esperado 'Workday: <n>')");

  const { data: wd } = await supabase
    .from("receita_dias")
    .select("id")
    .eq("unit_id", unitId)
    .eq("workday_id", parsed.workday_id)
    .maybeSingle();
  if (!wd) throw new Error(`Workday não encontrado para workday_id=${parsed.workday_id} — importe o Movimento primeiro`);

  await applyBatch(supabase, [
    ...replacement("receita_grupos", { workday_id_fk: wd.id }, parsed.grupos.map(g => ({ grupo: g.grupo, bruto: g.bruto, desconto: g.desconto, gorjeta: g.gorjeta, consumo: g.consumo, workday_id_fk: wd.id }))),
    ...replacement("receita_produtos_dia", { workday_id_fk: wd.id }, parsed.produtos.map(p => ({ grupo: p.grupo, produto: p.produto, qtd: p.qtd, cmv_pct: p.cmv_pct, bruto: p.bruto, desconto: p.desconto, gorjeta: p.gorjeta, total: p.total, workday_id_fk: wd.id }))),
  ]);
}

// ── Route handler — aceita Movimento e Venda misturados num único upload ───────
// Tipo detectado pelo nome do arquivo; Movimento processa antes de Venda (Venda
// depende do workday já existir) independente da ordem em que vieram no FormData.

type Detalhe = {
  arquivo: string;
  tipo: "movimento" | "venda" | null;
  workday_id: number | null;
  data: string | null;
  sucesso: boolean;
  erro?: string;
  resumo?: Record<string, unknown>;
};

function detectTipo(filename: string): "movimento" | "venda" | null {
  const lower = filename.toLowerCase();
  if (lower.includes("movimento")) return "movimento";
  if (lower.includes("venda")) return "venda";
  return null;
}

export async function POST(request: Request) {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (e) {
      return Response.json({ processados: 0, erros: [`formData: ${String(e)}`], detalhes: [] }, { status: 400, headers: CORS });
    }

    const unitId = formData.get("unit_id") as string | null;
    const arquivos = [...formData.getAll("arquivos"), ...formData.getAll("arquivos[]")]
      .filter((f): f is File => f instanceof File);

    if (!unitId) {
      return Response.json({ processados: 0, erros: ["unit_id é obrigatório"], detalhes: [] }, { status: 400, headers: CORS });
    }
    if (arquivos.length === 0) {
      return Response.json({ processados: 0, erros: ["nenhum arquivo em 'arquivos'"], detalhes: [] }, { status: 400, headers: CORS });
    }

    let supabase: Awaited<ReturnType<typeof getServiceClient>>;
    try {
      supabase = await getServiceClient();
    } catch (e) {
      return Response.json({ processados: 0, erros: [`supabase: ${String(e)}`], detalhes: [] }, { status: 500, headers: CORS });
    }

    // Movimento primeiro (Venda precisa do workday já existir).
    const ordenados = [...arquivos].sort((a, b) => {
      const ta = detectTipo(a.name), tb = detectTipo(b.name);
      if (ta === tb) return 0;
      return ta === "movimento" ? -1 : tb === "movimento" ? 1 : 0;
    });

    const detalhes: Detalhe[] = [];
    const erros: string[] = [];

    for (const arquivo of ordenados) {
      const tipo = detectTipo(arquivo.name);
      if (!tipo) {
        detalhes.push({ arquivo: arquivo.name, tipo: null, workday_id: null, data: null, sucesso: false, erro: "tipo não reconhecido no nome do arquivo (esperado 'Movimento' ou 'Venda')" });
        erros.push(`${arquivo.name}: tipo não reconhecido`);
        continue;
      }
      try {
        const buffer = Buffer.from(await arquivo.arrayBuffer());
        if (tipo === "movimento") {
          const parsed = parseMovimento(buffer, arquivo.name);
          await insertMovimento(supabase, parsed, unitId);
          detalhes.push({
            arquivo: arquivo.name, tipo, workday_id: parsed.workday_id, data: parsed.data, sucesso: true,
            resumo: {
              clientes: parsed.clientes, receita_bruta: parsed.receita_bruta, devedor: parsed.devedor, bruto: parsed.bruto,
              gorjeta: parsed.gorjeta, desconto: parsed.desconto, custo: parsed.custo, lucro: parsed.lucro,
              cmv_pct: parsed.cmv_pct, ticket_medio: parsed.ticket_medio, ticket_real: parsed.ticket_real,
              permanencia_media: parsed.permanencia_media,
              pagamentos: parsed.pagamentos.length, ambientes: parsed.ambientes.length,
              turnos: parsed.turnos.length, horarios: parsed.horarios.length,
              descontos: parsed.descontos.length, descontos_detalhe: parsed.descontos_detalhe.length,
              cancelamentos_detalhe: parsed.cancelamentos_detalhe.length, usuarios: parsed.usuarios.length,
            },
          });
        } else {
          const parsed = parseVenda(buffer, arquivo.name);
          await insertVenda(supabase, parsed, unitId);
          detalhes.push({
            arquivo: arquivo.name, tipo, workday_id: parsed.workday_id, data: parsed.data, sucesso: true,
            resumo: {
              grupos: parsed.grupos.length,
              bruto_total: parsed.grupos.reduce((s, g) => s + (g.bruto ?? 0), 0),
              desconto_total: parsed.grupos.reduce((s, g) => s + (g.desconto ?? 0), 0),
              gorjeta_total: parsed.grupos.reduce((s, g) => s + (g.gorjeta ?? 0), 0),
              consumo_total: parsed.grupos.reduce((s, g) => s + (g.consumo ?? 0), 0),
              produtos: parsed.produtos.length,
              produtos_total: parsed.produtos.reduce((s, p) => s + (p.total ?? 0), 0),
            },
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        detalhes.push({ arquivo: arquivo.name, tipo, workday_id: null, data: null, sucesso: false, erro: msg });
        erros.push(`${arquivo.name}: ${msg}`);
        // não interrompe o lote — segue pro próximo arquivo
      }
    }

    const processados = detalhes.filter((d) => d.sucesso).length;
    return Response.json({ processados, erros, detalhes }, { headers: CORS });
  } catch (e) {
    console.error("[lorean/import-xlsx] unhandled error:", e);
    return Response.json({ processados: 0, erros: [String(e)], detalhes: [] }, { status: 500, headers: CORS });
  }
}
