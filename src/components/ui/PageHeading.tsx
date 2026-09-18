import type { ReactNode } from "react";

export function PageHeading({ eyebrow = "Financeiro", title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="ork-page-heading ork-enter"><div><p className="ork-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions}</header>;
}
