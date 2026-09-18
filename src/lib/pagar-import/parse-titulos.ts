import { createHash } from "node:crypto"

// ── helpers ───────────────────────────────────────────────────────────────────

export type UnitNameMap = ReadonlyMap<string, string>

export function normalizeUnitName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, " ")
}

function resolveUnitId(fantasiaEmpresa: string, units: UnitNameMap): string | null {
  return units.get(normalizeUnitName(fantasiaEmpresa)) ?? null
}

// id determinístico a partir da chave natural (n_titulo, parcela,
// fantasia_empresa, ref_mes) — reimportar o mesmo título tem que produzir o
// MESMO id, senão titulo_override (que referencia titulos_a_pagar.id) perde
// o vínculo a cada reimport. Chave bate com o índice uq_titulos_chave.
function tituloId(nTitulo: string | null, parcela: string | null, fantasiaEmpresa: string | null, refMes: string | null): string {
  const key = `${nTitulo ?? ""}|${parcela ?? ""}|${fantasiaEmpresa ?? ""}|${refMes ?? ""}`
  return createHash("sha256").update(key).digest("hex")
}

function toDate(v: unknown): string | null {
  if (v == null || v === "") return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().split("T")[0]!
  if (typeof v === "number") return new Date((v - 25569) * 86400 * 1000).toISOString().split("T")[0]!
  if (typeof v === "string") {
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0]!
  }
  return null
}

function toStr(v: unknown): string | null {
  if (v == null || v === "" || v instanceof Date) return null
  const s = String(v).trim()
  return s === "" || s === "NaN" ? null : s
}

// Parser de número tolerante a formato BR ("1.234,56") e US ("1,234.56") —
// mesma lógica corrigida usada no import de produtos (ImportModal.tsx),
// reaproveitada aqui. No arquivo novo os valores já vêm como number puro
// (confirmado: nenhuma coluna monetária veio como string na validação),
// mas mantém a robustez pra formato de planilha que traga texto formatado.
function parseLocaleNumber(s: string): number {
  const cleaned = s.trim()
  const hasComma = cleaned.includes(",")
  const hasDot = cleaned.includes(".")

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",")
    const lastDot = cleaned.lastIndexOf(".")
    if (lastComma > lastDot) {
      return Number(cleaned.replace(/\./g, "").replace(",", "."))
    }
    return Number(cleaned.replace(/,/g, ""))
  }
  if (hasComma) {
    const parts = cleaned.split(",")
    if (parts.length > 2) return Number(cleaned.replace(/,/g, ""))
    const decimals = parts[1]?.length ?? 0
    if (decimals === 3) return Number(cleaned.replace(",", ""))
    return Number(cleaned.replace(",", "."))
  }
  if (hasDot) {
    const parts = cleaned.split(".")
    if (parts.length > 2) return Number(cleaned.replace(/\./g, ""))
    const decimals = parts[1]?.length ?? 0
    if (decimals === 3) return Number(cleaned.replace(".", ""))
    return Number(cleaned)
  }
  return Number(cleaned)
}

function toNum(v: unknown): number | null {
  if (v == null || v === "" || v instanceof Date) return null
  const n = typeof v === "string" ? parseLocaleNumber(v) : Number(v)
  return isNaN(n) ? null : n
}

// "Titulo" e "N.Nota Fiscal" vêm como number do SheetJS — se algum dia
// chegar como float (ex.: 21.0) ou string "21.0", precisa virar "21", sem
// o ".0": esse valor entra direto na chave de dedup (n_titulo, parcela,
// fantasia_empresa, ref_mes) e no hash do id determinístico — um ".0" a
// mais faria o hash mudar a cada reimport e duplicar o título.
function toIntString(v: unknown): string | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  if (isNaN(n)) return toStr(v)
  return String(Math.round(n))
}

function toBoolStr(v: unknown): string | null {
  if (v == null || v === "") return null
  if (typeof v === "boolean") return v ? "Sim" : "Não"
  const s = String(v).trim().toLowerCase()
  if (s === "true" || s === "sim" || s === "1") return "Sim"
  if (s === "false" || s === "não" || s === "nao" || s === "0") return "Não"
  return toStr(v)
}

function refMes(dateStr: string | null): string | null {
  if (!dateStr || dateStr.length < 7) return null
  return dateStr.slice(0, 7) + "-01"
}

// Acesso tolerante a variação de espaço/caixa no cabeçalho — o arquivo novo
// tem 9 colunas monetárias com espaço à esquerda no nome (" V. Título" etc,
// confirmado inspecionando o arquivo real), então acesso direto por chave
// exata quebraria silenciosamente.
function normalizeHeader(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/\u00a0/g, " ")                            // espaco nao separavel -> normal
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")                                // colapsa espacos multiplos
}

function col(raw: Record<string, unknown>, name: string): unknown {
  const wanted = normalizeHeader(name)
  for (const key of Object.keys(raw)) {
    if (normalizeHeader(key) === wanted) return raw[key]
  }
  return undefined
}

// ── Mapeamento de linha ──────────────────────────────────────────────────────
//
// Formato novo (aba "Banco"/"Planilha1", 49 colunas) — substitui o formato
// antigo aposentado ("Banco_Atrasados", 59 colunas). Mapa de campo validado
// contra um arquivo real de 4.620 linhas de dado (nova.xlsx):
//
//   ref_mes: derivado de D. Vencimento (refMes()), NÃO das colunas Ano/Mês
//   do arquivo — verificado antes de assumir (ver diagnóstico): "Ano" bate
//   com o ano de D. Vencimento em ~97% das linhas (124 divergências em
//   4.619), mas "Mês" é uma DATA sem relação com D. Vencimento (bate em
//   só ~43% ano+mês, valores repetidos em sequência sugerem timestamp de
//   geração do relatório, não competência do título) — não é confiável pra
//   derivar ref_mes. Mesmo critério do formato antigo (que já usava
//   D. Vencimento), mantém consistência com dados já gravados e com a
//   query de leitura (getTitulosAPagar filtra por d_vencimento).
//
//   situacao_atual agora traz LIQUIDADO/ATIVO de verdade (confirmado:
//   3.843 LIQUIDADO, 776 ATIVO, 1 null — a linha de rodapé).
//
//   Colunas do arquivo novo sem coluna correspondente no banco (ignoradas):
//   Descrição Tipo Fornecedor, Banco, Agência, T. Conta, D. Documento,
//   Responsável Autorização. Colunas do banco sem fonte no arquivo novo
//   (ficam null pra linhas novas): tipo, t_fornecedor, grupo_economico,
//   cep/bairro/cidade/uf/pais, v_saldo_anterior, d_liquidacao_periodo,
//   situacao_periodo, v_saldo_periodo, dias_atraso_periodo,
//   v_atraso_periodo, v_atualizado_periodo, d_liquidacao_atual, semana,
//   trimestre, quadrimestre, fluxo_de_caixa, tipo_sep, mes (a coluna "Mês"
//   do arquivo é a mesma date-sem-relação descrita acima — não populamos o
//   campo `mes` com ela pra não gravar lixo).
export function mapRow(r: Record<string, unknown>, units: UnitNameMap): {
  record: Record<string, unknown> | null
  fantasiaEmpresa: string | null
} {
  const fantasiaEmpresa = toStr(col(r, "Fantasia Empresa"))
  const fornecedorRaw = toStr(col(r, "Fornecedor") != null ? String(col(r, "Fornecedor")) : null)
  if (!fantasiaEmpresa || !fornecedorRaw) return { record: null, fantasiaEmpresa: null }

  const unitId = resolveUnitId(fantasiaEmpresa, units)
  if (!unitId) return { record: null, fantasiaEmpresa }

  const dVenc = toDate(col(r, "D. Vencimento"))
  const rm = refMes(dVenc)
  const nTitulo = toIntString(col(r, "Titulo"))
  const parcela = toStr(col(r, "Parcela"))

  const record: Record<string, unknown> = {
    id:                    tituloId(nTitulo, parcela, fantasiaEmpresa, rm),
    unit_id:               unitId,
    origem:                toStr(col(r, "Origem")),
    n_nota_fiscal:         toIntString(col(r, "N.Nota Fiscal")),
    empresa:               toStr(col(r, "Empresa") != null ? String(col(r, "Empresa")) : null),
    fantasia_empresa:      fantasiaEmpresa,
    fornecedor:            fornecedorRaw,
    razao_fornecedor:      toStr(col(r, "Razão Fornecedor")),
    fantasia_fornecedor:   toStr(col(r, "Fantasia Fornecedor")),
    cnpj_cpf_fornecedor:   toStr(col(r, "CNPJ/CPF")),
    n_conta:               toStr(col(r, "N. Conta")),
    condicao_compra:       toStr(col(r, "Condição Compra")),
    prazo_medio:           toNum(col(r, "Prazo Médio")),
    serie:                 toStr(col(r, "Série")),
    n_titulo:              nTitulo,
    parcela:               parcela,
    documento:             toStr(col(r, "Documento") != null ? String(col(r, "Documento")) : null),
    portador_num:          toStr(col(r, "Portador") != null ? String(col(r, "Portador")) : null),
    portador:              toStr(col(r, "Descrição Portador")),
    c_gerencial:           toStr(col(r, "C. Gerencial") != null ? String(col(r, "C. Gerencial")) : null),
    descricao_c_gerencial: toStr(col(r, "Descrição C. Gerencial")),
    d_lancamento:          toDate(col(r, "D. Lançamento")),
    d_competencia:         toDate(col(r, "D. Competência")),
    d_autorizacao_pgto:    toDate(col(r, "D. Autorização Pgto")),
    d_vencimento:          dVenc,
    dia_semana:            toStr(col(r, "Dia Semana")),
    v_desconto:            toNum(col(r, "V. Desconto")),
    v_multa_atraso:        toNum(col(r, "V. Multa Atraso")),
    v_juros_dia:           toNum(col(r, "V. Juros Dia")),
    v_titulo:              toNum(col(r, "V. Título")),
    v_original:            toNum(col(r, "V. Original")),
    v_credito_periodo:     toNum(col(r, "V. Crédito")),
    v_debito_periodo:      toNum(col(r, "V. Débito")),
    situacao_atual:        toStr(col(r, "Situação")),
    v_saldo_atual:         toNum(col(r, "V. Saldo")),
    dias_atraso_atual:     toNum(col(r, "Dias Atraso")),
    v_atraso_atual:        toNum(col(r, "V. Atraso")),
    v_atualizado_atual:    toNum(col(r, "V. Atualizado")),
    ano:                   toNum(col(r, "Ano")),
    v_pagamento:           toNum(col(r, "V. Pagamento")),
    d_liquidacao:          toDate(col(r, "D. Liquidação")),
    forma_pagamento:       toStr(col(r, "Forma Pagamento")),
    posicao:               toStr(col(r, "Posição")),
    dre:                   toBoolStr(col(r, "DRE")),
    ref_mes:               rm,
  }

  return { record, fantasiaEmpresa }
}
