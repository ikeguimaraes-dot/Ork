import { requireUser } from "@ork/auth/server";
import { getCurrentUnitComOrigem } from "@ork/auth/unit";
import { AvisoUnidadeFallback } from "@/components/financeiro/AvisoUnidadeFallback";
import { ImportarComprasClient } from "@/components/financeiro/pagar/ImportarComprasClient";



export const dynamic = "force-dynamic";

export default async function ImportarComprasPage() {
  await requireUser();
  const { unit, cookiePresente } = await getCurrentUnitComOrigem();

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <AvisoUnidadeFallback cookiePresente={cookiePresente} />
      <ImportarComprasClient unitIdInicial={unit?.id ?? ""} />
    </div>
  );
}
