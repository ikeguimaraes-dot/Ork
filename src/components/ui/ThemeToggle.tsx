"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

const subscribe = () => () => {};

export function ThemeToggle() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const { resolvedTheme, setTheme } = useTheme();
  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? "Ativar tema claro" : "Ativar tema escuro";
  return <button type="button" className="ork-icon-button" aria-label={label} title={label} onClick={() => setTheme(dark ? "light" : "dark")}>
    {dark ? <Sun size={17} /> : <Moon size={17} />}
  </button>;
}
