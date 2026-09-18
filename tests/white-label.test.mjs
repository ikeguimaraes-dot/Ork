import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { loadTs } from './helpers/load-ts.mjs';

test('compras aceita os doze meses e preserva mais de 200 linhas', () => {
  const wb = XLSX.utils.book_new();
  const months = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  for (const month of months) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Fornecedor'], ...Array.from({length: 201}, (_,i) => ['Fornecedor',null,String(i),'ALIMENTOS',10,'1',null,10])
  ]), month);
  const parser = loadTs('src/lib/financeiro/importacao/compras/parseComprasXlsx.ts');
  const result = parser.parseContasAPagarWorkbook(XLSX.write(wb, {type:'array',bookType:'xlsx'}), 2028);
  assert.equal(result.linhas.length, 12*201);
  assert.equal(result.linhas.at(-1).dCompetencia, '2028-12-01');
  assert.throws(() => parser.parseContasAPagarWorkbook(new ArrayBuffer(0), 1900), /ano válido/);
});

test('roteamento é configurável, ignora acentos e rejeita ambiguidade', () => {
  const previous = process.env.NEXT_PUBLIC_UNIT_RULES;
  try {
    const a = '10000000-0000-4000-8000-000000000001';
    const b = '10000000-0000-4000-8000-000000000002';
    process.env.NEXT_PUBLIC_UNIT_RULES = JSON.stringify({[a]:{categoryContains:['filial são paulo']},[b]:{categoryContains:['delivery']}});
    const config = loadTs('src/lib/instance.ts');
    assert.equal(config.unitMentioned('Compra FILIAL SAO PAULO'), a);
    assert.equal(config.unitMentioned('sem indicação'), null);
    assert.throws(() => config.unitMentioned('filial são paulo delivery'), /mais de uma unidade/);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_UNIT_RULES;
    else process.env.NEXT_PUBLIC_UNIT_RULES = previous;
  }
});
