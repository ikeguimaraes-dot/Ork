"use server"

import { createFinanceiroClient } from "@/lib/financeiro/db/client";

import { requireUser } from "@ork/auth/server"

import { fetchAllPaginado } from "@/lib/financeiro/razao/gerar"
import { gerarFornecedoresAutomatico, type ResultadoGeracaoFornecedores } from "@/lib/financeiro/fornecedores/gerarFornecedoresAutomatico"

export type { ResultadoGeracaoFornecedores } from "@/lib/financeiro/fornecedores/gerarFornecedoresAutomatico"

export async function gerarFornecedoresAutomaticoAction(): Promise<ResultadoGeracaoFornecedores> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, criados: 0, vinculados: 0, ignoradosPorConflito: 0, error: "Sem conexão com banco" }
  return gerarFornecedoresAutomatico(db)
}

export type NomeOrigemVinculado = { deparaId: string; nomeOrigem: string; nomeOrigemLiteral: string; origem: "nfe" | "titulo" }

export type FornecedorCatalogado = {
  id: string
  codigo: string
  nome: string
  cnpj: string | null
  ativo: boolean
  nomesOrigem: NomeOrigemVinculado[]
  valorTotalNfe: number
  qtdNotas: number
  valorTotalTitulo: number
  qtdTitulos: number
}

export type ListarFornecedoresResultado = { ok: boolean; fornecedores: FornecedorCatalogado[]; error?: string }

// Só leitura — junta fornecedores_depara de volta às fontes (produtos_relatorio
// pra NF-e, titulos_a_pagar pra planilha) só pra exibir valor/contagem na
// tela; não participa do match título↔NF-e (isso é gerarLancamentosTitulos).
export async function listarFornecedores(): Promise<ListarFornecedoresResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, fornecedores: [], error: "Sem conexão com banco" }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any
    const fornecedoresRows = await fetchAllPaginado((from, to) =>
      dbAny.from("fornecedores").select("id,codigo,nome,cnpj,ativo").range(from, to)
    ) as Array<{ id: string; codigo: string; nome: string; cnpj: string | null; ativo: boolean }>

    const deparaRows = await fetchAllPaginado((from, to) =>
      dbAny.from("fornecedores_depara").select("id,fornecedor_id,nome_origem,nome_origem_literal,origem").range(from, to)
    ) as Array<{ id: string; fornecedor_id: string; nome_origem: string; nome_origem_literal: string; origem: "nfe" | "titulo" }>

    // nome_origem é sempre upper+trim (não bate com a grafia original das
    // fontes) — o join de volta pra produtos_relatorio/titulos_a_pagar tem
    // que usar nome_origem_literal, a grafia exata como veio de lá.
    const nomesNfe = [...new Set(deparaRows.filter((d) => d.origem === "nfe").map((d) => d.nome_origem_literal))]
    const nomesTitulo = [...new Set(deparaRows.filter((d) => d.origem === "titulo").map((d) => d.nome_origem_literal))]

    const linhasNfe = nomesNfe.length === 0 ? [] : await fetchAllPaginado((from, to) =>
      dbAny.from("produtos_relatorio").select("fornecedor_nome,v_custo_total,chave_nfe").in("fornecedor_nome", nomesNfe).range(from, to)
    ) as Array<{ fornecedor_nome: string; v_custo_total: number | null; chave_nfe: string | null }>

    const linhasTitulo = nomesTitulo.length === 0 ? [] : await fetchAllPaginado((from, to) =>
      dbAny.from("titulos_a_pagar").select("fantasia_fornecedor,v_titulo")
        .in("fantasia_fornecedor", nomesTitulo).in("origem", ["nf_pedidos", "contas_pagar"]).range(from, to)
    ) as Array<{ fantasia_fornecedor: string; v_titulo: number | null }>

    const nfePorNome = new Map<string, { valor: number; chaves: Set<string> }>()
    for (const l of linhasNfe) {
      const atual = nfePorNome.get(l.fornecedor_nome) ?? { valor: 0, chaves: new Set<string>() }
      atual.valor += Math.abs(Number(l.v_custo_total ?? 0))
      if (l.chave_nfe) atual.chaves.add(l.chave_nfe)
      nfePorNome.set(l.fornecedor_nome, atual)
    }
    const tituloPorNome = new Map<string, { valor: number; qtd: number }>()
    for (const l of linhasTitulo) {
      const atual = tituloPorNome.get(l.fantasia_fornecedor) ?? { valor: 0, qtd: 0 }
      atual.valor += Math.abs(Number(l.v_titulo ?? 0))
      atual.qtd += 1
      tituloPorNome.set(l.fantasia_fornecedor, atual)
    }

    const deparaPorFornecedor = new Map<string, typeof deparaRows>()
    for (const d of deparaRows) {
      const arr = deparaPorFornecedor.get(d.fornecedor_id) ?? []
      arr.push(d)
      deparaPorFornecedor.set(d.fornecedor_id, arr)
    }

    const fornecedores: FornecedorCatalogado[] = fornecedoresRows.map((f) => {
      const vinculos = deparaPorFornecedor.get(f.id) ?? []
      let valorTotalNfe = 0, qtdNotas = 0, valorTotalTitulo = 0, qtdTitulos = 0
      for (const v of vinculos) {
        if (v.origem === "nfe") {
          const agregado = nfePorNome.get(v.nome_origem_literal)
          if (agregado) { valorTotalNfe += agregado.valor; qtdNotas += agregado.chaves.size }
        } else {
          const agregado = tituloPorNome.get(v.nome_origem_literal)
          if (agregado) { valorTotalTitulo += agregado.valor; qtdTitulos += agregado.qtd }
        }
      }
      return {
        id: f.id, codigo: f.codigo, nome: f.nome, cnpj: f.cnpj, ativo: f.ativo,
        nomesOrigem: vinculos.map((v) => ({ deparaId: v.id, nomeOrigem: v.nome_origem, nomeOrigemLiteral: v.nome_origem_literal, origem: v.origem })),
        valorTotalNfe, qtdNotas, valorTotalTitulo, qtdTitulos,
      }
    })
    fornecedores.sort((a, b) => (b.valorTotalNfe + b.valorTotalTitulo) - (a.valorTotalNfe + a.valorTotalTitulo))

    return { ok: true, fornecedores }
  } catch (e) {
    return { ok: false, fornecedores: [], error: e instanceof Error ? e.message : String(e) }
  }
}

export type FornecedorActionResultado = { ok: boolean; error?: string }

export async function renomearFornecedor(fornecedorId: string, nome: string): Promise<FornecedorActionResultado> {
  await requireUser()
  if (!nome.trim()) return { ok: false, error: "Nome não pode ser vazio." }
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, error: "Sem conexão com banco" }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("fornecedores").update({ nome: nome.trim() }).eq("id", fornecedorId)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Mescla: move todos os vínculos do fornecedor de origem pro de destino e
// inativa a origem — nunca apaga (soft-merge, igual ao catálogo de
// produtos), então dá pra desfazer movendo os vínculos de volta.
export async function mesclarFornecedores(origemId: string, destinoId: string): Promise<FornecedorActionResultado> {
  await requireUser()
  if (origemId === destinoId) return { ok: false, error: "Selecione dois fornecedores diferentes." }
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, error: "Sem conexão com banco" }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any
    const { error: moverError } = await dbAny.from("fornecedores_depara")
      .update({ fornecedor_id: destinoId }).eq("fornecedor_id", origemId)
    if (moverError) throw new Error(moverError.message)
    const { error: inativarError } = await dbAny.from("fornecedores")
      .update({ ativo: false }).eq("id", origemId)
    if (inativarError) throw new Error(inativarError.message)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function moverVinculoFornecedor(deparaId: string, novoFornecedorId: string): Promise<FornecedorActionResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, error: "Sem conexão com banco" }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("fornecedores_depara").update({ fornecedor_id: novoFornecedorId }).eq("id", deparaId)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
