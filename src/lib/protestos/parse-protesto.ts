// Parser de certidão de protesto (tabelião) — PURO, sem I/O e sem depender do
// build browser do pdfjs-dist. Recebe os text items já extraídos via
// page.getTextContent() (um array por página) e devolve os protestos
// individuais estruturados.
//
// Abordagem (validada contra um PDF real de 14 protestos / 5 cancelados):
//   1. Extração por coordenadas (x0/y de cada palavra/trecho), não linha-a-linha.
//   2. Filtro de margem direita (x0 >= MARGIN_X) — remove a assinatura digital
//      vertical (texto rotacionado, transform com a=0/d=0) que a extração
//      linear injeta embaralhada no meio do texto.
//   3. Cada REGISTRO Nº N é uma âncora; o bloco do registro vai da âncora até
//      a âncora do próximo registro (ou fim da página). Dentro do bloco, cada
//      campo é achado por rótulo fixo do formulário (ex.: "Data do Protesto",
//      "Valor do Titulo") e o valor é a linha mais próxima abaixo do rótulo,
//      pegando a coluna (x0) mais próxima — resolve o layout em colunas sem
//      juntar tudo numa string ambígua.
//   4. Checksum: o cabeçalho declara "00NN PROTESTO(S)". Se o número de
//      REGISTRO Nº extraídos não bater com o declarado, o parse falha (ok:
//      false) em vez de gravar parcial.

export type TextItemLike = {
  str: string
  transform: number[]
  width: number
  height: number
}

export type ProtestoRegistro = {
  numero_registro: number
  apresentante: string | null
  cnpj_apresentante: string | null
  especie: string | null
  protocolo_e_data: string | null
  motivo: string | null
  data_protesto: string | null // ISO YYYY-MM-DD
  emissao: string | null // ISO YYYY-MM-DD
  vencimento: string | null // texto — pode ser "A Vista" além de data
  valor_titulo: number | null
  valor_protestado: number | null
  valor_para_cancelar: number | null
  numero_titulo: string | null
  tipo_notificacao: string | null
  livro_folha: string | null
  situacao: "em_aberto" | "cancelado"
  avisos: string[]
}

export type CertidaoParsed = {
  data_certidao: string | null // ISO YYYY-MM-DD
  nome_devedor: string | null
  cnpj_devedor: string | null
  protestos_declarados: number
  registros: ProtestoRegistro[]
}

export type ParseResult =
  | { ok: true; certidao: CertidaoParsed }
  | { ok: false; error: string; declarados: number | null; extraidos: number }

// Palavras com x0 >= este limiar ficam na margem direita onde o tabelião
// imprime a assinatura digital vertical — sempre excluídas.
const MARGIN_X = 560

type Item = { str: string; x0: number; x1: number; y: number; page: number }

function extractItems(pages: TextItemLike[][]): Item[] {
  const out: Item[] = []
  pages.forEach((items, pageIdx) => {
    for (const it of items) {
      const str = it.str?.trim()
      if (!str) continue
      const x0 = it.transform[4]!
      const y = it.transform[5]!
      const x1 = x0 + (it.width ?? 0)
      if (x0 >= MARGIN_X) continue
      out.push({ str, x0, x1, y, page: pageIdx })
    }
  })
  return out
}

// Linha mais próxima abaixo de `ref` (mesma página), dentro de maxGap pontos —
// restrita a itens cuja coluna (x0) esteja a até xWindow de ref.x0, senão a
// linha "mais próxima em Y" pode pertencer a outra coluna (ex.: bloco de
// endereço na coluna esquerda) e não ao campo rotulado à direita.
function nearestLineBelow(pageItems: Item[], ref: Item, maxGap = 16, xWindow = 30): Item[] {
  const below = pageItems.filter(
    (it) => it.y < ref.y - 1 && it.y > ref.y - maxGap && Math.abs(it.x0 - ref.x0) <= xWindow
  )
  if (!below.length) return []
  const lineY = Math.max(...below.map((it) => it.y))
  return below.filter((it) => Math.abs(it.y - lineY) <= 1.5)
}

// Valor de um campo rotulado: linha mais próxima abaixo do rótulo, coluna (x0) mais próxima.
function valueForLabel(pageItems: Item[], label: Item, maxGap = 16, xWindow = 30): string | null {
  const line = nearestLineBelow(pageItems, label, maxGap, xWindow)
  if (!line.length) return null
  line.sort((a, b) => Math.abs(a.x0 - label.x0) - Math.abs(b.x0 - label.x0))
  return line[0]!.str.trim()
}

function findLabel(items: Item[], re: RegExp): Item | null {
  return items.find((it) => re.test(it.str)) ?? null
}

function parseBRL(raw: string | null): number | null {
  if (!raw) return null
  const m = raw.match(/-?[\d.]+,\d{2}/)
  if (!m) return null
  const n = Number(m[0].replace(/\./g, "").replace(",", "."))
  return isFinite(n) ? n : null
}

function parseBRDateToISO(raw: string | null): string | null {
  if (!raw) return null
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  return `${y}-${mo}-${d}`
}

const REGISTRO_RE = /^REGISTRO Nº\s*(\d+)$/
const DECLARED_RE = /^(\d{3,4})\s*PROTESTO\(S\)$/
const APRESENTANTE_RE = /^APRESENTANTE:\s*(.+)$/
const CNPJ_RE = /^CNPJ:?\s*([\d.\/-]{14,})$/
const ESPECIE_RE = /^Especie:\s*(.*)$/
const VALOR_CANCELAR_RE = /Valor para cancelar este protesto nesta data:\s*R\$\s*(-?[\d.,]+)/
const TIPO_NOTIF_RE = /^Tipo de Notificacao:\s*(.+)$/
const CANCELAMENTO_RE = /Cancelamento ja autorizado/i
const DATA_HEADER_RE = /^Data:\s*(\d{2}\/\d{2}\/\d{4})$/

function parseRegistro(pageItems: Item[], anchor: Item, numero: number): ProtestoRegistro {
  const avisos: string[] = []

  const cancelado = pageItems.some(
    (it) => Math.abs(it.y - anchor.y) < 1.5 && it.x0 > anchor.x1 && CANCELAMENTO_RE.test(it.str)
  )
  const valorCancelarItem = pageItems.find(
    (it) => Math.abs(it.y - anchor.y) < 1.5 && VALOR_CANCELAR_RE.test(it.str)
  )
  const valor_para_cancelar = valorCancelarItem
    ? parseBRL(valorCancelarItem.str.match(VALOR_CANCELAR_RE)?.[1] ?? null)
    : null

  const apresentanteItem = findLabel(pageItems, APRESENTANTE_RE)
  const apresentante = apresentanteItem?.str.match(APRESENTANTE_RE)?.[1]?.trim() ?? null
  if (!apresentanteItem) avisos.push("apresentante não encontrado")

  let cnpj_apresentante: string | null = null
  if (apresentanteItem) {
    const cnpjLine = nearestLineBelow(pageItems, apresentanteItem, 12)
    const cnpjItem = cnpjLine.find((it) => CNPJ_RE.test(it.str))
    cnpj_apresentante = cnpjItem?.str.match(CNPJ_RE)?.[1] ?? null
  }

  const especieItem = findLabel(pageItems, ESPECIE_RE)
  let especie = especieItem?.str.match(ESPECIE_RE)?.[1]?.trim() ?? null
  if (especieItem) {
    const cont = pageItems.find(
      (it) =>
        Math.abs(it.x0 - especieItem.x0) <= 2 &&
        it.y < especieItem.y - 2 &&
        it.y > especieItem.y - 18
    )
    if (cont && especie) especie = `${especie} ${cont.str.trim()}`
  } else {
    avisos.push("especie não encontrada")
  }

  const protocoloLabel = findLabel(pageItems, /^Protocolo e Data$/)
  const protocolo_e_data = protocoloLabel ? valueForLabel(pageItems, protocoloLabel) : null

  const motivoLabel = findLabel(pageItems, /^Motivo$/)
  const motivo = motivoLabel ? valueForLabel(pageItems, motivoLabel) : null

  const dataProtestoLabel = findLabel(pageItems, /^Data do Protesto$/)
  const data_protesto = parseBRDateToISO(dataProtestoLabel ? valueForLabel(pageItems, dataProtestoLabel) : null)

  const emissaoLabel = findLabel(pageItems, /^Emissao$/)
  const emissao = parseBRDateToISO(emissaoLabel ? valueForLabel(pageItems, emissaoLabel) : null)

  const vencimentoLabel = findLabel(pageItems, /^Vencimento$/)
  const vencimentoRaw = vencimentoLabel ? valueForLabel(pageItems, vencimentoLabel) : null
  const vencimento = vencimentoRaw ? parseBRDateToISO(vencimentoRaw) ?? vencimentoRaw : null

  const valorTituloLabel = findLabel(pageItems, /^Valor do Titulo$/)
  const valor_titulo = parseBRL(valorTituloLabel ? valueForLabel(pageItems, valorTituloLabel) : null)

  const valorProtestadoLabel = findLabel(pageItems, /^Valor Protestado$/)
  const valor_protestado = parseBRL(valorProtestadoLabel ? valueForLabel(pageItems, valorProtestadoLabel) : null)

  const numeroTituloLabel = findLabel(pageItems, /^Número Titulo$/)
  const numero_titulo = numeroTituloLabel ? valueForLabel(pageItems, numeroTituloLabel) : null

  const tipoNotifItem = findLabel(pageItems, TIPO_NOTIF_RE)
  const tipo_notificacao = tipoNotifItem?.str.match(TIPO_NOTIF_RE)?.[1]?.trim() ?? null

  const livroLabel = findLabel(pageItems, /^Livro$/)
  const folhaLabel = findLabel(pageItems, /^Folha$/)
  const livro = livroLabel ? valueForLabel(pageItems, livroLabel) : null
  const folha = folhaLabel ? valueForLabel(pageItems, folhaLabel) : null
  const livro_folha = livro || folha ? `${livro ?? "—"} / ${folha ?? "—"}` : null

  if (valor_titulo == null) avisos.push("valor do título não encontrado")
  if (valor_protestado == null) avisos.push("valor protestado não encontrado")
  if (data_protesto == null) avisos.push("data do protesto não encontrada")

  return {
    numero_registro: numero,
    apresentante,
    cnpj_apresentante,
    especie,
    protocolo_e_data,
    motivo,
    data_protesto,
    emissao,
    vencimento,
    valor_titulo,
    valor_protestado,
    valor_para_cancelar,
    numero_titulo,
    tipo_notificacao,
    livro_folha,
    situacao: cancelado ? "cancelado" : "em_aberto",
    avisos,
  }
}

export function parseProtesto(pages: TextItemLike[][]): ParseResult {
  const items = extractItems(pages)

  const declaredItem = findLabel(items, DECLARED_RE)
  const declarados = declaredItem ? Number(declaredItem.str.match(DECLARED_RE)?.[1]) : null

  const anchors = items
    .filter((it) => REGISTRO_RE.test(it.str))
    .map((it) => ({ ...it, numero: Number(it.str.match(REGISTRO_RE)?.[1]) }))

  if (!anchors.length) {
    return { ok: false, error: "Nenhum REGISTRO Nº encontrado no PDF — layout inesperado.", declarados, extraidos: 0 }
  }

  const registros: ProtestoRegistro[] = anchors.map((anchor, idx) => {
    const pageItems = items.filter((it) => it.page === anchor.page)
    const nextOnPage = anchors.find((a, j) => j > idx && a.page === anchor.page)
    const blockItems = pageItems.filter(
      (it) => it.y <= anchor.y + 0.5 && it.y > (nextOnPage ? nextOnPage.y : -Infinity)
    )
    return parseRegistro(blockItems, anchor, anchor.numero)
  })

  if (declarados != null && registros.length !== declarados) {
    return {
      ok: false,
      error: `Cabeçalho declara ${declarados} protesto(s), mas foram extraídos ${registros.length}. Import abortado — confira o PDF.`,
      declarados,
      extraidos: registros.length,
    }
  }

  const dataHeaderItem = findLabel(items, DATA_HEADER_RE)
  const data_certidao = parseBRDateToISO(dataHeaderItem?.str.match(DATA_HEADER_RE)?.[1] ?? null)

  const firstAnchor = anchors[0]!
  const headerItems = items.filter(
    (it) => (it.page < firstAnchor.page || (it.page === firstAnchor.page && it.y > firstAnchor.y))
  )
  const cnpjDevedorItem = headerItems.find((it) => CNPJ_RE.test(it.str))
  const cnpj_devedor = cnpjDevedorItem?.str.match(CNPJ_RE)?.[1] ?? null
  let nome_devedor: string | null = null
  if (cnpjDevedorItem) {
    const above = headerItems
      .filter((it) => it.y > cnpjDevedorItem.y && it.y <= cnpjDevedorItem.y + 40 && it !== cnpjDevedorItem)
      .sort((a, b) => a.y - b.y)
    nome_devedor = above[0]?.str.trim() ?? null
  }

  return {
    ok: true,
    certidao: {
      data_certidao,
      nome_devedor,
      cnpj_devedor,
      protestos_declarados: declarados ?? registros.length,
      registros,
    },
  }
}
