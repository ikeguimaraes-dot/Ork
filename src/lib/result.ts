// Tipo discriminated union para resultados de Server Actions.
// Mora aqui (e não no actions.ts com "use server") porque arquivos de
// Server Action no Next.js só devem exportar funções async — qualquer
// type/const exportado pode dar warning ou erro em alguns paths.

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
