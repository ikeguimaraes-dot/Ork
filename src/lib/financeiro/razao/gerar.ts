import type { SupabaseClient } from "@supabase/supabase-js"
import { competenciaTitulo } from "@/lib/financeiro/dates"
import { applyBatch, replacement, type Mutation, type Row } from "@/lib/financeiro/db/atomic"
// Lógica pura de geração do razão — recebe o client Supabase como parâmetro
// em vez de criar o seu próprio, pra ser chamável tanto pela Server Action
// (src/app/financeiro/razao/actions.ts, que faz requireUser() +
// await createFinanceiroClient() por cima) quanto por scripts/regerar-razao.ts (CLI,
// sem sessão de app) — mesmo código nos dois casos, sem duplicar regra de
// classificação.
import { normalizeDescricao } from "@/lib/financeiro/normalizeDescricao"

import { unitRules } from "@/lib/instance";

export type GerarLancamentosResultado = { ok: boolean; inseridos: number; error?: string }

export async function fetchAllPaginado<T>(buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const pageSize = 1000
  const result: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    result.push(...page)
    if (page.length < pageSize) return result
  }
}

// "competencia" sempre chega como o primeiro dia do mês, ex. "2026-06-01".
function competenciaRange(competencia: string): { mes: number; ano: number; inicio: string; fim: string } {
  const ano = Number(competencia.slice(0, 4))
  const mes = Number(competencia.slice(5, 7))
  const inicio = `${competencia.slice(0, 7)}-01`
  const fim = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`
  return { mes, ano, inicio, fim }
}

// Replace the whole source/month, including records removed by a correction.
async function substituirOrigem(db: Pick<SupabaseClient, "rpc">, origem: string, unitId: string, competencia: string, rows: Row[]): Promise<void> {
  await applyBatch(db, replacement("lancamentos", { origem, unit_id: unitId, competencia }, rows))
}

// Projeta produtos_relatorio (compras por XML) em lançamentos de CMV.
// Classificação automática pelo capítulo do NCM (2 primeiros dígitos de
// tipo_item) contra plano_contas.ncm_capitulos — sem match cai em 9.99.
export async function gerarLancamentosNfeEntrada(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  unitId: string,
  competencia: string
): Promise<GerarLancamentosResultado> {
  try {
    const { mes, ano, inicio } = competenciaRange(competencia)

    const linhas = await fetchAllPaginado((from, to) =>
      db.from("produtos_relatorio")
        .select("chave_nfe,item_nfe,item_codigo,fornecedor_codigo,fornecedor_nome,tipo_item,dt_emissao,v_total_danfe,v_custo_total")
        .eq("unit_id", unitId)
        .eq("mes_lancamento", mes)
        .eq("ano_lancamento", ano)
        .eq("direcao_nfe", "entrada")
        .not("chave_nfe", "is", null)
        .range(from, to)
    ) as Array<{
      chave_nfe: string; item_nfe: number | null; item_codigo: string | null; fornecedor_codigo: string | null
      fornecedor_nome: string | null; tipo_item: string | null; dt_emissao: string | null
      v_total_danfe: number | null; v_custo_total: number | null
    }>

    // Bonificação (item de brinde/promocional) não é compra real.
    const validas = linhas.filter(r =>
      r.item_codigo && r.v_total_danfe !== 0 && r.v_total_danfe !== 0.01
    )

    const cnpjs = [...new Set(validas.map(r => r.fornecedor_codigo).filter((v): v is string => Boolean(v)))]
    const itemCodigos = [...new Set(validas.map(r => r.item_codigo!).filter(Boolean))]
    const produtoIdPorPar = new Map<string, string>()
    if (cnpjs.length > 0 && itemCodigos.length > 0) {
      const deparaRows = await fetchAllPaginado((from, to) =>
        db.from("produtos_depara")
          .select("fornecedor_cnpj,item_codigo,produto_id")
          .in("fornecedor_cnpj", cnpjs)
          .in("item_codigo", itemCodigos)
          .range(from, to)
      ) as Array<{ fornecedor_cnpj: string; item_codigo: string; produto_id: string | null }>
      for (const d of deparaRows) {
        if (d.produto_id) produtoIdPorPar.set(`${d.fornecedor_cnpj}|${d.item_codigo}`, d.produto_id)
      }
    }

    const planoContas = await fetchAllPaginado((from, to) =>
      db.from("plano_contas").select("codigo,ncm_capitulos").not("ncm_capitulos", "is", null).range(from, to)
    ) as Array<{ codigo: string; ncm_capitulos: string[] | null }>
    const capituloParaConta = new Map<string, string>()
    for (const p of planoContas) {
      for (const capitulo of p.ncm_capitulos ?? []) capituloParaConta.set(capitulo, p.codigo)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = validas.map(r => {
      const capitulo = r.tipo_item ? r.tipo_item.slice(0, 2) : null
      const contaCodigo = (capitulo && capituloParaConta.get(capitulo)) || "9.99"
      const par = r.fornecedor_codigo ? `${r.fornecedor_codigo}|${r.item_codigo}` : null
      return {
        unit_id: unitId,
        data: (r.dt_emissao ?? inicio).slice(0, 10),
        competencia: inicio,
        conta_codigo: contaCodigo,
        valor: Math.abs(Number(r.v_custo_total ?? 0)),
        origem: "nfe_entrada",
        origem_id: `${r.chave_nfe}:${r.item_nfe ?? r.item_codigo}`,
        descricao: null,
        fornecedor_cnpj: r.fornecedor_codigo,
        fornecedor_nome: r.fornecedor_nome,
        produto_id: par ? produtoIdPorPar.get(par) ?? null : null,
        reconciliado: false,
      }
    })

    await substituirOrigem(db, "nfe_entrada", unitId, inicio, rows)

    return { ok: true, inseridos: rows.length }
  } catch (e) {
    return { ok: false, inseridos: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

// Projeta receita_dias (+ receita_cancelamentos) em lançamentos de receita e
// dedução. Gorjeta é repasse, não receita — nenhum lançamento gerado pra ela.
// Taxa de cartão (2.02) fica de fora: receita_pagamentos só tem
// forma/valor_fechado/valor_recebido/diferenca, sem coluna de taxa — estimar
// seria inventar dado. As colunas custo/cmv_pct de receita_dias são
// ignoradas (inválidas: já vimos R$965 de custo pra R$441mil de receita) —
// a única fonte de CMV é a NF-e, via gerarLancamentosNfeEntrada.
export async function gerarLancamentosReceita(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  unitId: string,
  competencia: string
): Promise<GerarLancamentosResultado> {
  try {
    const contaReceita = (unitRules[unitId]?.revenueAccount ?? "1.01")
    if (!contaReceita) {
      return { ok: false, inseridos: 0, error: `Unidade ${unitId} sem canal de receita mapeado ` }
    }

    const { inicio, fim } = competenciaRange(competencia)

    const dias = await fetchAllPaginado((from, to) =>
      db.from("receita_dias")
        .select("id,data,receita_bruta,desconto")
        .eq("unit_id", unitId)
        .gte("data", inicio)
        .lt("data", fim)
        .range(from, to)
    ) as Array<{ id: string; data: string; receita_bruta: number | null; desconto: number | null }>

    const diaIds = dias.map(d => d.id)
    const cancelamentoPorDia = new Map<string, number>()
    if (diaIds.length > 0) {
      const cancelamentos = await fetchAllPaginado((from, to) =>
        db.from("receita_cancelamentos")
          .select("workday_id_fk,consumo")
          .in("workday_id_fk", diaIds)
          .range(from, to)
      ) as Array<{ workday_id_fk: string; consumo: number | null }>
      for (const c of cancelamentos) {
        cancelamentoPorDia.set(c.workday_id_fk, (cancelamentoPorDia.get(c.workday_id_fk) ?? 0) + Number(c.consumo ?? 0))
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = []
    for (const d of dias) {
      rows.push({
        unit_id: unitId,
        data: d.data,
        competencia: inicio,
        conta_codigo: contaReceita,
        valor: Math.abs(Number(d.receita_bruta ?? 0)),
        origem: "receita",
        origem_id: `${unitId}:${d.id}:bruta`,
        descricao: "Receita bruta do dia",
        fornecedor_cnpj: null,
        fornecedor_nome: null,
        produto_id: null,
        reconciliado: false,
      })

      const deducao = Number(d.desconto ?? 0) + (cancelamentoPorDia.get(d.id) ?? 0)
      if (deducao > 0) {
        rows.push({
          unit_id: unitId,
          data: d.data,
          competencia: inicio,
          conta_codigo: "2.01",
          valor: deducao,
          origem: "receita",
          origem_id: `${unitId}:${d.id}:deducao`,
          descricao: "Descontos e cancelamentos do dia",
          fornecedor_cnpj: null,
          fornecedor_nome: null,
          produto_id: null,
          reconciliado: false,
        })
      }
    }

    await substituirOrigem(db, "receita", unitId, inicio, rows)

    return { ok: true, inseridos: rows.length }
  } catch (e) {
    return { ok: false, inseridos: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Similaridade de nome (bigramas) — mesmo princípio do catálogo de
// produtos (FASE 2), só pra sugerir, nunca pra decidir sozinha ────────────

function bigramas(s: string): Set<string> {
  const norm = normalizeDescricao(s)
  const set = new Set<string>()
  for (let i = 0; i < norm.length - 1; i++) set.add(norm.slice(i, i + 2))
  return set
}

export function similaridadeNome(a: string, b: string): number {
  const setA = bigramas(a)
  const setB = bigramas(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let intersecao = 0
  for (const bg of setA) if (setB.has(bg)) intersecao++
  return (2 * intersecao) / (setA.size + setB.size)
}

// Projeta titulos_a_pagar em lançamentos de despesa. NÃO faz dedup
// automático contra NF-e: titulos_a_pagar.cnpj_cpf_fornecedor está 100%
// nulo (confirmado nas 2.000 linhas), então uma correspondência por CNPJ
// exato — a única forma seguramente confiável — não existe aqui. Casar por
// nome livre é arriscado: falso positivo apaga uma despesa real e ninguém
// percebe. Em vez disso, toda candidata plausível (mesmo valor ±1%, mesma
// data ±5 dias) vai pra reconciliacoes_sugeridas como sugestão — um humano
// confirma na tela da Fase 7. Só título com sugestão status='confirmada'
// deixa de gerar lançamento aqui.
export async function gerarLancamentosTitulos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  unitId: string,
  competencia: string
): Promise<GerarLancamentosResultado> {
  try {
    const { inicio } = competenciaRange(competencia)

    // Candidatas a NF-e: nfe_documentos (nível de nota) da mesma unidade,
    // entrada, todo o histórico — o match é por NÚMERO exato, não por
    // proximidade de data. Buscado ANTES dos títulos porque agora também
    // decide a competência de cada título (ver resolverCompetencia).
    const notasCandidatas = await fetchAllPaginado((from, to) =>
      db.from("nfe_documentos")
        .select("chave,numero,emitente_nome,valor_total,emissao")
        .eq("unit_id", unitId)
        .eq("direcao", "entrada")
        .eq("cancelada", false)
        .not("numero", "is", null)
        .range(from, to)
    ) as Array<{ chave: string; numero: string | null; emitente_nome: string | null; valor_total: number; emissao: string | null }>
    const notasPorNumero = new Map<string, typeof notasCandidatas>()
    for (const nota of notasCandidatas) {
      const arr = notasPorNumero.get(nota.numero!) ?? []
      arr.push(nota)
      notasPorNumero.set(nota.numero!, arr)
    }

    // FASE 7 CORREÇÃO 2: titulos_a_pagar.d_competencia é derivado do
    // vencimento na origem (na compra parcelada, do vencimento da 2ª
    // parcela) — sistematicamente um mês depois da entrada real da
    // mercadoria. Competência de compra é quando a mercadoria ENTROU, não
    // quando se paga; a projeção (não a fonte) decide isso, em ordem de
    // precedência: (1) emissão da NF-e, quando o nº do título casa com uma
    // nota no banco; (2) d_lancamento (entrada na planilha); (3)
    // d_vencimento, só como último recurso. d_competencia nunca é lido
    // aqui — a fonte guarda o que a planilha disse, o razão decide a
    // competência.
    // FASE 7 PASSO 5: fonte é titulos_a_pagar origem in (nf_pedidos,
    // contas_pagar) — a origem antiga ('PLANILHA ORK', ~2.000 linhas de
    // fonte desconhecida) é ignorada por design, não só por estar apagada.
    // Sem filtro de data aqui — a competência de cada título só se sabe
    // depois de resolverCompetencia(), então busca-se TUDO da unidade e
    // filtra-se em memória.
    const todosOsTitulos = await fetchAllPaginado((from, to) =>
      db.from("titulos_a_pagar")
        .select("id,fantasia_fornecedor,razao_fornecedor,cnpj_cpf_fornecedor,c_gerencial,descricao_c_gerencial,v_titulo,valor_total_nf_origem,d_competencia,d_vencimento,d_lancamento,n_nota_fiscal,origem")
        .eq("unit_id", unitId)
        .in("origem", ["nf_pedidos", "contas_pagar"])
        .range(from, to)
    ) as Array<{
      id: string; fantasia_fornecedor: string | null; razao_fornecedor: string | null
      cnpj_cpf_fornecedor: string | null; c_gerencial: string | null; descricao_c_gerencial: string | null
      v_titulo: number | null; valor_total_nf_origem: number | null
      d_competencia: string | null; d_vencimento: string | null; d_lancamento: string | null
      n_nota_fiscal: string | null; origem: string
    }>
    const titulos = todosOsTitulos.filter((t) => competenciaTitulo(t) === inicio)


    // ENCARGO FOLHA/RESCISAO/FERIAS na planilha de compras são o pagamento
    // de um custo que o extrato Domínio já registra por rubrica (9.98,
    // fora de KPI — ver migration) — MAS só quando o extrato existe. Sem
    // ele, o título é a única evidência do custo e tem que contar em
    // mao_de_obra normalmente (caso do Restaurante maio, sem extrato ainda).
    const comp = competencia.slice(0, 7) // "YYYY-MM", mesmo formato de payroll_extrato_dominio_*
    const { data: folhaProbe, error: folhaProbeError } = await db
      .from("payroll_extrato_dominio_linha")
      .select("cod_colaborador").eq("unit_id", unitId).eq("competencia", comp).limit(1)
    if (folhaProbeError) throw new Error(folhaProbeError.message)
    const temFolhaExtrato = (folhaProbe?.length ?? 0) > 0
    const FALLBACK_MAO_DE_OBRA: Record<string, string> = {
      "ENCARGO FOLHA": "4.02", RESCISAO: "4.05", FERIAS: "4.06",
    }

    // Regras: categoria_gerencial (match exato contra c_gerencial) tem
    // prioridade — é a classificação real das planilhas novas. Os tipos
    // fuzzy antigos (cnpj/nome/descrição) seguem como fallback pra título
    // sem categoria.
    const TIPO_RANK: Record<string, number> = { categoria_gerencial: -1, fornecedor_cnpj: 0, fornecedor_nome: 1, descricao_contem: 2 }
    const regras = (await fetchAllPaginado((from, to) =>
      db.from("regras_classificacao")
        .select("unit_id,tipo,padrao,conta_codigo,prioridade")
        .or(`unit_id.is.null,unit_id.eq.${unitId}`)
        .range(from, to)
    ) as Array<{ unit_id: string | null; tipo: string; padrao: string; conta_codigo: string; prioridade: number }>)
      .sort((a, b) => ((TIPO_RANK[a.tipo] ?? 99) - (TIPO_RANK[b.tipo] ?? 99)) || (a.prioridade - b.prioridade))

    function classificar(t: typeof titulos[number]): string {
      const nome = (t.fantasia_fornecedor ?? t.razao_fornecedor ?? "").toUpperCase()
      const categoria = (t.c_gerencial ?? "").toUpperCase()
      for (const r of regras) {
        const padrao = r.padrao.toUpperCase()
        if (r.tipo === "categoria_gerencial" && categoria && categoria === padrao) return r.conta_codigo
        if (r.tipo === "fornecedor_cnpj" && t.cnpj_cpf_fornecedor && t.cnpj_cpf_fornecedor === r.padrao) return r.conta_codigo
        if (r.tipo === "fornecedor_nome" && nome && nome.includes(padrao)) return r.conta_codigo
        if (r.tipo === "descricao_contem" && nome && nome.includes(padrao)) return r.conta_codigo
      }
      return "9.99"
    }

    // nfe_documentos não tem coluna de competência (só "emissao", a data
    // real da nota); a competência RECONHECIDA internamente pro match
    // título↔NF-e é a de produtos_relatorio (mes_lancamento/ano_lancamento,
    // mesma fonte usada em gerarLancamentosNfeEntrada). Sem esse
    // cruzamento, duas notas com o mesmo número em meses diferentes (ex.
    // maio e junho) colidiam. notasCandidatas/notasPorNumero já foram
    // buscados no topo da função.
    const produtosCompetencia = await fetchAllPaginado((from, to) =>
      db.from("produtos_relatorio")
        .select("chave_nfe,mes_lancamento,ano_lancamento")
        .eq("unit_id", unitId)
        .not("chave_nfe", "is", null)
        .range(from, to)
    ) as Array<{ chave_nfe: string; mes_lancamento: number; ano_lancamento: number }>
    const competenciaPorChave = new Map<string, string>()
    for (const p of produtosCompetencia) {
      competenciaPorChave.set(p.chave_nfe, `${p.ano_lancamento}-${String(p.mes_lancamento).padStart(2, "0")}-01`)
    }

    // Match título↔NF-e passa a ser por fornecedor_id (catálogo de
    // fornecedores), exato — nunca mais por similaridade de nome. "TREZE DE
    // MAIO" (título) e "TREZE DE MAIO COMERCIO DE HORTIFRUTIGRANJEIROS LTDA"
    // (NF-e) só casam porque fornecedores_depara já resolveu os dois pro
    // mesmo fornecedor_id — gerarFornecedoresAutomatico() faz essa ligação
    // fora do caminho crítico. Nome sem vínculo no catálogo simplesmente não
    // casa com nada (mesmo comportamento de "não encontrou XML").
    const deparaRows = await fetchAllPaginado((from, to) =>
      db.from("fornecedores_depara").select("nome_origem,origem,fornecedor_id").range(from, to)
    ) as Array<{ nome_origem: string; origem: "nfe" | "titulo"; fornecedor_id: string }>
    const fornecedorIdPorNomeTitulo = new Map(
      deparaRows.filter((d) => d.origem === "titulo").map((d) => [d.nome_origem, d.fornecedor_id])
    )
    const fornecedorIdPorNomeNfe = new Map(
      deparaRows.filter((d) => d.origem === "nfe").map((d) => [d.nome_origem, d.fornecedor_id])
    )
    // fornecedores_depara.nome_origem é sempre upper+trim — a chave de
    // busca precisa da mesma normalização, não o nome literal da fonte.
    const fornecedorIdPorChaveNota = new Map<string, string>()
    for (const nota of notasCandidatas) {
      const fornecedorId = fornecedorIdPorNomeNfe.get((nota.emitente_nome ?? "").toUpperCase().trim())
      if (fornecedorId) fornecedorIdPorChaveNota.set(nota.chave, fornecedorId)
    }

    // ALIMENTOS/BEBIDAS de contas_pagar só é descartado (já vem por
    // NF_PEDIDOS) quando a unidade realmente TEM NF_PEDIDOS naquela
    // competência — a UNIDADE não tem planilha de NF_PEDIDOS nenhuma, então
    // esse descarte incondicional zerava seu CMV inteiro. Carregado uma
    // vez por execução, não por título.
    const nfPedidosRows = await fetchAllPaginado((from, to) =>
      db.from("titulos_a_pagar")
        .select("unit_id,d_competencia")
        .eq("origem", "nf_pedidos")
        .range(from, to)
    ) as Array<{ unit_id: string; d_competencia: string | null }>
    const competenciasComNfPedidos = new Set(
      nfPedidosRows.filter(r => r.d_competencia).map(r => `${r.unit_id}|${r.d_competencia}`)
    )
    const temNfPedidosEstaCompetencia = competenciasComNfPedidos.has(`${unitId}|${inicio}`)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lancamentosRows: any[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sugestoesRows: any[] = []

    type Titulo = typeof titulos[number]

    function valorTitulo(t: Titulo): number {
      return Math.abs(Number(t.v_titulo ?? 0))
    }

    function contaParaTitulo(t: Titulo): string {
      const categoria = (t.c_gerencial ?? "").toUpperCase()
      return !temFolhaExtrato && FALLBACK_MAO_DE_OBRA[categoria]
        ? FALLBACK_MAO_DE_OBRA[categoria]
        : classificar(t)
    }

    function gerarLancamento(t: Titulo): void {
      const nomeFornecedor = t.fantasia_fornecedor ?? t.razao_fornecedor ?? null
      const dataTitulo = t.d_vencimento ?? t.d_lancamento ?? inicio
      lancamentosRows.push({
        unit_id: unitId,
        data: dataTitulo,
        competencia: inicio,
        conta_codigo: contaParaTitulo(t),
        valor: valorTitulo(t),
        origem: "titulo",
        origem_id: t.id,
        descricao: t.descricao_c_gerencial,
        fornecedor_cnpj: t.cnpj_cpf_fornecedor,
        fornecedor_nome: nomeFornecedor,
        produto_id: null,
        reconciliado: false,
      })
    }

    // CONTAS_A_PAGAR duplica ALIMENTOS/BEBIDAS que já vêm por NF_PEDIDOS
    // (mesma compra, dois ângulos) — ignora pra não contar duas vezes, MAS
    // só quando a unidade tem NF_PEDIDOS pra cobrir (ver Set acima). Sem
    // NF_PEDIDOS, contas_pagar é a ÚNICA fonte de CMV — descartar
    // incondicionalmente zerava o CMV de quem não tem essa planilha.
    const titulosProcessaveis = titulos.filter((t) => {
      const categoria = (t.c_gerencial ?? "").toUpperCase()
      return !(t.origem === "contas_pagar" && (categoria === "ALIMENTOS" || categoria === "BEBIDAS") && temNfPedidosEstaCompetencia)
    })

    // Agrupa por (fornecedor_id, número da nota) — a nota pode vir parcelada
    // em várias linhas de título (2P. X 1/2, 2P. X 2/2, ...) e nenhuma
    // parcela sozinha bate ±2% contra o valor cheio da nota. O match tem que
    // ser da NOTA (soma das parcelas) contra a NF-e — se casar, NENHUMA
    // parcela do grupo gera lançamento; se não casar, TODAS geram. Título
    // sem fornecedor_id resolvido no catálogo nunca casa — cai direto no
    // "não achou XML", igual a título sem número.
    const gruposComNumero = new Map<string, Titulo[]>()
    const titulosSemMatchPossivel: Array<{ titulo: Titulo; nNota: string | null }> = []
    for (const t of titulosProcessaveis) {
      if (!t.n_nota_fiscal) { titulosSemMatchPossivel.push({ titulo: t, nNota: null }); continue }
      const fornecedorId = fornecedorIdPorNomeTitulo.get((t.fantasia_fornecedor ?? t.razao_fornecedor ?? "").toUpperCase().trim())
      if (!fornecedorId) { titulosSemMatchPossivel.push({ titulo: t, nNota: t.n_nota_fiscal }); continue }
      const chave = `${fornecedorId}|${t.n_nota_fiscal}`
      const arr = gruposComNumero.get(chave) ?? []
      arr.push(t)
      gruposComNumero.set(chave, arr)
    }

    for (const { titulo: t, nNota } of titulosSemMatchPossivel) {
      gerarLancamento(t)
      if (nNota) {
        sugestoesRows.push({
          unit_id: unitId, competencia: inicio, titulo_id: t.id, chave_nfe: `SEM_XML:${nNota}`,
          score: 0, valor_titulo: valorTitulo(t), valor_nfe: 0, dias_diferenca: 0, status: "sem_xml",
        })
      }
    }

    for (const membros of gruposComNumero.values()) {
      const primeiro = membros[0]!
      const nNota = primeiro.n_nota_fiscal!
      const fornecedorId = fornecedorIdPorNomeTitulo.get((primeiro.fantasia_fornecedor ?? primeiro.razao_fornecedor ?? "").toUpperCase().trim())!

      // valor_total_nf_origem é o valor CHEIO da nota, repetido em toda
      // parcela — usa ele quando existir (uma vez, não somado — já é o
      // total). Some as parcelas (v_titulo) só cobre linha sem esse campo.
      const valorTotalOrigem = membros.map((m) => m.valor_total_nf_origem).find((v): v is number => v != null)
      const valorGrupo = valorTotalOrigem ?? membros.reduce((s, m) => s + valorTitulo(m), 0)

      // Dedup: mesmo fornecedor_id (catálogo, exato) + número de NF + valor
      // ±2% + mesma competência → já foi gerado via XML (com detalhe por
      // item) — não duplica. Sem a competência bater, número igual em mês
      // diferente não é a mesma compra.
      let matchConfirmado: { chave: string; diffValor: number; valorNfe: number } | null = null
      const candidatas = notasPorNumero.get(nNota) ?? []
      for (const nota of candidatas) {
        if (fornecedorIdPorChaveNota.get(nota.chave) !== fornecedorId) continue
        if (competenciaPorChave.get(nota.chave) !== inicio) continue
        const diffValor = Math.abs(nota.valor_total - valorGrupo) / Math.max(valorGrupo, 0.01)
        if (diffValor > 0.02) continue
        if (!matchConfirmado || diffValor < matchConfirmado.diffValor) {
          matchConfirmado = { chave: nota.chave, diffValor, valorNfe: nota.valor_total }
        }
      }

      if (matchConfirmado) {
        for (const t of membros) {
          sugestoesRows.push({
            unit_id: unitId, competencia: inicio, titulo_id: t.id, chave_nfe: matchConfirmado.chave,
            score: Math.round((1 - matchConfirmado.diffValor) * 100) / 100,
            valor_titulo: valorTitulo(t), valor_nfe: matchConfirmado.valorNfe,
            dias_diferenca: 0, status: "confirmada",
          })
        }
        continue // nota inteira já coberta pelo XML — nenhuma parcela gera lançamento
      }

      // Não casou: todas as parcelas geram lançamento. Tinha número de nota
      // mas não achou XML correspondente — a nota existe, só falta
      // importar o XML. Sinaliza pro Ike.
      for (const t of membros) {
        gerarLancamento(t)
        sugestoesRows.push({
          unit_id: unitId, competencia: inicio, titulo_id: t.id, chave_nfe: `SEM_XML:${nNota}`,
          score: 0, valor_titulo: valorTitulo(t), valor_nfe: 0, dias_diferenca: 0, status: "sem_xml",
        })
      }
    }

    const operations: Mutation[] = replacement("lancamentos", { origem: "titulo", unit_id: unitId, competencia: inicio }, lancamentosRows)
    for (const status of ["confirmada", "sem_xml"]) operations.push({ table: "reconciliacoes_sugeridas", operation: "delete", scope: { unit_id: unitId, competencia: inicio, status } })
    if (sugestoesRows.length) operations.push({ table: "reconciliacoes_sugeridas", operation: "upsert", rows: sugestoesRows, conflict: "titulo_id,chave_nfe", ignoreDuplicates: true })
    await applyBatch(db, operations)

    return { ok: true, inseridos: lancamentosRows.length }
  } catch (e) {
    return { ok: false, inseridos: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

// Classificação de rubrica PROVENTO → conta, dada pelo Ike a partir dos
// extratos reais Domínio (UNIDADE Restaurantes e Unidade delivery, jun-ago/2026).
// Qualquer rubrica de provento fora desta lista cai em 9.99 (reportado, não
// bloqueia). Rubricas de DESCONTO nunca geram lançamento — são retenção
// sobre o bruto ou movimentação de líquido, não custo adicional — exceto a
// 843 (INSS EMPREGADOR: INSS patronal sobre pró-labore do diretor, é custo
// real da empresa apesar de aparecer como "D" no extrato).
const RUBRICA_PARA_CONTA: Record<number, string> = {
  // 4.01 Salários
  8781: "4.01", 9180: "4.01", 19: "4.01", 8870: "4.01", 200: "4.01",
  434: "4.01", 458: "4.01", 626: "4.01", 250: "4.01", 854: "4.01",
  8125: "4.01", 204: "4.01", 990: "4.01", 8130: "4.01", 9755: "4.01",
  // 4.06 Férias e 13º
  29: "4.06", 931: "4.06", 805: "4.06", 806: "4.06", 815: "4.06",
  816: "4.06", 8783: "4.06", 8169: "4.06", 940: "4.06", 8112: "4.06",
  8189: "4.06", 8550: "4.06", 8551: "4.06", 8552: "4.06",
  // 4.07 Pró-labore
  100: "4.07",
}
const RUBRICA_DESCONTO_ENCARGO = 843 // INSS EMPREGADOR — única DESCONTO que gera lançamento (4.02)

// Projeta payroll_extrato_dominio_linha (+ FGTS do rodapé de
// payroll_extrato_dominio_competencia) em lançamentos de mão de obra.
// Fonte EXCLUSIVA — nunca lê dre_folha (dado cross-wired entre unidades,
// substituído nesta fase). Classifica estritamente por código de rubrica.
export async function gerarLancamentosFolha(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  unitId: string,
  competencia: string
): Promise<GerarLancamentosResultado> {
  try {
    const comp = competencia.slice(0, 7) // payroll_extrato_dominio_* usa texto "YYYY-MM"
    const { inicio } = competenciaRange(competencia)

    const linhas = await fetchAllPaginado((from, to) =>
      db.from("payroll_extrato_dominio_linha")
        .select("cod_colaborador,rubrica_codigo,natureza,valor")
        .eq("unit_id", unitId)
        .eq("competencia", comp)
        .range(from, to)
    ) as Array<{ cod_colaborador: number; rubrica_codigo: number; natureza: string; valor: number }>

    const { data: competenciaRow, error: competenciaError } = await db
      .from("payroll_extrato_dominio_competencia")
      .select("valor_fgts,valor_fgts_rescisorio")
      .eq("unit_id", unitId)
      .eq("competencia", comp)
      .maybeSingle()
    if (competenciaError) throw new Error(competenciaError.message)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = []
    for (const l of linhas) {
      const valor = Math.abs(Number(l.valor ?? 0))
      if (valor === 0) continue

      const contaCodigo = l.natureza === "DESCONTO"
        ? (l.rubrica_codigo === RUBRICA_DESCONTO_ENCARGO ? "4.02" : null)
        : (RUBRICA_PARA_CONTA[l.rubrica_codigo] ?? "9.99")
      if (!contaCodigo) continue // desconto que não é 843: retenção/movimentação, não gera lançamento

      rows.push({
        unit_id: unitId,
        data: inicio,
        competencia: inicio,
        conta_codigo: contaCodigo,
        valor,
        origem: "folha",
        // origem_id precisa ser único por (origem, conta_codigo) globalmente —
        // cod_colaborador é um inteiro pequeno atribuído por empresa no
        // Domínio, colide entre unidades sem o prefixo unitId.
        origem_id: `${unitId}:${comp}:${l.cod_colaborador}:${l.rubrica_codigo}`,
        descricao: `Rubrica ${l.rubrica_codigo}`,
        fornecedor_cnpj: null,
        fornecedor_nome: null,
        produto_id: null,
        reconciliado: false,
      })
    }

    const valorFgts = Number(competenciaRow?.valor_fgts ?? 0)
    if (valorFgts > 0) {
      rows.push({
        unit_id: unitId, data: inicio, competencia: inicio, conta_codigo: "4.02",
        valor: valorFgts, origem: "folha", origem_id: `${unitId}:${comp}:FGTS`,
        descricao: "FGTS do mês", fornecedor_cnpj: null, fornecedor_nome: null,
        produto_id: null, reconciliado: false,
      })
    }
    const valorFgtsRescisorio = Number(competenciaRow?.valor_fgts_rescisorio ?? 0)
    if (valorFgtsRescisorio > 0) {
      rows.push({
        unit_id: unitId, data: inicio, competencia: inicio, conta_codigo: "4.02",
        valor: valorFgtsRescisorio, origem: "folha", origem_id: `${unitId}:${comp}:FGTS_RESC`,
        descricao: "FGTS rescisório", fornecedor_cnpj: null, fornecedor_nome: null,
        produto_id: null, reconciliado: false,
      })
    }

    await substituirOrigem(db, "folha", unitId, inicio, rows)

    return { ok: true, inseridos: rows.length }
  } catch (e) {
    return { ok: false, inseridos: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

const KPIS_COM_META_BASELINE = [
  "receita_liquida", "cmv_compras_pct", "mo_pct", "prime_cost_pct", "ebitda_pct", "clientes", "ticket_medio",
] as const

export type SnapshotResultado = { ok: boolean; error?: string }

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function gravarMetasBaseline(db: any, unitId: string, competencia: string): Promise<void> {
  const [ano, mes] = competencia.split("-").map(Number)
  const competenciasAnteriores: string[] = []
  for (let i = 1; i <= 3; i++) {
    const m = mes! - i
    const anoAjustado = m <= 0 ? ano! - 1 : ano!
    const mesAjustado = ((m - 1 + 12) % 12) + 1
    competenciasAnteriores.push(`${anoAjustado}-${String(mesAjustado).padStart(2, "0")}-01`)
  }

  const anteriores = await fetchAllPaginado((from, to) =>
    db.from("kpi_snapshot")
      .select(KPIS_COM_META_BASELINE.join(","))
      .eq("unit_id", unitId)
      .in("competencia", competenciasAnteriores)
      .range(from, to)
  ) as Array<Record<string, number | null>>

  const metasExistentes = await fetchAllPaginado((from, to) =>
    db.from("metas").select("chave,origem")
      .eq("unit_id", unitId).eq("competencia", competencia)
      .range(from, to)
  ) as Array<{ chave: string; origem: string }>
  const jaTemMetaManual = new Set(metasExistentes.filter(m => m.origem === "manual").map(m => m.chave))

  const rows = KPIS_COM_META_BASELINE
    .filter(chave => !jaTemMetaManual.has(chave))
    .map(chave => {
      const valores = anteriores.map(a => a[chave]).filter((v): v is number => v != null)
      if (valores.length === 0) return null
      const media = valores.reduce((s, v) => s + v, 0) / valores.length
      return {
        unit_id: unitId, competencia, chave,
        valor: round2(media), tipo: "absoluto", origem: "baseline",
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (rows.length > 0) {
    await applyBatch(db, [{ table: "metas", operation: "upsert", rows, conflict: "unit_id,competencia,chave" }])
  }
}

// Agrega lancamentos → dre_snapshot (por conta) e kpi_snapshot (por unidade
// e competência). Sempre delete+insert do escopo — é projeção, não dado
// digitado, então rodar de novo depois de mudar uma regra de classificação
// (ou de reprocessar o razão) sempre reflete o estado atual.
export async function recalcularSnapshot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  unitId: string,
  competencia: string,
  projected?: Array<{ conta_codigo: string; valor: number; origem: string; origem_id: string }>
): Promise<SnapshotResultado> {
  try {
    const { inicio, fim } = competenciaRange(competencia)

    const planoContas = await fetchAllPaginado((from, to) =>
      db.from("plano_contas").select("codigo,grupo").range(from, to)
    ) as Array<{ codigo: string; grupo: string }>
    const grupoPorConta = new Map(planoContas.map(p => [p.codigo, p.grupo]))

    const lancamentos = projected ?? await fetchAllPaginado((from, to) =>
      db.from("lancamentos").select("conta_codigo,valor,origem,origem_id")
        .eq("unit_id", unitId).eq("competencia", inicio)
        .range(from, to)
    ) as Array<{ conta_codigo: string; valor: number; origem: string; origem_id: string }>

    // ── dre_snapshot: soma por conta ──────────────────────────────────────
    const porConta = new Map<string, { valor: number; qtd: number }>()
    for (const l of lancamentos) {
      const cur = porConta.get(l.conta_codigo) ?? { valor: 0, qtd: 0 }
      cur.valor += Number(l.valor)
      cur.qtd += 1
      porConta.set(l.conta_codigo, cur)
    }

    const dreRows = [...porConta.entries()].map(([conta_codigo, v]) => ({
      unit_id: unitId, competencia: inicio, conta_codigo,
      valor: round2(v.valor), qtd_lancamentos: v.qtd,
    }))

    // ── KPIs ────────────────────────────────────────────────────────────
    let receitaBruta = 0, deducao = 0, cmv = 0, maoDeObra = 0, despesaOp = 0
    let financeiro = 0, impostoLucro = 0
    let valor999 = 0, valorTotal = 0
    for (const [conta, v] of porConta) {
      valorTotal += v.valor
      if (conta === "9.99") valor999 += v.valor
      switch (grupoPorConta.get(conta)) {
        case "receita": receitaBruta += v.valor; break
        case "deducao": deducao += v.valor; break
        case "cmv": cmv += v.valor; break
        case "mao_de_obra": maoDeObra += v.valor; break
        case "despesa_operacional": despesaOp += v.valor; break
        case "financeiro": financeiro += v.valor; break
        // imposto_lucro (IRPJ/CSLL) fica de fora do EBITDA e da receita
        // líquida — é imposto sobre o lucro, não dedução de venda. Some só
        // em resultado_liquido, abaixo do EBITDA.
        case "imposto_lucro": impostoLucro += v.valor; break
      }
    }
    const receitaLiquida = receitaBruta - deducao
    const ebitda = receitaLiquida - cmv - maoDeObra - despesaOp
    const resultadoLiquido = ebitda - financeiro - impostoLucro
    const pct = (v: number): number | null => (receitaLiquida > 0 ? v / receitaLiquida : null)
    const temNfe = lancamentos.some(l => l.origem === "nfe_entrada")
    const temFolha = lancamentos.some(l => l.origem === "folha")

    const dias = await fetchAllPaginado((from, to) =>
      db.from("receita_dias").select("clientes")
        .eq("unit_id", unitId).gte("data", inicio).lt("data", fim)
        .range(from, to)
    ) as Array<{ clientes: number | null }>
    const clientes = dias.length > 0 ? dias.reduce((s, d) => s + (d.clientes ?? 0), 0) : null
    // Ticket médio do mês = receita bruta total / clientes totais — evita
    // média de médias diárias, que distorce quando os dias têm volumes bem
    // diferentes.
    const ticketMedio = clientes && clientes > 0 ? receitaBruta / clientes : null
    const cmvPorCliente = clientes && clientes > 0 ? cmv / clientes : null

    const pctClassificado = valorTotal > 0 ? 1 - valor999 / valorTotal : null

    // v_fonte_saude não tem coluna de unidade — é uma leitura global de
    // saúde das fontes de dado, a mesma pras duas units até essa view
    // ganhar um recorte por unidade.
    const fontes = await fetchAllPaginado((from, to) =>
      db.from("v_fonte_saude").select("status_fonte").range(from, to)
    ) as Array<{ status_fonte: string }>
    const fontesTotal = fontes.length
    const fontesOk = fontes.filter(f => f.status_fonte === "viva").length

    // Terceiro termo: cobertura de XML dentro do próprio CMV do mês. Sem
    // ele, confianca_pct não reagia à ausência de NF-e (maio, zero XML,
    // saía com a mesma confiança de junho, com 543 notas) — os outros dois
    // termos (classificação de conta, saúde global das fontes) não olham
    // pra isso.
    const cmvComXml = lancamentos
      .filter(l => grupoPorConta.get(l.conta_codigo) === "cmv" && l.origem === "nfe_entrada")
      .reduce((s, l) => s + Number(l.valor), 0)
    const pctCompraComXml = cmv > 0 ? cmvComXml / cmv : null

    const confiancaPct = pctClassificado != null && fontesTotal > 0 && pctCompraComXml != null
      ? 0.4 * pctClassificado + 0.3 * (fontesOk / fontesTotal) + 0.3 * pctCompraComXml
      : null

    // possivel_dupla_contagem: Σ valor dos lançamentos de título desta
    // competência cuja sugestão de reconciliação ainda está pendente.
    const sugestoesPendentes = await fetchAllPaginado((from, to) =>
      db.from("reconciliacoes_sugeridas").select("titulo_id")
        .eq("unit_id", unitId).eq("status", "sugerida")
        .range(from, to)
    ) as Array<{ titulo_id: string }>
    const titulosPendentes = new Set(sugestoesPendentes.map(s => s.titulo_id))
    const possivelDuplaContagem = lancamentos
      .filter(l => l.origem === "titulo" && titulosPendentes.has(l.origem_id))
      .reduce((s, l) => s + Number(l.valor), 0)

    const kpiRow = {
      unit_id: unitId,
      competencia: inicio,
      receita_bruta: round2(receitaBruta),
      receita_liquida: round2(receitaLiquida),
      cmv_compras: round2(cmv),
      mao_de_obra: round2(maoDeObra),
      despesas_operacionais: round2(despesaOp),
      ebitda: round2(ebitda),
      resultado_liquido: round2(resultadoLiquido),
      cmv_compras_pct: pct(cmv),
      mo_pct: pct(maoDeObra),
      prime_cost_pct: pct(cmv + maoDeObra),
      ebitda_pct: pct(ebitda),
      clientes,
      ticket_medio: ticketMedio != null ? round2(ticketMedio) : null,
      cmv_por_cliente: cmvPorCliente != null ? round2(cmvPorCliente) : null,
      tem_nfe: temNfe,
      tem_folha: temFolha,
      pct_classificado: pctClassificado,
      fontes_ok: fontesOk,
      fontes_total: fontesTotal,
      pct_compra_com_xml: pctCompraComXml,
      confianca_pct: confiancaPct,
      possivel_dupla_contagem: round2(possivelDuplaContagem),
    }

    await applyBatch(db, [
      ...replacement("dre_snapshot", { unit_id: unitId, competencia: inicio }, dreRows),
      { table: "kpi_snapshot", operation: "upsert", rows: [kpiRow], conflict: "unit_id,competencia" },
    ])

    await gravarMetasBaseline(db, unitId, inicio)

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export type GerarRazaoResultado = {
  ok: boolean
  nfeEntrada: GerarLancamentosResultado
  titulos: GerarLancamentosResultado
  folha: GerarLancamentosResultado
  receita: GerarLancamentosResultado
  snapshot: SnapshotResultado
  error?: string
}

// Roda as quatro projeções pra uma unidade/competência, nessa ordem —
// títulos depois de NF-e não importa pra dedup (isso agora é sugestão, não
// exclusão automática), mas mantém a ordem estável do pedido original —
// depois recalcula o snapshot.
export async function gerarRazao(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  unitId: string,
  competencia: string
): Promise<GerarRazaoResultado> {
  const operations: Mutation[] = []
  const staged = {
    from: db.from.bind(db),
    rpc: async (_name: string, args: { p_operations: Mutation[] }) => {
      operations.push(...args.p_operations)
      return { error: null }
    },
  }
  const { data: state, error: stateError } = await db.from("financeiro_revisoes").select("revisao").eq("unit_id", unitId).maybeSingle()
  if (stateError) throw new Error(stateError.message)
  const revision = Number(state?.revisao ?? 0)
  const nfeEntrada = await gerarLancamentosNfeEntrada(staged, unitId, competencia)
  const titulos = await gerarLancamentosTitulos(staged, unitId, competencia)
  const folha = await gerarLancamentosFolha(staged, unitId, competencia)
  const receita = await gerarLancamentosReceita(staged, unitId, competencia)
  let snapshot: SnapshotResultado = { ok: false, error: "Indicadores não atualizados: uma das fontes falhou." }
  if (nfeEntrada.ok && titulos.ok && folha.ok && receita.ok) {
    const manual = await fetchAllPaginado((from, to) => db.from("lancamentos").select("conta_codigo,valor,origem,origem_id").eq("unit_id", unitId).eq("competencia", competencia).in("origem", ["manual", "inventario"]).range(from, to))
    const projected = [...manual, ...operations.filter(op => op.table === "lancamentos" && op.operation === "insert").flatMap(op => op.rows ?? [])]
    snapshot = await recalcularSnapshot(staged, unitId, competencia, projected as Array<{ conta_codigo: string; valor: number; origem: string; origem_id: string }>)
    if (snapshot.ok) {
      for (const op of operations) if (op.table === "kpi_snapshot") op.rows?.forEach(row => { row.revisao_fonte = revision })
      const { error } = await db.rpc("financeiro_aplicar_lote", { p_operations: operations, p_expected: { unit_id: unitId, revisao: revision } })
      if (error) snapshot = { ok: false, error: error.message }
    }
  }
  const ok = nfeEntrada.ok && titulos.ok && folha.ok && receita.ok && snapshot.ok
  return { ok, nfeEntrada, titulos, folha, receita, snapshot }
}
