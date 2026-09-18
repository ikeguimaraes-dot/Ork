import { redirect } from "next/navigation";

// A página real fica sob o layout do financeiro (sidebar + auth) em
// /financeiro/contratos — esse caminho também é o que o shell ork embute via
// rewrite /financeiro/*. Este stub mantém /contratos abrindo no domínio filho.
export default function ContratosRedirect() {
  redirect("/financeiro/contratos");
}
