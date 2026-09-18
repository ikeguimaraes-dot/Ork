"use client";

import { useAuth } from "@ork/auth/context";
import { usePathname } from "next/navigation";
import type { RemoteNavGroup, RemoteNavItem } from "@ork/ui/nav/types";
import { WorkspaceTopbar, type QuickLink } from "./WorkspaceTopbar";

export function FinanceiroTopbar({ groups, shellUrl }: { groups: RemoteNavGroup[]; shellUrl: string }) {
  const { user } = useAuth();
  const isDashboard = usePathname() === "/dashboard";
  const roles = new Set((user?.roles ?? []).map((entry) => entry.role as string));
  const links: QuickLink[] = [];
  function visit(items: RemoteNavItem[], group: string) {
    for (const item of items) {
      if (!roles.has("founder") && item.roles?.length && !item.roles.some((role) => roles.has(role))) continue;
      if (item.href) links.push({ href: item.href, label: item.label, group });
      if (item.children) visit(item.children, group);
    }
  }
  groups.filter((group) => group.habilitado !== false).forEach((group) => visit(group.items, group.label ?? "Ork"));
  return <WorkspaceTopbar section={isDashboard ? "Dashboard" : "Financeiro"} homeHref={isDashboard ? "/dashboard" : "/financeiro"} links={links.map((link) => ({ ...link, href: link.href === "/dashboard" || link.href.startsWith("/financeiro") ? link.href : `${shellUrl}${link.href}` }))} />;
}
