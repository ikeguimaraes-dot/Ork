"use client";

import { useEffect, type RefObject } from "react";

/** Focus stays inside the mobile navigation; the content behind it is inert. */
export function useMobileNavigation(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    const sidebar = ref.current;
    if (!sidebar) return;
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => { sidebar.inert = media.matches && !open; };
    sync();
    media.addEventListener("change", sync);
    return () => { media.removeEventListener("change", sync); sidebar.inert = false; };
  }, [ref, open]);
  useEffect(() => {
    if (!open || !window.matchMedia("(max-width: 767px)").matches) return;
    const sidebar = ref.current;
    if (!sidebar) return;
    const previous = document.activeElement as HTMLElement | null;
    const body = document.querySelector<HTMLElement>(".ork-workspace-body");
    const wasInert = body?.inert ?? false;
    if (body) body.inert = true;
    const focusable = () => Array.from(sidebar.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], summary, select, [tabindex='0']")).filter((el) => {
      if (!el.getClientRects().length || getComputedStyle(el).visibility === "hidden") return false;
      for (let parent = el.parentElement; parent && parent !== sidebar; parent = parent.parentElement) {
        if (parent.tagName === "DETAILS" && !parent.hasAttribute("open") && !parent.querySelector(":scope > summary")?.contains(el)) return false;
      }
      return true;
    });
    const focusFirst = () => {
      if (!sidebar.contains(document.activeElement)) focusable()[0]?.focus({ preventScroll: true });
    };
    let focusFrame = window.requestAnimationFrame(() => {
      focusFrame = window.requestAnimationFrame(focusFirst);
    });
    // Visibility may still be transitioning on the first painted frame.
    const onTransitionEnd = (event: TransitionEvent) => { if (event.target === sidebar) focusFirst(); };
    sidebar.addEventListener("transitionend", onTransitionEnd);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const media = window.matchMedia("(max-width: 767px)");
    const onResize = () => { if (!media.matches) close(); };
    document.addEventListener("keydown", onKey);
    media.addEventListener("change", onResize);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      sidebar.removeEventListener("transitionend", onTransitionEnd);
      document.removeEventListener("keydown", onKey);
      media.removeEventListener("change", onResize);
      if (body) body.inert = wasInert;
      previous?.focus();
    };
  }, [ref, open, close]);
}
