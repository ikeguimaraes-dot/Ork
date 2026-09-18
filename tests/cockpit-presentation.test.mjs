import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const path = new URL("../src/components/financeiro/cockpit/presentation.ts", import.meta.url);
const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { metricPresentation, metricDelta, sparklinePaths } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const complete = { receita_bruta: 100, receita_liquida: 90, cmv_compras_pct: .3, mo_pct: .2, prime_cost_pct: .5, ebitda_pct: .15, resultado_liquido: 12, clientes: 10, ticket_medio: 10, tem_nfe: true, tem_folha: true };

test("receita crescente é favorável; custo percentual crescente requer atenção", () => {
  assert.equal(metricDelta("receita_liquida", 120, 100).tone, "success");
  assert.equal(metricDelta("cmv_compras_pct", .35, .3).tone, "danger");
  assert.equal(metricDelta("mo_pct", .2, .25).tone, "success");
});
test("margens comparam em pontos percentuais; valores em variação percentual", () => {
  assert.ok(Math.abs(metricDelta("ebitda_pct", .2, .15).value - 5) < 1e-8);
  assert.equal(metricDelta("ebitda_pct", .2, .15).unit, "p.p.");
  assert.equal(metricDelta("receita_liquida", 120, 100).value, 20);
});
test("não gera comparação sem base, com base zero ou resultados não comparáveis", () => {
  assert.equal(metricDelta("receita_liquida", 100, null), null);
  assert.equal(metricDelta("receita_liquida", 100, 0), null);
  assert.equal(metricDelta("resultado_liquido", 20, 10, false), null);
});
test("falta de compras ou folha oculta o indicador dependente, inclusive na série histórica", () => {
  assert.equal(metricPresentation({ ...complete, tem_nfe: false }, "cmv_compras_pct").value, null);
  assert.equal(metricPresentation({ ...complete, tem_folha: false }, "mo_pct").value, null);
  assert.equal(metricPresentation({ ...complete, tem_nfe: false }, "prime_cost_pct").value, null);
  assert.equal(metricPresentation({ ...complete, tem_folha: false }, "receita_liquida").value, 90);
});
test("resultado parcial mantém o valor e identifica os dados faltantes", () => {
  const result = metricPresentation({ ...complete, tem_nfe: false }, "resultado_liquido");
  assert.equal(result.value, 12);
  assert.match(result.partial, /compras/);
});
test("ausência, zero e valor inválido são estados distintos", () => {
  assert.equal(metricPresentation(null, "receita_liquida").value, null);
  assert.equal(metricPresentation({ ...complete, receita_liquida: 0 }, "receita_liquida").value, 0);
  assert.equal(metricPresentation({ ...complete, receita_liquida: NaN }, "receita_liquida").value, null);
  assert.equal(metricPresentation({ ...complete, receita_bruta: 0 }, "ebitda_pct").value, null);
});
test("minigráficos não ligam meses separados por ausência de dados", () => {
  const paths = sparklinePaths([10, 20, null, 40, 50]);
  assert.equal(paths.length, 2);
  assert.ok(paths.every((path) => path.startsWith("M") && path.includes(" L")));
  assert.deepEqual(sparklinePaths([null, 4, null]), []);
});
test("série constante permanece centralizada", () => {
  assert.equal(sparklinePaths([10, 10, 10])[0], "M2.0,16.0 L50.0,16.0 L98.0,16.0");
});
