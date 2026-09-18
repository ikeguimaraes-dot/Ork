"use client";

// Ponte entre o PDF real (browser) e o parser puro (parser.ts). Roda 100% no
// navegador — pdfjs-dist precisa de DOMMatrix/Path2D/ImageData nativos do
// browser, que não existem em runtime serverless (ver erro de produção
// DOMMatrix em /api/folha/import). Mesma estratégia do NfeImportModal com
// jszip: parse pesado no cliente, só o resultado estruturado vai pro server.
import { parseDominioItems } from "./parser";
import type { DominioParseResultado, PositionedText } from "./types";

export async function parseDominioPdf(arquivo: File): Promise<DominioParseResultado> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const bytes = await arquivo.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;

  const itemsPorPagina: PositionedText[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: PositionedText[] = content.items.flatMap((raw) => {
      if (!("str" in raw) || !raw.str.trim() || !("transform" in raw)) return [];
      return [{
        text: raw.str,
        x: Math.round(raw.transform[4] * 10) / 10,
        y: Math.round(raw.transform[5] * 10) / 10,
        page: p,
      }];
    });
    itemsPorPagina.push(items);
  }

  return parseDominioItems(arquivo.name, itemsPorPagina);
}
