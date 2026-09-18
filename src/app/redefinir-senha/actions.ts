"use server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@ork/db/supabase/server";
export async function changePassword(form:FormData) {
 const db=await createSupabaseServerClient();
 if(!db || !(await db.auth.getUser()).data.user) redirect("/login");
 const password=String(form.get("password")||"");
 if(password.length<12 || password!==form.get("confirm")) redirect("/redefinir-senha?error=validation");
 const {error}=await db.auth.updateUser({password});
 if(error) redirect("/redefinir-senha?error=update");
 redirect("/financeiro");
}
