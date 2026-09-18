-- Run against an isolated schema with the migration applied, never production.
BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-000000000100'),('00000000-0000-0000-0000-000000000101');
INSERT INTO units(id,name) VALUES('00000000-0000-0000-0000-000000000001','Teste A'),('00000000-0000-0000-0000-000000000002','Teste B');
INSERT INTO roles(id,name) VALUES('00000000-0000-0000-0000-000000000010','operador'),('00000000-0000-0000-0000-000000000011','socio_readonly') ON CONFLICT(name) DO NOTHING;
INSERT INTO user_roles(user_id,role_id,unit_id) VALUES
('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000101',(SELECT id FROM roles WHERE name='socio_readonly'),'00000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000100',true);
SELECT financeiro_aplicar_lote('[{"table":"receita_dias","operation":"insert","rows":[{"unit_id":"00000000-0000-0000-0000-000000000001","workday_id":101,"data":"2026-06-01","turno":"dia_inteiro","receita_bruta":100}]}]');
DO $$ BEGIN
 IF (SELECT revisao FROM financeiro_revisoes WHERE unit_id='00000000-0000-0000-0000-000000000001') <> 1 THEN RAISE EXCEPTION 'Revision trigger failed'; END IF;
 BEGIN
  PERFORM financeiro_aplicar_lote('[{"table":"receita_dias","operation":"delete","scope":{"unit_id":"00000000-0000-0000-0000-000000000001"}},{"table":"receita_dias","operation":"insert","rows":[{"unit_id":"00000000-0000-0000-0000-000000000002","workday_id":102,"data":"2026-06-01","turno":"dia_inteiro"}]}]');
  RAISE EXCEPTION 'Unauthorized insert succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(*) FROM receita_dias WHERE workday_id=101) <> 1 THEN RAISE EXCEPTION 'Rollback lost previous data'; END IF;
 BEGIN
  PERFORM financeiro_aplicar_lote('[{"table":"receita_dias","operation":"delete","scope":{"unit_id":"00000000-0000-0000-0000-000000000002"}}]');
  RAISE EXCEPTION 'Unauthorized replacement succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM financeiro_aplicar_lote('[]','{"unit_id":"00000000-0000-0000-0000-000000000001","revisao":0}');
  RAISE EXCEPTION 'Stale calculation succeeded';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
SELECT financeiro_aplicar_lote('[{"table":"receita_dias","operation":"delete","scope":{"unit_id":"00000000-0000-0000-0000-000000000001","data":"2026-06-01"}},{"table":"receita_dias","operation":"insert","rows":[{"unit_id":"00000000-0000-0000-0000-000000000001","workday_id":101,"data":"2026-06-01","turno":"dia_inteiro","receita_bruta":80}]}]');
DO $$ BEGIN
 IF (SELECT sum(receita_bruta) FROM receita_dias) <> 80 THEN RAISE EXCEPTION 'Replacement duplicated revenue'; END IF;
END $$;
-- Same product may occur twice in one invoice; invoice numbers repeat across suppliers.
INSERT INTO produtos_relatorio(unit_id,chave_nfe,item_nfe,item_codigo,nr_danfe,fornecedor_codigo,mes_lancamento,ano_lancamento) VALUES
('00000000-0000-0000-0000-000000000001','11111111111111111111111111111111111111111111',1,'ABC','10','fornecedor A',6,2026),
('00000000-0000-0000-0000-000000000001','11111111111111111111111111111111111111111111',2,'ABC','10','fornecedor A',6,2026),
('00000000-0000-0000-0000-000000000001','22222222222222222222222222222222222222222222',1,'ABC','10','fornecedor B',6,2026);
DO $$ BEGIN IF (SELECT count(*) FROM produtos_relatorio) <> 3 THEN RAISE EXCEPTION 'Invoice identity collision'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM receita_dias) <> 1 THEN RAISE EXCEPTION 'Readonly access denied'; END IF;
 BEGIN
  PERFORM financeiro_aplicar_lote('[{"table":"receita_dias","operation":"delete","scope":{"unit_id":"00000000-0000-0000-0000-000000000001"}}]');
  RAISE EXCEPTION 'Readonly user mutated data';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM receita_dias) <> 0 THEN RAISE EXCEPTION 'Data leaked to non-member'; END IF;
END $$;
ROLLBACK;
