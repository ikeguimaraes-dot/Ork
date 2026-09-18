// Lógica pura da tela de Conferência (/financeiro/aprovacoes) — GRUPO 1
// (Identidade). Nenhum alerta afirma que algo está ERRADO: só que "merece
// conferência". Nunca grava nada; a única persistência é a decisão humana,
// feita em conferencias (ver src/app/financeiro/aprovacoes/actions.ts).
import { createHash } from "node:crypto"
import { fetchAllPaginado } from "@/lib/financeiro/razao/gerar"
import { extrairCalibre } from "@/lib/financeiro/produtos/extrairCalibre"

export type Severidade = "critico" | "atencao"
import { unitMentioned } from "@/lib/instance";
export type UnidadeTag = string

export type AlertaOcorrencia = {
  chave: string
  descricao: string
  valor: number
}

export type Alerta = {
  alertaChave: string
  grupo: 1 | 2 | 3 | 4
  titulo: string
  motivo: string
  severidade: Severidade
  link: string
  valorEnvolvido: number
  ocorrencias: AlertaOcorrencia[]
  assinatura: string
}

export type ConferenciaRow = {
  alerta_chave: string
  assinatura: string
  status: "conferido" | "ignorado"
  observacao: string | null
  conferido_por: string | null
  conferido_em: string
}

export type ConferenciaInfo = {
  status: "conferido" | "ignorado"
  observacao: string | null
  conferidoPor: string | null
  conferidoEm: string
  assinaturaMudou: boolean
}

export type AlertaComStatus = Alerta & { conferencia: ConferenciaInfo | null }

export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export function competenciaFim(competencia: string): string {
  const ano = Number(competencia.slice(0, 4))
  const mes = Number(competencia.slice(5, 7))
  return mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`
}

function calcularAssinatura(ocorrencias: AlertaOcorrencia[]): string {
  const chaves = ocorrencias.map((o) => `${o.chave}:${round2(o.valor)}`).sort()
  return createHash("sha256").update(chaves.join("|")).digest("hex")
}

type ParametrosAlerta = Omit<Alerta, "assinatura" | "valorEnvolvido">

export function montarAlerta(params: ParametrosAlerta): Alerta | null {
  if (params.ocorrencias.length === 0) return null
  const valorEnvolvido = round2(params.ocorrencias.reduce((s, o) => s + o.valor, 0))
  return { ...params, valorEnvolvido, assinatura: calcularAssinatura(params.ocorrencias) }
}

// ── 1.1 · Categoria de outra unidade na planilha ────────────────────────────
// "UNIDADE DELIVERY" identifica a unidade UNIDADE Delivery; "UNIDADE" sozinho (sem
// "DELIVERY") é a grafia curta de "UNIDADE Restaurantes", que É a Restaurante —
// não é um alerta de identidade trocada.
const detectarUnidadeMencionada = unitMentioned;

export async function calcularAlertaCategoriaOutraUnidade(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  unitId: string,
  unitTag: UnidadeTag,
  competencia: string
): Promise<Alerta | null> {
  const fim = competenciaFim(competencia)
  const titulos = await fetchAllPaginado((from, to) =>
    db.from("titulos_a_pagar")
      .select("id,fantasia_fornecedor,razao_fornecedor,c_gerencial,descricao_c_gerencial,v_titulo")
      .eq("unit_id", unitId)
      .in("origem", ["nf_pedidos", "contas_pagar"])
      .or(`d_competencia.eq.${competencia},and(d_competencia.is.null,d_vencimento.gte.${competencia},d_vencimento.lt.${fim})`)
      .range(from, to)
  ) as Array<{
    id: string; fantasia_fornecedor: string | null; razao_fornecedor: string | null
    c_gerencial: string | null; descricao_c_gerencial: string | null; v_titulo: number | null
  }>

  const ocorrencias: AlertaOcorrencia[] = []
  for (const t of titulos) {
    const texto = `${t.c_gerencial ?? ""} ${t.descricao_c_gerencial ?? ""}`
    const mencionada = detectarUnidadeMencionada(texto)
    if (!mencionada || mencionada === unitTag) continue
    const categoria = t.descricao_c_gerencial ?? t.c_gerencial ?? "sem categoria"
    ocorrencias.push({
      chave: t.id,
      descricao: `${t.fantasia_fornecedor ?? t.razao_fornecedor ?? "Fornecedor não identificado"} · ${categoria}`,
      valor: Math.abs(Number(t.v_titulo ?? 0)),
    })
  }

  return montarAlerta({
    alertaChave: "1.1_categoria_outra_unidade",
    grupo: 1,
    titulo: "Categoria de outra unidade na planilha",
    motivo: "A categoria gerencial deste título menciona uma unidade diferente da que foi importada.",
    severidade: "critico",
    link: "/financeiro/pagar",
    ocorrencias,
  })
}

// ── 1.2 · Fornecedores candidatos a fusão ───────────────────────────────────
// Mesmo nº de nota + mesmo valor em dois fornecedores catalogados como
// entidades diferentes — indício de que a mesma nota entrou com grafias
// distintas de fornecedor. Cruza as duas unidades operacionais porque o
// catálogo de fornecedores é global, não por unidade.
export async function calcularAlertaFornecedoresFusao(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  competencia: string
): Promise<Alerta | null> {
  const fim = competenciaFim(competencia)
  const titulos = await fetchAllPaginado((from, to) =>
    db.from("titulos_a_pagar")
      .select("id,fantasia_fornecedor,razao_fornecedor,n_nota_fiscal,v_titulo,valor_total_nf_origem")
      .in("origem", ["nf_pedidos", "contas_pagar"])
      .not("n_nota_fiscal", "is", null)
      .or(`d_competencia.eq.${competencia},and(d_competencia.is.null,d_vencimento.gte.${competencia},d_vencimento.lt.${fim})`)
      .range(from, to)
  ) as Array<{
    id: string; fantasia_fornecedor: string | null; razao_fornecedor: string | null
    n_nota_fiscal: string | null; v_titulo: number | null; valor_total_nf_origem: number | null
  }>

  const deparaRows = await fetchAllPaginado((from, to) =>
    db.from("fornecedores_depara").select("nome_origem,fornecedor_id").eq("origem", "titulo").range(from, to)
  ) as Array<{ nome_origem: string; fornecedor_id: string }>
  const fornecedorIdPorNome = new Map(deparaRows.map((d) => [d.nome_origem, d.fornecedor_id]))

  function valorTitulo(t: (typeof titulos)[number]): number {
    return Math.abs(Number(t.valor_total_nf_origem ?? t.v_titulo ?? 0))
  }
  function identidadeFornecedor(t: (typeof titulos)[number]): string {
    const nome = (t.fantasia_fornecedor ?? t.razao_fornecedor ?? "").toUpperCase().trim()
    return fornecedorIdPorNome.get(nome) ?? nome
  }

  const grupos = new Map<string, Array<(typeof titulos)[number]>>()
  for (const t of titulos) {
    const chave = `${t.n_nota_fiscal}|${round2(valorTitulo(t))}`
    const arr = grupos.get(chave) ?? []
    arr.push(t)
    grupos.set(chave, arr)
  }

  const ocorrencias: AlertaOcorrencia[] = []
  for (const [chaveGrupo, membros] of grupos) {
    if (membros.length < 2) continue
    const porIdentidade = new Map<string, (typeof titulos)[number]>()
    for (const m of membros) {
      const identidade = identidadeFornecedor(m)
      if (!porIdentidade.has(identidade)) porIdentidade.set(identidade, m)
    }
    if (porIdentidade.size < 2) continue
    const nomes = [...porIdentidade.values()].map((m) => m.fantasia_fornecedor ?? m.razao_fornecedor ?? "—")
    ocorrencias.push({
      chave: chaveGrupo,
      descricao: `Nota ${membros[0]!.n_nota_fiscal} · ${nomes.join(" ↔ ")}`,
      valor: valorTitulo(membros[0]!),
    })
  }

  return montarAlerta({
    alertaChave: "1.2_fornecedores_fusao",
    grupo: 1,
    titulo: "Fornecedores candidatos a fusão",
    motivo: "Dois fornecedores cadastrados separadamente têm um título com o mesmo número de nota e o mesmo valor.",
    severidade: "atencao",
    link: "/financeiro/dre/divergencias",
    ocorrencias,
  })
}

// ── 1.3 · Produtos duplicados no catálogo ───────────────────────────────────
// Mesmo NCM (código de tarifa aduaneira já bem específico, ex.: 03021400 =
// salmão fresco/resfriado) + mesmo calibre (extraído do nome) — as duas
// coisas juntas já são um casamento forte o bastante pra flagar; exigir
// similaridade textual em cima disso fragmenta duplicatas reais quando a
// descrição varia bastante entre fornecedores (confirmado com dado real:
// os 5 códigos de salmão 14-16 do catálogo têm nomes tão diferentes entre
// si que nenhum par bate um limiar de similaridade razoável).
export async function calcularAlertaProdutosDuplicados(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
): Promise<Alerta | null> {
  const produtos = await fetchAllPaginado((from, to) =>
    db.from("produtos_catalogo").select("id,codigo,nome,ncm").eq("ativo", true).range(from, to)
  ) as Array<{ id: string; codigo: string; nome: string; ncm: string | null }>

  // produtos_relatorio.produto_id nunca é preenchido na prática — o link
  // real de compra pra catálogo é (fornecedor_codigo = CNPJ, item_codigo)
  // via produtos_depara, mesmo caminho de getEvolucaoPorCompra().
  const compras = await fetchAllPaginado((from, to) =>
    db.from("produtos_relatorio")
      .select("fornecedor_codigo,item_codigo,v_custo_total,v_total_danfe")
      .eq("direcao_nfe", "entrada")
      .not("fornecedor_codigo", "is", null)
      .not("item_codigo", "is", null)
      .range(from, to)
  ) as Array<{ fornecedor_codigo: string; item_codigo: string; v_custo_total: number | null; v_total_danfe: number | null }>

  const deparaProdutoRows = await fetchAllPaginado((from, to) =>
    db.from("produtos_depara").select("fornecedor_cnpj,item_codigo,produto_id").range(from, to)
  ) as Array<{ fornecedor_cnpj: string; item_codigo: string; produto_id: string | null }>
  const produtoIdPorPar = new Map<string, string>()
  for (const d of deparaProdutoRows) {
    if (d.produto_id) produtoIdPorPar.set(`${d.fornecedor_cnpj}|${d.item_codigo}`, d.produto_id)
  }

  const custoPorProduto = new Map<string, number>()
  for (const c of compras) {
    if (c.v_total_danfe === 0 || c.v_total_danfe === 0.01) continue // bonificação, não é compra real
    const produtoId = produtoIdPorPar.get(`${c.fornecedor_codigo}|${c.item_codigo}`)
    if (!produtoId) continue
    custoPorProduto.set(produtoId, (custoPorProduto.get(produtoId) ?? 0) + Math.abs(Number(c.v_custo_total ?? 0)))
  }

  const analisados = produtos
    .filter((p): p is typeof p & { ncm: string } => !!p.ncm)
    .map((p) => {
      const { calibre } = extrairCalibre(p.nome.toUpperCase())
      return { id: p.id, codigo: p.codigo, nome: p.nome, ncm: p.ncm, calibre }
    })

  const porNcmCalibre = new Map<string, typeof analisados>()
  for (const p of analisados) {
    if (!p.calibre) continue
    const chave = `${p.ncm}|${p.calibre}`
    const arr = porNcmCalibre.get(chave) ?? []
    arr.push(p)
    porNcmCalibre.set(chave, arr)
  }

  const ocorrencias: AlertaOcorrencia[] = []
  for (const grupo of porNcmCalibre.values()) {
    if (grupo.length < 2) continue
    const valorGrupo = grupo.reduce((s, p) => s + (custoPorProduto.get(p.id) ?? 0), 0)
    ocorrencias.push({
      chave: grupo.map((p) => p.id).sort().join("+"),
      descricao: grupo.map((p) => `${p.codigo} · ${p.nome}`).join(" / "),
      valor: round2(valorGrupo),
    })
  }

  return montarAlerta({
    alertaChave: "1.3_produtos_duplicados",
    grupo: 1,
    titulo: "Produtos duplicados no catálogo",
    motivo: "Mesmo NCM e mesmo calibre com descrição similar cadastrados em códigos de catálogo diferentes.",
    severidade: "atencao",
    link: "/financeiro/dre/cmv",
    ocorrencias,
  })
}

export async function calcularAlertasGrupo1(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  unitId: string,
  unitTag: UnidadeTag,
  competencia: string
): Promise<Alerta[]> {
  const [categoria, fusao, duplicados] = await Promise.all([
    calcularAlertaCategoriaOutraUnidade(db, unitId, unitTag, competencia),
    calcularAlertaFornecedoresFusao(db, competencia),
    calcularAlertaProdutosDuplicados(db),
  ])
  return [categoria, fusao, duplicados].filter((a): a is Alerta => a !== null)
}

// ── Cruza os alertas calculados com as conferências já registradas ──────────
export function aplicarConferencias(alertas: Alerta[], rows: ConferenciaRow[]): AlertaComStatus[] {
  const porChave = new Map(rows.map((r) => [r.alerta_chave, r]))
  return alertas.map((a) => {
    const row = porChave.get(a.alertaChave)
    if (!row) return { ...a, conferencia: null }
    return {
      ...a,
      conferencia: {
        status: row.status,
        observacao: row.observacao,
        conferidoPor: row.conferido_por,
        conferidoEm: row.conferido_em,
        assinaturaMudou: row.assinatura !== a.assinatura,
      },
    }
  })
}
