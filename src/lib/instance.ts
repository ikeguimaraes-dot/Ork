import { z } from "zod";
const UnitRule = z.object({
  revenueAccount: z.enum(["1.01", "1.02", "1.03", "1.04"]).default("1.01"),
  erpCompany: z.string().optional(),
  categoryContains: z.array(z.string().min(1)).default([]),
});
// Public configuration only: no credentials belong in this object.
export const unitRules = z.record(z.string().uuid(), UnitRule).parse(
  JSON.parse(process.env.NEXT_PUBLIC_UNIT_RULES || "{}")
);
export const instance = {
  name: process.env.NEXT_PUBLIC_APP_NAME || "Ork",
  tagline: process.env.NEXT_PUBLIC_APP_TAGLINE || "Gestão financeira para restaurantes",
  color: /^#[0-9a-f]{6}$/i.test(process.env.NEXT_PUBLIC_BRAND_COLOR || "") ? process.env.NEXT_PUBLIC_BRAND_COLOR! : "#C4622D",
};
export function unitMentioned(text: string): string | null {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const matches = Object.entries(unitRules).filter(([, rule]) => rule.categoryContains.some(term =>
    normalized.includes(term.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase())
  ));
  if (matches.length > 1) throw new Error("Categoria corresponde a mais de uma unidade. Revise NEXT_PUBLIC_UNIT_RULES.");
  return matches[0]?.[0] ?? null;
}
