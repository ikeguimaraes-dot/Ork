import Link from 'next/link';
import { createFinanceiroClient } from '@/lib/financeiro/db/client';
import { getCurrentUnit } from '@ork/auth/unit';
import { refreshUnits } from '@/lib/financeiro/razao/refresh';
import { formatBRL, competenciaLabel } from '@/lib/financeiro/utils';
export const dynamic = 'force-dynamic';
export default async function Dre({searchParams}:{searchParams:Promise<{competencia?:string}>}) {
  const db=await createFinanceiroClient(); const unit=await getCurrentUnit();
  if(!unit)return <p>Cadastre uma unidade e vincule seu usuário para começar.</p>;
  await refreshUnits(db,[unit.id]);
  const {data:months,error}=await db.from('kpi_snapshot').select('competencia').eq('unit_id',unit.id).order('competencia');
  if(error)throw error;
  const sp=await searchParams; const periods=(months??[]).map(m=>String(m.competencia));
  const selected=sp.competencia&&periods.includes(sp.competencia)?sp.competencia:periods.at(-1);
  if(!selected)return <section className="ork-panel"><h1>DRE · {unit.name}</h1><p>Ainda não há dados para calcular a DRE desta unidade.</p><Link href="/financeiro/importacao-ork">Importar dados</Link></section>;
  const [snapshot,plan,kpi]=await Promise.all([
    db.from('dre_snapshot').select('conta_codigo,valor,qtd_lancamentos').eq('unit_id',unit.id).eq('competencia',selected),
    db.from('plano_contas').select('codigo,nome,grupo,ordem').order('ordem'),
    db.from('kpi_snapshot').select('receita_liquida,ebitda,resultado_liquido').eq('unit_id',unit.id).eq('competencia',selected).single(),
  ]);
  if(snapshot.error||plan.error||kpi.error)throw snapshot.error||plan.error||kpi.error;
  const byCode=new Map((snapshot.data??[]).map(row=>[row.conta_codigo,row]));
  return <section className="ork-panel" style={{padding:24}}><h1>DRE · {unit.name}</h1>
    <form><label>Competência <select name="competencia" defaultValue={selected}>{periods.map(p=><option key={p} value={p}>{competenciaLabel(p)}</option>)}</select></label><button type="submit">Consultar</button></form>
    <p>Receita líquida: {formatBRL(kpi.data?.receita_liquida??null)} · EBITDA: {formatBRL(kpi.data?.ebitda??null)} · Resultado líquido: {formatBRL(kpi.data?.resultado_liquido??null)}</p>
    <p>Valores por conta a partir das fontes importadas. CMV por compras; o fechamento depende da conferência das fontes.</p>
    <table style={{width:'100%'}}><thead><tr><th>Conta</th><th>Grupo</th><th>Lançamentos</th><th>Valor</th></tr></thead><tbody>{(plan.data??[]).filter(p=>byCode.has(p.codigo)).map(p=>{const row=byCode.get(p.codigo)!;return <tr key={p.codigo}><td>{p.codigo} · {p.nome}</td><td>{p.grupo}</td><td>{row.qtd_lancamentos}</td><td>{formatBRL(Number(row.valor))}</td></tr>;})}</tbody></table>
    <p><Link href="/financeiro/dre/classificacao">Conferir classificação</Link> · <Link href="/financeiro/aprovacoes">Conferir fontes</Link></p>
  </section>;
}
