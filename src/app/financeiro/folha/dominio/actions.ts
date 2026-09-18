"use server";

import { createFinanceiroClient } from "@/lib/financeiro/db/client";

import { requireUser } from "@ork/auth/server";

import {
  importarExtratoDominioParaBanco,
  type ImportarExtratoDominioResultado,
} from "@/lib/folha/dominio/importar";
import type { DominioParseResultado } from "@/lib/folha/dominio/types";

export async function importarExtratoDominio(
  resultado: DominioParseResultado
): Promise<ImportarExtratoDominioResultado> {
  await requireUser();
  const supabase = await createFinanceiroClient();
  if (!supabase) {
    return {
      ok: false,
      arquivoOrigem: resultado.arquivoOrigem,
      competencias: [],
      cnpjsDesconhecidos: [],
    };
  }
  return importarExtratoDominioParaBanco(supabase, resultado);
}
