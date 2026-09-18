"use client"

import React, { useState } from "react"
import type { LinhaDetalhadaRow } from "./DreDrillTable"

type DreRow = {
  mes_ano: string
  tipo: "orcado" | "realizado"
  receita_bruta: number | null
  cmv: number | null
  taxa_cartao: number | null
  impostos: number | null
  ebitda: number | null
  resultado_liquido: number | null
  [key: string]: unknown
}

type DespRow = {
  mes_ano: string
  tipo_despesa: string | null
  classificacao_dre: string | null
  valor: number
}

type PrestadorAudit = {
  mes_ano: string
  grupo: string
  nome: string
  valor: number
}

type ContratoAudit = {
  tipo: string | null
  razao_social: string
  descricao: string | null
  valor_mensal: number
}

type ReceitaAudit = {
  mes_ano: string
  bandeira: string
  valor: number
}

export type AuditTabProps = {
  dreRows: DreRow[]
  linhas: LinhaDetalhadaRow[]
  despRows: DespRow[]
  prestadores: PrestadorAudit[]
  contratosFixos: ContratoAudit[]
  receitaDetalhada: ReceitaAudit[]
}

// ── Internal types ─────────────────────────────────────────────────────────────
type AuditSeverity = "critico" | "atencao" | "info"
type AuditHL = "red" | "amber" | "green" | "none"
type AuditRow = { cells: string[]; hl?: AuditHL }
type AuditCheck = {
  id: string
  severity: AuditSeverity
  title: string
  passed: boolean
  summary: string
  headers?: string[]
  rows?: AuditRow[]
  statsLine?: string
  commentary?: string[]
  noData?: boolean
}

// ── Formatters ─────────────────────────────────────────────────────────────────
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
const mesL = (s: string) => MESES[(parseInt(s.split("-")[1]??"1",10)-1)%12] ?? s
const sortM = (a: string, b: string) => {
  const n = (s: string) => { const [y,m] = s.split("-").map(Number); return (y??0)*12+(m??0) }
  return n(a) - n(b)
}
const fmtR = (v: number) =>
  new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0}).format(v)
const fmtP = (v: number) => `${v.toFixed(1).replace(".",",")}%`
const fmtVP = (v: number) => `${v>=0?"+":""}${fmtP(v)}`
const avg = (arr: number[]) => arr.length===0 ? 0 : arr.reduce((a,b)=>a+b,0)/arr.length

// ── Styling maps ───────────────────────────────────────────────────────────────
const SEV_COLOR: Record<AuditSeverity, string> = {
  critico: "#EF4444",
  atencao: "#F59E0B",
  info:    "#60A5FA",
}
const SEV_LABEL: Record<AuditSeverity, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  info:    "Info",
}
const HL_BG: Record<AuditHL, string> = {
  red:   "rgba(239,68,68,0.08)",
  amber: "rgba(245,158,11,0.08)",
  green: "rgba(34,197,94,0.06)",
  none:  "transparent",
}
const HL_COLOR: Record<AuditHL, string> = {
  red:   "#EF4444",
  amber: "#F59E0B",
  green: "#22C55E",
  none:  "var(--text)",
}

// ── V1: Carga tributária ───────────────────────────────────────────────────────
function checkCargaTrib(dreRows: DreRow[], reMeses: string[]): AuditCheck {
  type TaxPoint = { mes: string; rePct: number; bdPct: number; ratio: number; rb: number }
  const points: TaxPoint[] = []
  for (const mes of reMeses) {
    const re = dreRows.find(r => r.mes_ano===mes && r.tipo==="realizado")
    const bd = dreRows.find(r => r.mes_ano===mes && r.tipo==="orcado")
    if (!re?.impostos||!re?.receita_bruta||!bd?.impostos||!bd?.receita_bruta) continue
    points.push({
      mes,
      rePct: Math.abs(re.impostos/re.receita_bruta*100),
      bdPct: Math.abs(bd.impostos/bd.receita_bruta*100),
      ratio: Math.abs(re.impostos/re.receita_bruta)/Math.abs(bd.impostos/bd.receita_bruta),
      rb: re.receita_bruta,
    })
  }

  const rows: AuditRow[] = points.map(p => {
    const hl: AuditHL = p.ratio<0.5?"red":p.ratio<0.8?"amber":"green"
    return { cells:[mesL(p.mes),fmtP(p.bdPct),fmtP(p.rePct),fmtP(p.ratio*100)], hl }
  })
  const anyBad = points.some(p => p.ratio<0.8)

  // ── Commentary ──
  const commentary: string[] = []
  if (anyBad && points.length > 0) {
    const rePcts = points.map(p=>p.rePct)
    const bdPcts = points.map(p=>p.bdPct)
    const worst  = points.reduce((a,b)=>a.ratio<b.ratio?a:b)
    const impact = points.reduce((s,p)=>(s+(p.bdPct/100-p.rePct/100)*p.rb),0)
    const avgBd  = avg(bdPcts)
    const firstM = mesL(points[0]!.mes), lastM = mesL(points[points.length-1]!.mes)

    commentary.push(
      `A carga tributária realizada ficou entre ${fmtP(Math.min(...rePcts))} e ${fmtP(Math.max(...rePcts))} da Receita Bruta nos meses analisados, contra um orçado de ${fmtP(Math.min(...bdPcts))}–${fmtP(Math.max(...bdPcts))}. ${mesL(worst.mes)} apresentou a maior discrepância: ${fmtP(worst.rePct)} realizado contra ${fmtP(worst.bdPct)} orçado (${fmtP(worst.ratio*100)} do previsto).`
    )
    commentary.push(
      `Três hipóteses possíveis: (1) imposto lançado por regime de caixa com defasagem — o pagamento ocorre no mês seguinte e não há provisionamento por competência; (2) subprovisionamento — o passivo tributário cresce de forma não registrada no resultado; (3) erro de classificação contábil — lançamentos tributários alocados em outras categorias de despesa.`
    )
    commentary.push(
      `⚠️ Impacto: se a carga efetiva for ~${fmtP(avgBd)} (como orçado), o EBITDA realizado de ${firstM}–${lastM} está superestimado em aproximadamente ${fmtR(impact)} — diferença entre o imposto que deveria ter sido provisionado e o que foi registrado.`
    )
    commentary.push(
      `Ação recomendada: verificar com o contador se os impostos estão sendo provisionados por competência ou lançados apenas no pagamento. Confirmar o regime tributário atual (Lucro Presumido, Simples Nacional, Lucro Real) e a alíquota efetiva esperada.`
    )
  }

  return {
    id:"v1", severity:"critico", title:"Carga tributária anômala",
    passed:!anyBad,
    summary: anyBad ? "Imposto/RB realizado abaixo de 80% do orçado em algum mês" : "Carga tributária dentro do esperado",
    headers: rows.length>0 ? ["Mês","BD %RB","RE %RB","RE/BD"] : undefined,
    rows:    rows.length>0 ? rows : undefined,
    commentary: commentary.length>0 ? commentary : undefined,
  }
}

// ── V4: CMV Planilha vs CMV Consumo ───────────────────────────────────────────
function checkCMVConsumo(linhas: LinhaDetalhadaRow[], dreRows: DreRow[]): AuditCheck {
  const cmvL = linhas.filter(l => l.grupo==="CMV" && !l.descricao.endsWith(" %"))
  if (cmvL.length===0) return {
    id:"v4", severity:"critico", title:"CMV Planilha vs CMV Consumo",
    passed:true, summary:"Sem dados detalhados de CMV", noData:true,
  }

  const meses = [...new Set(cmvL.map(l=>l.mes_ano))].sort(sortM)
  const rows: AuditRow[] = []
  let anyBad = false

  // Accumulate RE months for commentary
  let accPlanilhaRE = 0, accConsumoRE = 0, accRLRE = 0
  let minEF = Infinity, maxEF = -Infinity
  const reMeses = [...new Set(dreRows.filter(r=>r.tipo==="realizado").map(r=>r.mes_ano))].sort(sortM)

  for (const mes of meses) {
    for (const tipo of ["orcado","realizado"] as const) {
      const ml = cmvL.filter(l=>l.mes_ano===mes&&l.tipo===tipo)
      if (ml.length===0) continue
      const total = ml.find(l=>l.descricao.endsWith("Total"))
      if (!total?.valor) continue
      const eiL = ml.filter(l => l.descricao.toLowerCase().includes("estoque ini"))
      const efL = ml.filter(l => l.descricao.toLowerCase().includes("estoque fin"))
      const ei     = eiL.reduce((s,l)=>s+Math.abs(l.valor??0),0)
      const ef     = efL.reduce((s,l)=>s+Math.abs(l.valor??0),0)
      const compras = ml
        .filter(l=>!l.descricao.endsWith("Total")&&!eiL.includes(l)&&!efL.includes(l))
        .reduce((s,l)=>s+Math.abs(l.valor??0),0)
      const cmvConsumo  = ei + compras - ef
      const cmvPlanilha = Math.abs(total.valor)
      const div    = cmvConsumo - cmvPlanilha
      const divPct = cmvPlanilha>0 ? div/cmvPlanilha*100 : 0
      const hl: AuditHL = Math.abs(divPct)>25?"red":Math.abs(divPct)>10?"amber":"none"
      if (hl==="red") anyBad = true
      rows.push({
        cells:[`${mesL(mes)} ${tipo==="orcado"?"BD":"RE"}`,fmtR(cmvPlanilha),fmtR(cmvConsumo),fmtR(div),fmtVP(divPct)],
        hl,
      })

      if (tipo==="realizado" && reMeses.includes(mes)) {
        accPlanilhaRE += cmvPlanilha
        accConsumoRE  += cmvConsumo
        const reRow = dreRows.find(r=>r.mes_ano===mes&&r.tipo==="realizado")
        if (reRow) accRLRE += (reRow.receita_bruta??0)+(reRow.impostos??0)
        if (ef>0) { minEF = Math.min(minEF,ef); maxEF = Math.max(maxEF,ef) }
      }
    }
  }

  // ── Commentary ──
  const commentary: string[] = []
  if (anyBad) {
    const planilhaPct = accRLRE>0 ? accPlanilhaRE/accRLRE*100 : null
    const consumoPct  = accRLRE>0 ? accConsumoRE/accRLRE*100  : null
    const delta       = accConsumoRE - accPlanilhaRE
    const ppDiff      = planilhaPct!==null&&consumoPct!==null ? Math.abs(planilhaPct-consumoPct) : null
    const firstM = reMeses.length>0 ? mesL(reMeses[0]??"") : "—"
    const lastM  = reMeses.length>0 ? mesL(reMeses[reMeses.length-1]??"") : "—"

    commentary.push(
      `A planilha calcula o CMV somando a variação de estoque na direção inversa ao padrão contábil: trata o Estoque Final como custo adicional em vez de crédito (planilha: CMV = Compras − Estoque Inicial + Estoque Final; padrão: CMV = Estoque Inicial + Compras − Estoque Final). Isso faz o CMV registrado ser maior quando o estoque cresce e menor quando o estoque cai.`
    )
    if (accRLRE>0) {
      commentary.push(
        `Acumulado ${firstM}–${lastM}: a planilha registra CMV de ${fmtR(accPlanilhaRE)}${planilhaPct!==null?` (${fmtP(planilhaPct)} da Receita Líquida)`:""}` +
        `, enquanto o método de consumo aponta ${fmtR(accConsumoRE)}${consumoPct!==null?` (${fmtP(consumoPct)})`:""}` +
        `. Diferença acumulada: ${fmtR(Math.abs(delta))}` +
        (ppDiff!==null ? ` — o CMV real é ~${ppDiff.toFixed(1)} pp ${delta<0?"menor":"maior"} que o registrado` : "") + `.`
      )
    }
    if (minEF!==Infinity && maxEF!==-Infinity) {
      commentary.push(
        `O estoque de fechamento mensal varia entre ${fmtR(minEF)} e ${fmtR(maxEF)}, tornando o CMV de qualquer mês isolado pouco confiável para avaliar eficiência operacional. Variações expressivas sugerem que os valores de inventário podem ser estimativas, não contagens físicas.`
      )
    }
    if (consumoPct!==null) {
      commentary.push(
        `CMV pelo consumo acumulado (método correto): ${fmtR(accConsumoRE)} = ${fmtP(consumoPct)} da Receita Líquida — use este número para comparar eficiência entre períodos.`
      )
    }
    commentary.push(
      `Ação recomendada: (1) confirmar com o contador a fórmula de apuração do CMV e a convenção de Estoque Inicial/Final; (2) implementar contagem física mensal de estoque para garantir que os valores de inventário são reais; (3) usar o CMV acumulado do período como indicador de eficiência de cozinha, não o mensal.`
    )
  }

  return {
    id:"v4", severity:"critico", title:"CMV Planilha vs CMV Consumo",
    passed:!anyBad,
    summary: anyBad
      ? "Divergência >25% — distorção de estoque detectada (CMV consumo ≠ CMV planilha)"
      : "CMV planilha próximo ao CMV pelo consumo",
    headers:["Mês/Tipo","CMV Planilha","CMV Consumo","Δ R$","Δ%"],
    rows: rows.length>0 ? rows : undefined,
    commentary: commentary.length>0 ? commentary : undefined,
  }
}

// ── V2: Concentração PJ/Honorários ────────────────────────────────────────────
function checkConcentracaoPJ(
  linhas: LinhaDetalhadaRow[],
  dreRows: DreRow[],
  reMeses: string[],
  prestadores: PrestadorAudit[],
  contratosFixos: ContratoAudit[],
): AuditCheck {
  // Monthly fixed overhead from standing contracts (OPERAÇÃO + ADMINISTRATIVA)
  const CONTRATO_TIPOS = ["OPERAÇÃO","OPERACAO","ADMINISTRATIVA","ADM"]
  const contratosMonthly = contratosFixos
    .filter(c => CONTRATO_TIPOS.some(t=>(c.tipo??"").toUpperCase().includes(t)))
    .reduce((s,c)=>s+Math.abs(c.valor_mensal??0),0)

  // Consultoria / Honorários from linhas_detalhadas (realizado)
  const CONSULT_KW = ["consultoria","honorário","honorarios","honorar","direção","direcao"]
  const consultByMes = new Map<string,number>()
  for (const l of linhas) {
    if (l.tipo!=="realizado" || !l.valor) continue
    const desc = (l.descricao??"").toLowerCase()
    if (CONSULT_KW.some(k=>desc.includes(k)))
      consultByMes.set(l.mes_ano,(consultByMes.get(l.mes_ano)??0)+Math.abs(l.valor))
  }

  // Prestadores PJ by month and by grupo
  const pjOpByMes    = new Map<string,number>()
  const pjAdmByMes   = new Map<string,number>()
  for (const p of prestadores) {
    const grp = (p.grupo??"").toLowerCase()
    const isOp = grp.includes("1")||grp.toLowerCase().includes("op")
    const map  = isOp ? pjOpByMes : pjAdmByMes
    map.set(p.mes_ano,(map.get(p.mes_ano)??0)+Math.abs(p.valor??0))
  }

  // Build combined total per RE month
  const byMes = new Map<string,number>()
  for (const mes of reMeses) {
    const pjOp    = pjOpByMes.get(mes)??0
    const pjAdm   = pjAdmByMes.get(mes)??0
    const consult = consultByMes.get(mes)??0
    const total   = pjOp + pjAdm + contratosMonthly + consult
    if (total > 0) byMes.set(mes, total)
  }

  const noSources = prestadores.length===0 && contratosFixos.length===0 && [...consultByMes.values()].every(v=>v===0)
  if (noSources) return {
    id:"v2", severity:"atencao", title:"Concentração PJ/Honorários",
    passed:true, summary:"Sem dados de prestadores ou contratos carregados", noData:true,
  }

  const rows: AuditRow[] = []
  let anyBad = false

  for (const mes of reMeses) {
    const tot = byMes.get(mes)??0
    if (tot===0) continue
    const re  = dreRows.find(r=>r.mes_ano===mes&&r.tipo==="realizado")
    const rb  = re?.receita_bruta??0
    const pct = rb>0 ? tot/rb*100 : 0
    const hl: AuditHL = pct>10?"red":pct>7?"amber":"green"
    if (hl==="red"||hl==="amber") anyBad = true
    rows.push({ cells:[mesL(mes),fmtR(tot),fmtP(pct)], hl })
  }

  if (rows.length===0) return {
    id:"v2", severity:"atencao", title:"Concentração PJ/Honorários",
    passed:true, summary:"Nenhum valor PJ/Honorários nos meses realizados", noData:true,
  }

  // ── Commentary ──
  const commentary: string[] = []
  if (anyBad) {
    const allTotals = [...byMes.values()]
    const avgMonthly = avg(allTotals)
    const maxEntry   = [...byMes.entries()].reduce((a,b)=>b[1]>a[1]?b:a)
    const maxRe      = dreRows.find(r=>r.mes_ano===maxEntry[0]&&r.tipo==="realizado")
    const maxPct     = (maxRe?.receita_bruta??0)>0 ? maxEntry[1]/(maxRe!.receita_bruta!)*100 : 0

    // Build category breakdown for top-3
    const cats: { label: string; val: number }[] = []
    const avgPjOp  = avg(reMeses.map(m=>pjOpByMes.get(m)??0).filter(v=>v>0))
    const avgPjAdm = avg(reMeses.map(m=>pjAdmByMes.get(m)??0).filter(v=>v>0))
    const avgConsult = avg(reMeses.map(m=>consultByMes.get(m)??0).filter(v=>v>0))
    if (avgPjOp>0)      cats.push({ label:"Prestadores PJ Operação",    val:avgPjOp })
    if (avgPjAdm>0)     cats.push({ label:"Prestadores PJ Administrativo",val:avgPjAdm })
    if (contratosMonthly>0) cats.push({ label:"Contratos Fixos",         val:contratosMonthly })
    if (avgConsult>0)   cats.push({ label:"Consultoria/Honorários (DRE)",val:avgConsult })
    const topStr = cats.sort((a,b)=>b.val-a.val).slice(0,3).map(c=>`${c.label} (${fmtR(c.val)}/mês)`).join(", ")

    commentary.push(
      `O total mensal de serviços PJ, consultorias e honorários soma em média ${fmtR(avgMonthly)}/mês, com pico de ${fmtR(maxEntry[1])} em ${mesL(maxEntry[0])} (${fmtP(maxPct)} da Receita Bruta).` +
      (topStr ? ` Principais categorias: ${topStr}.` : "")
    )
    commentary.push(
      `Uma concentração acima de 10% da receita em serviços terceirizados e honorários é incomum para operações deste porte e merece revisão detalhada.`
    )
    commentary.push(
      `Ação recomendada: mapear cada contrato e responder — (a) trata-se de serviço efetivo ou de remuneração de sócio estruturada como PJ? (b) o serviço é essencial ou pode ser internalizado? (c) existe contrato formal com escopo e valor definidos? Variabilizar ou eliminar parte desses custos fixos reduz diretamente o ponto de equilíbrio da operação.`
    )
  }

  return {
    id:"v2", severity:"atencao", title:"Concentração PJ/Honorários",
    passed:!anyBad,
    summary: anyBad ? "PJ/Honorários acima de 7% da receita bruta" : "Concentração PJ dentro do limite",
    headers:["Mês","Total PJ/Honorários","% RB"],
    rows,
    commentary: commentary.length>0 ? commentary : undefined,
  }
}

// ── V3: Gorjetas ──────────────────────────────────────────────────────────────
function checkGorjeta(linhas: LinhaDetalhadaRow[], reMeses: string[]): AuditCheck {
  type GorPoint = { mes: string; pagasAbs: number; bdAbs: number|null; varPct: number|null; passPct: number|null }
  const points: GorPoint[] = []

  for (const mes of reMeses) {
    const reL   = linhas.filter(l=>l.mes_ano===mes&&l.tipo==="realizado"&&l.grupo==="PESSOAL")
    if (reL.length===0) continue
    const pagas = reL.find(l=>l.descricao==="Gorjetas Pagas")
    if (!pagas?.valor) continue
    const ret     = reL.find(l=>l.descricao==="Retenção de Gorjeta")
    const bdPagas = linhas.find(l=>l.mes_ano===mes&&l.tipo==="orcado"&&l.descricao==="Gorjetas Pagas")
    const pagasAbs = Math.abs(pagas.valor)
    const retAbs   = ret?.valor!=null ? Math.abs(ret.valor) : 0
    const gross    = pagasAbs + retAbs
    points.push({
      mes,
      pagasAbs,
      bdAbs:    bdPagas?.valor!=null ? Math.abs(bdPagas.valor) : null,
      varPct:   bdPagas?.valor!=null ? (pagasAbs-Math.abs(bdPagas.valor))/Math.abs(bdPagas.valor)*100 : null,
      passPct:  gross>0 ? pagasAbs/gross*100 : null,
    })
  }

  const rows: AuditRow[] = points.map(p => {
    const hl: AuditHL = p.varPct!==null&&Math.abs(p.varPct)>20?"amber":"none"
    return {
      cells:[mesL(p.mes),fmtR(p.pagasAbs),p.bdAbs?fmtR(p.bdAbs):"—",p.varPct!==null?fmtVP(p.varPct):"—",p.passPct!==null?fmtP(p.passPct):"—"],
      hl,
    }
  })
  const anyBad = points.some(p=>p.varPct!==null&&Math.abs(p.varPct)>20)

  // ── Commentary ──
  const commentary: string[] = []
  if (rows.length>0) {
    const avgPagas = avg(points.map(p=>p.pagasAbs))
    const withVar  = points.filter(p=>p.varPct!==null)
    const worstVar = withVar.length>0 ? withVar.reduce((a,b)=>Math.abs(b.varPct!)>Math.abs(a.varPct!)?b:a) : null

    commentary.push(
      `A gorjeta é tecnicamente um repasse — o restaurante coleta e redistribui aos funcionários. O custo real para a casa são apenas os encargos incidentes sobre o valor pago (INSS patronal, FGTS, férias, 13º), não o valor bruto repassado.`
    )
    commentary.push(
      `Registrar a Gorjeta Paga integralmente como despesa de Pessoal — sem contrapartida da Gorjeta Recebida — deprime o EBITDA em aproximadamente ${fmtR(avgPagas)}/mês em média.` +
      (anyBad && worstVar?.varPct!=null ? ` O mês com maior desvio em relação ao orçado foi ${mesL(worstVar.mes)}: ${fmtVP(worstVar.varPct)}.` : "")
    )
    commentary.push(
      `Ação recomendada: confirmar com o contador se a gorjeta deve transitar integralmente pelo resultado ou apenas pelos encargos patronais. Avaliar se a linha "Pessoal Operacional" (excluindo gorjetas) é a métrica mais adequada para comparar eficiência de pessoal entre períodos.`
    )
  }

  return {
    id:"v3", severity:"atencao", title:"Gorjetas Pagas vs orçado",
    passed:!anyBad,
    summary: rows.length===0 ? "Sem dados de gorjeta realizados"
      : anyBad ? "Gorjetas Pagas divergem >20% do orçado" : "Gorjetas Pagas dentro do esperado",
    headers: rows.length>0 ? ["Mês","Pagas (RE)","Orçado","Δ%","Pass-through"] : undefined,
    rows:    rows.length>0 ? rows : undefined,
    commentary: commentary.length>0 ? commentary : undefined,
  }
}

// ── V5: RL > RB ───────────────────────────────────────────────────────────────
function checkRLvRB(dreRows: DreRow[]): AuditCheck {
  const rows: AuditRow[] = []
  for (const r of dreRows) {
    if (r.receita_bruta==null||r.impostos==null) continue
    const rl = r.receita_bruta + r.impostos
    if (rl > r.receita_bruta)
      rows.push({ cells:[mesL(r.mes_ano),r.tipo==="orcado"?"BD":"RE",fmtR(r.receita_bruta),fmtR(rl)], hl:"red" })
  }
  return {
    id:"v5", severity:"atencao", title:"Receita Líquida > Receita Bruta",
    passed:rows.length===0,
    summary: rows.length===0 ? "RL sempre ≤ RB" : `${rows.length} ocorrência(s) onde RL > RB`,
    headers: rows.length>0 ? ["Mês","Tipo","RB","RL"] : undefined,
    rows:    rows.length>0 ? rows : undefined,
  }
}

// ── V6: Ponto de equilíbrio ───────────────────────────────────────────────────
function checkBreakEven(dreRows: DreRow[], linhas: LinhaDetalhadaRow[], reMeses: string[]): AuditCheck {
  const allMeses = [...new Set(dreRows.filter(r=>r.tipo==="orcado").map(r=>r.mes_ano))].sort(sortM)

  type BEPoint = {
    mes: string; cf: number; cvBd: number; bdRL: number; bdBE: number|null
    hasRE: boolean; reRL: number|null; reBE: number|null; below: boolean
  }
  const points: BEPoint[] = []

  for (const mes of allMeses) {
    const bd = dreRows.find(r=>r.mes_ano===mes&&r.tipo==="orcado")
    if (!bd) continue
    const bdRL = (bd.receita_bruta??0)+(bd.impostos??0)
    const fL = linhas.filter(l=>
      l.mes_ano===mes&&l.tipo==="orcado"&&l.custo_tipo==="F"&&
      !l.descricao.endsWith("Total")&&!l.descricao.endsWith(" %")
    )
    const vL = linhas.filter(l=>
      l.mes_ano===mes&&l.tipo==="orcado"&&l.custo_tipo==="V"&&
      !l.descricao.endsWith("Total")&&!l.descricao.endsWith(" %")&&
      l.grupo!=="CMV"&&!l.grupo.includes("TAXA")&&!l.grupo.includes("CARTÃO")
    )
    const cf   = fL.reduce((s,l)=>s+Math.abs(l.valor??0),0)
    const cvV  = vL.reduce((s,l)=>s+Math.abs(l.valor??0),0)
    const cvBd = Math.abs(bd.cmv??0)+Math.abs(bd.taxa_cartao??0)+cvV
    const bdBE = bdRL>0&&cvBd<bdRL ? cf/(1-cvBd/bdRL) : null

    const hasRE = reMeses.includes(mes)
    const re    = hasRE ? dreRows.find(r=>r.mes_ano===mes&&r.tipo==="realizado") : undefined
    let reRL: number|null = null, reBE: number|null = null
    if (re) {
      reRL = (re.receita_bruta??0)+(re.impostos??0)
      const cvRe = Math.abs(re.cmv??0)+Math.abs(re.taxa_cartao??0)
      reBE = reRL>0&&cf>0&&cvRe<reRL ? cf/(1-cvRe/reRL) : null
    }
    const below = hasRE && reRL!==null && reBE!==null && reRL<reBE
    points.push({ mes, cf, cvBd, bdRL, bdBE, hasRE, reRL, reBE, below })
  }

  const rows: AuditRow[] = points.map(p => ({
    cells:[
      mesL(p.mes),
      p.bdBE?fmtR(p.bdBE):"—",
      p.reRL!==null?fmtR(p.reRL):"—",
      p.reBE!==null?fmtR(p.reBE):"—",
      p.hasRE?(p.below?"✗ Abaixo":"✓ Acima"):"—",
    ],
    hl: p.below?"red":p.hasRE&&p.reRL!==null?"green":"none",
  }))
  const anyBad = points.some(p=>p.below)

  // ── Stats line ──
  const cfValues  = points.map(p=>p.cf).filter(v=>v>0)
  const mcValues  = points.filter(p=>p.bdRL>0&&p.cvBd>0).map(p=>(1-p.cvBd/p.bdRL)*100)
  const beValues  = points.filter(p=>p.bdBE!==null).map(p=>p.bdBE!)
  const avgCF     = cfValues.length>0 ? avg(cfValues)  : 0
  const avgMCPct  = mcValues.length>0 ? avg(mcValues)  : null
  const avgBE     = beValues.length>0 ? avg(beValues)  : null

  const statsLine = avgCF>0 && avgMCPct!==null && avgBE!==null
    ? `CF médio ${fmtR(avgCF)}/mês   ·   MC% médio ${fmtP(avgMCPct)}   ·   PE médio ${fmtR(avgBE)}/mês`
    : undefined

  // CF variation debug
  const cfMin    = cfValues.length>0 ? Math.min(...cfValues) : 0
  const cfMax    = cfValues.length>0 ? Math.max(...cfValues) : 0
  const cfVarPct = avgCF>0 ? (cfMax-cfMin)/avgCF*100 : 0

  const commentary: string[] = []
  if (points.length>0) {
    const belowPoints = points.filter(p=>p.below)
    if (avgCF>0 && avgMCPct!==null) {
      commentary.push(
        `Com custos fixos médios de ${fmtR(avgCF)}/mês e margem de contribuição de ~${fmtP(avgMCPct)}, a operação precisa de ${avgBE?fmtR(avgBE)+"/mês":""} de Receita Líquida para cobrir todos os custos (ponto de equilíbrio orçado).`
      )
    }
    if (belowPoints.length>0) {
      const detail = belowPoints.map(p=>`${mesL(p.mes)}: RL ${p.reRL!==null?fmtR(p.reRL):"—"} vs PE ${p.reBE!==null?fmtR(p.reBE):"—"}`).join("; ")
      commentary.push(`${belowPoints.map(p=>mesL(p.mes)).join(" e ")} ${belowPoints.length===1?"ficou":"ficaram"} abaixo do ponto de equilíbrio — ${detail}.`)
    }
    if (cfVarPct>15) {
      const fByDesc = new Map<string,Map<string,number>>()
      for (const mes of allMeses) {
        const fL = linhas.filter(l=>
          l.mes_ano===mes&&l.tipo==="orcado"&&l.custo_tipo==="F"&&
          !l.descricao.endsWith("Total")&&!l.descricao.endsWith(" %")
        )
        for (const l of fL) {
          const key = `${l.grupo} — ${l.descricao}`
          if (!fByDesc.has(key)) fByDesc.set(key, new Map())
          fByDesc.get(key)!.set(mes, Math.abs(l.valor??0))
        }
      }
      const varying = [...fByDesc.entries()]
        .map(([key,mesMap])=>{
          const vals=[...mesMap.values()]; const vA=avg(vals)
          return { key, vPct:vA>0?(Math.max(...vals)-Math.min(...vals))/vA*100:0, vMin:Math.min(...vals), vMax:Math.max(...vals) }
        })
        .filter(v=>v.vPct>20)
        .sort((a,b)=>b.vPct-a.vPct)
        .slice(0,5)
      if (varying.length>0) {
        commentary.push(`⚠️ CF varia ${fmtP(cfVarPct)} entre meses — linhas com maior instabilidade: ${varying.map(v=>`${v.key} (${fmtR(v.vMin)}–${fmtR(v.vMax)})`).join("; ")}. Verificar se essas linhas são realmente fixas ou contêm lançamentos sazonais.`)
      } else {
        commentary.push(`⚠️ CF varia ${fmtP(cfVarPct)} entre meses (${fmtR(cfMin)}–${fmtR(cfMax)}). A variação pode ser fruto de linhas com valores mensais distintos no orçamento — não necessariamente um erro de classificação.`)
      }
    }
    commentary.push(
      `Importante: o break-even calculado usa a estrutura de custos do orçado (custo_tipo F/V), pois as linhas do realizado não possuem essa tag. Uma calibração precisa exige taggear custo_tipo nas linhas do realizado — especialmente Pessoal e Operação.`
    )
    commentary.push(
      `Ação recomendada: taggear custo_tipo (F/V) em todas as linhas do realizado para calcular o break-even com precisão. Avaliar a conversão de custos fixos em variáveis para aumentar a resiliência em meses de baixa receita.`
    )
  }

  return {
    id:"v6", severity:"atencao", title:"Ponto de equilíbrio",
    passed:!anyBad,
    summary: anyBad ? "RL realizada abaixo do ponto de equilíbrio em algum mês" : "RL realizada acima do ponto de equilíbrio",
    headers:["Mês","PE Orçado","RL Real.","PE Real. (aprox.)","Status"],
    rows:      rows.length>0 ? rows : undefined,
    statsLine,
    commentary: commentary.length>0 ? commentary : undefined,
  }
}

// ── V7: Lançamentos sem classificação ─────────────────────────────────────────
function checkSemClass(despRows: DespRow[]): AuditCheck {
  if (despRows.length===0) return {
    id:"v7", severity:"info", title:"Lançamentos sem classificação",
    passed:true, summary:"Sem dados de despesas detalhadas", noData:true,
  }
  const sem = despRows.filter(d=>!d.classificacao_dre||!d.tipo_despesa)
  if (sem.length===0) return {
    id:"v7", severity:"info", title:"Lançamentos sem classificação",
    passed:true, summary:"Todos os lançamentos têm classificação DRE",
  }
  const byMes    = new Map<string,number>()
  const totByMes = new Map<string,number>()
  for (const d of sem) byMes.set(d.mes_ano,(byMes.get(d.mes_ano)??0)+1)
  for (const d of despRows) totByMes.set(d.mes_ano,(totByMes.get(d.mes_ano)??0)+1)
  const rows: AuditRow[] = [...byMes.entries()].sort(([a],[b])=>sortM(a,b)).map(([mes,cnt])=>{
    const tot = totByMes.get(mes)??1
    const pct = cnt/tot*100
    return { cells:[mesL(mes),String(cnt),fmtP(pct)], hl:(pct>5?"amber":"none") as AuditHL }
  })
  return {
    id:"v7", severity:"info", title:"Lançamentos sem classificação DRE",
    passed:false,
    summary:`${sem.length} lançamento(s) sem classificação em ${byMes.size} mês(es)`,
    headers:["Mês","Qtd","% do total"],
    rows,
  }
}

// ── V8: Reconciliação de receita ──────────────────────────────────────────────
// Compares dre_mensal.receita_bruta (realizado) against SUM(dre_receita_detalhada)
// Known divergence: Abril original had voucher (~R$8k) missing before sql/003 correction
function checkReconciliacao(dreRows: DreRow[], reMeses: string[], receitaDetalhada: ReceitaAudit[]): AuditCheck {
  if (receitaDetalhada.length===0) return {
    id:"v8", severity:"info", title:"Reconciliação de receita",
    passed:true, summary:"Sem dados de receita detalhada para reconciliar", noData:true,
  }

  // Sum dre_receita_detalhada by month
  const detalhadaByMes = new Map<string,number>()
  const bandeirasByMes = new Map<string,{bandeira:string;valor:number}[]>()
  for (const r of receitaDetalhada) {
    detalhadaByMes.set(r.mes_ano,(detalhadaByMes.get(r.mes_ano)??0)+r.valor)
    if (!bandeirasByMes.has(r.mes_ano)) bandeirasByMes.set(r.mes_ano,[])
    bandeirasByMes.get(r.mes_ano)!.push({ bandeira:r.bandeira, valor:r.valor })
  }

  if (detalhadaByMes.size===0) return {
    id:"v8", severity:"info", title:"Reconciliação de receita",
    passed:true, summary:"Sem dados de receita detalhada para reconciliar", noData:true,
  }

  const rows: AuditRow[] = []
  let anyBad = false

  for (const mes of reMeses) {
    const mensal  = dreRows.find(r=>r.mes_ano===mes&&r.tipo==="realizado")
    const detalh  = detalhadaByMes.get(mes)
    if (!mensal?.receita_bruta || detalh==null) continue
    const rb   = mensal.receita_bruta
    const diff = detalh - rb
    const pct  = Math.abs(diff/rb*100)
    const hl: AuditHL = pct>2?"red":pct>0.5?"amber":"green"
    if (hl==="red"||hl==="amber") anyBad = true
    rows.push({ cells:[mesL(mes),fmtR(rb),fmtR(detalh),fmtR(diff),fmtP(pct)], hl })
  }

  if (rows.length===0) return {
    id:"v8", severity:"info", title:"Reconciliação de receita",
    passed:true, summary:"Dados insuficientes para reconciliação", noData:true,
  }

  // ── Commentary for divergent months ──
  type ReconcEntry = { mes: string; rb: number; detalh: number; diff: number }
  const badEntries: ReconcEntry[] = []
  for (const mes of reMeses) {
    const mensal = dreRows.find(r=>r.mes_ano===mes&&r.tipo==="realizado")
    const detalh = detalhadaByMes.get(mes)
    if (!mensal?.receita_bruta || detalh==null) continue
    const rb   = mensal.receita_bruta
    const diff = detalh - rb
    const pct  = Math.abs(diff/rb*100)
    if (pct>0.5) badEntries.push({ mes, rb, detalh, diff })
  }

  const commentary: string[] = []
  if (anyBad) {
    for (const e of badEntries) {
      const bandeiras = bandeirasByMes.get(e.mes)??[]
      const sorted    = [...bandeiras].sort((a,b)=>b.valor-a.valor)
      const top3      = sorted.slice(0,3).map(b=>`${b.bandeira}: ${fmtR(b.valor)}`).join(", ")
      commentary.push(
        `${mesL(e.mes)}: DRE mensal registra ${fmtR(e.rb)} mas a soma por bandeira totaliza ${fmtR(e.detalh)} — diferença de ${fmtR(Math.abs(e.diff))}. Maiores bandeiras: ${top3}.`
      )
    }
    commentary.push(
      `Uma divergência indica que o DRE mensal não foi atualizado após a importação dos dados de receita por bandeira. Execute o UPDATE correspondente (sql/003 ou similar) para sincronizar receita_bruta com a soma detalhada.`
    )
  }

  return {
    id:"v8", severity:"info", title:"Reconciliação de receita",
    passed:!anyBad,
    summary: anyBad
      ? `Divergência entre DRE mensal e receita por bandeira`
      : "Receita DRE mensal = soma receita por bandeira",
    headers:["Mês","DRE Mensal","Soma Bandeiras","Δ R$","Δ%"],
    rows,
    commentary: commentary.length>0 ? commentary : undefined,
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AuditTab({ dreRows, linhas, despRows, prestadores, contratosFixos, receitaDetalhada }: AuditTabProps) {
  const reMeses = [...new Set(dreRows.filter(r=>r.tipo==="realizado").map(r=>r.mes_ano))].sort(sortM)

  const checks: AuditCheck[] = [
    checkCargaTrib(dreRows, reMeses),
    checkCMVConsumo(linhas, dreRows),
    checkConcentracaoPJ(linhas, dreRows, reMeses, prestadores, contratosFixos),
    checkGorjeta(linhas, reMeses),
    checkRLvRB(dreRows),
    checkBreakEven(dreRows, linhas, reMeses),
    checkSemClass(despRows),
    checkReconciliacao(dreRows, reMeses, receitaDetalhada),
  ]

  const sorted = [...checks].sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? 1 : -1
    const order = { critico:0, atencao:1, info:2 }
    return order[a.severity] - order[b.severity]
  })

  const nCritico = checks.filter(c=>!c.passed&&!c.noData&&c.severity==="critico").length
  const nAtencao = checks.filter(c=>!c.passed&&!c.noData&&c.severity==="atencao").length
  const nOk      = checks.filter(c=>c.passed&&!c.noData).length

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(checks.filter(c=>!c.passed&&(c.rows??[]).length>0).map(c=>c.id))
  )
  const toggle = (id: string) => setExpanded(s => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n
  })

  return (
    <div style={{ display:"grid", gap:16 }}>
      {/* ── Summary banner ── */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center", marginBottom:4 }}>
        {nCritico>0 && (
          <span style={{ fontSize:12,fontWeight:700,padding:"4px 12px",borderRadius:99,background:"rgba(239,68,68,0.12)",color:"#EF4444" }}>
            🔴 {nCritico} crítico{nCritico!==1?"s":""}
          </span>
        )}
        {nAtencao>0 && (
          <span style={{ fontSize:12,fontWeight:700,padding:"4px 12px",borderRadius:99,background:"rgba(245,158,11,0.12)",color:"#F59E0B" }}>
            🟡 {nAtencao} atenção{nAtencao!==1?"ões":""}
          </span>
        )}
        {nOk>0 && (
          <span style={{ fontSize:12,fontWeight:700,padding:"4px 12px",borderRadius:99,background:"rgba(34,197,94,0.12)",color:"#22C55E" }}>
            ✓ {nOk} ok
          </span>
        )}
        <span style={{ fontSize:11,color:"var(--text-3)" }}>
          {reMeses.length} mês{reMeses.length!==1?"es":""} realizado · {checks.length} verificações
        </span>
      </div>

      {/* ── Cards ── */}
      {sorted.map(check => {
        const color      = SEV_COLOR[check.severity]
        const isExp      = expanded.has(check.id)
        const hasRows    = !!(check.rows&&check.rows.length>0)
        const hasObs     = !check.passed && !check.noData && !!(check.commentary?.length)
        const borderColor = check.passed||check.noData ? "var(--border)" : color

        return (
          <div key={check.id} style={{
            background:"var(--surface)",
            border:"1px solid var(--border)",
            borderLeft:`4px solid ${borderColor}`,
            borderRadius:10,
            overflow:"hidden",
          }}>
            {/* ── Card header ── */}
            <div
              style={{ display:"flex",alignItems:"flex-start",gap:10,padding:"13px 16px",cursor:hasRows?"pointer":"default",userSelect:"none" }}
              onClick={()=>hasRows&&toggle(check.id)}
            >
              <span style={{
                flexShrink:0,fontSize:9,fontWeight:700,letterSpacing:0.6,textTransform:"uppercase",
                padding:"3px 8px",borderRadius:99,marginTop:1,
                background: check.passed||check.noData ? "rgba(34,197,94,0.12)" : `${color}22`,
                color:       check.passed||check.noData ? "#22C55E" : color,
              }}>
                {check.passed||check.noData ? "OK" : SEV_LABEL[check.severity]}
              </span>

              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ margin:0, fontSize:13, fontWeight:600, color: check.passed||check.noData?"var(--text-3)":"var(--text)" }}>
                  {check.title}
                </p>
                <p style={{ margin:"3px 0 0", fontSize:12, color:"var(--text-3)" }}>
                  {check.noData ? <em>Sem dados disponíveis</em> : check.summary}
                </p>
                {check.statsLine && (
                  <p style={{ margin:"5px 0 0", fontSize:11, color:"var(--text-3)", letterSpacing:0.1, fontVariantNumeric:"tabular-nums" }}>
                    {check.statsLine}
                  </p>
                )}
              </div>

              {hasRows && (
                <span style={{ flexShrink:0,fontSize:10,color:"var(--text-3)",marginTop:4 }}>
                  {isExp ? "▲" : "▼"}
                </span>
              )}
            </div>

            {/* ── Detail table ── */}
            {isExp && hasRows && (
              <div style={{ borderTop:"1px solid var(--border)", overflowX:"auto" }}>
                <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:360 }}>
                  {check.headers && (
                    <thead>
                      <tr style={{ background:"var(--surface-2)" }}>
                        {check.headers.map((h,i) => (
                          <th key={i} style={{
                            padding:"7px 12px",fontSize:10,fontWeight:700,letterSpacing:0.4,
                            textTransform:"uppercase",color:"var(--text-3)",
                            textAlign:i===0?"left":"right",
                            borderBottom:"1px solid var(--border)",whiteSpace:"nowrap",
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {check.rows!.map((row,ri) => (
                      <tr key={ri} style={{ borderTop:"1px solid var(--border)", background:row.hl?HL_BG[row.hl]:"transparent" }}>
                        {row.cells.map((cell,ci) => (
                          <td key={ci} style={{
                            padding:"7px 12px",
                            textAlign:ci===0?"left":"right",
                            color: ci>0&&row.hl&&row.hl!=="none" ? HL_COLOR[row.hl] : "var(--text)",
                            fontWeight:ci===0?500:400,
                            whiteSpace:"nowrap",
                          }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Observações ── */}
            {isExp && hasObs && (
              <div style={{
                borderTop:"1px solid var(--border)",
                padding:"14px 18px 16px",
                background:"var(--surface)",
              }}>
                <p style={{
                  margin:"0 0 10px",
                  fontSize:10,fontWeight:700,letterSpacing:0.7,textTransform:"uppercase",
                  color:"var(--text-3)",fontStyle:"italic",
                }}>
                  Observações para revisão
                </p>
                {check.commentary!.map((para,i) => (
                  <p key={i} style={{
                    margin: i===0?"0":"8px 0 0",
                    fontSize:11,
                    lineHeight:1.65,
                    color:"var(--text-3)",
                  }}>
                    {para}
                  </p>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
