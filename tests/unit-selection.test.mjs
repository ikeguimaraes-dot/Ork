import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/ork/auth/unit-selection.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { resolveUnitSelection } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const units = [{ id: "iky" }, { id: "yoshimori" }];

test("o menu mantém a unidade dos dados do servidor quando o navegador tem uma preferência antiga", () => {
  assert.equal(resolveUnitSelection(units, "iky", "yoshimori", "yoshimori"), "iky");
});

test("a preferência atual do Shell tem prioridade sobre a chave legada", () => {
  assert.equal(resolveUnitSelection(units, null, "iky", "yoshimori"), "iky");
  assert.equal(resolveUnitSelection(units, null, null, "yoshimori"), "yoshimori");
});

test("preferências de unidades inacessíveis não entram na seleção", () => {
  assert.equal(resolveUnitSelection(units, "outra", "removida", "inativa"), "iky");
  assert.equal(resolveUnitSelection(units, "outra", "yoshimori"), "yoshimori");
});

test("sem unidades acessíveis a seleção permanece vazia", () => {
  assert.equal(resolveUnitSelection([], "iky", "iky", "iky"), null);
});
