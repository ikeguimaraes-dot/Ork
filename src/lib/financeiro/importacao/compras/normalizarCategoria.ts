// Normaliza a coluna PRODUTO das planilhas de compras/contas a pagar numa
// categoria canônica curta, usada tanto pra popular regras_classificacao
// (FASE 7 PASSO 2) quanto pelos importadores (PASSO 4) e por
// gerarLancamentosTitulos() (PASSO 5) — mesma função nos três lugares, sem
// duplicar a lógica de agrupamento.
//
// Nos dois arquivos a categoria vive ANTES do primeiro traço:
//   CONTAS_A_PAGAR: "SEGURANÇA - 29/07 A 04/08/2026" → o que vem depois do
//     traço é metadado (data, unidade entre asteriscos, nome de pessoa).
//   NF_PEDIDOS: "ALIMENTOS - PANCETA" → o que vem depois é o item, não
//     metadado — mas a categoria em si ainda é o que vem ANTES do traço.
// A diferença real entre origens é só o fallback quando falta o traço
// (típico de erro de digitação em NF_PEDIDOS, ex. "ALIMENTOS CARAPU..."
// sem traço nenhum): aí usa a primeira palavra se ela for uma categoria
// conhecida, em vez de tratar a linha inteira como categoria.
export type OrigemPlanilha = "contas_pagar" | "nf_pedidos";

const CATEGORIAS_CONHECIDAS_SEM_TRACO = new Set([
  "ALIMENTOS", "ALIMENTO", "BEBIDAS", "BEBIDA", "DESCARTAVEIS", "DESCARTAVEL",
  "UTENSILIOS", "UTENSILIO", "LIMPEZA",
]);

function limparBase(texto: string): string {
  return texto
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Blocos entre asteriscos: **UNIDADE**, ***MZ YOSHI PATRIMONIAL***, "*** UNIDADE***"
    .replace(/\*+[^*]*\*+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Impostos precisam de detecção por PALAVRA-CHAVE em vez de prefixo — a
// natureza real (venda / lucro / encargo de folha) está na sigla que vem
// DEPOIS do traço ("IMPOSTOS - IRPJ **UNIDADE**"), não no texto antes dele.
// IRPJ/CSLL são imposto sobre lucro (não reduz receita líquida — ver
// resultado_liquido). FGTS/DCTF/SINDICATO/CONTRIBUICAO são encargo de
// folha, não imposto de venda. O resto (ICMS, PIS, COFINS, ISS, DIFAL,
// NFSE, DAS, DAMSP) é imposto sobre venda de verdade.
const IMPOSTO_LUCRO_PALAVRAS = ["IRPJ", "CSLL"];
const ENCARGO_FOLHA_PALAVRAS = ["FGTS", "DCTF", "SINDICATO", "CONTRIBUICAO"];

function contemAlguma(texto: string, palavras: string[]): boolean {
  return palavras.some((p) => texto.includes(p));
}

function categoriaImposto(textoCompleto: string): string | null {
  if (!textoCompleto.startsWith("IMPOSTO") && !textoCompleto.includes("CONTRIBUICAO")) return null;
  if (contemAlguma(textoCompleto, IMPOSTO_LUCRO_PALAVRAS)) return "IMPOSTO LUCRO";
  if (contemAlguma(textoCompleto, ENCARGO_FOLHA_PALAVRAS)) return "ENCARGO FOLHA";
  return "IMPOSTOS VENDA";
}

// "PROD - REFIL GÁS" — "PROD" é abreviação de "produto", não categoria.
// O item em si (GÁS) é que decide: mesma natureza de CONSUMO GAS.
function categoriaProd(textoCompleto: string): string | null {
  if (!textoCompleto.startsWith("PROD")) return null;
  if (textoCompleto.includes("GAS")) return "CONSUMO GAS";
  return null;
}

// As 36 categorias que regras_classificacao (FASE 7 PASSO 2) sabe
// classificar. Usado só pelo fallback de seção do NF_PEDIDOS: se o
// resultado normal não bate com nenhuma destas, a seção ("ALIMENTOS - 1ª
// SEMANA...") é uma pista melhor que a linha em si.
export const CATEGORIAS_MAPEADAS = new Set([
  "ALIMENTOS", "BEBIDAS", "ALUGUEL", "GALPAO", "ENERGIA", "CONSUMO AGUA",
  "CONSUMO GAS", "INTERNET", "MARKETING", "MANUTENCAO", "MAQ LAVAR",
  "ALARME", "CAMERAS", "AROMATIZACAO", "LIMPEZA", "DESCARTAVEIS",
  "UTENSILIOS", "PAPELARIA", "MOTOBOY", "ADVOGADO", "CONTABILIDADE",
  "SISTEMA", "SEGURANCA", "LAVANDERIA", "EXAMES", "AMOSTRAS", "LOCACAO",
  "ACORDO", "EXTRA", "SERVICO", "IMPOSTOS VENDA", "IMPOSTO LUCRO",
  "ENCARGO FOLHA", "RESCISAO", "FERIAS", "PREPARACAO",
]);

// Alias por prefixo/igualdade — unifica grafia, plural/singular e as várias
// sub-variações de uma mesma família no nome canônico usado em
// regras_classificacao. Impostos são tratados antes (categoriaImposto),
// não entram aqui.
const ALIAS_PREFIXO: Array<[RegExp, string]> = [
  [/^MAQ\b/, "MAQ LAVAR"],
  [/^LOCACAO/, "LOCACAO"],
  [/^AROMATIZACAO/, "AROMATIZACAO"],
  [/^GALPAO/, "GALPAO"],
  [/^AMOSTRAS?\b/, "AMOSTRAS"],
  [/^EXAMES/, "EXAMES"],
  [/^ACORDO/, "ACORDO"],
  [/^UTENSIL/, "UTENSILIOS"],
  [/^DESCARTA?VE/, "DESCARTAVEIS"], // cobre DESCARTAVEIS/DESCARTAVEL/DESCARTVEIS (typo sem A)
  [/^BEBIDA/, "BEBIDAS"],
  [/^ALIMENTO/, "ALIMENTOS"],
  [/^LIMPEZA/, "LIMPEZA"],
]

const ALIAS_EXATO: Record<string, string> = {
  "CONSUMO DE ENERGIA": "ENERGIA",
}

function aplicarAlias(categoria: string): string {
  if (ALIAS_EXATO[categoria]) return ALIAS_EXATO[categoria]!
  for (const [padrao, canonico] of ALIAS_PREFIXO) {
    if (padrao.test(categoria)) return canonico
  }
  return categoria
}

// categoriaSecaoAtual: só usado por NF_PEDIDOS — a categoria da seção
// vigente ("ALIMENTOS - 1ª SEMANA...", "BEBIDAS - 3ª SEMANA...") acima da
// linha na planilha. É uma pista confiável (o Domínio já classificou),
// então vira fallback quando a linha em si não bate com nenhuma categoria
// mapeada (typo, prefixo faltando, abreviação como "PROD").
export function normalizarCategoria(
  textoOriginal: string,
  origem: OrigemPlanilha,
  categoriaSecaoAtual?: string
): string {
  const limpo = limparBase(textoOriginal || "")
  if (!limpo) return ""

  // Imposto: a sigla que decide a natureza (venda/lucro/encargo) pode estar
  // depois do traço ("IMPOSTOS - IRPJ"), então checa o texto limpo INTEIRO
  // antes de cortar — diferente de todas as outras categorias.
  const imposto = categoriaImposto(limpo)
  if (imposto) return imposto

  const prod = categoriaProd(limpo)
  if (prod) return prod

  const partes = limpo.split(/\s*-\s*/)
  let candidata = partes[0]!.trim()

  // Sem traço e a linha inteira não é claramente uma categoria curta (típico
  // de erro de digitação em NF_PEDIDOS, ex. "ALIMENTOS CARAPU (1,5 KG)...").
  // Usa a primeira palavra se ela for uma categoria conhecida.
  if (origem === "nf_pedidos" && partes.length === 1 && candidata.includes(" ")) {
    const primeiraPalavra = candidata.split(" ")[0]!
    if (CATEGORIAS_CONHECIDAS_SEM_TRACO.has(primeiraPalavra)) {
      candidata = primeiraPalavra
    }
  }

  const resultado = aplicarAlias(candidata)

  if (origem === "nf_pedidos" && categoriaSecaoAtual && !CATEGORIAS_MAPEADAS.has(resultado)) {
    return categoriaSecaoAtual
  }

  return resultado
}
