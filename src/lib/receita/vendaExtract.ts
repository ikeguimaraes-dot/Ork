import { extractedRecord } from "./extraction";
// Lógica COMPARTILHADA de extração de PDF do Lorean via Claude.
// Fonte única para o import diário (/api/receita/import) e o consolidado
// (/api/vendas-consolidado/import) — assim a mecânica de chamada ao Claude e
// o parse NUNCA divergem entre as duas rotas. A única diferença permitida
// entre elas é o DESTINO no banco (lorean_* por dia/turno vs
// vendas_consolidado_* por período).
import Anthropic from "@anthropic-ai/sdk";

// Prompt de extração dos produtos do relatório de Venda (idêntico nas duas rotas).
export const VENDA_PROMPT = `Extraia TODOS os produtos vendidos de TODAS as seções de grupo deste relatório Lorean de Venda e retorne APENAS JSON válido, sem texto adicional, sem markdown.

Cada seção tem um título de grupo (ex: Soft Drinks, Vinho Tinto, Da Brasa) e linhas de produtos com colunas Qtde, Garrafa, CMV, Bruto, Desconto, Gorjeta, Total.

Formato esperado:
{
  "produtos": [
    { "grupo": string, "produto": string, "qtd": number, "cmv_pct": number, "bruto": number, "desconto": number, "gorjeta": number, "total": number }
  ]
}

Regras:
- cmv_pct: valor decimal (ex: 0.27 para 27%)
- Ignorar linhas de subtotal das seções
- Array vazio [] se não houver produtos`;

export async function fileToBase64(file: File): Promise<string> {
  // Buffer.from() is O(n) — safe for multi-MB PDFs
  const buf = await file.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

// Chamada ao Claude EXATAMENTE como o import diário faz (streaming + finalMessage).
// Não alterar sem alterar o diário — esta é a fonte única para ambos.
export async function parsePdf(pdfBase64: string, prompt: string, label: string, maxTokens = 16384) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === "max_tokens") {
    throw new Error(`JSON truncado para ${label} — aumentar max_tokens`);
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error(`No text block from Claude for ${label}`);
  const clean = textBlock.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  if (!clean.startsWith("{")) throw new Error(`Claude response not JSON for ${label}: ${clean.slice(0, 80)}`);
  return extractedRecord(JSON.parse(clean));
}
