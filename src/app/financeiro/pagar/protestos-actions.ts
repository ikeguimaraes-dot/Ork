"use server"

import { applyBatch, replacement } from "@/lib/financeiro/db/atomic";
import { stableId } from "@/lib/receita/persist";

import { createFinanceiroClient } from "@/lib/financeiro/db/client";

import {  createSupabaseServerClient } from "@ork/db/supabase/server"
import { getCurrentUnit } from "@ork/auth/unit"
import { requireUser } from "@ork/auth/server"
import { parseProtesto } from "@/lib/protestos/parse-protesto"
import type { TextItemLike, ProtestoRegistro } from "@/lib/protestos/parse-protesto"
// Precisa rodar antes de qualquer import de "pdfjs-dist/..." — ver o
// comentário no próprio arquivo pra entender por que isso é necessário.
import "@/lib/protestos/pdfjs-node-polyfill"

const BUCKET = "protestos"

// Formato gravado no banco — sem `avisos` (é só diagnóstico do parser, não é coluna).
export type ProtestoRegistroRow = Omit<ProtestoRegistro, "avisos"> & { id: string; certidao_id: string }

export type CertidaoProtesto = {
  id: string
  unit_id: string | null
  data_certidao: string | null
  nome_devedor: string | null
  cnpj_devedor: string | null
  protestos_declarados: number
  storage_path: string
  nome_arquivo: string
  tamanho_bytes: number | null
  created_at: string
  registros: ProtestoRegistroRow[]
}

function safeFileName(nome: string) {
  return (
    nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 120) || "arquivo.pdf"
  )
}

// Lista certidões + protestos individuais — respeita o filtro de unidade da
// shell (unitId null = todas as unidades, mesmo padrão do resto do módulo).
export async function getProtestos(unitId: string | null): Promise<CertidaoProtesto[]> {
  try {
    await requireUser()
    const supabase = await createSupabaseServerClient()
    if (!supabase) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    let cq = db
      .from("protestos_certidoes")
      .select("id,unit_id,data_certidao,nome_devedor,cnpj_devedor,protestos_declarados,storage_path,nome_arquivo,tamanho_bytes,created_at")
      .order("created_at", { ascending: false })
    if (unitId) cq = cq.eq("unit_id", unitId)
    const { data: certidoes, error: cErr } = await cq
    if (cErr) {
      console.error("[getProtestos] certidoes:", cErr.message)
      return []
    }
    if (!certidoes || certidoes.length === 0) return []

    const certidaoIds = certidoes.map((c: { id: string }) => c.id)
    const { data: registros, error: rErr } = await db
      .from("protestos_registros")
      .select("*")
      .in("certidao_id", certidaoIds)
      .order("numero_registro", { ascending: true })
    if (rErr) console.error("[getProtestos] registros:", rErr.message)

    const byCertidao = new Map<string, ProtestoRegistroRow[]>()
    for (const r of (registros ?? []) as ProtestoRegistroRow[]) {
      const bucket = byCertidao.get(r.certidao_id) ?? []
      bucket.push(r)
      byCertidao.set(r.certidao_id, bucket)
    }

    return (certidoes as Omit<CertidaoProtesto, "registros">[]).map((c) => ({
      ...c,
      registros: byCertidao.get(c.id) ?? [],
    }))
  } catch (e) {
    console.error("[getProtestos]", e)
    return []
  }
}

// Gera signed upload URL — o client sobe o PDF direto pro Storage (não passa
// pela Vercel, evita o limite de ~4.5 MB de body das functions). Segue a
// mesma infra do módulo Contratos.
export async function getProtestoUploadUrl(
  nome: string
): Promise<{ path: string; token: string; signedUrl: string } | { error: string }> {
  try {
    await requireUser()
    const supabase = await createFinanceiroClient()
    if (!supabase) return { error: "Supabase não configurado" }
    const unit = await getCurrentUnit()
    if (!unit) return { error: "Selecione uma unidade" }
    const path = `${unit.id}/${Date.now()}-${safeFileName(nome)}`
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error || !data) return { error: error?.message ?? "falha ao gerar signed URL" }
    return { path: data.path, token: data.token, signedUrl: data.signedUrl }
  } catch (e) {
    return { error: String(e) }
  }
}

export type ProcessarResultado =
  | { ok: true; certidao_id: string; protestos: number; cancelados: number; unit_id: string | null }
  | { ok: false; error: string }

// Baixa o PDF recém-enviado do Storage, parseia por coordenadas (ver
// parse-protesto.ts) e grava certidão + protestos individuais de forma
// idempotente (upsert por chave natural). unit_id é resolvido comparando o
// CNPJ do devedor lido no PDF contra units.cnpj (normalizado, só dígitos).
export async function processarCertidaoProtesto(input: {
  storage_path: string
  nome_arquivo: string
  tamanho_bytes: number | null
}): Promise<ProcessarResultado> {
  try {
    await requireUser()
    const supabase = await createFinanceiroClient()
    if (!supabase) return { ok: false, error: "Supabase não configurado" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const { data: fileBlob, error: dlErr } = await supabase.storage.from(BUCKET).download(input.storage_path)
    if (dlErr || !fileBlob) return { ok: false, error: dlErr?.message ?? "falha ao baixar PDF do Storage" }

    const buf = new Uint8Array(await fileBlob.arrayBuffer())
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const doc = await getDocument({ data: buf }).promise
    const pages: TextItemLike[][] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const items: TextItemLike[] = []
      for (const it of content.items) {
        if (!("str" in it)) continue
        items.push({ str: it.str, transform: it.transform, width: it.width, height: it.height })
      }
      pages.push(items)
    }

    const parsed = parseProtesto(pages)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const { certidao } = parsed

    // Resolve unit_id pelo CNPJ do devedor (normalizado, só dígitos).
    let unit_id: string | null = null
    if (certidao.cnpj_devedor) {
      const alvo = certidao.cnpj_devedor.replace(/\D/g, "")
      const { data: units } = await db.from("units").select("id,cnpj").not("cnpj", "is", null)
      const match = ((units ?? []) as { id: string; cnpj: string | null }[]).filter(
        (u) => (u.cnpj ?? "").replace(/\D/g, "") === alvo
      )
      if (match.length === 1) unit_id = match[0]!.id
    }

    if (!unit_id || !certidao.cnpj_devedor || !certidao.data_certidao) throw new Error("Certidão sem unidade, CNPJ ou data identificável; nenhum registro foi substituído.")
    if (input.storage_path.split("/")[0] !== unit_id) throw new Error("O CNPJ da certidão não corresponde à unidade selecionada no upload.")
    const { data: existing, error: lookupError } = await db.from("protestos_certidoes").select("id").eq("cnpj_devedor", certidao.cnpj_devedor).eq("data_certidao", certidao.data_certidao).maybeSingle()
    if (lookupError) throw new Error(lookupError.message)
    const certidao_id: string = existing?.id ?? stableId(`protesto|${certidao.cnpj_devedor}|${certidao.data_certidao}`)
    const dedup = new Map<number, ProtestoRegistro>()
    for (const r of certidao.registros) dedup.set(r.numero_registro, r)
    const rows = [...dedup.values()].map(r => ({ ...Object.fromEntries(Object.entries(r).filter(([key]) => key !== "avisos")), certidao_id }))
    await applyBatch(db, [
      { table: "protestos_certidoes", operation: "upsert", conflict: "cnpj_devedor,data_certidao", rows: [{
        id: certidao_id, unit_id, data_certidao: certidao.data_certidao, nome_devedor: certidao.nome_devedor,
        cnpj_devedor: certidao.cnpj_devedor, protestos_declarados: certidao.protestos_declarados,
        storage_path: input.storage_path, nome_arquivo: input.nome_arquivo, tamanho_bytes: input.tamanho_bytes,
      }] },
      ...replacement("protestos_registros", { certidao_id }, rows),
    ])

    const cancelados = certidao.registros.filter((r) => r.situacao === "cancelado").length
    return { ok: true, certidao_id, protestos: certidao.registros.length, cancelados, unit_id }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
