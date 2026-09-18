import { login } from "./actions";
import { instance } from "@/lib/instance";
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return <main style={{ maxWidth: 400, margin: "10vh auto", padding: 24 }}><h1>{instance.name}</h1><p>{instance.tagline}</p>
    <form action={login} style={{ display: "grid", gap: 16 }}><h2>Entrar</h2>
    {sp.error && <p role="alert">{sp.error === "config" ? "Configure o Supabase antes de entrar." : "Não foi possível entrar. Confira e-mail e senha."}</p>}
    <input type="hidden" name="next" value={sp.next || "/financeiro"} />
    <label>E-mail<input style={{ display: "block", width: "100%" }} type="email" name="email" autoComplete="username" required /></label>
    <label>Senha<input style={{ display: "block", width: "100%" }} type="password" name="password" autoComplete="current-password" required /></label>
    <button type="submit" className="ork-button ork-button-primary">Entrar</button></form>
    <p><a href="/recuperar-senha">Esqueci minha senha</a></p><p>Sem acesso? Solicite uma conta ao administrador do restaurante.</p></main>;
}
