"use client";

import { useEffect, useEffectEvent, useState } from "react";

/** Discard results from an older unit/filter, including after unmount. */
export function useResource<T>(key: string, loader: () => Promise<T>, initial: T) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; version: number; data: T; error: string | null }>();
  const load = useEffectEvent(loader);
  useEffect(() => {
    let active = true;
    load().then(
      data => { if (active) setResult({ key, version, data, error: null }); },
      error => { if (active) setResult({ key, version, data: initial, error: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { active = false; };
    // The initial value is a fallback; only key/version define a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  const current = result?.key === key && result.version === version ? result : undefined;
  return { data: current?.data ?? initial, loading: !current, error: current?.error ?? null, reload: () => setVersion(v => v + 1) };
}
