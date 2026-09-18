"use server"

import { fetchAllPaginado } from "@/lib/financeiro/razao/gerar"

import { applyBatch, replacement, type Mutation } from "@/lib/financeiro/db/atomic";
import { createFinanceiroClient } from "@/lib/financeiro/db/client";

import { createSupabaseServerClient } from "@ork/db/supabase/server"
import { getCurrentUnit } from "@ork/auth/unit"
import { requireUser } from "@ork/auth/server"

import { normalizeDescricao } from "@/lib/financeiro/normalizeDescricao"
import { extrairCalibre } from "@/lib/financeiro/produtos/extrairCalibre"

// Categorias de desc_gerencial que são despesa administrativa/financeira/folha,
// não produto comprado. Usada só para linhas SEM NCM (planilha) na geração
// automática do catálogo — linhas COM NCM já são filtradas pela faixa de
// capítulo 02-23 (alimentos/bebidas/preparações), sem precisar de lista manual.
const CATEGORIAS_NAO_PRODUTO = new Set([
  "IMPOSTOS", "IMPOSTO", "IMPOSTOS FGTS DIGITAL **UNIDADE**", "IMPOSTO DCTF WEB **UNIDADE**",
  "MOTOBOY",
  "CONSUMO DE ENERGIA", "CONSUMO ÁGUA", "CONSUMO GÁS",
  "RESCISÃO", "FERIAS",
  "LAVANDERIA",
  "PGTO 1ª QUINZENA", "PGTO 2ª QUINZENA",
  "CONTABILIDADE",
  "INTERNET", "SISTEMA", "TI",
  "ACORDO", "ACORDO AÇÃO TRABALHISTA",
  "EXAMES", "EXAMES ADMISSIONAIS",
  "ALARME",
  "MANUTENÇÃO",
  "RENOVAÇÃO SEGURO",
  "GALPÃO GUARULHOS",
  "LOCAÇÃO PRESHH",
  "AROMATIZAÇÃO DE AMBIENTES",
  "AMOSTRAS LABORATORIAIS",
])

export type ProdutoInsert = {
  unit_id: string
  fornecedor_nome: string | null
  nr_danfe: string | null
  v_total_danfe: number | null
  dt_emissao: string | null
  item_codigo: string | null
  item_descricao: string | null
  cfop?: string | null
  unidade_medida: string | null
  tipo_item: string | null
  q_embalagem: number | null
  q_estoque: number | null
  v_embalagem: number | null
  v_total_embalagem: number | null
  v_custo_medio: number | null
  v_custo_compra: number | null
  v_custo_total: number | null
  perc_variacao: number | null
  calcula_cmv: boolean | null
  fornecedor_codigo: string | null
  codigo_gerencial: string | null
  desc_gerencial: string | null
  mes_lancamento: number
  ano_lancamento: number
}

export type ProdutoImportUnit = { id: string; name: string }

export async function getProdutoImportUnits(): Promise<ProdutoImportUnit[]> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) throw new Error("Conexao administrativa com o banco nao configurada")
  const { data, error } = await db.from("units").select("id,name").order("name")
  if (error) throw new Error(error.message)
  return data ?? []
}

export type NfeImportPayload = {
  arquivo: string
  direcao: "entrada" | "saida"
  notas: Array<{
    chave: string; numero: string | null; serie: string | null; emissao: string
    emitenteCnpj: string | null; emitenteNome: string | null
    destinatarioCnpj: string | null; destinatarioNome: string | null
    valorTotal: number; statusSefaz: string | null; cancelada: boolean
    itens: Array<{
      codigo: string | null; descricao: string | null; ncm: string | null
      cfop: string | null; unidade: string | null; quantidade: number | null
      valorUnitario: number | null; valorTotal: number | null
    }>
  }>
  rejeitadas: number
}

export type NfeCnpjDesconhecido = {
  cnpj: string
  nome: string | null
  notas: number
  valor: number
}

export type NfeImportResult = {
  ok: boolean
  importadas: number
  duplicadas: number
  canceladas: number
  itens: number
  naoImportadas: number
  cnpjsDesconhecidos: NfeCnpjDesconhecido[]
  produtosCriados: number
  vinculosCriados: number
  error?: string
}

type NfeImportNota = NfeImportPayload["notas"][number]

export async function importNfe(payload: NfeImportPayload): Promise<NfeImportResult> {
  const empty = { ok: false, importadas: 0, duplicadas: 0, canceladas: 0, itens: 0, naoImportadas: 0, cnpjsDesconhecidos: [], produtosCriados: 0, vinculosCriados: 0 }
  try {
    await requireUser()
    const unit = await getCurrentUnit()
    if (!unit) return { ...empty, error: "Unidade não identificada." }
    if (!payload.notas.length) return { ...empty, error: "O ZIP não contém NF-e válida." }

    const db = await createFinanceiroClient()
    if (!db) return { ...empty, error: "Conexão administrativa com o banco não configurada." }
    // Tabelas novas ainda não constam nos tipos gerados.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = db as any

    // A unidade é resolvida POR NOTA pelo CNPJ próprio (emitente nas saídas,
    // destinatário nas entradas) — nunca pela unidade selecionada no menu, e
    // nunca por um CNPJ "dominante" do pacote. Nota cujo CNPJ não bate com
    // nenhuma unit cadastrada não é importada.
    const ownCnpjOf = (note: NfeImportNota) =>
      payload.direcao === "saida" ? note.emitenteCnpj : note.destinatarioCnpj
    const ownNomeOf = (note: NfeImportNota) =>
      payload.direcao === "saida" ? note.emitenteNome : note.destinatarioNome

    // units.cnpj é legado (um CNPJ por unidade) — a fonte de verdade pra
    // resolução fiscal é unit_cnpjs (N CNPJs por unidade, por papel), desde
    // a FASE 6: a mesma empresa pode pagar folha e comprar com CNPJs
    // diferentes, ou ter mais de um CNPJ de compras. Aceita QUALQUER papel
    // aqui — uma nota de entrada não sabe (nem precisa saber) se o CNPJ
    // destinatário está cadastrado como folha, compras ou faturamento.
    const distinctCnpjs = [...new Set(
      payload.notas.map(ownCnpjOf).filter((cnpj): cnpj is string => Boolean(cnpj))
    )]
    const { data: unitCnpjsData, error: unitCnpjsError } = distinctCnpjs.length
      ? await raw.from("unit_cnpjs").select("unit_id,cnpj").eq("ativo", true).in("cnpj", distinctCnpjs)
      : { data: [], error: null }
    if (unitCnpjsError) return { ...empty, error: unitCnpjsError.message }
    const unitIdByCnpj = new Map<string, string>(
      (unitCnpjsData ?? []).map((u: { unit_id: string; cnpj: string }) => [u.cnpj, u.unit_id])
    )

    const resolvidas: Array<NfeImportNota & { unitId: string }> = []
    const cnpjAgg = new Map<string, { nome: string | null; notas: number; valor: number }>()
    for (const note of payload.notas) {
      const cnpj = ownCnpjOf(note)
      const unitId = cnpj ? unitIdByCnpj.get(cnpj) : undefined
      if (unitId) {
        resolvidas.push({ ...note, unitId })
        continue
      }
      const key = cnpj ?? "—"
      const acc = cnpjAgg.get(key) ?? { nome: ownNomeOf(note), notas: 0, valor: 0 }
      acc.notas += 1
      acc.valor += note.valorTotal
      if (!acc.nome) acc.nome = ownNomeOf(note)
      cnpjAgg.set(key, acc)
    }
    const cnpjsDesconhecidos: NfeCnpjDesconhecido[] =
      [...cnpjAgg.entries()].map(([cnpj, v]) => ({ cnpj, ...v }))
    const naoImportadas = payload.notas.length - resolvidas.length

    if (!resolvidas.length) {
      return { ok: true, importadas: 0, duplicadas: 0, canceladas: 0, itens: 0, naoImportadas, cnpjsDesconhecidos, produtosCriados: 0, vinculosCriados: 0 }
    }

    const keys = resolvidas.map(note => note.chave)
    const targetUnitIds = [...new Set(resolvidas.map(note => note.unitId))]
    const { data: existing, error: existingError } = await raw
      .from("nfe_documentos").select("unit_id,chave").in("unit_id", targetUnitIds).in("chave", keys)
    if (existingError) return { ...empty, error: `Migração 025 pendente: ${existingError.message}`, naoImportadas, cnpjsDesconhecidos }
    const existingKeys = new Set(
      (existing ?? []).map((row: { unit_id: string; chave: string }) => `${row.unit_id} ${row.chave}`)
    )
    const canceladas = resolvidas.filter(note => note.cancelada).length
    const validas = resolvidas.filter(note => !note.cancelada)
    const operations: Mutation[] = []
    const importacaoIdPorUnidade = new Map<string, string>()
    for (const uid of targetUnitIds) {
      const id = crypto.randomUUID()
      importacaoIdPorUnidade.set(uid, id)
      const notas = resolvidas.filter(n => n.unitId === uid)
      operations.push({ table: "nfe_importacoes", operation: "insert", rows: [{
        id, unit_id: uid, arquivo: payload.arquivo, direcao: payload.direcao,
        total_xml: notas.length, importadas: notas.filter(n => !n.cancelada).length,
        duplicadas: notas.filter(n => existingKeys.has(`${uid} ${n.chave}`)).length,
        canceladas: notas.filter(n => n.cancelada).length, rejeitadas: uid === targetUnitIds[0] ? payload.rejeitadas : 0,
        valor_total: notas.filter(n => !n.cancelada).reduce((sum, n) => sum + n.valorTotal, 0),
      }] })
    }
    let itemCount = 0
    // A correction replaces the whole note, including removed items and cancellation.
    for (const note of resolvidas) {
      if (!/^\d{44}$/.test(note.chave) || !Number.isFinite(note.valorTotal) || !Number.isFinite(Date.parse(note.emissao))) throw new Error("NF-e com chave, data ou valor inválido.")
      operations.push({ table: "nfe_documentos", operation: "upsert", conflict: "unit_id,chave", rows: [{
        unit_id: note.unitId, importacao_id: importacaoIdPorUnidade.get(note.unitId), chave: note.chave, direcao: payload.direcao,
        numero: note.numero, serie: note.serie, emissao: note.emissao,
        emitente_cnpj: note.emitenteCnpj, emitente_nome: note.emitenteNome,
        destinatario_cnpj: note.destinatarioCnpj, destinatario_nome: note.destinatarioNome,
        valor_total: note.valorTotal, status_sefaz: note.statusSefaz, cancelada: note.cancelada,
      }] })
      const rows = note.cancelada ? [] : note.itens.map((item, index) => ({
        unit_id: note.unitId, chave_nfe: note.chave, fornecedor_nome: note.emitenteNome, nr_danfe: note.numero,
        v_total_danfe: note.valorTotal, dt_emissao: note.emissao,
        item_nfe: index + 1, item_codigo: item.codigo ?? String(index + 1), item_descricao: item.descricao,
        unidade_medida: item.unidade, tipo_item: item.ncm, q_embalagem: item.quantidade, q_estoque: item.quantidade,
        v_embalagem: item.valorUnitario, v_total_embalagem: item.valorTotal,
        v_custo_medio: item.valorUnitario, v_custo_compra: item.valorUnitario, v_custo_total: item.valorTotal,
        perc_variacao: null, calcula_cmv: payload.direcao === "entrada", fornecedor_codigo: note.emitenteCnpj,
        cfop: item.cfop, codigo_gerencial: item.cfop, desc_gerencial: payload.direcao === "entrada" ? "NF-e sem classificação" : "NF-e saída",
        direcao_nfe: payload.direcao, mes_lancamento: Number(note.emissao.slice(5, 7)), ano_lancamento: Number(note.emissao.slice(0, 4)),
      }))
      operations.push(...replacement("produtos_relatorio", { unit_id: note.unitId, chave_nfe: note.chave }, rows))
      itemCount += rows.length
    }
    await applyBatch(db, operations)
    const notasParaProdutos = validas

    // Catálogo automático: escopado às chaves deste lote (não reprocessa o
    // histórico inteiro a cada importação). Falha aqui não derruba a
    // importação — os itens já foram gravados; o botão "Reprocessar
    // catálogo completo" na aba Catálogo cobre qualquer lacuna.
    const chavesDoLote = [...new Set(notasParaProdutos.map(note => note.chave))]
    const catalogo = chavesDoLote.length ? await gerarCatalogoAutomatico(chavesDoLote) : null

    return {
      ok: true, importadas: validas.length, duplicadas: existingKeys.size, canceladas, itens: itemCount,
      naoImportadas, cnpjsDesconhecidos,
      produtosCriados: catalogo?.produtosCriados ?? 0,
      vinculosCriados: catalogo?.vinculosCriados ?? 0,
    }
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function substituirProdutosPlanilha(rows: ProdutoInsert[]): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    if (!rows.length) throw new Error("Planilha sem produtos válidos.")
    const db = await createFinanceiroClient()
    const scopes = new Map<string, { unit_id: string; mes_lancamento: number; ano_lancamento: number; chave_nfe: null }>()
    for (const r of rows) {
      if (!r.unit_id || !Number.isInteger(r.mes_lancamento) || r.mes_lancamento < 1 || r.mes_lancamento > 12 || !Number.isInteger(r.ano_lancamento)) throw new Error("Unidade ou período inválido.")
      scopes.set(`${r.unit_id}|${r.ano_lancamento}|${r.mes_lancamento}`, { unit_id: r.unit_id, mes_lancamento: r.mes_lancamento, ano_lancamento: r.ano_lancamento, chave_nfe: null })
    }
    await applyBatch(db, [...scopes.values()].flatMap(scope => replacement("produtos_relatorio", scope, rows.filter(r => r.unit_id === scope.unit_id && r.mes_lancamento === scope.mes_lancamento && r.ano_lancamento === scope.ano_lancamento))))
    return { ok: true, count: rows.length }
  } catch (error) { return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) } }
}

export async function insertProdutos(
  rows: ProdutoInsert[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    await requireUser()
    const supabase = await createFinanceiroClient()
    if (!supabase) return { ok: false, count: 0, error: "Sem conexão com banco" }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const deduplicated = new Map<string, ProdutoInsert>()
    for (const row of rows) {
      const key = `${row.unit_id}\u0000${row.nr_danfe ?? ""}\u0000${row.item_codigo ?? ""}\u0000${row.fornecedor_codigo ?? ""}`
      deduplicated.set(key, row)
    }
    const records = [...deduplicated.values()]
    const { error, count } = await db
      .from("produtos_relatorio")
      .upsert(records, { onConflict: "unit_id,nr_danfe,item_codigo,fornecedor_codigo,chave_nfe,item_nfe" })
      .select("id", { count: "exact", head: true })

    if (error) return { ok: false, count: 0, error: error.message }
    return { ok: true, count: count ?? records.length }
  } catch (e) {
    return { ok: false, count: 0, error: String(e) }
  }
}

export async function getProdutosMeses(
  unitId: string
): Promise<{ mes: number; ano: number; total: number }[]> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data } = await db
      .from("produtos_relatorio")
      .select("mes_lancamento, ano_lancamento")
      .eq("unit_id", unitId)
      .not("chave_nfe", "is", null)
      .limit(10000)
    if (!data) return []
    const map = new Map<string, number>()
    for (const r of data) {
      const k = `${r.ano_lancamento}-${r.mes_lancamento}`
      map.set(k, (map.get(k) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([k, total]) => {
        const [ano, mes] = k.split("-").map(Number)
        return { mes: mes!, ano: ano!, total }
      })
      .sort((a, b) => a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes)
  } catch {
    return []
  }
}

export type RankingItem = {
  item_descricao: string | null
  item_codigo: string | null
  fornecedor_nome: string | null
  desc_gerencial: string | null
  unidade_medida: string | null
  custo_total: number
  quantidade_total: number
  custo_medio: number
  variacao_media: number | null
}

export type RankingResult = {
  porValor: RankingItem[]
  porQuantidade: RankingItem[]
  porVariacao: RankingItem[]
  totalCmv: number
}

export async function getRankingProdutos(
  unitId: string | null,
  mes: number,
  ano: number
): Promise<RankingResult> {
  const empty: RankingResult = { porValor: [], porQuantidade: [], porVariacao: [], totalCmv: 0 }
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return empty
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    let q = db
      .from("produtos_relatorio")
      .select("item_descricao,item_codigo,fornecedor_nome,desc_gerencial,unidade_medida,v_total_embalagem,v_custo_total,q_estoque,v_custo_medio,perc_variacao")
      .eq("mes_lancamento", mes)
      .eq("ano_lancamento", ano)
      .eq("calcula_cmv", true)
      .not("chave_nfe", "is", null)
      .limit(10000)
    if (unitId) q = q.eq("unit_id", unitId)
    const { data } = await q
    if (!data || data.length === 0) return empty

    type Acc = {
      item_descricao: string | null
      item_codigo: string | null
      fornecedor_nome: string | null
      desc_gerencial: string | null
      unidade_medida: string | null
      custo_total: number
      quantidade_total: number
      custo_medio_sum: number
      custo_medio_n: number
      variacao_sum: number
      variacao_n: number
    }

    const map = new Map<string, Acc>()
    for (const r of data) {
      const key = `${r.item_descricao}||${r.fornecedor_nome}||${r.desc_gerencial}||${r.unidade_medida}`
      const a: Acc = map.get(key) ?? {
        item_descricao: r.item_descricao,
        item_codigo: r.item_codigo ?? null,
        fornecedor_nome: r.fornecedor_nome,
        desc_gerencial: r.desc_gerencial,
        unidade_medida: r.unidade_medida,
        custo_total: 0, quantidade_total: 0,
        custo_medio_sum: 0, custo_medio_n: 0,
        variacao_sum: 0, variacao_n: 0,
      }
      const ct = r.v_total_embalagem != null ? Number(r.v_total_embalagem) : 0
      const qt = r.q_estoque         != null ? Number(r.q_estoque)         : 0
      a.custo_total      += isFinite(ct) ? Math.abs(ct) : 0
      a.quantidade_total += isFinite(qt) ? qt           : 0
      if (r.v_custo_medio != null) {
        const n = Number(r.v_custo_medio)
        if (isFinite(n)) { a.custo_medio_sum += n; a.custo_medio_n++ }
      }
      if (r.perc_variacao != null) {
        const n = Number(r.perc_variacao)
        if (isFinite(n)) { a.variacao_sum += n; a.variacao_n++ }
      }
      if (!a.item_codigo && r.item_codigo) a.item_codigo = r.item_codigo
      map.set(key, a)
    }

    const items: RankingItem[] = [...map.values()].map(a => ({
      item_descricao:  a.item_descricao,
      item_codigo:     a.item_codigo,
      fornecedor_nome: a.fornecedor_nome,
      desc_gerencial:  a.desc_gerencial,
      unidade_medida:  a.unidade_medida,
      custo_total:     a.custo_total,
      quantidade_total: a.quantidade_total,
      custo_medio:     a.custo_medio_n > 0 ? a.custo_medio_sum / a.custo_medio_n : 0,
      variacao_media:  a.variacao_n > 0 ? a.variacao_sum / a.variacao_n : null,
    }))

    const totalCmv     = items.reduce((s, i) => s + i.custo_total, 0)
    const porValor     = [...items].sort((a, b) => b.custo_total - a.custo_total).slice(0, 20)
    const porQuantidade = [...items].sort((a, b) => b.quantidade_total - a.quantidade_total).slice(0, 20)
    const porVariacao  = items
      .filter(i => i.variacao_media != null && i.variacao_media > 0)
      .sort((a, b) => (b.variacao_media ?? 0) - (a.variacao_media ?? 0))
      .slice(0, 20)

    return { porValor, porQuantidade, porVariacao, totalCmv }
  } catch {
    return empty
  }
}

export type HistoricoRow = {
  mes_lancamento: number
  ano_lancamento: number
  dt_emissao: string | null
  nr_danfe: string | null
  chave_nfe: string | null
  fornecedor_nome: string | null
  q_estoque: number | null
  v_custo_medio: number | null
  v_custo_total: number | null
  perc_variacao: number | null
  desc_gerencial: string | null
  item_descricao: string | null
}

type HistoricoRowBruto = HistoricoRow & { fornecedor_codigo: string | null; item_codigo: string | null }

const HISTORICO_SELECT = "mes_lancamento,ano_lancamento,dt_emissao,nr_danfe,chave_nfe,fornecedor_nome,fornecedor_codigo,item_codigo,q_estoque,v_custo_medio,v_custo_total,perc_variacao,desc_gerencial,item_descricao"

function paraHistoricoRow(r: HistoricoRowBruto): HistoricoRow {
  return {
    mes_lancamento: r.mes_lancamento, ano_lancamento: r.ano_lancamento,
    dt_emissao: r.dt_emissao, nr_danfe: r.nr_danfe, chave_nfe: r.chave_nfe,
    fornecedor_nome: r.fornecedor_nome, q_estoque: r.q_estoque,
    v_custo_medio: r.v_custo_medio, v_custo_total: r.v_custo_total,
    perc_variacao: r.perc_variacao, desc_gerencial: r.desc_gerencial,
    item_descricao: r.item_descricao,
  }
}

// Com produtoId: histórico do PRODUTO do catálogo — todas as variações de
// descrição e todos os fornecedores vinculados a ele, não só este item_codigo.
// Sem produtoId (ou sem vínculo): comportamento anterior, por item_codigo.
// perc_variacao em produtos_relatorio é sempre null (importNfe nunca grava esse
// campo) — precisa ser CALCULADO contra a compra anterior real, na ordem
// cronológica, nunca lido do banco.
function comVariacaoCalculada(rowsDesc: HistoricoRow[]): HistoricoRow[] {
  const asc = [...rowsDesc].reverse()
  let anterior: number | null = null
  const comVariacao = asc.map(r => {
    const atual = r.v_custo_medio
    let perc: number | null = null
    if (atual != null && anterior != null && anterior !== 0) {
      perc = ((atual - anterior) / Math.abs(anterior)) * 100
    }
    if (atual != null) anterior = atual
    return { ...r, perc_variacao: perc }
  })
  return comVariacao.reverse()
}

export async function getHistoricoProduto(
  unitId: string | null,
  itemCodigo: string,
  produtoId?: string | null
): Promise<HistoricoRow[]> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    if (produtoId) {
      const pares = await fetchAllPaginado((from, to) =>
        db.from("produtos_depara")
          .select("fornecedor_cnpj,item_codigo")
          .eq("produto_id", produtoId)
          .range(from, to)
      ) as Array<{ fornecedor_cnpj: string; item_codigo: string }>

      if (pares.length > 0) {
        const itemCodigos = [...new Set(pares.map(p => p.item_codigo))]
        const paresValidos = new Set(pares.map(p => `${p.fornecedor_cnpj} ${p.item_codigo}`))

        const rows = await fetchAllPaginado((from, to) => {
          let q = db.from("produtos_relatorio")
            .select(HISTORICO_SELECT)
            .in("item_codigo", itemCodigos)
            .not("chave_nfe", "is", null)
            .order("dt_emissao", { ascending: false })
            .range(from, to)
          if (unitId) q = q.eq("unit_id", unitId)
          return q
        }) as HistoricoRowBruto[]

        return comVariacaoCalculada(
          rows
            .filter(r => paresValidos.has(`${r.fornecedor_codigo} ${r.item_codigo}`))
            .map(paraHistoricoRow)
        )
      }
    }

    const rows = await fetchAllPaginado((from, to) => {
      let q = db.from("produtos_relatorio")
        .select(HISTORICO_SELECT)
        .eq("item_codigo", itemCodigo)
        .not("chave_nfe", "is", null)
        .order("dt_emissao", { ascending: false })
        .range(from, to)
      if (unitId) q = q.eq("unit_id", unitId)
      return q
    }) as HistoricoRowBruto[]
    return comVariacaoCalculada(rows.map(paraHistoricoRow))
  } catch {
    return []
  }
}

export async function getCurrentUnitId(): Promise<string | null> {
  const unit = await getCurrentUnit()
  return unit?.id ?? null
}

// ── Aba Produto: uma linha por ITEM de NF-e de entrada, todo o histórico ───
// (ignora competência — é busca, não fechamento mensal). Categoria vem do
// catálogo (produtos_depara → produtos_catalogo), nunca de desc_gerencial
// (texto livre com erro de classificação, ex. "ALGA KOMBU" como "FRUTAS").

export type ItemProdutoRow = {
  id: number
  dtEmissao: string | null
  itemCodigo: string | null
  fornecedorCodigo: string | null
  fornecedorNome: string | null
  nrDanfe: string | null
  itemDescricao: string | null
  produtoId: string | null
  produtoCodigo: string | null
  produtoNome: string | null
  categoria: string | null
  qEstoque: number | null
  unidadeMedida: string | null
  vTotalEmbalagem: number | null
  vCustoCompra: number | null
  vCustoTotal: number | null
}

export async function getItensProdutoBusca(unitId: string | null): Promise<ItemProdutoRow[]> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const rows = await fetchAllPaginado((from, to) => {
      let q = db.from("produtos_relatorio")
        .select("id,dt_emissao,fornecedor_nome,fornecedor_codigo,nr_danfe,item_codigo,item_descricao,q_estoque,unidade_medida,v_total_embalagem,v_custo_compra,v_custo_total")
        .eq("direcao_nfe", "entrada")
        .not("chave_nfe", "is", null)
        .order("dt_emissao", { ascending: false })
        .range(from, to)
      if (unitId) q = q.eq("unit_id", unitId)
      return q
    }) as Array<{
      id: number; dt_emissao: string | null; fornecedor_nome: string | null; fornecedor_codigo: string | null
      nr_danfe: string | null; item_codigo: string | null; item_descricao: string | null
      q_estoque: number | null; unidade_medida: string | null
      v_total_embalagem: number | null; v_custo_compra: number | null; v_custo_total: number | null
    }>
    if (rows.length === 0) return []

    const pares = await fetchAllPaginado((from, to) =>
      db.from("produtos_depara").select("fornecedor_cnpj,item_codigo,produto_id").range(from, to)
    ) as Array<{ fornecedor_cnpj: string; item_codigo: string; produto_id: string | null }>
    const produtoIdPorPar = new Map<string, string>()
    for (const p of pares) if (p.produto_id) produtoIdPorPar.set(`${p.fornecedor_cnpj} ${p.item_codigo}`, p.produto_id)

    const produtoIds = [...new Set(produtoIdPorPar.values())]
    const catalogo = produtoIds.length
      ? await fetchAllPaginado((from, to) =>
          db.from("produtos_catalogo").select("id,codigo,nome,categoria").in("id", produtoIds).range(from, to)
        ) as Array<{ id: string; codigo: string; nome: string; categoria: string | null }>
      : []
    const catalogoPorId = new Map(catalogo.map(c => [c.id, c]))

    return rows.map(r => {
      const produtoId = produtoIdPorPar.get(`${r.fornecedor_codigo} ${r.item_codigo}`) ?? null
      const produto = produtoId ? catalogoPorId.get(produtoId) : undefined
      return {
        id: r.id,
        dtEmissao: r.dt_emissao,
        itemCodigo: r.item_codigo,
        fornecedorCodigo: r.fornecedor_codigo,
        fornecedorNome: r.fornecedor_nome,
        nrDanfe: r.nr_danfe,
        itemDescricao: r.item_descricao,
        produtoId,
        produtoCodigo: produto?.codigo ?? null,
        produtoNome: produto?.nome ?? null,
        categoria: produto?.categoria ?? null,
        qEstoque: r.q_estoque,
        unidadeMedida: r.unidade_medida,
        vTotalEmbalagem: r.v_total_embalagem,
        vCustoCompra: r.v_custo_compra,
        vCustoTotal: r.v_custo_total,
      }
    })
  } catch {
    return []
  }
}

// ── Análise: evolução de preço unitário por produto ─────────────────────────────
// Preço unitário do mês = AVG(v_custo_compra) — preço de compra JÁ normalizado pelo
// sistema na unidade base do produto (R$/kg, R$/L, R$/un). Não usamos
// Σv_total_embalagem ÷ Σq_embalagem porque a embalagem muda entre meses (caixa 10kg
// vs pacote 1kg dá preço unitário diferente com custo igual). Só entram produtos em
// >= 2 meses. preco_unit = null quando nenhum registro do mês tem v_custo_compra
// válido (null/zero são ignorados, nunca viram zero).

export type AnaliseMesPonto = {
  mes: number
  ano: number
  qtd: number
  valor: number
  preco_unit: number | null
}

export type AnaliseProduto = {
  item_codigo: string
  item_descricao: string | null
  unidade_medida: string | null
  desc_gerencial: string | null
  gasto_total: number
  meses: AnaliseMesPonto[]
}

export async function getAnaliseProdutos(
  unitId: string | null
): Promise<AnaliseProduto[]> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    let q = db
      .from("produtos_relatorio")
      .select("item_codigo,item_descricao,unidade_medida,desc_gerencial,q_embalagem,v_total_embalagem,v_custo_compra,v_total_danfe,mes_lancamento,ano_lancamento")
      .eq("calcula_cmv", true)
      .not("chave_nfe", "is", null)
      .limit(100000)
    if (unitId) q = q.eq("unit_id", unitId)
    const { data } = await q
    if (!data || data.length === 0) return []

    // custoSum/custoN = base do AVG(v_custo_compra) do mês; qtd/valor só p/ exibição.
    type MesAcc = { mes: number; ano: number; qtd: number; valor: number; custoSum: number; custoN: number }
    type Acc = {
      item_codigo: string
      item_descricao: string | null
      unidade_medida: string | null
      desc_gerencial: string | null
      meses: Map<string, MesAcc>
    }

    const map = new Map<string, Acc>()
    for (const r of data) {
      const cod = r.item_codigo
      if (!cod) continue // sem código não dá para rastrear entre meses
      let a = map.get(cod)
      if (!a) {
        a = {
          item_codigo: cod,
          item_descricao: r.item_descricao ?? null,
          unidade_medida: r.unidade_medida ?? null,
          desc_gerencial: r.desc_gerencial ?? null,
          meses: new Map(),
        }
        map.set(cod, a)
      }
      if (!a.item_descricao && r.item_descricao) a.item_descricao = r.item_descricao
      if (!a.unidade_medida && r.unidade_medida) a.unidade_medida = r.unidade_medida
      if (!a.desc_gerencial && r.desc_gerencial) a.desc_gerencial = r.desc_gerencial

      const mk = `${r.ano_lancamento}-${r.mes_lancamento}`
      let m = a.meses.get(mk)
      if (!m) {
        m = { mes: Number(r.mes_lancamento), ano: Number(r.ano_lancamento), qtd: 0, valor: 0, custoSum: 0, custoN: 0 }
        a.meses.set(mk, m)
      }
      const qtd = r.q_embalagem != null ? Number(r.q_embalagem) : 0
      const val = r.v_total_embalagem != null ? Number(r.v_total_embalagem) : 0
      m.qtd   += isFinite(qtd) ? qtd : 0
      m.valor += isFinite(val) ? Math.abs(val) : 0
      // AVG(v_custo_compra): ignora null e zero (não entram na média do mês).
      const danfe = r.v_total_danfe != null ? Number(r.v_total_danfe) : null
      const bonificacao = danfe != null && isFinite(danfe) && (danfe === 0 || danfe === 0.01)
      if (!bonificacao && r.v_custo_compra != null) {
        const cc = Number(r.v_custo_compra)
        if (isFinite(cc) && cc !== 0) { m.custoSum += cc; m.custoN++ }
      }
    }

    const produtos: AnaliseProduto[] = []
    for (const a of map.values()) {
      if (a.meses.size < 2) continue // >1 mês para haver evolução
      const meses: AnaliseMesPonto[] = [...a.meses.values()]
        .sort((x, y) => (x.ano !== y.ano ? x.ano - y.ano : x.mes - y.mes))
        .map(m => ({
          mes: m.mes,
          ano: m.ano,
          qtd: m.qtd,
          valor: m.valor,
          preco_unit: m.custoN > 0 ? m.custoSum / m.custoN : null,
        }))
      produtos.push({
        item_codigo: a.item_codigo,
        item_descricao: a.item_descricao,
        unidade_medida: a.unidade_medida,
        desc_gerencial: a.desc_gerencial,
        gasto_total: meses.reduce((s, m) => s + m.valor, 0),
        meses,
      })
    }
    return produtos
  } catch {
    return []
  }
}

export type ProdutoCompra = {
  id: number
  nr_danfe: string | null
  cfop: string | null
  dt_emissao: string | null
  fornecedor_nome: string | null
  item_descricao: string | null
  q_embalagem: number | null
  v_custo_compra: number | null
  v_total_embalagem: number | null
  v_total_danfe: number | null
  calcula_cmv: boolean | null
  mes_lancamento: number
  ano_lancamento: number
}

async function getProdutosDb() {
  return createFinanceiroClient()
}

export async function getBonificacoes(unitId: string | null): Promise<ProdutoCompra[]> {
  try {
    const db = await getProdutosDb()
    let query = db.from("produtos_relatorio")
      .select("id,nr_danfe,cfop,dt_emissao,fornecedor_nome,item_descricao,q_embalagem,v_custo_compra,v_total_embalagem,v_total_danfe,calcula_cmv,mes_lancamento,ano_lancamento")
      .or("cfop.in.(5910,6910),v_total_danfe.eq.0,v_total_danfe.eq.0.01")
      .not("chave_nfe", "is", null)
      .order("id", { ascending: false }).limit(5000)
    if (unitId) query = query.eq("unit_id", unitId)
    const { data, error } = await query
    if (error) throw error
    return data ?? []
  } catch { return [] }
}

export async function getFornecedoresLista(unitId: string | null, mes: number, ano: number): Promise<string[]> {
  try {
    const db = await getProdutosDb()
    let query = db.from("produtos_relatorio").select("fornecedor_nome")
      .eq("mes_lancamento", mes).eq("ano_lancamento", ano)
      .not("fornecedor_nome", "is", null).not("chave_nfe", "is", null).limit(50000)
    if (unitId) query = query.eq("unit_id", unitId)
    const { data, error } = await query
    if (error) throw error
    return [...new Set<string>((data ?? []).map((row: { fornecedor_nome: string }) => row.fornecedor_nome))]
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
  } catch { return [] }
}

export async function getComprasPorFornecedor(unitId: string | null, fornecedor: string, mes: number, ano: number): Promise<ProdutoCompra[]> {
  try {
    const db = await getProdutosDb()
    let query = db.from("produtos_relatorio")
      .select("id,nr_danfe,cfop,dt_emissao,fornecedor_nome,item_descricao,q_embalagem,v_custo_compra,v_total_embalagem,v_total_danfe,calcula_cmv,mes_lancamento,ano_lancamento")
      .eq("fornecedor_nome", fornecedor).eq("mes_lancamento", mes).eq("ano_lancamento", ano)
      .not("chave_nfe", "is", null)
      .order("id", { ascending: false }).limit(10000)
    if (unitId) query = query.eq("unit_id", unitId)
    const { data, error } = await query
    if (error) throw error
    return data ?? []
  } catch { return [] }
}

export async function getNotasARevisar(unitId: string | null): Promise<ProdutoCompra[]> {
  try {
    const db = await getProdutosDb()
    let candidates = db.from("produtos_relatorio").select("nr_danfe")
      .eq("v_custo_compra", 0).gt("v_total_danfe", 0.01).not("nr_danfe", "is", null)
      .not("chave_nfe", "is", null).limit(20000)
    if (unitId) candidates = candidates.eq("unit_id", unitId)
    const { data: candidateRows, error: candidateError } = await candidates
    if (candidateError) throw candidateError
    const danfes = [...new Set<string>((candidateRows ?? []).map((row: { nr_danfe: string }) => row.nr_danfe))]
    if (!danfes.length) return []
    let query = db.from("produtos_relatorio")
      .select("id,nr_danfe,cfop,dt_emissao,fornecedor_nome,item_descricao,q_embalagem,v_custo_compra,v_total_embalagem,v_total_danfe,calcula_cmv,mes_lancamento,ano_lancamento")
      .not("chave_nfe", "is", null)
      .in("nr_danfe", danfes).order("fornecedor_nome").order("nr_danfe").limit(50000)
    if (unitId) query = query.eq("unit_id", unitId)
    const { data, error } = await query
    if (error) throw error
    return data ?? []
  } catch { return [] }
}

// ── Catálogo de produtos e de-para de fornecedor ─────────────────────────────
// produtos_depara é a fonte de verdade do vínculo (fornecedor_cnpj, item_codigo)
// → produto_id. produtos_relatorio.produto_id não é escrito nesta fase.

export type ProdutoPendente = {
  fornecedorCnpj: string
  fornecedorNome: string | null
  itemCodigo: string
  itemDescricao: string | null
  ncm: string | null
  compras: number
  valorTotal: number
}

export type CatalogoCandidato = {
  id: string
  codigo: string
  nome: string
  ncm: string | null
  similaridade: number
}

export type ProdutoCatalogo = {
  id: string
  codigo: string
  nome: string
  ncm: string | null
  unidadePadrao: string | null
  categoria: string | null
}

function bigramas(s: string): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return set
}

// Dice coefficient sobre bigramas — sem dependência externa.
function similaridade(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const A = bigramas(a)
  const B = bigramas(b)
  if (A.size === 0 || B.size === 0) return 0
  let intersecao = 0
  for (const bg of A) if (B.has(bg)) intersecao++
  return (2 * intersecao) / (A.size + B.size)
}

export async function getProdutosPendentes(): Promise<ProdutoPendente[]> {
  try {
    const db = await getProdutosDb()

    const { data: mapeados, error: mapeadosError } = await db
      .from("produtos_depara")
      .select("fornecedor_cnpj,item_codigo")
      .limit(50000)
    if (mapeadosError) throw mapeadosError
    const mapeadosSet = new Set(
      (mapeados ?? []).map((m: { fornecedor_cnpj: string; item_codigo: string }) =>
        `${m.fornecedor_cnpj} ${m.item_codigo}`
      )
    )

    const { data, error } = await db
      .from("produtos_relatorio")
      .select("fornecedor_codigo,fornecedor_nome,item_codigo,item_descricao,tipo_item,v_total_embalagem")
      .not("chave_nfe", "is", null)
      .eq("calcula_cmv", true)
      .not("fornecedor_codigo", "is", null)
      .not("item_codigo", "is", null)
      .limit(100000)
    if (error) throw error
    if (!data || data.length === 0) return []

    const map = new Map<string, ProdutoPendente>()
    for (const r of data as Array<{
      fornecedor_codigo: string; fornecedor_nome: string | null
      item_codigo: string; item_descricao: string | null
      tipo_item: string | null; v_total_embalagem: number | null
    }>) {
      const key = `${r.fornecedor_codigo} ${r.item_codigo}`
      if (mapeadosSet.has(key)) continue
      const acc = map.get(key) ?? {
        fornecedorCnpj: r.fornecedor_codigo,
        fornecedorNome: r.fornecedor_nome,
        itemCodigo: r.item_codigo,
        itemDescricao: r.item_descricao,
        ncm: r.tipo_item,
        compras: 0,
        valorTotal: 0,
      }
      acc.compras += 1
      const v = r.v_total_embalagem != null ? Number(r.v_total_embalagem) : 0
      acc.valorTotal += isFinite(v) ? Math.abs(v) : 0
      if (!acc.itemDescricao && r.item_descricao) acc.itemDescricao = r.item_descricao
      if (!acc.ncm && r.tipo_item) acc.ncm = r.tipo_item
      if (!acc.fornecedorNome && r.fornecedor_nome) acc.fornecedorNome = r.fornecedor_nome
      map.set(key, acc)
    }

    return [...map.values()].sort((a, b) => b.valorTotal - a.valorTotal)
  } catch {
    return []
  }
}

export async function getCandidatosProduto(
  fornecedorCnpj: string,
  itemCodigo: string
): Promise<CatalogoCandidato[]> {
  try {
    const db = await getProdutosDb()

    const { data: item } = await db
      .from("produtos_relatorio")
      .select("item_descricao,tipo_item")
      .eq("fornecedor_codigo", fornecedorCnpj)
      .eq("item_codigo", itemCodigo)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
    const ncm = item?.tipo_item ?? null
    if (!ncm) return []

    const { data: candidatos, error } = await db
      .from("produtos_catalogo")
      .select("id,codigo,nome,ncm")
      .eq("ncm", ncm)
      .eq("ativo", true)
      .limit(200)
    if (error) throw error
    if (!candidatos || candidatos.length === 0) return []

    const alvo = normalizeDescricao(item?.item_descricao ?? "")
    return (candidatos as Array<{ id: string; codigo: string; nome: string; ncm: string | null }>)
      .map(c => ({
        id: c.id,
        codigo: c.codigo,
        nome: c.nome,
        ncm: c.ncm,
        similaridade: similaridade(alvo, normalizeDescricao(c.nome)),
      }))
      .sort((a, b) => b.similaridade - a.similaridade)
  } catch {
    return []
  }
}

export async function criarProdutoCatalogo(
  codigo: string,
  nome: string,
  ncm: string | null,
  unidadePadrao: string | null,
  categoria: string | null
): Promise<{ ok: boolean; produto?: ProdutoCatalogo; error?: string }> {
  try {
    await requireUser()
    const supabase = await createFinanceiroClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data, error } = await db
      .from("produtos_catalogo")
      .insert({ codigo, nome, ncm, unidade_padrao: unidadePadrao, categoria })
      .select("id,codigo,nome,ncm,unidade_padrao,categoria")
      .single()
    if (error) return { ok: false, error: error.message }
    return {
      ok: true,
      produto: {
        id: data.id, codigo: data.codigo, nome: data.nome, ncm: data.ncm,
        unidadePadrao: data.unidade_padrao, categoria: data.categoria,
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function vincularProduto(
  fornecedorCnpj: string,
  itemCodigo: string,
  produtoId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireUser()
    const supabase = await createFinanceiroClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const { data: item } = await db
      .from("produtos_relatorio")
      .select("fornecedor_nome,item_descricao,tipo_item")
      .eq("fornecedor_codigo", fornecedorCnpj)
      .eq("item_codigo", itemCodigo)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    const { error } = await db
      .from("produtos_depara")
      .upsert({
        fornecedor_cnpj: fornecedorCnpj,
        fornecedor_nome: item?.fornecedor_nome ?? null,
        item_codigo: itemCodigo,
        item_descricao: item?.item_descricao ?? null,
        ncm: item?.tipo_item ?? null,
        produto_id: produtoId,
      }, { onConflict: "fornecedor_cnpj,item_codigo" })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function desvincularProduto(
  fornecedorCnpj: string,
  itemCodigo: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireUser()
    const supabase = await createFinanceiroClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db
      .from("produtos_depara")
      .delete()
      .eq("fornecedor_cnpj", fornecedorCnpj)
      .eq("item_codigo", itemCodigo)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Geração automática do catálogo ───────────────────────────────────────────
// Chave de agrupamento = ncm + descrição-núcleo + calibre. Estritamente aditivo:
// nunca toca um par (fornecedor_cnpj, item_codigo) que já tenha produtos_depara
// (manual ou de uma geração anterior) — é isso que garante idempotência e
// preserva correções feitas via mesclarProdutos/renomearProduto/moverVinculo.

const CATEGORIA_PREFIXO_MAX_LEN = 30
const CATEGORIA_MIN_OCORRENCIAS = 5
const SUFIXOS_CERTIFICACAO = ["ASC", "ISP", "S/M"]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function getCategoriasConhecidas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
): Promise<Set<string>> {
  const data = await fetchAllPaginado((from, to) =>
    db.from("produtos_relatorio")
      .select("desc_gerencial")
      .not("desc_gerencial", "is", null)
      .range(from, to)
  )
  const contagem = new Map<string, number>()
  for (const row of data as Array<{ desc_gerencial: string }>) {
    const v = row.desc_gerencial.trim().replace(/-+$/, "").trim().toUpperCase()
    if (v.length === 0 || v.length > CATEGORIA_PREFIXO_MAX_LEN) continue
    if (/[-*()0-9]/.test(v)) continue
    contagem.set(v, (contagem.get(v) ?? 0) + 1)
  }
  const set = new Set<string>()
  for (const [v, n] of contagem) if (n >= CATEGORIA_MIN_OCORRENCIAS) set.add(v)
  return set
}

function removerPrefixoCategoria(texto: string, categorias: Set<string>): string {
  for (const cat of categorias) {
    const regex = new RegExp(`^${escapeRegExp(cat)}\\s*-+\\s*`, "i")
    if (regex.test(texto)) return texto.replace(regex, "")
  }
  return texto
}

// Repete até estabilizar — sufixos empilhados ("... 14-16 LB S/M ISP") só
// removem um por vez da direita pra esquerda.
function removerSufixoCertificacao(texto: string): string {
  let out = texto
  let mudou = true
  while (mudou) {
    mudou = false
    for (const suf of SUFIXOS_CERTIFICACAO) {
      const regex = new RegExp(`\\s+${escapeRegExp(suf)}$`, "i")
      if (regex.test(out)) { out = out.replace(regex, ""); mudou = true }
    }
  }
  return out
}

// Só remove parêntese no fim quando contém dígito — "(SALMO SALAR)" nunca é
// removido (sem dígito, é nome de espécie); "(1,8 KG)" é removido (peso).
function removerPesoEntreParenteses(texto: string): string {
  return texto.replace(/\(([^()]*\d[^()]*)\)\s*$/, "").trimEnd()
}

// Fronteira de palavra só à esquerda: "10-20U/LB" precisa capturar "10-20"
// mesmo com "U" colado logo depois, sem espaço.
function calcularNucleoECalibre(
  itemDescricao: string,
  categorias: Set<string>
): { nucleo: string; calibre: string | null } {
  let texto = itemDescricao.toUpperCase()
  texto = removerPrefixoCategoria(texto, categorias)
  texto = removerSufixoCertificacao(texto)
  texto = removerPesoEntreParenteses(texto)
  const { texto: semCalibre, calibre } = extrairCalibre(texto)
  const nucleo = normalizeDescricao(semCalibre)
  return { nucleo, calibre }
}

export type GerarCatalogoResultado = {
  ok: boolean
  linhasLidas: number
  itensDistintos: number
  produtosCriados: number
  vinculosCriados: number
  excluidosPorNcm: number
  excluidosPorCategoria: number
  error?: string
}

// Capítulos 02-23 da NBM/NCM = animais/carnes, peixes, laticínios, hortifruti,
// café/chá, cereais, gorduras, preparações alimentícias, bebidas, resíduos
// alimentares. Um freezer (84xxxxx) ou embalagem plástica (39xxxxx) nunca cai
// nessa faixa, então não precisa de lista manual pra excluí-los.
function ncmEmFaixaAlimentar(ncm: string): boolean {
  const capitulo = parseInt(ncm.slice(0, 2), 10)
  return Number.isFinite(capitulo) && capitulo >= 2 && capitulo <= 23
}

type LinhaEntrada = {
  fornecedor_codigo: string | null
  fornecedor_nome: string | null
  item_codigo: string
  item_descricao: string
  tipo_item: string | null
  desc_gerencial: string | null
  unidade_medida: string | null
  v_total_embalagem: number | null
}

type ParPendente = {
  fornecedorCnpj: string
  fornecedorNome: string | null
  itemCodigo: string
  itemDescricao: string
  ncmOriginal: string | null
  unidadeMedida: string | null
  valorTotal: number
}

type GrupoCatalogo = {
  ncm: string | null
  nucleo: string
  calibre: string | null
  valorTotal: number
  unidadeFreq: Map<string, number>
  pares: ParPendente[]
}

// Sem chavesNfe: varre todo produtos_relatorio (ação de manutenção, botão
// "Reprocessar catálogo completo" na aba Catálogo). Com chavesNfe: só os
// itens daquelas notas — é o que importNfe() chama a cada lote, pra não
// reprocessar o histórico inteiro em toda importação. jaVinculados (pares
// já em produtos_depara) já torna a função aditiva; o filtro por chave só
// reduz o que precisa ser lido de produtos_relatorio.
export async function gerarCatalogoAutomatico(chavesNfe?: string[]): Promise<GerarCatalogoResultado> {
  const empty = {
    ok: false, linhasLidas: 0, itensDistintos: 0, produtosCriados: 0, vinculosCriados: 0,
    excluidosPorNcm: 0, excluidosPorCategoria: 0,
  }
  try {
    await requireUser()
    if (chavesNfe && chavesNfe.length === 0) {
      return { ok: true, linhasLidas: 0, itensDistintos: 0, produtosCriados: 0, vinculosCriados: 0, excluidosPorNcm: 0, excluidosPorCategoria: 0 }
    }
    const supabase = await createFinanceiroClient()
    if (!supabase) return { ...empty, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const categorias = await getCategoriasConhecidas(db)

    // Pares já vinculados (manual ou geração anterior) ficam intocados — é
    // isso que torna a função aditiva e idempotente.
    let existentes: Array<{
      fornecedor_cnpj: string; item_codigo: string; produto_id: string | null
      item_descricao: string | null; ncm: string | null
    }>
    try {
      existentes = await fetchAllPaginado((from, to) =>
        db.from("produtos_depara")
          .select("fornecedor_cnpj,item_codigo,produto_id,item_descricao,ncm")
          .range(from, to)
      )
    } catch (e) {
      return { ...empty, error: e instanceof Error ? e.message : String(e) }
    }

    let ativos: Array<{ id: string }>
    try {
      ativos = await fetchAllPaginado((from, to) =>
        db.from("produtos_catalogo").select("id").eq("ativo", true).range(from, to)
      )
    } catch (e) {
      return { ...empty, error: e instanceof Error ? e.message : String(e) }
    }
    const ativosSet = new Set(ativos.map((p: { id: string }) => p.id))

    const jaVinculados = new Set<string>()
    const grupoParaProdutoId = new Map<string, string>()
    for (const row of existentes) {
      jaVinculados.add(`${row.fornecedor_cnpj} ${row.item_codigo}`)
      if (row.produto_id && ativosSet.has(row.produto_id) && row.item_descricao) {
        const { nucleo, calibre } = calcularNucleoECalibre(row.item_descricao, categorias)
        const chave = `${row.ncm ?? ""} ${nucleo} ${calibre ?? ""}`
        if (!grupoParaProdutoId.has(chave)) grupoParaProdutoId.set(chave, row.produto_id)
      }
    }

    let rows: LinhaEntrada[]
    try {
      rows = await fetchAllPaginado((from, to) => {
        let q = db.from("produtos_relatorio")
          .select("fornecedor_codigo,fornecedor_nome,item_codigo,item_descricao,tipo_item,desc_gerencial,unidade_medida,v_total_embalagem")
          .eq("direcao_nfe", "entrada")
          .not("chave_nfe", "is", null)
          .not("fornecedor_codigo", "is", null)
          .not("item_codigo", "is", null)
          .not("item_descricao", "is", null)
        if (chavesNfe && chavesNfe.length > 0) q = q.in("chave_nfe", chavesNfe)
        return q.range(from, to)
      })
    } catch (e) {
      return { ...empty, error: e instanceof Error ? e.message : String(e) }
    }
    const linhasLidas = rows.length

    // Agrega por (fornecedor, item_codigo) primeiro — evita recalcular o
    // núcleo pra cada compra individual do mesmo item.
    let excluidosPorNcm = 0
    let excluidosPorCategoria = 0
    const pendentesPorPar = new Map<string, ParPendente>()
    for (const r of rows) {
      const fornecedorCnpj = r.fornecedor_codigo as string
      const parKey = `${fornecedorCnpj} ${r.item_codigo}`
      if (jaVinculados.has(parKey)) continue

      if (r.tipo_item) {
        if (!ncmEmFaixaAlimentar(r.tipo_item)) { excluidosPorNcm++; continue }
      } else {
        const categoria = (r.desc_gerencial ?? "").trim().toUpperCase()
        if (CATEGORIAS_NAO_PRODUTO.has(categoria)) { excluidosPorCategoria++; continue }
      }

      const acc = pendentesPorPar.get(parKey) ?? {
        fornecedorCnpj,
        fornecedorNome: r.fornecedor_nome,
        itemCodigo: r.item_codigo,
        itemDescricao: r.item_descricao,
        ncmOriginal: r.tipo_item,
        unidadeMedida: r.unidade_medida,
        valorTotal: 0,
      }
      const v = r.v_total_embalagem != null ? Number(r.v_total_embalagem) : 0
      acc.valorTotal += isFinite(v) ? Math.abs(v) : 0
      if (!acc.ncmOriginal && r.tipo_item) acc.ncmOriginal = r.tipo_item
      if (!acc.unidadeMedida && r.unidade_medida) acc.unidadeMedida = r.unidade_medida
      pendentesPorPar.set(parKey, acc)
    }

    const itensDistintos = pendentesPorPar.size

    if (itensDistintos === 0) {
      return { ok: true, linhasLidas, itensDistintos, produtosCriados: 0, vinculosCriados: 0, excluidosPorNcm, excluidosPorCategoria }
    }

    // Agrupa os pares pendentes por (ncm, núcleo, calibre).
    const grupos = new Map<string, GrupoCatalogo>()
    for (const p of pendentesPorPar.values()) {
      const { nucleo, calibre } = calcularNucleoECalibre(p.itemDescricao, categorias)
      if (!nucleo) continue // descrição vazia após normalizar — não dá pra agrupar com segurança
      const chave = `${p.ncmOriginal ?? ""} ${nucleo} ${calibre ?? ""}`
      let g = grupos.get(chave)
      if (!g) {
        g = { ncm: p.ncmOriginal, nucleo, calibre, valorTotal: 0, unidadeFreq: new Map(), pares: [] }
        grupos.set(chave, g)
      }
      g.valorTotal += p.valorTotal
      g.pares.push(p)
      if (p.unidadeMedida) g.unidadeFreq.set(p.unidadeMedida, (g.unidadeFreq.get(p.unidadeMedida) ?? 0) + 1)
    }

    // Próximo código sequencial livre — só considera códigos já no formato 0000-9999
    // (códigos manuais tipo "SAL-ATL-1416" da FASE 2 não entram nessa contagem).
    let codigosExistentes: Array<{ codigo: string }>
    try {
      codigosExistentes = await fetchAllPaginado((from, to) =>
        db.from("produtos_catalogo").select("codigo").range(from, to)
      )
    } catch (e) {
      return { ...empty, linhasLidas, itensDistintos, error: e instanceof Error ? e.message : String(e) }
    }
    let proximoCodigo = 1
    for (const row of codigosExistentes) {
      if (/^\d{4}$/.test(row.codigo)) {
        const n = parseInt(row.codigo, 10)
        if (n >= proximoCodigo) proximoCodigo = n + 1
      }
    }

    // Separa: grupos que já batem com um produto ativo existente (só ganham
    // novos vínculos) dos que precisam de produto novo.
    const paresParaVincular: Array<{ pendente: ParPendente; produtoId: string }> = []
    const gruposNovos: GrupoCatalogo[] = []
    for (const [chave, grupo] of grupos) {
      const produtoExistente = grupoParaProdutoId.get(chave)
      if (produtoExistente) {
        for (const p of grupo.pares) paresParaVincular.push({ pendente: p, produtoId: produtoExistente })
      } else {
        gruposNovos.push(grupo)
      }
    }
    gruposNovos.sort((a, b) => b.valorTotal - a.valorTotal)

    let produtosCriados = 0
    for (const grupo of gruposNovos) {
      const unidadePadrao = [...grupo.unidadeFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      const codigo = String(proximoCodigo).padStart(4, "0")
      proximoCodigo += 1
      const nome = grupo.calibre ? `${grupo.nucleo} ${grupo.calibre}` : grupo.nucleo
      const { data: novo, error: novoError } = await db
        .from("produtos_catalogo")
        .insert({ codigo, nome, ncm: grupo.ncm || null, unidade_padrao: unidadePadrao, categoria: null })
        .select("id")
        .single()
      if (novoError) {
        return { ok: false, linhasLidas, itensDistintos, produtosCriados, vinculosCriados: 0, excluidosPorNcm, excluidosPorCategoria, error: novoError.message }
      }
      produtosCriados += 1
      for (const p of grupo.pares) paresParaVincular.push({ pendente: p, produtoId: novo.id })
    }

    let vinculosCriados = 0
    for (let i = 0; i < paresParaVincular.length; i += 500) {
      const chunk = paresParaVincular.slice(i, i + 500).map(({ pendente, produtoId }) => ({
        produto_id: produtoId,
        fornecedor_cnpj: pendente.fornecedorCnpj,
        fornecedor_nome: pendente.fornecedorNome,
        item_codigo: pendente.itemCodigo,
        item_descricao: pendente.itemDescricao,
        ncm: pendente.ncmOriginal,
      }))
      const { error } = await db
        .from("produtos_depara")
        .upsert(chunk, { onConflict: "fornecedor_cnpj,item_codigo" })
      if (error) {
        return { ok: false, linhasLidas, itensDistintos, produtosCriados, vinculosCriados, excluidosPorNcm, excluidosPorCategoria, error: error.message }
      }
      vinculosCriados += chunk.length
    }

    return { ok: true, linhasLidas, itensDistintos, produtosCriados, vinculosCriados, excluidosPorNcm, excluidosPorCategoria }
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) }
  }
}

export type LimparCatalogoResultado = {
  ok: boolean
  produtosRemovidos: number
  vinculosRemovidos: number
  error?: string
}

// Apaga produtos_catalogo e produtos_depara. Seguro: produtos_relatorio nao e'
// tocado (produto_id continua null la), so o catalogo gerado e' descartado.
export async function limparCatalogo(): Promise<LimparCatalogoResultado> {
  try {
    await requireUser()
    const supabase = await createFinanceiroClient()
    if (!supabase) return { ok: false, produtosRemovidos: 0, vinculosRemovidos: 0, error: "Sem conexao com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const NIL_UUID = "00000000-0000-0000-0000-000000000000"

    const { data: depara, error: deparaError } = await db
      .from("produtos_depara").delete().neq("id", NIL_UUID).select("id")
    if (deparaError) return { ok: false, produtosRemovidos: 0, vinculosRemovidos: 0, error: deparaError.message }

    const { data: catalogo, error: catalogoError } = await db
      .from("produtos_catalogo").delete().neq("id", NIL_UUID).select("id")
    if (catalogoError) {
      return { ok: false, produtosRemovidos: 0, vinculosRemovidos: depara?.length ?? 0, error: catalogoError.message }
    }

    return { ok: true, produtosRemovidos: catalogo?.length ?? 0, vinculosRemovidos: depara?.length ?? 0 }
  } catch (e) {
    return { ok: false, produtosRemovidos: 0, vinculosRemovidos: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

export type CatalogoItem = {
  id: string
  codigo: string
  nome: string
  ncm: string | null
  unidadePadrao: string | null
  categoria: string | null
  ativo: boolean
  itensVinculados: number
}

export async function getCatalogoGerado(): Promise<CatalogoItem[]> {
  try {
    const db = await getProdutosDb()
    const { data: produtos, error } = await db
      .from("produtos_catalogo")
      .select("id,codigo,nome,ncm,unidade_padrao,categoria,ativo")
      .order("codigo")
      .limit(20000)
    if (error) throw error
    if (!produtos || produtos.length === 0) return []

    const { data: depara } = await db.from("produtos_depara").select("produto_id").limit(200000)
    const contagem = new Map<string, number>()
    for (const row of (depara ?? []) as Array<{ produto_id: string | null }>) {
      if (!row.produto_id) continue
      contagem.set(row.produto_id, (contagem.get(row.produto_id) ?? 0) + 1)
    }

    return (produtos as Array<{
      id: string; codigo: string; nome: string; ncm: string | null
      unidade_padrao: string | null; categoria: string | null; ativo: boolean
    }>).map(p => ({
      id: p.id, codigo: p.codigo, nome: p.nome, ncm: p.ncm,
      unidadePadrao: p.unidade_padrao, categoria: p.categoria, ativo: p.ativo,
      itensVinculados: contagem.get(p.id) ?? 0,
    }))
  } catch {
    return []
  }
}

export async function mesclarProdutos(
  produtoIdOrigem: string,
  produtoIdDestino: string
): Promise<{ ok: boolean; movidos?: number; error?: string }> {
  try {
    await requireUser()
    if (produtoIdOrigem === produtoIdDestino) return { ok: false, error: "Origem e destino são o mesmo produto." }
    const supabase = await createFinanceiroClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const { data: movidos, error: moveError } = await db
      .from("produtos_depara")
      .update({ produto_id: produtoIdDestino })
      .eq("produto_id", produtoIdOrigem)
      .select("id")
    if (moveError) return { ok: false, error: moveError.message }

    const { error: desativaError } = await db
      .from("produtos_catalogo")
      .update({ ativo: false })
      .eq("id", produtoIdOrigem)
    if (desativaError) return { ok: false, error: desativaError.message }

    return { ok: true, movidos: movidos?.length ?? 0 }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function renomearProduto(
  produtoId: string,
  nome: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireUser()
    if (!nome.trim()) return { ok: false, error: "Nome não pode ser vazio." }
    const supabase = await createFinanceiroClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db.from("produtos_catalogo").update({ nome: nome.trim() }).eq("id", produtoId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function moverVinculo(
  fornecedorCnpj: string,
  itemCodigo: string,
  novoProdutoId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireUser()
    const supabase = await createFinanceiroClient()
    if (!supabase) return { ok: false, error: "Sem conexão com banco" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db
      .from("produtos_depara")
      .update({ produto_id: novoProdutoId })
      .eq("fornecedor_cnpj", fornecedorCnpj)
      .eq("item_codigo", itemCodigo)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Conteúdo completo da NF-e (drawer da nota) ───────────────────────────────

export type NotaCompleta = {
  chave: string
  numero: string | null
  serie: string | null
  emissao: string | null
  valorTotal: number
  cancelada: boolean
  emitenteNome: string | null
  emitenteCnpj: string | null
  destinatarioNome: string | null
  destinatarioCnpj: string | null
}

export type NotaItem = {
  itemCodigo: string | null
  itemDescricao: string | null
  ncm: string | null
  unidade: string | null
  quantidade: number | null
  valorUnitario: number | null
  valorTotal: number | null
  produtoId: string | null
  produtoCodigo: string | null
  produtoNome: string | null
}

export type NotaCompletaResultado = {
  nota: NotaCompleta | null
  itens: NotaItem[]
  somaItens: number
}

export async function getNotaCompleta(chaveNfe: string): Promise<NotaCompletaResultado> {
  const vazio: NotaCompletaResultado = { nota: null, itens: [], somaItens: 0 }
  try {
    const db = await getProdutosDb()

    const { data: doc } = await db
      .from("nfe_documentos")
      .select("chave,numero,serie,emissao,valor_total,cancelada,emitente_nome,emitente_cnpj,destinatario_nome,destinatario_cnpj")
      .eq("chave", chaveNfe)
      .maybeSingle()

    const nota: NotaCompleta | null = doc ? {
      chave: doc.chave,
      numero: doc.numero,
      serie: doc.serie,
      emissao: doc.emissao,
      valorTotal: doc.valor_total != null ? Number(doc.valor_total) : 0,
      cancelada: doc.cancelada,
      emitenteNome: doc.emitente_nome,
      emitenteCnpj: doc.emitente_cnpj,
      destinatarioNome: doc.destinatario_nome,
      destinatarioCnpj: doc.destinatario_cnpj,
    } : null

    const itensRaw = await fetchAllPaginado((from, to) =>
      db.from("produtos_relatorio")
        .select("fornecedor_codigo,item_codigo,item_descricao,tipo_item,unidade_medida,q_embalagem,v_embalagem,v_total_embalagem")
        .eq("chave_nfe", chaveNfe)
        .order("id")
        .range(from, to)
    ) as Array<{
      fornecedor_codigo: string | null; item_codigo: string | null; item_descricao: string | null
      tipo_item: string | null; unidade_medida: string | null
      q_embalagem: number | null; v_embalagem: number | null; v_total_embalagem: number | null
    }>

    if (itensRaw.length === 0) return { nota, itens: [], somaItens: 0 }

    const fornecedorCnpj = itensRaw.find(r => r.fornecedor_codigo)?.fornecedor_codigo ?? null
    const itemCodigos = [...new Set(itensRaw.map(r => r.item_codigo).filter((v): v is string => Boolean(v)))]

    const produtoPorItemCodigo = new Map<string, { id: string; codigo: string; nome: string }>()
    if (fornecedorCnpj && itemCodigos.length > 0) {
      const deparaRows = await fetchAllPaginado((from, to) =>
        db.from("produtos_depara")
          .select("item_codigo,produto_id")
          .eq("fornecedor_cnpj", fornecedorCnpj)
          .in("item_codigo", itemCodigos)
          .range(from, to)
      ) as Array<{ item_codigo: string; produto_id: string | null }>

      const produtoIds = [...new Set(deparaRows.map(d => d.produto_id).filter((v): v is string => Boolean(v)))]
      const catalogoPorId = new Map<string, { id: string; codigo: string; nome: string }>()
      if (produtoIds.length > 0) {
        const catalogoRows = await fetchAllPaginado((from, to) =>
          db.from("produtos_catalogo").select("id,codigo,nome").in("id", produtoIds).range(from, to)
        ) as Array<{ id: string; codigo: string; nome: string }>
        for (const c of catalogoRows) catalogoPorId.set(c.id, { id: c.id, codigo: c.codigo, nome: c.nome })
      }
      for (const d of deparaRows) {
        if (d.produto_id && catalogoPorId.has(d.produto_id)) {
          produtoPorItemCodigo.set(d.item_codigo, catalogoPorId.get(d.produto_id)!)
        }
      }
    }

    const itens: NotaItem[] = itensRaw.map(r => {
      const produto = r.item_codigo ? produtoPorItemCodigo.get(r.item_codigo) : undefined
      return {
        itemCodigo: r.item_codigo,
        itemDescricao: r.item_descricao,
        ncm: r.tipo_item,
        unidade: r.unidade_medida,
        quantidade: r.q_embalagem,
        valorUnitario: r.v_embalagem,
        valorTotal: r.v_total_embalagem,
        produtoId: produto?.id ?? null,
        produtoCodigo: produto?.codigo ?? null,
        produtoNome: produto?.nome ?? null,
      }
    })
    const somaItens = itens.reduce((s, i) => s + Math.abs(i.valorTotal ?? 0), 0)

    return { nota, itens, somaItens }
  } catch {
    return vazio
  }
}

export type CompraProduto = {
  data: string | null
  fornecedor: string | null
  nrDanfe: string | null
  chaveNfe: string | null
  custoUnitario: number | null
  qtd: number | null
  varPct: number | null
  varAbs: number | null
  trocouFornecedor: boolean
}

export type ProdutoEvolucao = {
  produtoId: string
  codigo: string
  nome: string
  ncm: string | null
  unidade: string | null
  compras: CompraProduto[]
  ultimaVarPct: number | null
  ultimaVarAbs: number | null
  totalCompras: number
  precoAtual: number | null
  precoMinimo: number
  precoMaximo: number
  precoMedio: number
}

type LinhaCompraBruta = {
  fornecedor_codigo: string | null
  fornecedor_nome: string | null
  item_codigo: string | null
  dt_emissao: string | null
  nr_danfe: string | null
  chave_nfe: string | null
  v_custo_compra: number | null
  q_embalagem: number | null
  v_total_danfe: number | null
}

// Analisa a variação de preço de cada produto do catálogo ao longo de suas
// compras reais (uma por chave_nfe+item_codigo), comparando sempre com a
// compra cronologicamente anterior — nunca com o mês anterior.
export async function getEvolucaoPorCompra(unitId: string | null): Promise<ProdutoEvolucao[]> {
  try {
    const db = await getProdutosDb()

    const linhas = await fetchAllPaginado((from, to) => {
      let q = db.from("produtos_relatorio")
        .select("fornecedor_codigo,fornecedor_nome,item_codigo,dt_emissao,nr_danfe,chave_nfe,v_custo_compra,q_embalagem,v_total_danfe")
        .eq("direcao_nfe", "entrada")
        .not("chave_nfe", "is", null)
        .order("dt_emissao", { ascending: true })
        .range(from, to)
      if (unitId) q = q.eq("unit_id", unitId)
      return q
    }) as LinhaCompraBruta[]

    // Bonificação (item de brinde/promocional) não é compra real: v_total_danfe 0 ou 0.01.
    const validas = linhas.filter(r =>
      r.fornecedor_codigo && r.item_codigo &&
      r.v_total_danfe !== 0 && r.v_total_danfe !== 0.01
    )

    // Uma nota = uma compra: um ponto por (chave_nfe, item_codigo).
    const porChaveItem = new Map<string, LinhaCompraBruta>()
    for (const r of validas) {
      const chave = `${r.chave_nfe}|${r.item_codigo}`
      if (!porChaveItem.has(chave)) porChaveItem.set(chave, r)
    }
    const compras = [...porChaveItem.values()]
    if (compras.length === 0) return []

    const cnpjs = [...new Set(compras.map(r => r.fornecedor_codigo!))]
    const itemCodigos = [...new Set(compras.map(r => r.item_codigo!))]

    const deparaRows = await fetchAllPaginado((from, to) =>
      db.from("produtos_depara")
        .select("fornecedor_cnpj,item_codigo,produto_id")
        .in("fornecedor_cnpj", cnpjs)
        .in("item_codigo", itemCodigos)
        .range(from, to)
    ) as Array<{ fornecedor_cnpj: string; item_codigo: string; produto_id: string | null }>

    const produtoIdPorPar = new Map<string, string>()
    for (const d of deparaRows) {
      if (d.produto_id) produtoIdPorPar.set(`${d.fornecedor_cnpj}|${d.item_codigo}`, d.produto_id)
    }
    const produtoIds = [...new Set(produtoIdPorPar.values())]
    if (produtoIds.length === 0) return []

    const catalogoRows = await fetchAllPaginado((from, to) =>
      db.from("produtos_catalogo")
        .select("id,codigo,nome,ncm,unidade_padrao")
        .in("id", produtoIds)
        .range(from, to)
    ) as Array<{ id: string; codigo: string; nome: string; ncm: string | null; unidade_padrao: string | null }>
    const catalogoPorId = new Map(catalogoRows.map(c => [c.id, c]))

    const comprasPorProduto = new Map<string, LinhaCompraBruta[]>()
    for (const r of compras) {
      const produtoId = produtoIdPorPar.get(`${r.fornecedor_codigo}|${r.item_codigo}`)
      if (!produtoId || !catalogoPorId.has(produtoId)) continue
      const lista = comprasPorProduto.get(produtoId) ?? []
      lista.push(r)
      comprasPorProduto.set(produtoId, lista)
    }

    const resultado: ProdutoEvolucao[] = []
    for (const [produtoId, lista] of comprasPorProduto) {
      if (lista.length < 2) continue
      const catalogo = catalogoPorId.get(produtoId)!
      const ordenadas = [...lista].sort((a, b) => (a.dt_emissao ?? "").localeCompare(b.dt_emissao ?? ""))

      let anterior: LinhaCompraBruta | null = null
      const comprasCalculadas: CompraProduto[] = ordenadas.map(r => {
        const custoUnitario = r.v_custo_compra
        let varPct: number | null = null
        let varAbs: number | null = null
        let trocouFornecedor = false
        if (anterior) {
          trocouFornecedor = anterior.fornecedor_codigo !== r.fornecedor_codigo
          if (custoUnitario != null && anterior.v_custo_compra != null && anterior.v_custo_compra !== 0) {
            varAbs = custoUnitario - anterior.v_custo_compra
            varPct = (varAbs / Math.abs(anterior.v_custo_compra)) * 100
          }
        }
        anterior = r
        return {
          data: r.dt_emissao,
          fornecedor: r.fornecedor_nome,
          nrDanfe: r.nr_danfe,
          chaveNfe: r.chave_nfe,
          custoUnitario,
          qtd: r.q_embalagem,
          varPct,
          varAbs,
          trocouFornecedor,
        }
      })

      const precos = comprasCalculadas.map(c => c.custoUnitario).filter((v): v is number => v != null)
      if (precos.length === 0) continue

      const ultima = comprasCalculadas[comprasCalculadas.length - 1]!
      resultado.push({
        produtoId,
        codigo: catalogo.codigo,
        nome: catalogo.nome,
        ncm: catalogo.ncm,
        unidade: catalogo.unidade_padrao,
        compras: comprasCalculadas,
        ultimaVarPct: ultima.varPct,
        ultimaVarAbs: ultima.varAbs,
        totalCompras: comprasCalculadas.length,
        precoAtual: ultima.custoUnitario,
        precoMinimo: Math.min(...precos),
        precoMaximo: Math.max(...precos),
        precoMedio: precos.reduce((s, v) => s + v, 0) / precos.length,
      })
    }

    return resultado
  } catch {
    return []
  }
}
