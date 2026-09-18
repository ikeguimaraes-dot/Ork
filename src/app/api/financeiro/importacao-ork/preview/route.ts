export const runtime = "nodejs"
export const maxDuration = 120

import { requireUser } from "@ork/auth/server"
import { getCurrentUnit } from "@ork/auth/unit"
import { previewOrkArchive, previewOrkSpreadsheet } from "@/lib/financeiro/importacao/ork/archive"
import { ImportConflictError, persistOrkArchive } from "@/lib/financeiro/importacao/ork/repository"

export async function POST(request: Request) {
  try { await requireUser() }
  catch { return Response.json({ error: "Não autorizado" }, { status: 401 }) }

  try {
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File) || !/\.(zip|xlsx)$/i.test(file.name)) {
      return Response.json({ error: "Envie um arquivo ZIP ou Excel (.xlsx) válido." }, { status: 400 })
    }
    const bytes = Buffer.from(await file.arrayBuffer())
    const preview = /\.zip$/i.test(file.name) ? await previewOrkArchive(file.name, bytes) : previewOrkSpreadsheet(file.name, bytes)
    if (form.get("commit") !== "true") return Response.json(preview)
    const unit = await getCurrentUnit()
    if (!unit) return Response.json({ error: "Selecione uma unidade antes de importar." }, { status: 400 })
    const user = await requireUser()
    const result = await persistOrkArchive({ unitId: unit.id, unitName: unit.name, userId: user.id, fileName: file.name, bytes, preview, replaceExisting: form.get("replace_existing") === "true" })
    return Response.json({ ...result, preview })
  } catch (error) {
    const status = error instanceof ImportConflictError ? 409 : 422
    return Response.json({ error: error instanceof Error ? error.message : String(error), conflict: status === 409 }, { status })
  }
}
