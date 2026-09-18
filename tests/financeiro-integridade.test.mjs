import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

function database(initial = {}, failures = []) {
  let tables = structuredClone(initial);
  const calls = [];
  const db = {
    calls, rows: t => tables[t] ?? [],
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "financeiro_can_write") return { data: false, error: null };
      const next = structuredClone(tables);
      for (const op of args.p_operations ?? []) {
        if (op.rows?.some(r => r.valor === -999)) return { error: { message: "valor recusado" } };
        if (op.operation === "delete") next[op.table] = (next[op.table] ?? []).filter(r => !Object.entries(op.scope).every(([k, v]) => r[k] === v));
        else next[op.table] = [...next[op.table] ?? [], ...op.rows ?? []];
      }
      tables = next;
      return { error: null };
    },
    from(table) {
      let rows = tables[table] ?? [], first = false;
      const query = {
        select: () => query,
        or: () => query,
        order: () => query,
        limit(n) { rows = rows.slice(0, n); return query; },
        not(k, op, v) { rows = rows.filter(r => r[k] !== v); return query; },
        lte(k, v) { rows = rows.filter(r => r[k] <= v); return query; },
        eq(k, v) { rows = rows.filter(r => r[k] === v); return query; },
        in(k, values) { rows = rows.filter(r => values.includes(r[k])); return query; },
        gte(k, v) { rows = rows.filter(r => r[k] >= v); return query; },
        lt(k, v) { rows = rows.filter(r => r[k] < v); return query; },
        range(a, b) { rows = rows.slice(a, b + 1); return query; },
        maybeSingle() { first = true; return query; },
        then(resolve) { return Promise.resolve({ data: first ? rows[0] ?? null : rows, error: failures.includes(table) ? { message: "Falha de leitura simulada" } : null }).then(resolve); },
      };
      return query;
    },
  };
  return db;
}
const razao = loadTs("src/lib/financeiro/razao/gerar.ts");
const unit = "10000000-0000-4000-8000-000000000001";
const otherUnit = "10000000-0000-4000-8000-000000000002";
const month = "2026-06-01";

test("corrigir desconto para zero remove a dedução; remover origem limpa o mês", async () => {
  const db = database({ receita_dias: [{ id: "dia", unit_id: unit, data: month, receita_bruta: 100, desconto: 10 }] });
  assert.equal((await razao.gerarLancamentosReceita(db, unit, month)).ok, true);
  assert.equal(db.rows("lancamentos").length, 2);
  db.rows("receita_dias")[0].desconto = 0;
  await razao.gerarLancamentosReceita(db, unit, month);
  assert.equal(db.rows("lancamentos").length, 1);
  assert.equal(db.rows("lancamentos")[0].valor, 100);
  db.rows("receita_dias").splice(0);
  await razao.gerarLancamentosReceita(db, unit, month);
  assert.equal(db.rows("lancamentos").length, 0);
});

test("reprocessar uma unidade/mês preserva outras unidades e competências", async () => {
  const original = [ { unit_id: "outra", competencia: month, origem: "receita", valor: 80 }, { unit_id: unit, competencia: "2026-05-01", origem: "receita", valor: 90 } ];
  const db = database({ lancamentos: original });
  await razao.gerarLancamentosReceita(db, unit, month);
  assert.deepEqual(db.rows("lancamentos"), original);
});

test("lote com falha não perde a versão anterior", async () => {
  const { applyBatch, replacement } = loadTs("src/lib/financeiro/db/atomic.ts");
  const db = database({ lancamentos: [{ unit_id: unit, valor: 100 }] });
  await assert.rejects(() => applyBatch(db, replacement("lancamentos", { unit_id: unit }, [{ unit_id: unit, valor: -999 }])), /versão anterior/);
  assert.equal(db.rows("lancamentos")[0].valor, 100);
});

test("compras só substituem os escopos presentes, nunca uma unidade alheia", async () => {
  const { importarLinhasCompra } = loadTs("src/lib/financeiro/importacao/compras/importarCompras.ts");
  const db = database();
  const row = { dCompetencia: month, vTitulo: 100, roteamentoLegado: false, fornecedorNome: "Fornecedor", produtoOriginal: "ALIMENTOS", categoriaNormalizada: "ALIMENTOS" };
  const result = await importarLinhasCompra(db, [row], otherUnit, "compra", "nf_pedidos");
  assert.equal(result.ok, true);
  const deletes = db.calls[0].args.p_operations.filter(op => op.operation === "delete");
  assert.ok(deletes.every(op => op.scope.import_unit_id === otherUnit));
  const bad = await importarLinhasCompra(db, [{ ...row, vTitulo: NaN }], unit, "compra", "nf_pedidos");
  assert.equal(bad.ok, false);
});

test("competência explícita tem prioridade; fallback é lançamento e depois vencimento", () => {
  const { competenciaTitulo, hojeSaoPaulo } = loadTs("src/lib/financeiro/dates.ts");
  assert.equal(competenciaTitulo({ d_competencia: month, d_lancamento: "2026-05-30", d_vencimento: "2026-07-01" }), month);
  assert.equal(competenciaTitulo({ d_lancamento: "2026-05-30", d_vencimento: "2026-07-01" }), "2026-05-01");
  assert.equal(competenciaTitulo({}), null);
  assert.equal(hojeSaoPaulo(new Date("2026-06-01T01:00:00Z")), "2026-05-31");
});

test("título pago sem vencimento continua no total pago", async () => {
  const { calcularPagar } = loadTs("src/lib/financeiro/pagar/calcularPagar.ts");
  const db = database({ titulos_a_pagar: [{ id: "t1", unit_id: unit, origem: "contas_pagar", d_competencia: month, d_vencimento: null, liquidacao_origem: "OK", v_titulo: 50 }] });
  const result = await calcularPagar(db, unit, month, "contas_pagar");
  assert.equal(result.cards.pago, 50);
  assert.equal(result.cards.semDataVencimento, 0);
});

test("sessão lida do cookie não substitui identidade validada", async () => {
  let calls = 0;
  const { getCurrentUser } = loadTs("lib/ork/auth/server.ts", {
    react: { cache: fn => fn }, "next/headers": { cookies: async () => ({}) }, "next/navigation": { redirect() { throw new Error("redirect"); } },
    "@ork/db/supabase/server": { createSupabaseServerClient: async () => ({ auth: { getUser: async () => { calls++; return { data: { user: null }, error: null }; }, getSession: () => { throw new Error("Não deve confiar no cookie"); } } }) },
  });
  assert.equal(await getCurrentUser(), null);
  assert.equal(calls, 1);
});


test("caixa reconstrói o saldo anterior à janela e respeita a data-base da conta", async () => {
  const { calcularFluxo } = loadTs("src/lib/financeiro/fluxo/calcularFluxo.ts");
  const db = database({ contas_bancarias: [{ id: "banco", unit_id: unit, ativo: true, saldo_inicial: 1000, data_saldo_inicial: "2026-06-01" }],
    movimentacoes_caixa: [
      { conta_id: "banco", unit_id: unit, data: "2026-05-31", tipo: "entrada", valor: 9999 },
      { conta_id: "banco", unit_id: unit, data: "2026-06-02", tipo: "saida", valor: 100 },
      { conta_id: "banco", unit_id: unit, data: "2026-06-10", tipo: "entrada", valor: 50 },
    ], titulos_a_pagar: [{ id: "t", unit_id: unit, origem: "contas_pagar", d_vencimento: "2026-06-10", v_titulo: 500, liquidacao_origem: "*" }],
  });
  const result = await calcularFluxo(db, unit, "banco", "2026-06-10", "2026-06-11");
  assert.equal(result.dias[0].saldoInicial, 900);
  assert.equal(result.dias[0].saldoFinal, 950);
  assert.equal(result.dias[0].saidasPrevistas, 0);
  await assert.rejects(() => calcularFluxo(db, unit, "banco", "2026-05-01", "2026-06-01"), /saldo inicial/);
});

test("correção remove compras roteadas sem apagar importação própria do outro restaurante", async () => {
  const { importarLinhasCompra } = loadTs("src/lib/financeiro/importacao/compras/importarCompras.ts");
  const own = { unit_id: unit, import_unit_id: unit, origem: "nf_pedidos", d_competencia: month, v_titulo: 30 };
  const db = database({ titulos_a_pagar: [own, { ...own, import_unit_id: otherUnit, v_titulo: 50 }] });
  await importarLinhasCompra(db, [{ dCompetencia: month, vTitulo: 100, roteamentoLegado: false, fornecedorNome: "F", produtoOriginal: "ALIMENTOS", categoriaNormalizada: "ALIMENTOS" }], otherUnit, "compra", "nf_pedidos");
  assert.equal(db.rows("titulos_a_pagar").length, 2);
  assert.deepEqual(db.rows("titulos_a_pagar").find(r => r.unit_id === unit), own);
});

test("liquidação vazia continua indefinida", () => {
  const { classificarLiquidacao } = loadTs("src/lib/financeiro/fluxo/liquidacao.ts");
  assert.equal(classificarLiquidacao("  "), "indefinido");
  assert.equal(classificarLiquidacao("OK"), "pago");
  assert.equal(classificarLiquidacao("*"), "nao_pago");
});

test("extração malformada não vira exclusão de seção válida", () => {
  const { extractedRows } = loadTs("src/lib/receita/extraction.ts");
  assert.throws(() => extractedRows("erro de extração"));
  assert.equal(extractedRows([]).length, 0);
});


test("falha em uma fonte impede publicação de razão e snapshots parciais", async () => {
  const original = [{ unit_id: unit, competencia: month, receita_bruta: 123 }];
  const db = database({ kpi_snapshot: original }, ["produtos_relatorio"]);
  const result = await razao.gerarRazao(db, unit, month);
  assert.equal(result.ok, false);
  assert.equal(result.snapshot.ok, false);
  assert.deepEqual(db.rows("kpi_snapshot"), original);
  assert.equal(db.calls.length, 0);
});
