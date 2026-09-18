export class ImportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = "ImportError"
  }
}

export function importErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado durante a importacao."
}
