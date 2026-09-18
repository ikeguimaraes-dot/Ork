// Catálogo de fornecedores — mesmo princípio de produtos_catalogo/produtos_depara
// (sql/027_catalogo_produtos.sql): um fornecedor canônico com um de-para de
// nomes de origem (NF-e e planilha de compras divergem: "TREZE DE MAIO" vs
// "TREZE DE MAIO COMERCIO DE HORTIFRUTIGRANJEIROS LTDA", "MAC" vs "MAC
// ORIENTAL", "IMCOPESC " com espaço vs "IMCOPESC"). Idempotente: nunca toca
// um (nome_origem, origem) já vinculado — preserva mesclagens/renomeações
// manuais feitas na tela. Escopo opcional por lista de nomes pra rodar
// incremental (mesmo padrão de gerarCatalogoAutomatico(chavesNfe?)).
//
// Agrupamento é CONSERVADOR por design: em dúvida, cria fornecedor separado.
// Duplicata é visível na tela e corrigível com um clique; agrupamento errado
// esconde uma compra dentro de outro fornecedor sem ninguém perceber.
import { fetchAllPaginado, similaridadeNome } from "@/lib/financeiro/razao/gerar"

const SUFIXOS_SOCIETARIOS = [
  "COMERCIO DE", "INDUSTRIA E COMERCIO", "DISTRIBUIDORA",
  "EIRELI", "LTDA", "EPP", "S A", "ME",
]

const LIMIAR_SIMILARIDADE = 0.84
const MIN_CHARS_CONTIDO = 5

// Chave de armazenamento — só maiúsculas/trim, sem stemming. nome_origem
// é SEMPRE gravado assim; nome_origem_literal guarda o texto como veio da
// fonte. Consultas que comparam com upper(trim()) (ex. telas de
// investigação) encontram a linha independente da grafia original.
function upperTrim(nome: string): string {
  return nome.toUpperCase().trim()
}

function normalizarNomeFornecedor(nome: string): string {
  let n = nome.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ").trim()
  for (const sufixo of SUFIXOS_SOCIETARIOS) {
    n = n.replace(new RegExp(`\\b${sufixo}\\b`, "g"), " ")
  }
  return n.replace(/\s+/g, " ").trim()
}

// Contenção em QUALQUER posição — início, fim ou meio — mas só com fronteira
// de palavra completa dos dois lados. "IRMAOS AVELINO" ⊂ "DISTRIB. E IMP.
// IRMAOS AVELINO" (no fim) e "SETBRAS" ⊂ "MATRIZ SC - SETBRAS" (no fim)
// passam; "SCALA" ⊂ "SCALAPEIS" não passa (sem fronteira depois de SCALA).
// Mínimo de 5 caracteres pra não casar "MZ" ou "RD" dentro de qualquer coisa.
function contidoComFronteira(curto: string, longo: string): boolean {
  if (curto.length < MIN_CHARS_CONTIDO) return false
  if (longo === curto) return true
  const regex = new RegExp(`(^|\\s)${curto}(\\s|$)`)
  return regex.test(longo)
}

function nomesRelacionados(a: string, b: string): boolean {
  if (a === b) return true
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a]
  if (contidoComFronteira(curto, longo)) return true
  return similaridadeNome(a, b) >= LIMIAR_SIMILARIDADE
}

// Union-find local — estado mutável encapsulado só dentro desta função,
// nunca exposto; forma padrão de resolver componentes conexos sem O(n³).
class UnionFind {
  private pai = new Map<string, string>()

  find(x: string): string {
    if (!this.pai.has(x)) this.pai.set(x, x)
    let raiz = x
    while (this.pai.get(raiz) !== raiz) raiz = this.pai.get(raiz)!
    let atual = x
    while (this.pai.get(atual) !== raiz) {
      const proximo = this.pai.get(atual)!
      this.pai.set(atual, raiz)
      atual = proximo
    }
    return raiz
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.pai.set(ra, rb)
  }
}

type Pendente = { nomeOrigem: string; origem: "nfe" | "titulo"; cnpj: string | null; valorTotal: number }

export type ResultadoGeracaoFornecedores = {
  ok: boolean
  criados: number
  vinculados: number
  ignoradosPorConflito: number
  error?: string
}

export async function gerarFornecedoresAutomatico(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  nomesEscopo?: string[]
): Promise<ResultadoGeracaoFornecedores> {
  try {
    if (nomesEscopo && nomesEscopo.length === 0) {
      return { ok: true, criados: 0, vinculados: 0, ignoradosPorConflito: 0 }
    }

    let queryNfe = db.from("produtos_relatorio")
      .select("fornecedor_nome,fornecedor_codigo,v_custo_total")
      .not("fornecedor_nome", "is", null)
    if (nomesEscopo) queryNfe = queryNfe.in("fornecedor_nome", nomesEscopo)
    const linhasNfe = await fetchAllPaginado((from, to) => queryNfe.range(from, to)) as Array<{
      fornecedor_nome: string; fornecedor_codigo: string | null; v_custo_total: number | null
    }>

    let queryTitulo = db.from("titulos_a_pagar")
      .select("fantasia_fornecedor,razao_fornecedor,v_titulo")
      .in("origem", ["nf_pedidos", "contas_pagar"])
      .not("fantasia_fornecedor", "is", null)
    if (nomesEscopo) queryTitulo = queryTitulo.in("fantasia_fornecedor", nomesEscopo)
    const linhasTitulo = await fetchAllPaginado((from, to) => queryTitulo.range(from, to)) as Array<{
      fantasia_fornecedor: string | null; razao_fornecedor: string | null; v_titulo: number | null
    }>

    const pendentesMap = new Map<string, Pendente>()
    for (const l of linhasNfe) {
      const chave = `nfe|${l.fornecedor_nome}`
      const atual = pendentesMap.get(chave) ?? { nomeOrigem: l.fornecedor_nome, origem: "nfe" as const, cnpj: null, valorTotal: 0 }
      pendentesMap.set(chave, {
        ...atual,
        cnpj: atual.cnpj ?? l.fornecedor_codigo,
        valorTotal: atual.valorTotal + Math.abs(Number(l.v_custo_total ?? 0)),
      })
    }
    for (const l of linhasTitulo) {
      const nome = l.fantasia_fornecedor ?? l.razao_fornecedor
      if (!nome) continue
      const chave = `titulo|${nome}`
      const atual = pendentesMap.get(chave) ?? { nomeOrigem: nome, origem: "titulo" as const, cnpj: null, valorTotal: 0 }
      pendentesMap.set(chave, { ...atual, valorTotal: atual.valorTotal + Math.abs(Number(l.v_titulo ?? 0)) })
    }

    const deparaExistente = await fetchAllPaginado((from, to) =>
      db.from("fornecedores_depara").select("nome_origem,origem,fornecedor_id").range(from, to)
    ) as Array<{ nome_origem: string; origem: string; fornecedor_id: string }>
    // nome_origem já vem normalizado (upper+trim) do banco — compara contra
    // a mesma normalização do nome bruto, não contra o texto literal.
    const jaVinculados = new Set(deparaExistente.map((r) => `${r.origem}|${r.nome_origem}`))

    // CNPJ é identidade legal, vem da NF-e (produtos_relatorio.fornecedor_codigo)
    // — só o lado 'nfe' tem CNPJ, título nunca tem (cnpj_cpf_fornecedor é
    // 100% nulo). Quando dois nomes têm o mesmo CNPJ, são o mesmo
    // fornecedor, PONTO — checado antes de qualquer heurística de texto.
    const fornecedoresExistentes = await fetchAllPaginado((from, to) =>
      db.from("fornecedores").select("id,cnpj").range(from, to)
    ) as Array<{ id: string; cnpj: string | null }>
    const fornecedorIdPorCnpjAncora = new Map<string, string>()
    for (const f of fornecedoresExistentes) {
      if (f.cnpj) fornecedorIdPorCnpjAncora.set(f.cnpj, f.id)
    }

    const pendentesNovos = [...pendentesMap.values()].filter((p) => !jaVinculados.has(`${p.origem}|${upperTrim(p.nomeOrigem)}`))
    if (pendentesNovos.length === 0) {
      return { ok: true, criados: 0, vinculados: 0, ignoradosPorConflito: 0 }
    }

    // Nós novos, deduplicados por nome normalizado — "IMCOPESC " e "IMCOPESC"
    // já colapsam aqui, antes de qualquer comparação difusa.
    const porNormalizadoNovo = new Map<string, { cnpj: string | null; entradas: Pendente[] }>()
    for (const p of pendentesNovos) {
      const norm = normalizarNomeFornecedor(p.nomeOrigem)
      const atual = porNormalizadoNovo.get(norm) ?? { cnpj: null, entradas: [] }
      porNormalizadoNovo.set(norm, { cnpj: atual.cnpj ?? p.cnpj, entradas: [...atual.entradas, p] })
    }

    // Âncoras: todo (nome_origem, origem) já vinculado vira um nó fixo no
    // grafo, apontando pro fornecedor_id existente — garante que um nome
    // novo parecido com uma variante JÁ catalogada gruda no mesmo fornecedor
    // em vez de criar um duplicado a cada execução incremental.
    const fornecedorIdPorNormalizadoAncora = new Map<string, string>()
    for (const r of deparaExistente) {
      const norm = normalizarNomeFornecedor(r.nome_origem)
      if (!fornecedorIdPorNormalizadoAncora.has(norm)) fornecedorIdPorNormalizadoAncora.set(norm, r.fornecedor_id)
    }

    const todosNormalizados = new Set<string>([
      ...porNormalizadoNovo.keys(),
      ...fornecedorIdPorNormalizadoAncora.keys(),
    ])
    const listaNormalizados = [...todosNormalizados]

    const uf = new UnionFind()

    // Precedência 1: CNPJ igual — dois normalizados novos que compartilham
    // CNPJ são o mesmo fornecedor, mesmo sem nenhuma relação textual (ex.
    // "FRESCATTO" e "Jahu - Sao Paulo", se emitirem com o mesmo CNPJ).
    const normalizadosPorCnpj = new Map<string, string[]>()
    for (const [norm, info] of porNormalizadoNovo) {
      if (!info.cnpj) continue
      const arr = normalizadosPorCnpj.get(info.cnpj) ?? []
      arr.push(norm)
      normalizadosPorCnpj.set(info.cnpj, arr)
    }
    for (const normsComMesmoCnpj of normalizadosPorCnpj.values()) {
      for (let i = 1; i < normsComMesmoCnpj.length; i++) {
        uf.union(normsComMesmoCnpj[0]!, normsComMesmoCnpj[i]!)
      }
    }

    // Precedência 2 e 3: contenção com fronteira, depois bigrama ≥ 0,84 —
    // só entram pra nomes que o CNPJ não decidiu sozinho.
    for (let i = 0; i < listaNormalizados.length; i++) {
      for (let j = i + 1; j < listaNormalizados.length; j++) {
        if (nomesRelacionados(listaNormalizados[i]!, listaNormalizados[j]!)) {
          uf.union(listaNormalizados[i]!, listaNormalizados[j]!)
        }
      }
    }

    type GrupoProcessado = {
      chave: string
      fornecedorIdExistente: string | null
      entradasNovas: Pendente[]
      valorTotal: number
      cnpj: string | null
      melhorNomeOriginal: string
    }

    const gruposPorRaiz = new Map<string, { normalizados: string[]; fornecedorIdsAncora: Set<string> }>()
    for (const n of listaNormalizados) {
      const raiz = uf.find(n)
      const grupo = gruposPorRaiz.get(raiz) ?? { normalizados: [], fornecedorIdsAncora: new Set<string>() }
      gruposPorRaiz.set(raiz, { normalizados: [...grupo.normalizados, n], fornecedorIdsAncora: grupo.fornecedorIdsAncora })
    }
    for (const [norm, fornecedorId] of fornecedorIdPorNormalizadoAncora) {
      gruposPorRaiz.get(uf.find(norm))!.fornecedorIdsAncora.add(fornecedorId)
    }
    // CNPJ de um pendente batendo com CNPJ de um fornecedor JÁ catalogado
    // também é âncora — mesma força que uma âncora por nome.
    for (const [norm, info] of porNormalizadoNovo) {
      const fornecedorIdPorCnpj = info.cnpj ? fornecedorIdPorCnpjAncora.get(info.cnpj) : undefined
      if (fornecedorIdPorCnpj) gruposPorRaiz.get(uf.find(norm))!.fornecedorIdsAncora.add(fornecedorIdPorCnpj)
    }

    let ignoradosPorConflito = 0
    const gruposProcessados: GrupoProcessado[] = []
    for (const [raiz, grupo] of gruposPorRaiz) {
      const entradasNovasDoGrupo = grupo.normalizados.flatMap((n) => porNormalizadoNovo.get(n)?.entradas ?? [])
      if (entradasNovasDoGrupo.length === 0) continue

      if (grupo.fornecedorIdsAncora.size > 1) {
        // Toca dois fornecedores já catalogados distintos — ambíguo.
        // Conservador: não mescla entidades já estabelecidas, deixa de fora
        // pra revisão manual na tela.
        ignoradosPorConflito += entradasNovasDoGrupo.length
        continue
      }

      const fornecedorIdExistente = grupo.fornecedorIdsAncora.size === 1 ? [...grupo.fornecedorIdsAncora][0]! : null
      const cnpj = grupo.normalizados.map((n) => porNormalizadoNovo.get(n)?.cnpj).find((c): c is string => !!c) ?? null
      const valorTotal = entradasNovasDoGrupo.reduce((s, e) => s + e.valorTotal, 0)
      const melhorNomeOriginal = [...entradasNovasDoGrupo].sort((a, b) => b.valorTotal - a.valorTotal)[0]!.nomeOrigem

      gruposProcessados.push({ chave: raiz, fornecedorIdExistente, entradasNovas: entradasNovasDoGrupo, valorTotal, cnpj, melhorNomeOriginal })
    }

    // Código sequencial F0001... por volume de valor — mesmo critério do
    // catálogo de produtos (maior gasto primeiro).
    const codigosExistentes = await fetchAllPaginado((from, to) =>
      db.from("fornecedores").select("codigo").range(from, to)
    ) as Array<{ codigo: string }>
    let proximoNumero = 1
    for (const r of codigosExistentes) {
      const m = /^F(\d{4})$/.exec(r.codigo)
      if (m) {
        const n = parseInt(m[1]!, 10)
        if (n >= proximoNumero) proximoNumero = n + 1
      }
    }

    const gruposSemFornecedor = gruposProcessados
      .filter((g) => g.fornecedorIdExistente === null)
      .sort((a, b) => b.valorTotal - a.valorTotal)

    const insertsFornecedores = gruposSemFornecedor.map((g, i) => ({
      codigo: `F${String(proximoNumero + i).padStart(4, "0")}`,
      nome: g.melhorNomeOriginal,
      cnpj: g.cnpj,
      ativo: true,
    }))

    let idsInseridos: Array<{ id: string; codigo: string }> = []
    if (insertsFornecedores.length > 0) {
      const { data, error } = await db.from("fornecedores").insert(insertsFornecedores).select("id,codigo")
      if (error) throw new Error(error.message)
      idsInseridos = data as Array<{ id: string; codigo: string }>
    }

    const fornecedorIdPorChaveGrupo = new Map<string, string>()
    for (const g of gruposProcessados) {
      if (g.fornecedorIdExistente) fornecedorIdPorChaveGrupo.set(g.chave, g.fornecedorIdExistente)
    }
    gruposSemFornecedor.forEach((g, i) => {
      const codigo = insertsFornecedores[i]!.codigo
      const inserido = idsInseridos.find((r) => r.codigo === codigo)
      if (inserido) fornecedorIdPorChaveGrupo.set(g.chave, inserido.id)
    })

    // nome_origem é a chave única (upper+trim) — duas grafias que só
    // diferem em caixa/espaço (ex. "IMCOPESC" e "IMCOPESC ") colapsam na
    // MESMA linha aqui, senão violam UNIQUE(nome_origem, origem). Mantém a
    // primeira grafia literal encontrada como nome_origem_literal.
    const deparaInserts = gruposProcessados.flatMap((g) => {
      const fornecedorId = fornecedorIdPorChaveGrupo.get(g.chave)
      if (!fornecedorId) return []
      const porChaveUnica = new Map<string, Pendente>()
      for (const e of g.entradasNovas) {
        const chaveUnica = `${e.origem}|${upperTrim(e.nomeOrigem)}`
        if (!porChaveUnica.has(chaveUnica)) porChaveUnica.set(chaveUnica, e)
      }
      return [...porChaveUnica.values()].map((e) => ({
        fornecedor_id: fornecedorId,
        nome_origem: upperTrim(e.nomeOrigem),
        nome_origem_literal: e.nomeOrigem,
        origem: e.origem,
      }))
    })

    for (let i = 0; i < deparaInserts.length; i += 500) {
      const { error } = await db.from("fornecedores_depara").insert(deparaInserts.slice(i, i + 500))
      if (error) throw new Error(error.message)
    }

    return {
      ok: true,
      criados: insertsFornecedores.length,
      vinculados: deparaInserts.length,
      ignoradosPorConflito,
    }
  } catch (e) {
    return { ok: false, criados: 0, vinculados: 0, ignoradosPorConflito: 0, error: e instanceof Error ? e.message : String(e) }
  }
}
