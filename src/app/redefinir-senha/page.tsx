import { requireUser } from "@ork/auth/server";
import { changePassword } from "./actions";
export default async function Password({searchParams}:{searchParams:Promise<{error?:string}>}) {
 await requireUser();const sp=await searchParams;
 return <main style={{maxWidth:400,margin:"10vh auto",padding:24}}><h1>Definir senha</h1>{sp.error && <p role="alert">Não foi possível salvar. Use pelo menos 12 caracteres e confirme a mesma senha.</p>}<form action={changePassword} style={{display:"grid",gap:16}}><label>Nova senha<input type="password" name="password" minLength={12} autoComplete="new-password" required /></label><label>Confirmar senha<input type="password" name="confirm" minLength={12} autoComplete="new-password" required /></label><button type="submit">Salvar senha</button></form></main>;
}
