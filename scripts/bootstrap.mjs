import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const { values } = parseArgs({ options: { config: {type:'string'}, owner: {type:'string'}, 'project-ref': {type:'string'} } });
if (!values.config || !values.owner || !values['project-ref']) throw Error('Uso: npm run bootstrap -- --config config/client.local.json --owner UUID --project-ref REF');
z.string().uuid().parse(values.owner);
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
const local = ['127.0.0.1','localhost'].includes(url.hostname);
if ((!local && url.hostname !== `${values['project-ref']}.supabase.co`) || (local && values['project-ref'] !== 'local')) throw Error('Projeto não corresponde a --project-ref');
const schema = z.object({ name:z.string().min(1), slug:z.string().regex(/^[a-z0-9-]+$/), color:z.string().regex(/^#[0-9a-f]{6}$/i).default('#C4622D'), groupId:z.string().uuid().optional(), brandId:z.string().uuid().optional(), units:z.array(z.object({ id:z.string().uuid().optional(), name:z.string().min(1), cnpj:z.string().regex(/^$|^\d{14}$/).default(''), revenueAccount:z.enum(['1.01','1.02','1.03','1.04']).default('1.01'), erpCompany:z.string().optional(), categoryContains:z.array(z.string().min(1)).default([]) })).min(1) });
const config = schema.parse(JSON.parse(readFileSync(values.config,'utf8')));
const db = createClient(url.href, process.env.SUPABASE_SERVICE_ROLE_KEY || '', {auth:{persistSession:false,autoRefreshToken:false}});
const {data:owner,error:ownerError} = await db.auth.admin.getUserById(values.owner);
if(ownerError || !owner.user) throw Error('Crie/convidе o usuário no Supabase Auth antes do bootstrap.');
config.groupId ||= randomUUID(); config.brandId ||= randomUUID(); config.units.forEach(u => {u.id ||= randomUUID();});
// Stable IDs are persisted before writes: rerunning after a partial failure is safe.
writeFileSync(values.config, JSON.stringify(config,null,2)+'\n', {mode:0o600});
async function upsert(table, rows, onConflict='id') {const {error}=await db.from(table).upsert(rows,{onConflict});if(error)throw Error(`${table}: ${error.message}`);}
await upsert('groups',{id:config.groupId,name:config.name,slug:config.slug});
await upsert('brands',{id:config.brandId,group_id:config.groupId,name:config.name,slug:config.slug,color:config.color});
await upsert('units',config.units.map(u=>({id:u.id,brand_id:config.brandId,name:u.name,cnpj:u.cnpj||null,active:true})));
await upsert('profiles',{id:owner.user.id,name:owner.user.user_metadata?.name||'Administrador',email:owner.user.email});
const {data:role,error:roleError}=await db.from('roles').select('id').eq('name','founder').single();if(roleError)throw roleError;
const {data:existing,error:existingError}=await db.from('user_roles').select('id').eq('user_id',owner.user.id).eq('role_id',role.id).eq('group_id',config.groupId);if(existingError)throw existingError;
if(!existing.length){const {error}=await db.from('user_roles').insert({user_id:owner.user.id,role_id:role.id,group_id:config.groupId});if(error)throw error;}
const rules=Object.fromEntries(config.units.map(({id,revenueAccount,erpCompany,categoryContains})=>[id,{revenueAccount,erpCompany,categoryContains}]));
// Values below are public instance configuration. Credentials never appear in output.
writeFileSync('.env.instance.local', `NEXT_PUBLIC_APP_NAME=${JSON.stringify(config.name)}\nNEXT_PUBLIC_BRAND_COLOR=${JSON.stringify(config.color)}\nNEXT_PUBLIC_UNIT_RULES='${JSON.stringify(rules).replaceAll("'", "\\u0027")}'\n`,{mode:0o600});
console.log(`Bootstrap concluído: ${config.units.length} unidade(s). IDs salvos em ${values.config}; configuração pública em .env.instance.local. Inclua essas variáveis no ambiente do app e refaça o build.`);
