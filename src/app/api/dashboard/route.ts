import {
  getServiceClient,
  empresaEverestDaUnit,
  buildLinhaResolver,
  corsOptionsFor,
  jsonOkFor,
  jsonErrorFor,
  monthRange,
} from "@/lib/dre/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/dashboard?unidade=<unit_id>&mes=<YYYY-MM>
// Monta TODOS os números do Ork Dashboard numa chamada só. Cada indicador
// numérico vem como { valor, valor_mes_anterior, delta_pct, sem_dados } — dado
// AUSENTE nunca vira zero, vira null + sem_dados:true (o front pinta de vermelho).
// Faturamento = SUM(receita_pagamentos.valor_fechado) dos workdays — o que foi
// vendido/consumido (NUNCA o campo receita_bruta do workday, nem valor_recebido:
// esse é só o que entrou no caixa e diverge de valor_fechado quando há devedor).
// Linha DRE resolvida com precedência override > mapa, reusando o helper
// compartilhado das rotas /api/dre/*.

type SupabaseClient = Awaited<ReturnType<typeof getServiceClient>>;
type Resolver = ReturnType<typeof buildLinhaResolver>;

const num = (v: unknown) => Number(v ?? 0);

// { valor, valor_mes_anterior, delta_pct, sem_dados }. delta_pct = null quando
// o mês anterior não tem dado (null) ou é zero (divisão indefinida).
function ind(valor: number | null, anterior: number | null) {
  const sem_dados = valor === null;
  let delta_pct: number | null = null;
  if (valor !== null && anterior !== null && anterior !== 0) {
    delta_pct = ((valor - anterior) / Math.abs(anterior)) * 100;
  }
  return { valor, valor_mes_anterior: anterior, delta_pct, sem_dados };
}

type MonthAgg = {
  temWorkdays: boolean;
  faturamento: number | null;
  clientes: number | null;
  melhorDia: { data: string; valor: number } | null;
  ticketMediaDiaria: number | null;
  gorjeta: number | null;
  gorjetaPorDia: Array<{ data: string; valor: number }>;
  serieFaturamento: Array<{ data: string; valor: number }>;
  mixPorForma: Map<string, number>;
  topGrupos: Array<{ grupo: string; valor: number }>;
  temTitulos: boolean;
  cmv: number | null;
  despesaTotal: number | null;
  maiorConta: { nome: string; valor: number } | null;
  totaisPorConta: Map<string, number>;
  datasComWorkday: Set<string>;
  contasComTitulo: Set<string>;
};

// Carrega e agrega um mês (lorean + títulos) para uma unidade/empresa.
async function loadMonth(
  db: SupabaseClient,
  unitId: string,
  empresa: string | null,
  start: string,
  nextStart: string,
  refMes: string,
  resolver: Resolver,
): Promise<MonthAgg> {
  // ── Lorean (faturamento/clientes/melhor dia/ticket) ──
  const wdRes = await db
    .from("receita_dias")
    .select("id, data, clientes, ticket_medio, gorjeta")
    .eq("unit_id", unitId)
    .gte("data", start)
    .lt("data", nextStart);
  const workdays = (wdRes.data ?? []) as Array<{ id: string; data: string; clientes: number | null; ticket_medio: number | null; gorjeta: number | null }>;
  const temWorkdays = workdays.length > 0;

  let faturamento: number | null = null;
  let clientes: number | null = null;
  let melhorDia: { data: string; valor: number } | null = null;
  let ticketMediaDiaria: number | null = null;
  let gorjeta: number | null = null;
  let gorjetaPorDia: Array<{ data: string; valor: number }> = [];
  let serieFaturamento: Array<{ data: string; valor: number }> = [];
  const mixPorForma = new Map<string, number>();
  let topGrupos: Array<{ grupo: string; valor: number }> = [];
  const datasComWorkday = new Set<string>();

  if (temWorkdays) {
    for (const w of workdays) datasComWorkday.add(w.data);
    clientes = workdays.reduce((s, w) => s + num(w.clientes), 0);
    gorjeta = workdays.reduce((s, w) => s + num(w.gorjeta), 0);

    // Série diária de gorjeta: soma por dia (um dia pode ter vários turnos).
    const gorjPorDia = new Map<string, number>();
    for (const w of workdays) gorjPorDia.set(w.data, (gorjPorDia.get(w.data) ?? 0) + num(w.gorjeta));
    gorjetaPorDia = Array.from(gorjPorDia, ([data, valor]) => ({ data, valor }))
      .sort((a, b) => a.data.localeCompare(b.data));

    const ids = workdays.map((w) => w.id);
    const dataDoWorkday = new Map(workdays.map((w) => [w.id, w.data]));
    const pagRes = await db
      .from("receita_pagamentos")
      .select("workday_id_fk, forma, valor_fechado")
      .in("workday_id_fk", ids);
    const pags = (pagRes.data ?? []) as Array<{ workday_id_fk: string; forma: string | null; valor_fechado: number | null }>;
    faturamento = pags.reduce((s, p) => s + num(p.valor_fechado), 0);

    // Melhor dia = maior soma de valor_fechado por dia.
    const porDia = new Map<string, number>();
    for (const p of pags) {
      const d = dataDoWorkday.get(p.workday_id_fk);
      if (d) porDia.set(d, (porDia.get(d) ?? 0) + num(p.valor_fechado));
    }
    for (const [data, valor] of porDia) {
      if (!melhorDia || valor > melhorDia.valor) melhorDia = { data, valor };
    }
    // Série diária de faturamento (mesma base do melhor dia), ordenada por data.
    serieFaturamento = Array.from(porDia, ([data, valor]) => ({ data, valor }))
      .sort((a, b) => a.data.localeCompare(b.data));

    // Mix de pagamentos: soma valor_fechado por forma no mês.
    for (const p of pags) {
      const forma = p.forma ?? "(sem forma)";
      mixPorForma.set(forma, (mixPorForma.get(forma) ?? 0) + num(p.valor_fechado));
    }

    const tms = workdays.map((w) => w.ticket_medio).filter((t): t is number => t != null);
    ticketMediaDiaria = tms.length ? tms.reduce((s, t) => s + t, 0) / tms.length : null;

    // Top grupos: soma bruto por grupo no mês, top 5.
    const grpRes = await db
      .from("receita_grupos")
      .select("workday_id_fk, grupo, bruto")
      .in("workday_id_fk", ids);
    const grupos = (grpRes.data ?? []) as Array<{ workday_id_fk: string; grupo: string | null; bruto: number | null }>;
    const porGrupo = new Map<string, number>();
    for (const g of grupos) {
      const grupo = g.grupo ?? "(sem grupo)";
      porGrupo.set(grupo, (porGrupo.get(grupo) ?? 0) + num(g.bruto));
    }
    topGrupos = Array.from(porGrupo, ([grupo, valor]) => ({ grupo, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 5);
  }

  // ── Títulos (CMV / despesa total / maior conta) ──
  let temTitulos = false;
  let cmv: number | null = null;
  let despesaTotal: number | null = null;
  let maiorConta: { nome: string; valor: number } | null = null;
  const totaisPorConta = new Map<string, number>();
  const contasComTitulo = new Set<string>();

  if (empresa) {
    const titRes = await db
      .from("titulos_a_pagar")
      .select("id, descricao_c_gerencial, v_titulo")
      .eq("empresa", empresa)
      .eq("ref_mes", refMes);
    const titulos = (titRes.data ?? []) as Array<{ id: string; descricao_c_gerencial: string | null; v_titulo: number | null }>;
    temTitulos = titulos.length > 0;

    if (temTitulos) {
      let somaCmv = 0;
      let somaTotal = 0;
      for (const t of titulos) {
        const v = num(t.v_titulo); // positivo = despesa
        const conta = t.descricao_c_gerencial ?? "(sem conta)";
        contasComTitulo.add(conta);
        somaTotal += v;
        totaisPorConta.set(conta, (totaisPorConta.get(conta) ?? 0) + v);
        if (resolver.resolve({ id: t.id, descricao_c_gerencial: t.descricao_c_gerencial }) === "CMV") somaCmv += v;
      }
      cmv = somaCmv;
      despesaTotal = somaTotal;
      let top: { nome: string; valor: number } | null = null;
      for (const [nome, valor] of totaisPorConta) {
        if (!top || valor > top.valor) top = { nome, valor };
      }
      maiorConta = top;
    }
  }

  return {
    temWorkdays, faturamento, clientes, melhorDia, ticketMediaDiaria,
    gorjeta, gorjetaPorDia, serieFaturamento, mixPorForma, topGrupos,
    temTitulos, cmv, despesaTotal, maiorConta, totaisPorConta,
    datasComWorkday, contasComTitulo,
  };
}

export function OPTIONS(req: Request) {
  return corsOptionsFor(req.headers.get("origin"));
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  try {
    const { searchParams } = new URL(req.url);
    const unidade = searchParams.get("unidade");
    const mes = searchParams.get("mes"); // YYYY-MM
    if (!unidade) return jsonErrorFor(origin, "param 'unidade' é obrigatório", 400);
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return jsonErrorFor(origin, "param 'mes' (YYYY-MM) é obrigatório", 400);

    const empresa = empresaEverestDaUnit(unidade); // estrito: unidade sem empresa Everest → null
    const R = monthRange(mes);
    const db = await getServiceClient();

    // Mapa + overrides são globais (independem de mês) — carrega uma vez.
    const [mapaRes, ovRes] = await Promise.all([
      db.from("mapa_conta_dre").select("descricao_c_gerencial, linha_dre, esperada_mensal"),
      db.from("titulo_override").select("titulo_id, linha_dre_corrigida"),
    ]);
    if (mapaRes.error) return jsonErrorFor(origin, `mapa_conta_dre: ${mapaRes.error.message}`);
    if (ovRes.error) return jsonErrorFor(origin, `titulo_override: ${ovRes.error.message}`);
    const resolver = buildLinhaResolver(mapaRes.data, ovRes.data);

    // Mês solicitado + mês anterior (para os comparativos) + produto (período manual).
    const [cur, prev, prodPeriodos] = await Promise.all([
      loadMonth(db, unidade, empresa, R.start, R.nextStart, R.refMes, resolver),
      loadMonth(db, unidade, empresa, R.prevStart, R.prevNextStart, R.prevRefMes, resolver),
      db.from("vendas_consolidado_periodo").select("id, label, data_inicio, importado_em")
        .eq("unit_id", unidade)
        .order("data_inicio", { ascending: false })
        .order("importado_em", { ascending: false })
        .limit(1),
    ]);

    // ── Ticket médio: faturamento ÷ clientes; reporta divergência vs média diária ──
    const ticketCalc = (m: MonthAgg): number | null =>
      m.faturamento != null && m.clientes != null && m.clientes > 0 ? m.faturamento / m.clientes : null;
    const ticketCur = ticketCalc(cur);
    const ticketBase = ind(ticketCur, ticketCalc(prev));
    const divergente =
      ticketCur != null && cur.ticketMediaDiaria != null && cur.ticketMediaDiaria > 0
        ? Math.abs(ticketCur - cur.ticketMediaDiaria) / cur.ticketMediaDiaria > 0.15
        : false;

    // ── Produto mais vendido (do período mais recente em vendas_consolidado) ──
    let produto_mais_vendido: {
      produto: string | null; grupo: string | null; valor_liquido: number | null;
      quantidade: number | null; periodo_label: string | null; sem_dados: boolean;
    } = { produto: null, grupo: null, valor_liquido: null, quantidade: null, periodo_label: null, sem_dados: true };
    const periodo = prodPeriodos.data?.[0] as { id: string; label: string | null } | undefined;
    if (periodo) {
      const prodRes = await db
        .from("vendas_consolidado_produtos")
        .select("produto, grupo, valor_liquido, quantidade")
        .eq("periodo_id", periodo.id)
        .order("valor_liquido", { ascending: false })
        .limit(1);
      const p = prodRes.data?.[0] as { produto: string; grupo: string; valor_liquido: number | null; quantidade: number | null } | undefined;
      if (p) {
        produto_mais_vendido = {
          produto: p.produto, grupo: p.grupo,
          valor_liquido: num(p.valor_liquido), quantidade: num(p.quantidade),
          periodo_label: periodo.label, sem_dados: false,
        };
      }
    }

    // ── Funcionário top (maior bruto vendido no período mais recente) ──
    let funcionario_top: {
      funcionario: string | null; valor: number | null;
      periodo_label: string | null; sem_dados: boolean;
    } = { funcionario: null, valor: null, periodo_label: null, sem_dados: true };
    if (periodo) {
      const funcRes = await db
        .from("vendas_consolidado_funcionarios")
        .select("funcionario, bruto")
        .eq("periodo_id", periodo.id)
        .order("bruto", { ascending: false })
        .limit(1);
      const f = funcRes.data?.[0] as { funcionario: string; bruto: number | null } | undefined;
      if (f) {
        funcionario_top = {
          funcionario: f.funcionario, valor: num(f.bruto),
          periodo_label: periodo.label, sem_dados: false,
        };
      }
    }

    // ── Mix de pagamentos: formas com <5% do total viram "Outros" (máx 5 + Outros) ──
    // pct = fração sobre o total (front multiplica por 100). Vazio → sem_dados.
    let mix_pagamentos: { itens: Array<{ forma: string; valor: number; pct: number | null }>; sem_dados: boolean };
    if (cur.mixPorForma.size === 0) {
      mix_pagamentos = { itens: [], sem_dados: true };
    } else {
      const total = Array.from(cur.mixPorForma.values()).reduce((s, v) => s + v, 0);
      const ordenadas = Array.from(cur.mixPorForma, ([forma, valor]) => ({ forma, valor }))
        .sort((a, b) => b.valor - a.valor);
      const principais: Array<{ forma: string; valor: number }> = [];
      let outros = 0;
      for (const item of ordenadas) {
        const pct = total > 0 ? item.valor / total : 0;
        if (principais.length < 5 && pct >= 0.05) principais.push(item);
        else outros += item.valor;
      }
      const itens = principais.map((i) => ({ forma: i.forma, valor: i.valor, pct: total > 0 ? i.valor / total : null }));
      if (outros > 0) itens.push({ forma: "Outros", valor: outros, pct: total > 0 ? outros / total : null });
      mix_pagamentos = { itens, sem_dados: false };
    }

    // ── cmv_pct = cmv ÷ faturamento (fração; front multiplica por 100) ──
    const cmvPctCalc = (m: MonthAgg): number | null =>
      m.cmv != null && m.faturamento != null && m.faturamento > 0 ? m.cmv / m.faturamento : null;

    // ── maior_conta: comparativo maçã-com-maçã (mesma conta no mês anterior) ──
    const maiorContaAnterior =
      cur.maiorConta ? prev.totaisPorConta.get(cur.maiorConta.nome) ?? null : null;

    // ── Alerta de importação: dias do mês sem workday, até ontem (data corrente) ──
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const ontemISO = ontem.toISOString().slice(0, 10);
    const fimMes = new Date(R.nextStart);
    fimMes.setDate(fimMes.getDate() - 1);
    const fimMesISO = fimMes.toISOString().slice(0, 10);
    const limiteSuperior = fimMesISO < ontemISO ? fimMesISO : ontemISO; // min(fim do mês, ontem)
    const datas_faltantes: string[] = [];
    if (limiteSuperior >= R.start) {
      const d = new Date(R.start);
      const limite = new Date(limiteSuperior);
      while (d <= limite) {
        const iso = d.toISOString().slice(0, 10);
        if (!cur.datasComWorkday.has(iso)) datas_faltantes.push(iso);
        d.setDate(d.getDate() + 1);
      }
    }

    // ── Alerta de contas esperadas (esperada_mensal) sem título no mês ──
    let alerta_contas_faltantes: { nomes: string[]; sem_empresa: boolean };
    if (!empresa) {
      alerta_contas_faltantes = { nomes: [], sem_empresa: true };
    } else {
      const esperadas: string[] = [];
      for (const [conta, esp] of resolver.esperadaDaConta) if (esp) esperadas.push(conta);
      alerta_contas_faltantes = {
        nomes: esperadas.filter((c) => !cur.contasComTitulo.has(c)).sort(),
        sem_empresa: false,
      };
    }

    return jsonOkFor(origin, {
      unidade,
      empresa,
      mes: R.refMes.slice(0, 7),
      mes_anterior: R.prevRefMes.slice(0, 7),
      gerado_em: new Date().toISOString(),

      faturamento_mes: ind(cur.faturamento, prev.faturamento),
      melhor_dia: {
        data: cur.melhorDia?.data ?? null,
        ...ind(cur.melhorDia?.valor ?? null, prev.melhorDia?.valor ?? null),
      },
      ticket_medio_mes: {
        ...ticketBase,
        media_diaria: cur.ticketMediaDiaria,
        divergente,
      },
      clientes_mes: ind(cur.clientes, prev.clientes),
      gorjeta_mes: {
        ...ind(cur.gorjeta, prev.gorjeta),
        pct_sobre_faturamento:
          cur.gorjeta != null && cur.faturamento != null && cur.faturamento > 0
            ? cur.gorjeta / cur.faturamento
            : null,
        serie_diaria: cur.gorjetaPorDia,
      },
      serie_diaria_faturamento: {
        itens: cur.serieFaturamento,
        sem_dados: cur.serieFaturamento.length === 0,
      },
      mix_pagamentos,
      top_grupos: {
        itens: cur.topGrupos,
        sem_dados: cur.topGrupos.length === 0,
      },
      produto_mais_vendido,
      funcionario_top,
      cmv_mes: {
        ...ind(cur.cmv, prev.cmv),
        cmv_pct: cmvPctCalc(cur),
        cmv_pct_mes_anterior: cmvPctCalc(prev),
      },
      despesa_total_mes: ind(cur.despesaTotal, prev.despesaTotal),
      maior_conta: {
        nome: cur.maiorConta?.nome ?? null,
        ...ind(cur.maiorConta?.valor ?? null, maiorContaAnterior),
      },
      alerta_importacao: { datas_faltantes, total: datas_faltantes.length },
      alerta_contas_faltantes,
    });
  } catch (e) {
    return jsonErrorFor(origin, String(e));
  }
}
