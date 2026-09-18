// Item de texto posicionado, como pdfjs-dist entrega via page.getTextContent()
// (item.transform[4]/[5] = x,y). Único formato de entrada do parser — quem
// chama decide como obter isso (no navegador, via pdfjs-dist real).
export type PositionedText = { text: string; x: number; y: number; page: number };

export type DominioLinha = {
  codColaborador: number;
  rubricaCodigo: number;
  valor: number;
};

export type DominioColaborador = {
  codColaborador: number;
  nome: string;
  cpf: string;
  situacao: string | null;
  dataAdmissao: string | null;
  dataDemissao: string | null;
  motivoDemissao: string | null;
  vinculo: string | null;
  centroCusto: number | null;
  departamento: number | null;
  cargoCodigo: number | null;
  cargoNome: string | null;
  cbo: string | null;
  salario: number | null;
  proventos: number;
  descontos: number;
  liquido: number;
  baseInss: number | null;
  baseFgts: number | null;
  valorFgts: number | null;
  baseIrrf: number | null;
};

export type DominioRubricaResumo = {
  rubricaCodigo: number;
  rubricaDescricao: string;
  natureza: "PROVENTO" | "DESCONTO";
  quantidadeTexto: string | null;
  valor: number;
};

export type DominioCompetencia = {
  competencia: string; // "2026-06"
  codEmpresaDominio: string;
  cnpj: string;
  razaoSocial: string | null;
  colaboradores: DominioColaborador[];
  linhasProvento: DominioLinha[];
  linhasDesconto: DominioLinha[];
  resumoRubricas: DominioRubricaResumo[];
  totalGeralProventos: number | null;
  totalGeralDescontos: number | null;
  liquidoGeral: number | null;
  baseFgts: number | null;
  valorFgts: number | null;
  baseFgtsRescisorio: number | null;
  valorFgtsRescisorio: number | null;
  totalInss: number | null;
  inssEmpresa: number | null;
  rat: number | null;
  terceiros: number | null;
  noEmpregados: number | null;
  trabalhando: number | null;
  demitido: number | null;
  admissoes: number | null;
  noContribuintes: number | null;
};

export type DominioParseResultado = {
  arquivoOrigem: string;
  competencias: DominioCompetencia[];
  avisos: string[];
};
