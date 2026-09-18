import { competenciaTitulo } from "@/lib/financeiro/dates"
// Lógica pura de leitura pra tela /financeiro/dre/divergencias — NÃO grava
// lançamento nenhum. Decisão do Ike (FASE 7): parar de ajustar heurística
// pra o CMV bater e, em vez disso, EXPOR a divergência entre a planilha de
// contas a pagar e as NF-e importadas, deixando o dado mostrar qual fonte
// está errada. Reaplica o MESMO critério de match de
// gerarLancamentosTitulos() (agrupar por fornecedor_id (catálogo) + nº da
// nota, comparar valor_total_nf_origem ou soma das parcelas contra a NF-e,
// ±2%, mesma competência) só pra CLASSIFICAR e MOSTRAR — nunca escreve em
// titulos_a_pagar, lancamentos ou reconciliacoes_sugeridas. Roda a
// classificação para TODOS os títulos, inclusive os que
// gerarLancamentosTitulos() descartaria por outras regras (ex. ALIMENTOS de
// contas_pagar quando há NF_PEDIDOS) — aqui queremos ver o universo inteiro,
// não o que o pipeline de lançamento escolheu processar.
import { fetchAllPaginado } from "@/lib/financeiro/razao/gerar"



export type ComNotaComXml = {
  fornecedor: string | null
  nNota: string
  valorTitulo: number
  valorNfe: number
  diferenca: number
  dataTitulo: string | null
  dataNfe: string | null
}

export type ComNotaSemXml = {
  fornecedor: string | null
  nNota: string
  valor: number
  data: string | null
  categoria: string | null
}

export type SemNota = {
  fornecedor: string | null
  valor: number
  data: string | null
  categoria: string | null
  observacao: string | null
}

export type XmlSemTitulo = {
  fornecedor: string | null
  nNota: string | null
  chave: string
  valor: number
  data: string | null
  unidade: string
}

export type FechamentoAlimentos = {
  valorPlanilhaAlimentos: number
  valorNfeTotal: number
  valorReconciliado: number
  divergenciaNaoExplicada: number
}

export type ResumoLista = { qtd: number; valor: number }

export type DivergenciasResultado = {
  unitId: string
  unitName: string
  competencia: string
  comNotaComXml: ComNotaComXml[]
  comNotaSemXml: ComNotaSemXml[]
  semNota: SemNota[]
  xmlSemTitulo: XmlSemTitulo[]
  resumo: {
    totalTitulos: number
    totalValor: number
    listaA: ResumoLista
    listaB: ResumoLista
    listaC: ResumoLista
    listaD: ResumoLista
    fechamento: FechamentoAlimentos
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export async function calcularDivergenciasContasPagarNotas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  unitId: string,
  unitName: string,
  competencia: string
): Promise<DivergenciasResultado> {


  const titulosTodos = await fetchAllPaginado((from, to) =>
    db.from("titulos_a_pagar")
      .select("id,fantasia_fornecedor,razao_fornecedor,c_gerencial,parcela,v_titulo,valor_total_nf_origem,d_competencia,d_vencimento,d_lancamento,n_nota_fiscal,origem")
      .eq("unit_id", unitId)
      .in("origem", ["nf_pedidos", "contas_pagar"])
      .range(from, to)
  ) as Array<{
    id: string; fantasia_fornecedor: string | null; razao_fornecedor: string | null
    c_gerencial: string | null; parcela: string | null
    v_titulo: number | null; valor_total_nf_origem: number | null
    d_competencia: string | null; d_vencimento: string | null; d_lancamento: string | null
    n_nota_fiscal: string | null; origem: string
  }>

  const titulos = titulosTodos.filter(t => competenciaTitulo(t) === competencia)

  const notasCandidatas = await fetchAllPaginado((from, to) =>
    db.from("nfe_documentos")
      .select("chave,numero,emitente_nome,valor_total,emissao")
      .eq("unit_id", unitId)
      .eq("direcao", "entrada")
      .eq("cancelada", false)
      .not("numero", "is", null)
      .range(from, to)
  ) as Array<{ chave: string; numero: string | null; emitente_nome: string | null; valor_total: number; emissao: string | null }>
  const notaPorChave = new Map(notasCandidatas.map((n) => [n.chave, n]))
  const notasPorNumero = new Map<string, typeof notasCandidatas>()
  for (const nota of notasCandidatas) {
    const arr = notasPorNumero.get(nota.numero!) ?? []
    arr.push(nota)
    notasPorNumero.set(nota.numero!, arr)
  }

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

  // Mesmo catálogo de fornecedores usado em gerarLancamentosTitulos() — o
  // match aqui é só pra CLASSIFICAR/MOSTRAR, mas tem que refletir o mesmo
  // critério exato por fornecedor_id, não texto.
  const deparaRows = await fetchAllPaginado((from, to) =>
    db.from("fornecedores_depara").select("nome_origem,origem,fornecedor_id").range(from, to)
  ) as Array<{ nome_origem: string; origem: "nfe" | "titulo"; fornecedor_id: string }>
  const fornecedorIdPorNomeTitulo = new Map(
    deparaRows.filter((d) => d.origem === "titulo").map((d) => [d.nome_origem, d.fornecedor_id])
  )
  const fornecedorIdPorNomeNfe = new Map(
    deparaRows.filter((d) => d.origem === "nfe").map((d) => [d.nome_origem, d.fornecedor_id])
  )
  // fornecedores_depara.nome_origem é sempre upper+trim — a chave de busca
  // precisa da mesma normalização, não o nome literal da fonte.
  const fornecedorIdPorChaveNota = new Map<string, string>()
  for (const nota of notasCandidatas) {
    const fornecedorId = fornecedorIdPorNomeNfe.get((nota.emitente_nome ?? "").toUpperCase().trim())
    if (fornecedorId) fornecedorIdPorChaveNota.set(nota.chave, fornecedorId)
  }

  type Titulo = (typeof titulos)[number]

  function valorTitulo(t: Titulo): number {
    return Math.abs(Number(t.v_titulo ?? 0))
  }
  function dataTitulo(t: Titulo): string | null {
    return t.d_vencimento ?? t.d_lancamento ?? t.d_competencia ?? null
  }
  function primeiraData(datas: Array<string | null>): string | null {
    const validas = datas.filter((d): d is string => d != null).sort()
    return validas[0] ?? null
  }

  const comNumero = titulos.filter((t) => t.n_nota_fiscal)
  const semNumeroTitulos = titulos.filter((t) => !t.n_nota_fiscal)

  const comNotaComXml: ComNotaComXml[] = []
  const comNotaSemXml: ComNotaSemXml[] = []
  const chavesUsadas = new Set<string>()

  // Agrupa por (fornecedor_id, número da nota) — mesmo critério de
  // gerarLancamentosTitulos(): uma nota parcelada em várias linhas de
  // título só pode ser comparada como grupo, nunca parcela a parcela.
  // Título sem fornecedor_id resolvido no catálogo nunca casa — cai direto
  // em "com nota, sem XML".
  const grupos = new Map<string, Titulo[]>()
  for (const t of comNumero) {
    const fornecedorId = fornecedorIdPorNomeTitulo.get((t.fantasia_fornecedor ?? t.razao_fornecedor ?? "").toUpperCase().trim())
    if (!fornecedorId) {
      comNotaSemXml.push({
        fornecedor: t.fantasia_fornecedor ?? t.razao_fornecedor ?? null,
        nNota: t.n_nota_fiscal!,
        valor: round2(valorTitulo(t)),
        data: dataTitulo(t),
        categoria: t.c_gerencial,
      })
      continue
    }
    const chave = `${fornecedorId}|${t.n_nota_fiscal}`
    const arr = grupos.get(chave) ?? []
    arr.push(t)
    grupos.set(chave, arr)
  }

  for (const membros of grupos.values()) {
    const primeiro = membros[0]!
    const nomeFornecedor = primeiro.fantasia_fornecedor ?? primeiro.razao_fornecedor ?? null
    const nNota = primeiro.n_nota_fiscal!
    const fornecedorId = fornecedorIdPorNomeTitulo.get((nomeFornecedor ?? "").toUpperCase().trim())!

    const valorTotalOrigem = membros.map((m) => m.valor_total_nf_origem).find((v): v is number => v != null)
    const valorGrupo = valorTotalOrigem ?? membros.reduce((s, m) => s + valorTitulo(m), 0)

    let matchConfirmado: { chave: string; diffValor: number; valorNfe: number; emissao: string | null } | null = null
    const candidatas = notasPorNumero.get(nNota) ?? []
    for (const nota of candidatas) {
      if (fornecedorIdPorChaveNota.get(nota.chave) !== fornecedorId) continue
      if (competenciaPorChave.get(nota.chave) !== competencia) continue
      const diffValor = Math.abs(nota.valor_total - valorGrupo) / Math.max(valorGrupo, 0.01)
      if (diffValor > 0.02) continue
      if (!matchConfirmado || diffValor < matchConfirmado.diffValor) {
        matchConfirmado = { chave: nota.chave, diffValor, valorNfe: nota.valor_total, emissao: nota.emissao }
      }
    }

    if (matchConfirmado) {
      chavesUsadas.add(matchConfirmado.chave)
      comNotaComXml.push({
        fornecedor: nomeFornecedor,
        nNota,
        valorTitulo: round2(valorGrupo),
        valorNfe: round2(matchConfirmado.valorNfe),
        diferenca: round2(valorGrupo - matchConfirmado.valorNfe),
        dataTitulo: primeiraData(membros.map(dataTitulo)),
        dataNfe: matchConfirmado.emissao,
      })
    } else {
      comNotaSemXml.push({
        fornecedor: nomeFornecedor,
        nNota,
        valor: round2(valorGrupo),
        data: primeiraData(membros.map(dataTitulo)),
        categoria: primeiro.c_gerencial,
      })
    }
  }

  const semNota: SemNota[] = semNumeroTitulos.map((t) => ({
    fornecedor: t.fantasia_fornecedor ?? t.razao_fornecedor ?? null,
    valor: round2(valorTitulo(t)),
    data: dataTitulo(t),
    categoria: t.c_gerencial,
    observacao: t.parcela,
  }))

  // NF-e da competência (via produtos_relatorio) que nenhum grupo de título
  // usou — o inverso: nota que existe no fisco mas não está na planilha.
  const chavesDaCompetencia = [...competenciaPorChave.entries()]
    .filter(([, c]) => c === competencia)
    .map(([chave]) => chave)
  const xmlSemTitulo: XmlSemTitulo[] = []
  for (const chave of chavesDaCompetencia) {
    if (chavesUsadas.has(chave)) continue
    const nota = notaPorChave.get(chave)
    if (!nota) continue
    xmlSemTitulo.push({
      fornecedor: nota.emitente_nome,
      nNota: nota.numero,
      chave: nota.chave,
      valor: round2(nota.valor_total),
      data: nota.emissao,
      unidade: unitName,
    })
  }

  // Fechamento: só ALIMENTOS/BEBIDAS, o único recorte onde planilha e NF-e
  // descrevem a mesma compra de verdade (aluguel, folha, impostos não têm
  // contrapartida em NF-e de produto).
  const categoriasAlimento = new Set(["ALIMENTOS", "BEBIDAS"])
  const valorPlanilhaAlimentos = titulos
    .filter((t) => categoriasAlimento.has((t.c_gerencial ?? "").toUpperCase()))
    .reduce((s, t) => s + valorTitulo(t), 0)
  const valorNfeTotal = chavesDaCompetencia.reduce((s, chave) => s + (notaPorChave.get(chave)?.valor_total ?? 0), 0)
  const valorReconciliado = comNotaComXml.reduce((s, g) => s + g.valorTitulo, 0)
  const divergenciaNaoExplicada = Math.abs(valorPlanilhaAlimentos - valorNfeTotal) - valorReconciliado

  const somaValor = (itens: Array<{ valor: number }>) => itens.reduce((s, i) => s + i.valor, 0)

  comNotaComXml.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))
  comNotaSemXml.sort((a, b) => b.valor - a.valor)
  semNota.sort((a, b) => b.valor - a.valor)
  xmlSemTitulo.sort((a, b) => b.valor - a.valor)

  return {
    unitId,
    unitName,
    competencia,
    comNotaComXml,
    comNotaSemXml,
    semNota,
    xmlSemTitulo,
    resumo: {
      totalTitulos: titulos.length,
      totalValor: round2(titulos.reduce((s, t) => s + valorTitulo(t), 0)),
      listaA: { qtd: comNotaComXml.length, valor: round2(somaValor(comNotaComXml.map((i) => ({ valor: i.valorTitulo })))) },
      listaB: { qtd: comNotaSemXml.length, valor: round2(somaValor(comNotaSemXml)) },
      listaC: { qtd: semNota.length, valor: round2(somaValor(semNota)) },
      listaD: { qtd: xmlSemTitulo.length, valor: round2(somaValor(xmlSemTitulo)) },
      fechamento: {
        valorPlanilhaAlimentos: round2(valorPlanilhaAlimentos),
        valorNfeTotal: round2(valorNfeTotal),
        valorReconciliado: round2(valorReconciliado),
        divergenciaNaoExplicada: round2(divergenciaNaoExplicada),
      },
    },
  }
}
