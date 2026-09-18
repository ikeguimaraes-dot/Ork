// pdfjs-dist (mesmo o build "legacy") referencia DOMMatrix/Path2D no escopo
// do módulo (ex.: `const SCALE_MATRIX = new DOMMatrix()`), que não existem
// no Node — só em browser. A própria pdfjs-dist tenta um fallback:
// `require("@napi-rs/canvas")` dinâmico de dentro do pacote pra pegar esses
// globals, mas por ser um require dinâmico de dentro de outro pacote (não
// um import estático do NOSSO código), o file tracer de funções serverless
// da Vercel não enxerga essa dependência e não inclui o binário nativo no
// bundle publicado — o fallback interno da pdfjs falha silenciosamente
// (só loga um warn) e `new DOMMatrix()` explode com ReferenceError.
//
// Fix: importar @napi-rs/canvas estaticamente no NOSSO código (rastreável
// pelo bundler) e setar os globals ANTES de importar a pdfjs-dist. Import
// deste módulo tem que vir antes de qualquer `import("pdfjs-dist/...")`.
import { DOMMatrix, Path2D } from "@napi-rs/canvas"
// @ts-expect-error — pdfjs-dist não publica .d.ts pro worker (é um bundle de saída, não uma API pública)
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs"

if (!globalThis.DOMMatrix) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).DOMMatrix = DOMMatrix
}
if (!globalThis.Path2D) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).Path2D = Path2D
}

// Em Node, a pdfjs-dist já roda sem worker_thread de verdade (PDFWorker
// desabilita o worker real e cai no "fake worker" no mesmo processo). Mas o
// fake worker, se não achar `globalThis.pdfjsWorker`, tenta um
// `import(this.workerSrc)` DINÂMICO com um path calculado em runtime — o
// file tracer da Vercel não segue import dinâmico com path computado, então
// pdf.worker.mjs não vai pro bundle da function e o import falha em
// produção ("Cannot find module ... pdf.worker.mjs"). Import ESTÁTICO do
// worker aqui (rastreável) + registrar em globalThis.pdfjsWorker faz a
// pdfjs pular esse import dinâmico inteiramente e usar o handler já
// carregado — é o mecanismo oficial da própria lib pra uso em Node.
if (!(globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).pdfjsWorker = pdfjsWorker
}
