import { applyBatch, type Mutation } from "@/lib/financeiro/db/atomic";
// Grava um DominioParseResultado (já validado pelo parser puro) nas tabelas
// payroll_extrato_dominio_*. Recebe `db` como parâmetro (em vez de importar
// await createFinanceiroClient() direto) pra funcionar tanto a partir da Server
// Action de produção quanto de um script local de carga única — mesmo
// caminho de código nos dois casos, sem duplicar a lógica de gravação.
import type { DominioCompetencia, DominioParseResultado } from "./types";

const TOLERANCIA_CENTAVOS = 0.01;

export type ImportarCompetenciaResultado = {
  competencia: string;
  cnpj: string;
  ok: boolean;
  unitId: string | null;
  colaboradores: number;
  linhasProvento: number;
  linhasDesconto: number;
  error?: string;
};

export type ImportarExtratoDominioResultado = {
  ok: boolean;
  arquivoOrigem: string;
  competencias: ImportarCompetenciaResultado[];
  cnpjsDesconhecidos: string[];
};

function validarCompetencia(comp: DominioCompetencia): { ok: boolean; error?: string } {
  const somaProvento = comp.linhasProvento.reduce((s, l) => s + l.valor, 0);
  const somaDesconto = comp.linhasDesconto.reduce((s, l) => s + l.valor, 0);
  const somaFgts = comp.colaboradores.reduce((s, c) => s + (c.valorFgts ?? 0), 0);
  const footerFgts = (comp.valorFgts ?? 0) + (comp.valorFgtsRescisorio ?? 0);

  const erros: string[] = [];
  if (comp.totalGeralProventos != null) {
    const diff = somaProvento - comp.totalGeralProventos;
    if (Math.abs(diff) > TOLERANCIA_CENTAVOS) {
      erros.push(`proventos: soma rubricas ${somaProvento.toFixed(2)} != Total Geral Proventos ${comp.totalGeralProventos.toFixed(2)} (diff ${diff.toFixed(2)})`);
    }
  }
  if (comp.totalGeralDescontos != null) {
    const diff = somaDesconto - comp.totalGeralDescontos;
    if (Math.abs(diff) > TOLERANCIA_CENTAVOS) {
      erros.push(`descontos: soma rubricas ${somaDesconto.toFixed(2)} != Total Geral Descontos ${comp.totalGeralDescontos.toFixed(2)} (diff ${diff.toFixed(2)})`);
    }
  }
  if (comp.valorFgts != null) {
    const diff = somaFgts - footerFgts;
    if (Math.abs(diff) > TOLERANCIA_CENTAVOS) {
      erros.push(`FGTS: soma por colaborador ${somaFgts.toFixed(2)} != Valor FGTS + Rescisório ${footerFgts.toFixed(2)} (diff ${diff.toFixed(2)})`);
    }
  }

  return erros.length > 0
    ? { ok: false, error: `Competência ${comp.competencia}: ${erros.join("; ")}` }
    : { ok: true };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function gravarCompetencia(db: any, unitId: string, comp: DominioCompetencia, arquivoOrigem: string): Promise<void> {
  const operations: Mutation[] = ["linha", "rubrica", "colaborador", "competencia"].map(suffix => ({
    table: `payroll_extrato_dominio_${suffix}`, operation: "delete", scope: { unit_id: unitId, competencia: comp.competencia },
  }));
  operations.push({ table: "payroll_extrato_dominio_competencia", operation: "insert", rows: [{
    unit_id: unitId,
    competencia: comp.competencia,
    cod_empresa_dominio: comp.codEmpresaDominio,
    cnpj: comp.cnpj,
    razao_social: comp.razaoSocial,
    arquivo_origem: arquivoOrigem,
    total_geral_proventos: comp.totalGeralProventos,
    total_geral_descontos: comp.totalGeralDescontos,
    liquido_geral: comp.liquidoGeral,
    base_fgts: comp.baseFgts,
    valor_fgts: comp.valorFgts,
    base_fgts_rescisorio: comp.baseFgtsRescisorio,
    valor_fgts_rescisorio: comp.valorFgtsRescisorio,
    total_inss: comp.totalInss,
    inss_empresa: comp.inssEmpresa,
    rat: comp.rat,
    terceiros: comp.terceiros,
    no_empregados: comp.noEmpregados,
    trabalhando: comp.trabalhando,
    demitido: comp.demitido,
    admissoes: comp.admissoes,
    no_contribuintes: comp.noContribuintes,
  }] });

  if (comp.colaboradores.length > 0) {
    const rows = comp.colaboradores.map((c) => ({
      unit_id: unitId,
      competencia: comp.competencia,
      cod_empresa_dominio: comp.codEmpresaDominio,
      cnpj: comp.cnpj,
      cod_colaborador: c.codColaborador,
      nome: c.nome,
      cpf: c.cpf,
      situacao: c.situacao,
      data_admissao: c.dataAdmissao,
      data_demissao: c.dataDemissao,
      motivo_demissao: c.motivoDemissao,
      vinculo: c.vinculo,
      centro_custo: c.centroCusto,
      departamento: c.departamento,
      cargo_codigo: c.cargoCodigo,
      cargo_nome: c.cargoNome,
      cbo: c.cbo,
      salario: c.salario,
      proventos: c.proventos,
      descontos: c.descontos,
      liquido: c.liquido,
      base_inss: c.baseInss,
      base_fgts: c.baseFgts,
      valor_fgts: c.valorFgts,
      base_irrf: c.baseIrrf,
    }));
    operations.push({ table: "payroll_extrato_dominio_colaborador", operation: "insert", rows });
  }

  const linhaRows = [
    ...comp.linhasProvento.map((l) => ({
      unit_id: unitId, competencia: comp.competencia, cod_colaborador: l.codColaborador,
      rubrica_codigo: l.rubricaCodigo, natureza: "PROVENTO", valor: l.valor,
    })),
    ...comp.linhasDesconto.map((l) => ({
      unit_id: unitId, competencia: comp.competencia, cod_colaborador: l.codColaborador,
      rubrica_codigo: l.rubricaCodigo, natureza: "DESCONTO", valor: l.valor,
    })),
  ];
  if (linhaRows.length > 0) operations.push({ table: "payroll_extrato_dominio_linha", operation: "insert", rows: linhaRows });

  if (comp.resumoRubricas.length > 0) {
    const rubricaRows = comp.resumoRubricas.map((r) => ({
      unit_id: unitId,
      competencia: comp.competencia,
      cod_empresa_dominio: comp.codEmpresaDominio,
      rubrica_codigo: r.rubricaCodigo,
      rubrica_descricao: r.rubricaDescricao,
      natureza: r.natureza,
      quantidade_texto: r.quantidadeTexto,
      valor: r.valor,
    }));
    operations.push({ table: "payroll_extrato_dominio_rubrica", operation: "insert", rows: rubricaRows });
  }
  await applyBatch(db, operations);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function importarExtratoDominioParaBanco(db: any, resultado: DominioParseResultado): Promise<ImportarExtratoDominioResultado> {
  const cnpjs = [...new Set(resultado.competencias.map((c) => c.cnpj))];
  const { data: mapeamentos, error: mapError } = cnpjs.length > 0
    ? await db.from("unit_cnpjs").select("unit_id,cnpj").eq("papel", "folha").eq("ativo", true).in("cnpj", cnpjs)
    : { data: [], error: null };
  if (mapError) throw new Error(mapError.message);
  const unitPorCnpj = new Map<string, string>(
    (mapeamentos ?? []).map((m: { cnpj: string; unit_id: string }) => [m.cnpj, m.unit_id])
  );

  const competencias: ImportarCompetenciaResultado[] = [];
  const cnpjsDesconhecidos = new Set<string>();

  for (const comp of resultado.competencias) {
    const unitId = unitPorCnpj.get(comp.cnpj) ?? null;
    if (!unitId) {
      cnpjsDesconhecidos.add(comp.cnpj);
      competencias.push({
        competencia: comp.competencia, cnpj: comp.cnpj, ok: false, unitId: null,
        colaboradores: 0, linhasProvento: 0, linhasDesconto: 0,
        error: `CNPJ ${comp.cnpj} não mapeado em unit_cnpjs (papel=folha, ativo=true)`,
      });
      continue;
    }

    const validacao = validarCompetencia(comp);
    if (!validacao.ok) {
      competencias.push({
        competencia: comp.competencia, cnpj: comp.cnpj, ok: false, unitId,
        colaboradores: 0, linhasProvento: 0, linhasDesconto: 0,
        error: validacao.error,
      });
      continue;
    }

    await gravarCompetencia(db, unitId, comp, resultado.arquivoOrigem);
    competencias.push({
      competencia: comp.competencia, cnpj: comp.cnpj, ok: true, unitId,
      colaboradores: comp.colaboradores.length,
      linhasProvento: comp.linhasProvento.length,
      linhasDesconto: comp.linhasDesconto.length,
    });
  }

  return {
    ok: competencias.every((c) => c.ok),
    arquivoOrigem: resultado.arquivoOrigem,
    competencias,
    cnpjsDesconhecidos: [...cnpjsDesconhecidos],
  };
}
