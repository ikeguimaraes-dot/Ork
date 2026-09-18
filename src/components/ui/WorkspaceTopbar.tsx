"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ChevronRight, Menu, Search, X } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

export type QuickLink = { href: string; label: string; group: string };

export function WorkspaceTopbar({ links, section = "Financeiro", homeHref = "/financeiro" }: { links: QuickLink[]; section?: string; homeHref?: string }) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const current = links.filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  const matches = useMemo(() => {
    const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return links.filter((link) => normalize(`${link.label} ${link.group}`).includes(normalize(query)));
  }, [links, query]);

  function openSearch() { setQuery(""); dialog.current?.showModal(); }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else { setQuery(""); dialog.current?.showModal(); }
      }
    };
    const onMenu = (event: Event) => setMenuOpen(Boolean((event as CustomEvent<boolean>).detail));
    document.addEventListener("keydown", onKey);
    window.addEventListener("ork:sidebarState", onMenu);
    return () => { document.removeEventListener("keydown", onKey); window.removeEventListener("ork:sidebarState", onMenu); };
  }, []);

  return <>
    <header className="ork-topbar">
      <button type="button" className="ork-icon-button ork-menu-trigger" aria-label="Abrir menu de navegação" aria-controls="ork-sidebar" aria-expanded={menuOpen} onClick={() => window.dispatchEvent(new Event("ork:toggleSidebar"))}><Menu size={19} /></button>
      <nav className="ork-breadcrumb" aria-label="Localização">
        {current && current.label !== section && <><a href={homeHref}>{section}</a><ChevronRight size={13} /></>}<strong>{current?.label ?? section}</strong>
      </nav>
      <div className="ork-topbar-actions">
        <button type="button" ref={trigger} className="ork-search-button" onClick={openSearch} aria-label="Buscar página (Ctrl ou Command K)"><Search size={16} /><span>Ir para uma página</span><kbd>⌘ K</kbd></button>
        <ThemeToggle />
      </div>
    </header>
    <dialog ref={dialog} className="ork-dialog" aria-labelledby="ork-search-title" onClose={() => trigger.current?.focus()} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="ork-dialog-heading"><h2 id="ork-search-title">Aonde vamos?</h2><button type="button" className="ork-icon-button" aria-label="Fechar busca" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      <input className="ork-command-input" aria-label="Buscar página" placeholder="Digite o nome de uma página…" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
      <nav className="ork-command-results" aria-label="Resultados da busca">
        {matches.map((link) => <a key={link.href} href={link.href} onClick={() => dialog.current?.close()}><span>{link.label}<br /><small>{link.group}</small></span><ArrowUpRight size={16} /></a>)}
        {matches.length === 0 && <p className="ork-command-empty">Nenhuma página encontrada. Tente outro termo.</p>}
      </nav>
    </dialog>
  </>;
}
