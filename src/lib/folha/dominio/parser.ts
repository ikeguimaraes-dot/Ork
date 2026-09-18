// Parser puro do extrato Domínio — opera sobre PositionedText[] (já extraído
// via pdfjs-dist por quem chama). Sem dependência de pdfjs-dist aqui, então
// é testável em qualquer ambiente (Node, browser, etc.) sem polyfill nenhum.
//
// Estratégia: nunca depende de "ordem de leitura" do PDF (que pode intercalar
// rótulo e valor de formas confusas — ver alertas do extrato real). Tudo é
// reconstruído por coordenada (x,y): agrupa por linha visual (y arredondado)
// e usa faixas de x pra separar proventos (esquerda) de descontos (direita).
import type {
  PositionedText, DominioCompetencia, DominioParseResultado,
} from "./types";

const MONEY_RE = /^-?[\d.]+,\d{2}$/;
const MONEY_D_RE = /^(-?[\d.]+,\d{2})\s*D$/i;
const CODE_RE = /^\d{1,6}$/;
const CODE_DESC_RE = /^(\d{1,6})\s+(.+)$/;
const CPF_RE = /\d{3}\.\d{3}\.\d{3}-\d{2}/;
const COMPETENCIA_RE = /^(\d{2})\/(\d{4})$/;

function toNumber(text: string): number {
  const cleaned = text.replace(/\s*D$/i, "").trim().replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function isMoney(text: string): boolean {
  return MONEY_RE.test(text.trim());
}

// Agrupa itens por linha visual. Tolerância de 2pt — o extrato tem casos
// onde rótulo (ex. "Informativa:") e seu valor saem 1pt de diferença em y.
function groupLines(items: PositionedText[]): PositionedText[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PositionedText[][] = [];
  for (const item of sorted) {
    const last = lines.at(-1);
    if (last && Math.abs(last[0]!.y - item.y) <= 2) last.push(item);
    else lines.push([item]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

// Busca uma etiqueta por regex e o valor monetário mais próximo (mesma
// vizinhança y, x maior) — mesmo princípio já usado em pdf-parser.ts pro
// recibo individual, só que aqui pesquisa num conjunto de itens já filtrado
// (linha, ou página inteira quando rótulo/valor podem estar em colunas).
function nearestValueAfterLabel(items: PositionedText[], label: RegExp, maxDy = 3, maxDx = 260): number | null {
  const target = items.find((it) => label.test(it.text));
  if (!target) return null;
  const candidate = items
    .filter((it) => isMoney(it.text.trim()) && Math.abs(it.y - target.y) <= maxDy && it.x > target.x && it.x - target.x <= maxDx)
    .sort((a, b) => a.x - b.x)[0];
  return candidate ? toNumber(candidate.text) : null;
}

function nearestIntAfterLabel(items: PositionedText[], label: RegExp, maxDy = 3, maxDx = 260): number | null {
  const target = items.find((it) => label.test(it.text));
  if (!target) return null;
  const candidate = items
    .filter((it) => /^\d+$/.test(it.text.trim()) && Math.abs(it.y - target.y) <= maxDy && it.x > target.x && it.x - target.x <= maxDx)
    .sort((a, b) => a.x - b.x)[0];
  return candidate ? Number(candidate.text.trim()) : null;
}

type ParConta = { codigo: number; descricao: string; referencia: string | null; valor: number };

// Extrai (código, descrição, referência, valor) de um lado de uma linha de
// rubrica. Tolera as duas variações vistas no extrato: código colado na
// descrição num item só (lado provento, e também no Resumo por Rubrica dos
// dois lados) OU código isolado seguido de item de descrição separado (lado
// desconto no detalhe por colaborador).
function parseLadoRubrica(sideItems: PositionedText[], natureza: "P" | "D"): ParConta | null {
  const items = sideItems.filter((it) => it.text.trim() !== "P" && it.text.trim() !== "D");
  if (items.length === 0) return null;

  let codigo: number | null = null;
  let descricao = "";
  let rest = items;

  const first = items[0]!;
  const combined = first.text.trim().match(CODE_DESC_RE);
  if (combined) {
    codigo = Number(combined[1]);
    descricao = combined[2]!.trim();
    rest = items.slice(1);
  } else if (CODE_RE.test(first.text.trim())) {
    codigo = Number(first.text.trim());
    const descItem = items[1];
    descricao = descItem ? descItem.text.trim() : "";
    rest = items.slice(2);
  } else {
    return null;
  }

  // valor: para desconto vem com sufixo " D" colado no próprio item; pra
  // provento é o último item em formato de dinheiro puro.
  let valor: number | null = null;
  let referencia: string | null = null;
  const numericRest = rest.filter((it) => it.text.trim().length > 0);
  const valorItem = natureza === "D"
    ? [...numericRest].reverse().find((it) => MONEY_D_RE.test(it.text.trim()))
    : [...numericRest].reverse().find((it) => isMoney(it.text.trim()));
  if (valorItem) valor = toNumber(valorItem.text);
  const others = numericRest.filter((it) => it !== valorItem);
  referencia = others.length > 0 ? others.map((it) => it.text.trim()).join(" ") : null;

  if (codigo === null || valor === null) return null;
  return { codigo, descricao: descricao || `Rubrica ${codigo}`, referencia, valor };
}

// Uma linha de rubrica tem "P" numa posição fixa (~x=286 no layout real).
// Tudo à esquerda do "P"/"D" mais próximo pertence a esse lado; heurística:
// separa em x<300 (provento) e x>=300 (desconto) — validado contra o PDF
// real, onde P sempre cai perto de x=286 e o código de desconto começa perto
// de x=313+.
const CORTE_PROVENTO_DESCONTO = 300;

function parseLinhaRubrica(line: PositionedText[]): { provento: ParConta | null; desconto: ParConta | null } {
  const ladoProvento = line.filter((it) => it.x < CORTE_PROVENTO_DESCONTO);
  const ladoDesconto = line.filter((it) => it.x >= CORTE_PROVENTO_DESCONTO);
  return {
    provento: parseLadoRubrica(ladoProvento, "P"),
    desconto: parseLadoRubrica(ladoDesconto, "D"),
  };
}

function novaCompetencia(competencia: string, codEmpresa: string, cnpj: string, razaoSocial: string | null): DominioCompetencia {
  return {
    competencia, codEmpresaDominio: codEmpresa, cnpj, razaoSocial,
    colaboradores: [], linhasProvento: [], linhasDesconto: [], resumoRubricas: [],
    totalGeralProventos: null, totalGeralDescontos: null, liquidoGeral: null,
    baseFgts: null, valorFgts: null, baseFgtsRescisorio: null, valorFgtsRescisorio: null,
    totalInss: null, inssEmpresa: null, rat: null, terceiros: null,
    noEmpregados: null, trabalhando: null, demitido: null, admissoes: null, noContribuintes: null,
  };
}

function isoDate(br: string): string {
  const [d, m, y] = br.split("/");
  return `${y}-${m}-${d}`;
}

export function parseDominioItems(arquivoOrigem: string, itemsPorPagina: PositionedText[][]): DominioParseResultado {
  const avisos: string[] = [];
  const competencias = new Map<string, DominioCompetencia>();
  let atual: DominioCompetencia | null = null;
  let colaboradorAtual: { codColaborador: number } | null = null;

  for (let pageIndex = 0; pageIndex < itemsPorPagina.length; pageIndex++) {
    const items = itemsPorPagina[pageIndex]!;
    if (items.length === 0) continue;

    const compItem = items.find((it) => COMPETENCIA_RE.test(it.text.trim()));
    const cnpjItem = items.find((it) => /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(it.text.trim()));
    const empresaItem = items.find((it) => /^\d+\s*-\s*.+/.test(it.text.trim()) && it.y > 700);
    if (!compItem || !cnpjItem) {
      avisos.push(`Página ${pageIndex + 1}: sem competência/CNPJ no cabeçalho, ignorada.`);
      continue;
    }
    const [, mm, aaaa] = compItem.text.trim().match(COMPETENCIA_RE)!;
    const competenciaChave = `${aaaa}-${mm}`;
    const cnpjLimpo = cnpjItem.text.trim().replace(/\D/g, "");
    const empresaMatch = empresaItem?.text.trim().match(/^(\d+)\s*-\s*(.+)$/);
    const codEmpresa = empresaMatch?.[1] ?? "";
    const razaoSocial = empresaMatch?.[2]?.trim() ?? null;
    const chaveComp = `${cnpjLimpo}:${competenciaChave}`;

    if (!atual || atual.competencia !== competenciaChave || atual.cnpj !== cnpjLimpo) {
      atual = competencias.get(chaveComp) ?? novaCompetencia(competenciaChave, codEmpresa, cnpjLimpo, razaoSocial);
      competencias.set(chaveComp, atual);
      colaboradorAtual = null;
    }
    const competenciaAtual = atual;

    const lines = groupLines(items);

    for (const line of lines) {
      const lineText = line.map((it) => it.text).join(" ");

      // ── Início de um colaborador ──────────────────────────────────────
      const empMatch = lineText.match(/^(Empr\.|Contr\.):\s*(\d+)\s+(.+?)(?:\s+Situação:|$)/);
      if (empMatch) {
        const codColaborador = Number(empMatch[2]);
        const nome = empMatch[3]!.trim().replace(/Situa[çc][ãa]o:.*$/i, "").trim();
        const situacaoMatch = lineText.match(/Situa[çc][ãa]o:\s*(\w+)/i);
        const cpfMatch = lineText.match(CPF_RE);
        const admMatch = lineText.match(/Adm:\s*(\d{2}\/\d{2}\/\d{4})/);

        competenciaAtual.colaboradores.push({
          codColaborador, nome,
          cpf: cpfMatch ? cpfMatch[0] : "",
          situacao: situacaoMatch?.[1] ?? null,
          dataAdmissao: admMatch ? isoDate(admMatch[1]!) : null,
          dataDemissao: null, motivoDemissao: null, vinculo: null,
          centroCusto: null, departamento: null, cargoCodigo: null, cargoNome: null, cbo: null,
          salario: null, proventos: 0, descontos: 0, liquido: 0,
          baseInss: null, baseFgts: null, valorFgts: null, baseIrrf: null,
        });
        colaboradorAtual = { codColaborador };
        continue;
      }

      if (/^Vínculo:/.test(lineText) && colaboradorAtual) {
        const colab = competenciaAtual.colaboradores.at(-1)!;
        const vinculoMatch = lineText.match(/Vínculo:\s*(\w+)/);
        const ccMatch = lineText.match(/CC:\s*(\d+)/);
        const deptoMatch = lineText.match(/Depto:\s*(\d+)/);
        colab.vinculo = vinculoMatch?.[1] ?? null;
        colab.centroCusto = ccMatch ? Number(ccMatch[1]) : null;
        colab.departamento = deptoMatch ? Number(deptoMatch[1]) : null;
        continue;
      }

      if (/^Cargo:/.test(lineText) && colaboradorAtual) {
        const colab = competenciaAtual.colaboradores.at(-1)!;
        const cargoMatch = lineText.match(/Cargo:\s*(\d+)\s+([^C]+?)\s+C\.B\.O:/);
        const cboMatch = lineText.match(/C\.B\.O:\s*(\d+)/);
        const salarioItem = [...line].reverse().find((it) => isMoney(it.text.trim()));
        colab.cargoCodigo = cargoMatch ? Number(cargoMatch[1]) : null;
        colab.cargoNome = cargoMatch ? cargoMatch[2]!.trim() : null;
        colab.cbo = cboMatch?.[1] ?? null;
        colab.salario = salarioItem ? toNumber(salarioItem.text) : null;
        continue;
      }

      if (/^DEMITIDO EM/.test(lineText) && colaboradorAtual) {
        const colab = competenciaAtual.colaboradores.at(-1)!;
        const demMatch = lineText.match(/DEMITIDO EM\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*MOTIVO\s*(\d+)-?\s*(.*)$/i);
        if (demMatch) {
          colab.dataDemissao = isoDate(demMatch[1]!);
          colab.motivoDemissao = `${demMatch[2]} - ${demMatch[3]}`.trim();
        }
        continue;
      }

      // ── Totais do colaborador (ND: ... Líquido: ...) ───────────────────
      // Um colaborador demitido pode ter DOIS blocos ND:/NF: dentro da mesma
      // seção Empr.: (o mês normal + a rescisão), sem repetir o cabeçalho —
      // por isso acumula em vez de sobrescrever.
      if (/^ND:/.test(lineText) && colaboradorAtual) {
        const colab = competenciaAtual.colaboradores.at(-1)!;
        colab.proventos += nearestValueAfterLabel(line, /^Proventos:$/) ?? 0;
        colab.descontos += nearestValueAfterLabel(line, /^Descontos:$/) ?? 0;
        // Alerta 2: "Líquido:" pode não ter valor logo depois — o líquido
        // real é o ÚLTIMO valor monetário da linha inteira.
        const todosValores = line.filter((it) => isMoney(it.text.trim()));
        colab.liquido += todosValores.length > 0 ? toNumber(todosValores.at(-1)!.text) : 0;
        continue;
      }

      if (/^NF:/.test(lineText) && colaboradorAtual) {
        const colab = competenciaAtual.colaboradores.at(-1)!;
        colab.baseInss = (colab.baseInss ?? 0) + (nearestValueAfterLabel(line, /^Base INSS:$/) ?? 0);
        colab.baseFgts = (colab.baseFgts ?? 0) + (nearestValueAfterLabel(line, /^Base FGTS:$/) ?? 0);
        colab.valorFgts = (colab.valorFgts ?? 0) + (nearestValueAfterLabel(line, /^Valor FGTS:$/) ?? 0);
        colab.baseIrrf = (colab.baseIrrf ?? 0) + (nearestValueAfterLabel(line, /^Base IRRF:$/) ?? 0);
        continue;
      }

      // ── Total Geral / Líquido Geral ────────────────────────────────────
      if (/Total Geral Proventos:/.test(lineText)) {
        competenciaAtual.totalGeralProventos = nearestValueAfterLabel(line, /Total Geral Proventos:/);
        competenciaAtual.totalGeralDescontos = nearestValueAfterLabel(line, /Total Geral Descontos:/);
        continue;
      }
      if (/^Líquido Geral:/.test(lineText)) {
        if (competenciaAtual.liquidoGeral == null) {
          competenciaAtual.liquidoGeral = nearestValueAfterLabel(line, /Líquido Geral:/);
        }
        continue;
      }

      // ── Bloco INSS / FGTS ───────────────────────────────────────────────
      const linhaVizinha = items.filter((it) => Math.abs(it.y - line[0]!.y) <= 2);
      if (/Base do FGTS:/.test(lineText)) { competenciaAtual.baseFgts = nearestValueAfterLabel(linhaVizinha, /Base do FGTS:/); continue; }
      if (/Valor do FGTS:/.test(lineText)) { competenciaAtual.valorFgts = nearestValueAfterLabel(linhaVizinha, /Valor do FGTS:/); continue; }
      if (/Base FGTS Rescisório:/.test(lineText)) { competenciaAtual.baseFgtsRescisorio = nearestValueAfterLabel(linhaVizinha, /Base FGTS Rescisório:/); continue; }
      if (/Valor FGTS Rescisório:/.test(lineText)) { competenciaAtual.valorFgtsRescisorio = nearestValueAfterLabel(linhaVizinha, /Valor FGTS Rescisório:/); continue; }
      if (/^Total INSS:/.test(lineText)) { competenciaAtual.totalInss = nearestValueAfterLabel(line, /^Total INSS:/); continue; }
      if (/^Empresa:/.test(lineText) && line[0]!.x < 30 && line[0]!.y < 750) { competenciaAtual.inssEmpresa = nearestValueAfterLabel(line, /^Empresa:$/); continue; }
      if (/^RAT:/.test(lineText)) { competenciaAtual.rat = nearestValueAfterLabel(line, /^RAT:$/); continue; }
      if (/^Terceiros:/.test(lineText)) { competenciaAtual.terceiros = nearestValueAfterLabel(line, /^Terceiros:$/); continue; }

      // ── Situações (melhor esforço — não usado na validação obrigatória) ─
      if (/No\. Empregados:/.test(lineText)) { competenciaAtual.noEmpregados = nearestIntAfterLabel(items, /No\. Empregados:/, 4, 260); continue; }
      if (/^Trabalhando:/.test(lineText)) { competenciaAtual.trabalhando = nearestIntAfterLabel(items, /^Trabalhando:$/, 4, 260); continue; }
      if (/^Demitido:/.test(lineText)) { competenciaAtual.demitido = nearestIntAfterLabel(items, /^Demitido:$/, 4, 260); continue; }
      if (/^Admissões:/.test(lineText)) { competenciaAtual.admissoes = nearestIntAfterLabel(items, /^Admissões:$/, 4, 260); continue; }
      if (/No\. Contribuintes:/.test(lineText)) { competenciaAtual.noContribuintes = nearestIntAfterLabel(items, /No\. Contribuintes:/, 4, 260); continue; }

      // ── Linha de rubrica (detalhe por colaborador OU Resumo por Rubrica)
      const temP = line.some((it) => it.text.trim() === "P");
      const temDSuffix = line.some((it) => MONEY_D_RE.test(it.text.trim()));
      if (temP || temDSuffix) {
        const { provento, desconto } = parseLinhaRubrica(line);
        const dentroDeResumo = competenciaAtual.totalGeralProventos != null;
        if (dentroDeResumo && (provento || desconto)) {
          if (provento) competenciaAtual.resumoRubricas.push({ rubricaCodigo: provento.codigo, rubricaDescricao: provento.descricao, natureza: "PROVENTO", quantidadeTexto: provento.referencia, valor: provento.valor });
          if (desconto) competenciaAtual.resumoRubricas.push({ rubricaCodigo: desconto.codigo, rubricaDescricao: desconto.descricao, natureza: "DESCONTO", quantidadeTexto: desconto.referencia, valor: desconto.valor });
        } else if (colaboradorAtual) {
          if (provento) competenciaAtual.linhasProvento.push({ codColaborador: colaboradorAtual.codColaborador, rubricaCodigo: provento.codigo, valor: provento.valor });
          if (desconto) competenciaAtual.linhasDesconto.push({ codColaborador: colaboradorAtual.codColaborador, rubricaCodigo: desconto.codigo, valor: desconto.valor });
        }
      }
    }
  }

  return { arquivoOrigem, competencias: [...competencias.values()], avisos };
}
