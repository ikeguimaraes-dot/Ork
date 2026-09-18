import { recover } from "./actions";
export default async function Recover({searchParams}:{searchParams:Promise<{sent?:string}>}) {
 const sp=await searchParams;
 return <main style={{maxWidth:400,margin:"10vh auto",padding:24}}><h1>Recuperar senha</h1>{sp.sent ? <p>Se houver uma conta habilitada para esse e-mail, você receberá as instruções.</p> : <form action={recover}><label>E-mail<input type="email" name="email" required autoComplete="email" /></label><button type="submit">Enviar instruções</button></form>}<a href="/login">Voltar ao login</a></main>;
}
