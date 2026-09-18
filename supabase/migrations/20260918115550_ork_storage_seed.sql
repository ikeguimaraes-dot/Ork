-- Technical chart of accounts; no customer amounts or classifications.
INSERT INTO public.plano_contas(codigo,nome,grupo,ordem,ncm_capitulos,ativo) VALUES
('1.01','Receita — salão','receita',10,NULL,true),
('1.02','Receita — delivery/apps','receita',20,NULL,true),
('1.03','Receita — eventos','receita',30,NULL,true),
('1.04','Outras receitas','receita',40,NULL,true),
('2.01','Cancelamentos e descontos','deducao',110,NULL,true),
('2.02','Taxas de cartão','deducao',120,NULL,true),
('2.03','Comissões de delivery','deducao',130,NULL,true),
('2.04','Impostos sobre vendas','deducao',140,NULL,true),
('3.01','CMV — carnes','cmv',210,ARRAY['02']::text[],true),
('3.02','CMV — pescados','cmv',220,ARRAY['03']::text[],true),
('3.03','CMV — laticínios e ovos','cmv',230,ARRAY['04']::text[],true),
('3.04','CMV — hortifrúti','cmv',240,ARRAY['06','07','08']::text[],true),
('3.05','CMV — secos e mercearia','cmv',250,ARRAY['09','10','11','12','15','16','17','18','19','20','21','29','35']::text[],true),
('3.06','CMV — bebidas','cmv',260,ARRAY['22']::text[],true),
('3.07','CMV — variação de estoque','cmv',270,NULL,true),
('3.99','CMV — compras fora do fluxo de NF-e','cmv',280,NULL,true),
('4.01','Salários','mao_de_obra',310,NULL,true),
('4.02','Encargos','mao_de_obra',320,NULL,true),
('4.03','Benefícios','mao_de_obra',330,NULL,true),
('4.04','Extras e freelancers','mao_de_obra',340,NULL,true),
('4.05','Rescisões','mao_de_obra',350,NULL,true),
('4.06','Férias e 13º','mao_de_obra',360,NULL,true),
('4.07','Pró-labore','mao_de_obra',370,NULL,true),
('5.01','Ocupação','despesa_operacional',410,NULL,true),
('5.02','Utilidades','despesa_operacional',420,ARRAY['27']::text[],true),
('5.03','Marketing','despesa_operacional',430,NULL,true),
('5.04','Manutenção','despesa_operacional',440,NULL,true),
('5.05','Administrativo','despesa_operacional',450,ARRAY['64']::text[],true),
('5.06','Descartáveis, embalagens e limpeza','despesa_operacional',460,ARRAY['28','34','38','39','40','44','48','56','63','65','68','83']::text[],true),
('5.07','Logística e transportadora','despesa_operacional',470,NULL,true),
('5.09','Entrega e motoboy','despesa_operacional',475,NULL,true),
('5.08','Outras despesas','despesa_operacional',480,NULL,true),
('6.01','Juros e multas','financeiro',510,NULL,true),
('6.02','Tarifas bancárias','financeiro',520,NULL,true),
('6.03','Antecipação de recebíveis','financeiro',530,NULL,true),
('7.01','Equipamentos','investimento',610,ARRAY['70','73','84','85','94']::text[],true),
('7.02','Reformas e obras','investimento',620,NULL,true),
('8.01','Imposto sobre o lucro','imposto_lucro',700,NULL,true),
('9.98','Pagamento de folha (não é custo)','nao_operacional',998,NULL,true),
('9.99','A classificar','despesa_operacional',999,NULL,true);


INSERT INTO public.roles(name,description) VALUES
('founder','Administrador da instalação'),('cfo','Gestão financeira por unidade'),('socio_readonly','Consulta por unidade') ON CONFLICT(name) DO NOTHING;
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES
('contratos','contratos',false,20971520),('protestos','protestos',false,20971520),
('financeiro-importacoes','financeiro-importacoes',false,52428800),('folha-documentos','folha-documentos',false,20971520)
ON CONFLICT(id) DO NOTHING;
CREATE POLICY ork_storage_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id IN ('contratos','protestos','financeiro-importacoes','folha-documentos') AND public.financeiro_can_read(public.financeiro_storage_unit(name))) ;
CREATE POLICY ork_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id IN ('contratos','protestos','financeiro-importacoes','folha-documentos') AND public.financeiro_can_write(public.financeiro_storage_unit(name)));
CREATE POLICY ork_storage_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id IN ('contratos','protestos','financeiro-importacoes','folha-documentos') AND public.financeiro_can_write(public.financeiro_storage_unit(name))) WITH CHECK (bucket_id IN ('contratos','protestos','financeiro-importacoes','folha-documentos') AND public.financeiro_can_write(public.financeiro_storage_unit(name)));
CREATE POLICY ork_storage_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id IN ('contratos','protestos','financeiro-importacoes','folha-documentos') AND public.financeiro_can_write(public.financeiro_storage_unit(name))) ;
