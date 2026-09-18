/** The server selection takes precedence so the menu describes the rendered data. */
export function resolveUnitSelection(
  units: ReadonlyArray<{ id: string }>,
  serverUnitId?: string | null,
  storedUnitId?: string | null,
  legacyUnitId?: string | null,
): string | null {
  for (const id of [serverUnitId, storedUnitId, legacyUnitId]) {
    if (id && units.some((unit) => unit.id === id)) return id;
  }
  return units[0]?.id ?? null;
}
