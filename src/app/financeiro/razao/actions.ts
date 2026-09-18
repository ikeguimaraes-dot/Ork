"use server"

import { createFinanceiroClient } from "@/lib/financeiro/db/client";

import { requireUser } from "@ork/auth/server"

import * as Gerar from "@/lib/financeiro/razao/gerar"

export type {
  GerarLancamentosResultado,
  SnapshotResultado,
  GerarRazaoResultado,
} from "@/lib/financeiro/razao/gerar"

// Cada função aqui é só requireUser() + await createFinanceiroClient() por cima da
// lógica pura em src/lib/financeiro/razao/gerar.ts — a mesma lógica é usada
// por scripts/regerar-razao.ts (CLI, sem sessão de app), sem duplicação.

export async function gerarLancamentosNfeEntrada(
  unitId: string,
  competencia: string
): Promise<Gerar.GerarLancamentosResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, inseridos: 0, error: "Sem conexão com banco" }
  return Gerar.gerarLancamentosNfeEntrada(db, unitId, competencia)
}

export async function gerarLancamentosReceita(
  unitId: string,
  competencia: string
): Promise<Gerar.GerarLancamentosResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, inseridos: 0, error: "Sem conexão com banco" }
  return Gerar.gerarLancamentosReceita(db, unitId, competencia)
}

export async function gerarLancamentosTitulos(
  unitId: string,
  competencia: string
): Promise<Gerar.GerarLancamentosResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, inseridos: 0, error: "Sem conexão com banco" }
  return Gerar.gerarLancamentosTitulos(db, unitId, competencia)
}

export async function gerarLancamentosFolha(
  unitId: string,
  competencia: string
): Promise<Gerar.GerarLancamentosResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, inseridos: 0, error: "Sem conexão com banco" }
  return Gerar.gerarLancamentosFolha(db, unitId, competencia)
}

export async function recalcularSnapshot(
  unitId: string,
  competencia: string
): Promise<Gerar.SnapshotResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, error: "Sem conexão com banco" }
  return Gerar.recalcularSnapshot(db, unitId, competencia)
}

export async function gerarRazao(
  unitId: string,
  competencia: string
): Promise<Gerar.GerarRazaoResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) {
    const semConexao = { ok: false, inseridos: 0, error: "Sem conexão com banco" } as const
    return {
      ok: false,
      nfeEntrada: semConexao,
      titulos: semConexao,
      folha: semConexao,
      receita: semConexao,
      snapshot: { ok: false, error: "Sem conexão com banco" },
    }
  }
  return Gerar.gerarRazao(db, unitId, competencia)
}

// ── PASSO 5: tela de regras de classificação ──────────────────────────────
// Substitui a tela antiga (dependia de titulos_a_pagar.descricao_c_gerencial,
// 100% nula). Agrupa lançamentos em 9.99 por fornecedor — uma decisão de
// classificação vira regra em regras_classificacao, que gerarLancamentosTitulos()
// já aplica em toda execução futura (histórico incluído, ao rodar gerarRazao
// de novo pra competência).

export type FornecedorNaoClassificado = {
  fornecedorNome: string | null
  fornecedorCnpj: string | null
  quantidade: number
  valorTotal: number
}

export type PlanoContaOpcao = { codigo: string; nome: string; grupo: string }

export type GetLancamentosNaoClassificadosResultado = {
  ok: boolean
  totalNaoClassificado: number
  fornecedores: FornecedorNaoClassificado[]
  planoContas: PlanoContaOpcao[]
  error?: string
}

export async function getLancamentosNaoClassificados(
  unitId: string,
  competencia: string
): Promise<GetLancamentosNaoClassificadosResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, totalNaoClassificado: 0, fornecedores: [], planoContas: [], error: "Sem conexão com banco" }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any
    const linhas = await Gerar.fetchAllPaginado((from, to) =>
      dbAny.from("lancamentos")
        .select("fornecedor_nome,fornecedor_cnpj,valor")
        .eq("unit_id", unitId)
        .eq("competencia", competencia)
        .eq("conta_codigo", "9.99")
        .range(from, to)
    ) as Array<{ fornecedor_nome: string | null; fornecedor_cnpj: string | null; valor: number }>

    const grupos = new Map<string, FornecedorNaoClassificado>()
    let totalNaoClassificado = 0
    for (const l of linhas) {
      const valor = Number(l.valor)
      totalNaoClassificado += valor
      const chave = l.fornecedor_cnpj || l.fornecedor_nome || "—"
      const atual = grupos.get(chave) ?? {
        fornecedorNome: l.fornecedor_nome, fornecedorCnpj: l.fornecedor_cnpj, quantidade: 0, valorTotal: 0,
      }
      atual.quantidade += 1
      atual.valorTotal += valor
      grupos.set(chave, atual)
    }
    const fornecedores = [...grupos.values()].sort((a, b) => b.valorTotal - a.valorTotal)

    const planoContasRows = await Gerar.fetchAllPaginado((from, to) =>
      dbAny.from("plano_contas").select("codigo,nome,grupo").neq("codigo", "9.99").order("ordem").range(from, to)
    ) as PlanoContaOpcao[]

    return {
      ok: true,
      totalNaoClassificado: Math.round(totalNaoClassificado * 100) / 100,
      fornecedores,
      planoContas: planoContasRows,
    }
  } catch (e) {
    return { ok: false, totalNaoClassificado: 0, fornecedores: [], planoContas: [], error: e instanceof Error ? e.message : String(e) }
  }
}

export type CriarRegraResultado = { ok: boolean; error?: string }

export async function criarRegraClassificacao(
  unitId: string,
  tipo: "fornecedor_cnpj" | "fornecedor_nome",
  padrao: string,
  contaCodigo: string
): Promise<CriarRegraResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, error: "Sem conexão com banco" }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("regras_classificacao").insert({
      unit_id: unitId, tipo, padrao, conta_codigo: contaCodigo, prioridade: 0,
    })
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export type RegraClassificacao = {
  id: string
  unitId: string | null
  tipo: string
  padrao: string
  contaCodigo: string
  prioridade: number
  criadoEm: string
}

export type ListarRegrasResultado = { ok: boolean; regras: RegraClassificacao[]; error?: string }

export async function listarRegras(unitId: string): Promise<ListarRegrasResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, regras: [], error: "Sem conexão com banco" }
  try {
    const linhas = await Gerar.fetchAllPaginado((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).from("regras_classificacao")
        .select("id,unit_id,tipo,padrao,conta_codigo,prioridade,criado_em")
        .or(`unit_id.is.null,unit_id.eq.${unitId}`)
        .order("criado_em", { ascending: false })
        .range(from, to)
    ) as Array<{ id: string; unit_id: string | null; tipo: string; padrao: string; conta_codigo: string; prioridade: number; criado_em: string }>

    const regras: RegraClassificacao[] = linhas.map((r) => ({
      id: r.id, unitId: r.unit_id, tipo: r.tipo, padrao: r.padrao,
      contaCodigo: r.conta_codigo, prioridade: r.prioridade, criadoEm: r.criado_em,
    }))
    return { ok: true, regras }
  } catch (e) {
    return { ok: false, regras: [], error: e instanceof Error ? e.message : String(e) }
  }
}

export type RemoverRegraResultado = { ok: boolean; error?: string }

export async function removerRegra(id: string): Promise<RemoverRegraResultado> {
  await requireUser()
  const db = await createFinanceiroClient()
  if (!db) return { ok: false, error: "Sem conexão com banco" }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("regras_classificacao").delete().eq("id", id)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
