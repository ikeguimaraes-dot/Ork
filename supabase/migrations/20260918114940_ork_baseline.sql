-- Ork: schema-only baseline. No customer data or Auth users.
-- Install only into a NEW Supabase project; managed auth/storage schemas already exist.

SET statement_timeout = 0;

SET lock_timeout = 0;

SET idle_in_transaction_session_timeout = 0;

SET client_encoding = 'UTF8';

SET standard_conforming_strings = on;

SELECT pg_catalog.set_config('search_path', '', false);

SET check_function_bodies = false;

SET xmloption = content;

SET client_min_messages = warning;

SET row_security = off;

CREATE SCHEMA IF NOT EXISTS "public";
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

CREATE TYPE "public"."purchase_order_status" AS ENUM (
    'rascunho',
    'enviado',
    'parcial',
    'recebido',
    'cancelado'
);

CREATE OR REPLACE FUNCTION "public"."_sync_employee_tier"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.role_id IS NULL THEN
    NEW.tier := NULL;
  ELSE
    SELECT r.tier INTO NEW.tier FROM public.roles r WHERE r.id = NEW.role_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."financeiro_aplicar_lote"("p_operations" "jsonb", "p_expected" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
DECLARE
 op jsonb; row_data jsonb; scope jsonb; tbl text; kind text;
 cols text; conflict_cols text; update_cols text; statement text; n integer; actual_revision bigint; predicates text; allowed_columns text[];
 allowed text[] := ARRAY[
 'lancamentos','dre_snapshot','kpi_snapshot','metas','reconciliacoes_sugeridas','protestos_certidoes','protestos_registros',
 'titulos_a_pagar','produtos_relatorio','nfe_documentos','nfe_importacoes',
 'payroll_extrato_dominio_competencia','payroll_extrato_dominio_colaborador',
 'payroll_extrato_dominio_linha','payroll_extrato_dominio_rubrica',
 'receita_dias','receita_pagamentos','receita_ambientes','receita_turnos',
 'receita_grupos','receita_descontos','receita_descontos_detalhe',
 'receita_cancelamentos','receita_cancelamentos_detalhe','receita_horarios',
 'receita_usuarios','receita_produtos_dia','receita_caixas','financeiro_importacoes',
 'vendas_consolidado_periodo','vendas_consolidado_produtos','vendas_consolidado_resumo',
 'vendas_consolidado_funcionarios','vendas_consolidado_ambiente','vendas_consolidado_turno',
 'vendas_consolidado_dia_semana','vendas_consolidado_mensal'
 ];
BEGIN
 IF auth.uid() IS NULL AND current_user <> 'service_role' THEN RAISE EXCEPTION 'Não autorizado' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_operations) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Lote inválido'; END IF;
 -- Serialize replacement commits (no delete/insert interleaving).
 PERFORM pg_advisory_xact_lock(hashtextextended('financeiro_importacao',0));
 IF p_expected IS NOT NULL THEN
  SELECT revisao INTO actual_revision FROM public.financeiro_revisoes WHERE unit_id=(p_expected->>'unit_id')::uuid FOR UPDATE;
  IF coalesce(actual_revision,0) <> (p_expected->>'revisao')::bigint THEN RAISE EXCEPTION 'As fontes mudaram durante o cálculo. Tente novamente.' USING ERRCODE='40001'; END IF;
 END IF;
 FOR op IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
  tbl := op->>'table'; kind := op->>'operation';
  IF tbl IS NULL OR NOT tbl=ANY(allowed) THEN RAISE EXCEPTION 'Tabela não permitida'; END IF;
  SELECT array_agg(column_name::text) INTO allowed_columns FROM information_schema.columns WHERE table_schema='public' AND table_name=tbl;
  IF kind='delete' THEN
   scope := op->'scope';
   IF scope IS NULL OR jsonb_typeof(scope)<>'object' OR scope='{}'::jsonb THEN RAISE EXCEPTION 'Exclusão sem escopo'; END IF;
   -- RLS may hide unauthorized rows; explicitly reject a denied unit so a
   -- replacement cannot silently succeed without replacing its old version.
   IF scope ? 'unit_id' AND current_user <> 'service_role' AND NOT public.financeiro_can_write((scope->>'unit_id')::uuid) THEN RAISE EXCEPTION 'Unidade não autorizada' USING ERRCODE='42501'; END IF;
   SELECT string_agg(CASE WHEN scope->key='null'::jsonb THEN format('t.%I IS NULL',key)
     ELSE format('t.%I = (jsonb_populate_record(NULL::public.%I,$1)).%I',key,tbl,key) END,' AND '),count(*)
     INTO predicates,n FROM jsonb_object_keys(scope) key WHERE key=ANY(allowed_columns);
   IF n<>(SELECT count(*) FROM jsonb_object_keys(scope)) THEN RAISE EXCEPTION 'Coluna de escopo inválida'; END IF;
   EXECUTE format('DELETE FROM public.%I t WHERE %s',tbl,predicates) USING scope;
  ELSIF kind IN ('insert','upsert') THEN
   IF jsonb_typeof(op->'rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Linhas inválidas'; END IF;
   FOR row_data IN SELECT value FROM jsonb_array_elements(op->'rows') LOOP
    IF jsonb_typeof(row_data)<>'object' OR row_data='{}'::jsonb THEN RAISE EXCEPTION 'Linha inválida'; END IF;
    SELECT string_agg(format('%I',key),',' ORDER BY key), count(*) INTO cols,n
    FROM jsonb_object_keys(row_data) key WHERE key=ANY(allowed_columns);
    IF n<>(SELECT count(*) FROM jsonb_object_keys(row_data)) THEN RAISE EXCEPTION 'Coluna inválida em %',tbl; END IF;
    statement := format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1)',tbl,cols,cols,tbl);
    IF kind='upsert' THEN
     IF coalesce(op->>'conflict','')='' THEN RAISE EXCEPTION 'Chave de conflito obrigatória'; END IF;
     SELECT string_agg(format('%I',key),',') INTO conflict_cols FROM unnest(string_to_array(op->>'conflict',',')) key;
     SELECT string_agg(format('%I=EXCLUDED.%I',key,key),',') INTO update_cols FROM jsonb_object_keys(row_data) key WHERE NOT key=ANY(string_to_array(op->>'conflict',','));
     statement := statement || format(' ON CONFLICT (%s) ',conflict_cols) || CASE WHEN coalesce((op->>'ignoreDuplicates')::boolean,false) OR update_cols IS NULL THEN 'DO NOTHING' ELSE 'DO UPDATE SET ' || update_cols END;
    END IF;
    EXECUTE statement USING row_data;
   END LOOP;
  ELSE RAISE EXCEPTION 'Operação inválida'; END IF;
 END LOOP;
END $_$;

CREATE OR REPLACE FUNCTION "public"."financeiro_can_read"("p_unit" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT auth.uid() IS NOT NULL AND (public.kph_is_founder() OR (p_unit IS NOT NULL AND public.kph_has_role_for_unit(p_unit))) $$;

CREATE OR REPLACE FUNCTION "public"."financeiro_can_write"("p_unit" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT auth.uid() IS NOT NULL AND (public.kph_is_founder() OR EXISTS (
 SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
 WHERE ur.user_id=auth.uid() AND ur.unit_id=p_unit AND r.name <> 'socio_readonly'
)) $$;

CREATE OR REPLACE FUNCTION "public"."financeiro_has_membership"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid()) $$;

CREATE OR REPLACE FUNCTION "public"."financeiro_source_changed"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE old_unit uuid; new_unit uuid; parent_id uuid;
BEGIN
 IF TG_TABLE_NAME IN ('regras_classificacao','produtos_depara','produtos_catalogo','fornecedores_depara','fornecedores','plano_contas') THEN
  INSERT INTO public.financeiro_revisoes(unit_id) SELECT id FROM public.units WHERE current_user='service_role' OR public.financeiro_can_write(id)
  ON CONFLICT(unit_id) DO UPDATE SET revisao=financeiro_revisoes.revisao+1;
  RETURN NULL;
 END IF;
 IF TG_TABLE_NAME='lancamentos' THEN
  IF TG_OP <> 'INSERT' AND OLD.origem IN ('manual','inventario') THEN old_unit:=OLD.unit_id; END IF;
  IF TG_OP <> 'DELETE' AND NEW.origem IN ('manual','inventario') THEN new_unit:=NEW.unit_id; END IF;
 ELSIF TG_TABLE_NAME='receita_cancelamentos' THEN
  IF TG_OP <> 'INSERT' THEN SELECT unit_id INTO old_unit FROM public.receita_dias WHERE id=OLD.workday_id_fk; END IF;
  IF TG_OP <> 'DELETE' THEN SELECT unit_id INTO new_unit FROM public.receita_dias WHERE id=NEW.workday_id_fk; END IF;
 ELSE
  IF TG_OP <> 'INSERT' THEN old_unit := OLD.unit_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_unit := NEW.unit_id; END IF;
 END IF;
 IF old_unit IS NOT NULL THEN INSERT INTO public.financeiro_revisoes(unit_id) VALUES(old_unit) ON CONFLICT(unit_id) DO UPDATE SET revisao=financeiro_revisoes.revisao+1; END IF;
 IF new_unit IS NOT NULL AND new_unit IS DISTINCT FROM old_unit THEN INSERT INTO public.financeiro_revisoes(unit_id) VALUES(new_unit) ON CONFLICT(unit_id) DO UPDATE SET revisao=financeiro_revisoes.revisao+1; END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION "public"."financeiro_storage_unit"("p_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$ BEGIN RETURN split_part(p_name,'/',1)::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END $$;

CREATE OR REPLACE FUNCTION "public"."fn_ingredient_price_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.custo_padrao IS DISTINCT FROM OLD.custo_padrao THEN
    INSERT INTO ingredient_price_history (ingredient_id, custo_anterior, custo_novo, motivo)
    VALUES (NEW.id, OLD.custo_padrao, NEW.custo_padrao, 'alteracao_manual');

    UPDATE public.recipe_items
       SET custo_unitario = NEW.custo_padrao
     WHERE ingredient_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."fn_recalc_menu_item_custo"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  target_menu_id UUID;
BEGIN
  target_menu_id := COALESCE(NEW.menu_item_id, OLD.menu_item_id);

  UPDATE public.menu_items
     SET custo_total = COALESCE(
           (SELECT SUM(custo_total) FROM public.recipe_items WHERE menu_item_id = target_menu_id),
           0
         ),
         tem_ficha_tecnica = EXISTS (
           SELECT 1 FROM public.recipe_items WHERE menu_item_id = target_menu_id
         ),
         updated_at = NOW()
   WHERE id = target_menu_id;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."fn_recalc_status_prazo"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare v_dias integer;
begin
  if new.status = 'congelada' then
    new.status_prazo := 'congelada';
  elsif new.status = 'fechada' then
    new.status_prazo := 'no_prazo';
  elsif new.sla_dias is not null then
    v_dias := (current_date - new.created_at::date);
    new.status_prazo := case
      when v_dias <= new.sla_dias * 0.6 then 'no_prazo'
      when v_dias <= new.sla_dias       then 'atencao'
      else                                   'atrasado'
    end;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."fn_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

SET default_tablespace = '';

SET default_table_access_method = "heap";

CREATE OR REPLACE FUNCTION "public"."get_produto_meses"("p_unit_id" "uuid") RETURNS TABLE("mes" integer, "ano" integer, "total" bigint)
    LANGUAGE "sql"
    AS $$
  SELECT mes_lancamento, ano_lancamento, COUNT(*) as total
  FROM produtos_relatorio
  WHERE unit_id = p_unit_id
  GROUP BY mes_lancamento, ano_lancamento
  ORDER BY ano_lancamento, mes_lancamento;
$$;

CREATE OR REPLACE FUNCTION "public"."kph_accessible_unit_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- Founder vê tudo
  SELECT id FROM units WHERE public.kph_is_founder()
  UNION
  -- Unit-scoped roles
  SELECT ur.unit_id
  FROM user_roles ur
  WHERE ur.user_id = auth.uid()
    AND ur.unit_id IS NOT NULL
  UNION
  -- Brand-scoped roles: todas as units da brand
  SELECT u.id
  FROM units u
  JOIN user_roles ur ON ur.brand_id = u.brand_id
  WHERE ur.user_id = auth.uid()
    AND ur.brand_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION "public"."kph_has_role_for_brand"("p_brand_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.kph_is_founder()
      OR EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = auth.uid()
          AND (ur.brand_id = p_brand_id
               OR ur.unit_id IN (SELECT id FROM units WHERE brand_id = p_brand_id))
      );
$$;

CREATE OR REPLACE FUNCTION "public"."kph_has_role_for_group"("p_group_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.kph_is_founder()
      OR EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = auth.uid()
          AND (ur.group_id = p_group_id
               OR ur.brand_id IN (SELECT id FROM brands WHERE group_id = p_group_id))
      );
$$;

CREATE OR REPLACE FUNCTION "public"."kph_has_role_for_unit"("p_unit_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.kph_is_founder()
      OR EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.unit_id = p_unit_id
      );
$$;

CREATE OR REPLACE FUNCTION "public"."kph_is_founder"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid() AND r.name = 'founder'
  );
$$;

CREATE OR REPLACE FUNCTION "public"."kph_is_founder_or_cfo"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid() AND r.name IN ('founder', 'cfo')
  );
$$;

CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;

CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS "public"."brands" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid",
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "color" "text" DEFAULT '#D4A574'::"text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."candidates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_opening_id" "uuid",
    "full_name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "access_code" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "status" "text" DEFAULT 'novo'::"text" NOT NULL,
    "interview_status" "text" DEFAULT 'pendente'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "unit_id" "uuid",
    "origem" "text" DEFAULT 'manual'::"text" NOT NULL,
    "area_interesse" "text",
    "nota_maya" numeric(3,1),
    "conversa_id" "uuid",
    "disc_profile" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responsavel_id" "uuid",
    "entrevistador_id" "uuid",
    "observacoes" "text",
    "welcome_message_sid" "text",
    "welcome_delivery_status" "text",
    "welcome_sent_at" timestamp with time zone,
    "welcome_error_code" "text",
    "origem_id" "uuid",
    "cidade" "text",
    "escolaridade_nivel" "text",
    "pretensao_salarial" numeric(10,2),
    "disponibilidade_inicio" "date",
    "turnos_disponiveis" "text"[] DEFAULT '{}'::"text"[],
    "bairro" "text",
    "cv_storage_path" "text",
    "experiencias" "jsonb" DEFAULT '[]'::"jsonb",
    "formacoes" "jsonb" DEFAULT '[]'::"jsonb",
    "idiomas" "jsonb" DEFAULT '[]'::"jsonb",
    "habilidades" "text"[] DEFAULT '{}'::"text"[],
    "cargo_id" "uuid",
    "requer_entrevista_diretoria" boolean,
    CONSTRAINT "candidates_escolaridade_nivel_check" CHECK ((("escolaridade_nivel" IS NULL) OR ("escolaridade_nivel" = ANY (ARRAY['analfabeto'::"text", 'fundamental_5_incompleto'::"text", 'fundamental_5_completo'::"text", 'fundamental_6_9'::"text", 'fundamental_completo'::"text", 'medio_incompleto'::"text", 'medio_completo'::"text", 'superior_incompleto'::"text", 'superior_completo'::"text", 'pos_graduacao'::"text"])))),
    CONSTRAINT "candidates_interview_status_check" CHECK (("interview_status" = ANY (ARRAY['pendente'::"text", 'em_andamento'::"text", 'concluido'::"text"]))),
    CONSTRAINT "candidates_origem_check" CHECK ((("origem" IS NULL) OR ("origem" = ANY (ARRAY['maya'::"text", 'portal'::"text", 'indicacao_colaborador'::"text", 'indicacao'::"text", 'linkedin'::"text", 'indeed'::"text", 'catho'::"text", 'vagas_com_br'::"text", 'infojobs'::"text", 'instagram'::"text", 'mutirao'::"text", 'busca_ativa'::"text", 'banco_talentos_reativado'::"text", 'escola'::"text", 'sindicato'::"text", 'abordagem'::"text", 'manual'::"text", 'outro'::"text", 'maya_whatsapp'::"text", 'portal_kph'::"text"])))),
    CONSTRAINT "candidates_status_check" CHECK (("status" = ANY (ARRAY['novo'::"text", 'triagem'::"text", 'agendamento'::"text", 'entrevista'::"text", 'avaliacao_administrativa'::"text", 'entrevista_diretoria'::"text", 'agendamento_teste'::"text", 'feedback_operacional'::"text", 'decisao'::"text", 'aprovado'::"text", 'contratado'::"text", 'reprovado'::"text", 'desistiu'::"text", 'banco_talentos'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."cargo_grupos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "sla_dias_uteis" integer NOT NULL,
    "descricao" "text",
    "ativo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cargo_grupos_sla_dias_uteis_check" CHECK (("sla_dias_uteis" > 0))
);

CREATE TABLE IF NOT EXISTS "public"."cargos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "setor" "text" NOT NULL,
    "grupo" "text" NOT NULL,
    "tem_nivel" boolean DEFAULT false NOT NULL,
    "sinonimos" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reporta_a_cargo_id" "uuid",
    "ordem_hierarquia" integer,
    "requer_entrevista_diretoria" boolean DEFAULT false NOT NULL,
    CONSTRAINT "cargos_grupo_chk" CHECK (("grupo" = ANY (ARRAY['Operacional'::"text", 'Tático'::"text", 'Estratégico'::"text", 'Executivo-Liderança'::"text"]))),
    CONSTRAINT "cargos_setor_chk" CHECK (("setor" = ANY (ARRAY['Gerência'::"text", 'Bar'::"text", 'Salão'::"text", 'Limpeza'::"text", 'Cozinha'::"text", 'Estoque'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."conferencias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "competencia" "date" NOT NULL,
    "alerta_chave" "text" NOT NULL,
    "assinatura" "text" NOT NULL,
    "status" "text" NOT NULL,
    "observacao" "text",
    "conferido_por" "text",
    "conferido_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conferencias_status_check" CHECK (("status" = ANY (ARRAY['conferido'::"text", 'ignorado'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."contas_bancarias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "banco" "text" NOT NULL,
    "apelido" "text",
    "saldo_inicial" numeric(16,2) DEFAULT 0 NOT NULL,
    "data_saldo_inicial" "date" NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."contratos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid",
    "titulo" "text" NOT NULL,
    "categoria" "text" NOT NULL,
    "contraparte" "text" NOT NULL,
    "contraparte_doc" "text",
    "responsavel" "text",
    "valor" numeric(14,2) DEFAULT 0,
    "recorrencia" "text",
    "data_inicio" "date",
    "data_fim" "date",
    "vigencia_indeterminada" boolean DEFAULT false,
    "renovacao_automatica" boolean DEFAULT false,
    "aviso_previo_dias" integer DEFAULT 0,
    "indice_reajuste" "text",
    "data_proximo_reajuste" "date",
    "multa_rescisoria" "text",
    "status_manual" "text",
    "tags" "text"[],
    "observacoes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."contratos_arquivos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contrato_id" "uuid" NOT NULL,
    "tipo" "text" DEFAULT 'principal'::"text" NOT NULL,
    "nome" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "tamanho_bytes" bigint,
    "content_type" "text" DEFAULT 'application/pdf'::"text",
    "uploaded_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."dre_contratos_fixos" (
    "id" bigint NOT NULL,
    "razao_social" "text" NOT NULL,
    "descricao" "text",
    "valor_mensal" numeric NOT NULL,
    "codigo_contabil" "text",
    "tipo" "text",
    "unit_id" "uuid"
);

CREATE SEQUENCE IF NOT EXISTS "public"."dre_contratos_fixos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."dre_contratos_fixos_id_seq" OWNED BY "public"."dre_contratos_fixos"."id";

CREATE TABLE IF NOT EXISTS "public"."dre_despesa_detalhada" (
    "id" integer NOT NULL,
    "mes_ano" character varying(7) NOT NULL,
    "data_competencia" "date",
    "descricao" "text",
    "categoria" character varying(100),
    "valor" numeric NOT NULL,
    "classificacao_dre" character varying(100),
    "tipo_despesa" character varying(60),
    "criado_em" timestamp with time zone DEFAULT "now"(),
    "unit_id" "uuid"
);

CREATE SEQUENCE IF NOT EXISTS "public"."dre_despesa_detalhada_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."dre_despesa_detalhada_id_seq" OWNED BY "public"."dre_despesa_detalhada"."id";

CREATE TABLE IF NOT EXISTS "public"."dre_faturamento_historico" (
    "id" integer NOT NULL,
    "mes_num" smallint NOT NULL,
    "categoria" character varying(20) NOT NULL,
    "rec_2022" numeric,
    "rec_2023" numeric,
    "rec_2024" numeric,
    "rec_2025" numeric,
    "rec_2026_bd" numeric,
    "clientes_bd" integer,
    "ticket_bd" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"(),
    "unit_id" "uuid",
    CONSTRAINT "dre_faturamento_historico_categoria_check" CHECK ((("categoria")::"text" = ANY (ARRAY[('restaurante'::character varying)::"text", ('eventos'::character varying)::"text", ('total'::character varying)::"text"]))),
    CONSTRAINT "dre_faturamento_historico_mes_num_check" CHECK ((("mes_num" >= 1) AND ("mes_num" <= 12)))
);

CREATE SEQUENCE IF NOT EXISTS "public"."dre_faturamento_historico_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."dre_faturamento_historico_id_seq" OWNED BY "public"."dre_faturamento_historico"."id";

CREATE TABLE IF NOT EXISTS "public"."dre_folha" (
    "id" integer NOT NULL,
    "tipo" character varying(10) NOT NULL,
    "nome" character varying(120),
    "funcao" character varying(80) NOT NULL,
    "divisao" character varying(40) NOT NULL,
    "admissao" "date",
    "salario" numeric NOT NULL,
    "custo_total" numeric NOT NULL,
    "is_vaga" boolean DEFAULT false NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"(),
    "unit_id" "uuid",
    "competencia" "text",
    "total_proventos" numeric DEFAULT 0 NOT NULL,
    "total_descontos" numeric DEFAULT 0 NOT NULL,
    "valor_liquido" numeric DEFAULT 0 NOT NULL,
    "base_inss" numeric DEFAULT 0 NOT NULL,
    "base_fgts" numeric DEFAULT 0 NOT NULL,
    "fgts_mes" numeric DEFAULT 0 NOT NULL,
    "base_irrf" numeric DEFAULT 0 NOT NULL,
    "gorjeta" numeric DEFAULT 0 NOT NULL,
    "verbas" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "documento_path" "text",
    "documento_nome" "text",
    "documento_pagina" integer,
    "texto_origem" "text"
);

CREATE SEQUENCE IF NOT EXISTS "public"."dre_folha_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."dre_folha_id_seq" OWNED BY "public"."dre_folha"."id";

CREATE TABLE IF NOT EXISTS "public"."dre_gorjeta_mensal" (
    "id" integer NOT NULL,
    "mes_ano" character varying(7) NOT NULL,
    "gorjeta_recebida" numeric,
    "gorjeta_paga" numeric,
    "retencao" numeric,
    "ferias" numeric,
    "decimo_terceiro" numeric,
    "fgts" numeric,
    "inss" numeric,
    "encargos_total" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"(),
    "unit_id" "uuid"
);

CREATE SEQUENCE IF NOT EXISTS "public"."dre_gorjeta_mensal_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."dre_gorjeta_mensal_id_seq" OWNED BY "public"."dre_gorjeta_mensal"."id";

CREATE TABLE IF NOT EXISTS "public"."dre_indicadores" (
    "id" integer NOT NULL,
    "mes_ano" character varying(7) NOT NULL,
    "tipo" character varying(20) NOT NULL,
    "indicador" character varying(40) NOT NULL,
    "valor" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"(),
    "unit_id" "uuid",
    CONSTRAINT "dre_indicadores_tipo_check" CHECK ((("tipo")::"text" = ANY (ARRAY[('orcado'::character varying)::"text", ('realizado'::character varying)::"text"])))
);

CREATE SEQUENCE IF NOT EXISTS "public"."dre_indicadores_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."dre_indicadores_id_seq" OWNED BY "public"."dre_indicadores"."id";

CREATE TABLE IF NOT EXISTS "public"."dre_kpis_mensais" (
    "mes_ano" "text" NOT NULL,
    "clientes" integer,
    "ticket_medio" numeric,
    "gorjetas_recebidas" numeric,
    "icms" numeric,
    "cofins" numeric,
    "pis" numeric,
    "iss" numeric,
    "unit_id" "uuid" NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."dre_linhas_detalhadas" (
    "id" bigint NOT NULL,
    "mes_ano" character varying NOT NULL,
    "tipo" character varying NOT NULL,
    "grupo" character varying NOT NULL,
    "descricao" character varying NOT NULL,
    "conta" character varying,
    "custo_tipo" character varying,
    "valor" numeric,
    "av_percentual" numeric,
    "criado_em" timestamp without time zone DEFAULT "now"(),
    "unit_id" "uuid"
);

CREATE SEQUENCE IF NOT EXISTS "public"."dre_linhas_detalhadas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."dre_linhas_detalhadas_id_seq" OWNED BY "public"."dre_linhas_detalhadas"."id";

CREATE TABLE IF NOT EXISTS "public"."dre_manutencao_detalhada" (
    "id" bigint NOT NULL,
    "mes_ano" "text",
    "fornecedor" "text" NOT NULL,
    "categoria" "text" NOT NULL,
    "valor" numeric NOT NULL,
    "unit_id" "uuid"
);

CREATE SEQUENCE IF NOT EXISTS "public"."dre_manutencao_detalhada_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."dre_manutencao_detalhada_id_seq" OWNED BY "public"."dre_manutencao_detalhada"."id";

CREATE TABLE IF NOT EXISTS "public"."dre_mensal" (
    "id" integer NOT NULL,
    "mes_ano" character varying(7) NOT NULL,
    "tipo" character varying(20) NOT NULL,
    "receita_bruta" numeric,
    "cmv" numeric,
    "pessoal" numeric,
    "ocupacao" numeric,
    "utilidades" numeric,
    "operacao" numeric,
    "manutencao" numeric,
    "administrativa" numeric,
    "marketing" numeric,
    "taxa_cartao" numeric,
    "impostos" numeric,
    "ebitda" numeric,
    "resultado_liquido" numeric,
    "clientes" integer,
    "ticket_medio" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"(),
    "unit_id" "uuid",
    CONSTRAINT "dre_mensal_tipo_check" CHECK ((("tipo")::"text" = ANY (ARRAY[('orcado'::character varying)::"text", ('realizado'::character varying)::"text"])))
);

CREATE SEQUENCE IF NOT EXISTS "public"."dre_mensal_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."dre_mensal_id_seq" OWNED BY "public"."dre_mensal"."id";

CREATE TABLE IF NOT EXISTS "public"."dre_pessoal_detalhado" (
    "id" bigint NOT NULL,
    "mes_ano" "text" NOT NULL,
    "categoria" "text" NOT NULL,
    "valor" numeric,
    "unit_id" "uuid"
);

CREATE SEQUENCE IF NOT EXISTS "public"."dre_pessoal_detalhado_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."dre_pessoal_detalhado_id_seq" OWNED BY "public"."dre_pessoal_detalhado"."id";

CREATE TABLE IF NOT EXISTS "public"."dre_prestadores" (
    "id" bigint NOT NULL,
    "mes_ano" "text" NOT NULL,
    "nome" "text" NOT NULL,
    "grupo" "text" NOT NULL,
    "valor" numeric NOT NULL,
    "unit_id" "uuid"
);

CREATE SEQUENCE IF NOT EXISTS "public"."dre_prestadores_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."dre_prestadores_id_seq" OWNED BY "public"."dre_prestadores"."id";

CREATE TABLE IF NOT EXISTS "public"."dre_receita_detalhada" (
    "id" integer NOT NULL,
    "mes_ano" character varying(7) NOT NULL,
    "bandeira" character varying(50) NOT NULL,
    "classificacao" character varying(60) NOT NULL,
    "grupo" character varying(40) NOT NULL,
    "valor" numeric NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"(),
    "unit_id" "uuid"
);

CREATE SEQUENCE IF NOT EXISTS "public"."dre_receita_detalhada_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."dre_receita_detalhada_id_seq" OWNED BY "public"."dre_receita_detalhada"."id";

CREATE TABLE IF NOT EXISTS "public"."dre_snapshot" (
    "unit_id" "uuid" NOT NULL,
    "competencia" "date" NOT NULL,
    "conta_codigo" "text" NOT NULL,
    "valor" numeric(16,2) NOT NULL,
    "qtd_lancamentos" integer NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."employees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "nome" "text" NOT NULL,
    "sobrenome" "text" NOT NULL,
    "cpf" "text",
    "ctps" "text",
    "funcao" "text" NOT NULL,
    "salario_base" numeric(10,2) DEFAULT 0 NOT NULL,
    "data_admissao" "date" NOT NULL,
    "data_demissao" "date",
    "ativo" boolean DEFAULT true,
    "banco" "text",
    "agencia" "text",
    "conta" "text",
    "tipo_conta" "text",
    "pix" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "rg" "text",
    "rg_orgao" "text",
    "rg_uf" character(2),
    "pis" "text",
    "ctps_serie" "text",
    "ctps_uf" character(2),
    "titulo_eleitor" "text",
    "reservista" "text",
    "rua" "text",
    "numero" "text",
    "complemento" "text",
    "bairro" "text",
    "cidade" "text",
    "estado" character(2),
    "cep" "text",
    "escolaridade" "text",
    "raca" "text",
    "genero" "text",
    "nome_mae" "text",
    "nome_pai" "text",
    "departamento" "text",
    "employee_code" "text",
    "esocial_code" "text",
    "nome_social" "text",
    "data_nascimento" "date",
    "cidade_nascimento" "text",
    "uf_nascimento" character(2),
    "pais_nascimento" "text" DEFAULT 'Brasil'::"text",
    "estado_civil" "text",
    "tipo_contrato" "text",
    "jornada" "text",
    "telefone" "text",
    "email" "text",
    "contato_emergencia_nome" "text",
    "contato_emergencia_tel" "text",
    "photo_url" "text",
    "ctps_expedicao" "date",
    "zona_eleitoral" "text",
    "secao_eleitoral" "text",
    "rne" "text",
    "rne_orgao" "text",
    "rne_expedicao" "date",
    "status_rh" "text" DEFAULT 'ativo'::"text",
    "score" integer DEFAULT 100 NOT NULL,
    "manager_id" "uuid",
    "mise_ativo" boolean DEFAULT false,
    "role_id" "uuid",
    "tier" "text",
    "observacao" "text",
    "push_token" "text",
    "push_token_updated_at" timestamp with time zone,
    CONSTRAINT "employees_status_rh_check" CHECK (("status_rh" = ANY (ARRAY['ativo'::"text", 'inativo'::"text", 'ferias'::"text", 'afastado'::"text"]))),
    CONSTRAINT "employees_tier_check" CHECK (("tier" = ANY (ARRAY['T1'::"text", 'T2A'::"text", 'T2B'::"text", 'T3'::"text", 'T4'::"text", 'T5'::"text", 'T6'::"text"]))),
    CONSTRAINT "employees_tipo_contrato_check" CHECK (("tipo_contrato" = ANY (ARRAY['CLT'::"text", 'PJ'::"text", 'temporario'::"text", 'estagiario'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."financeiro_importacoes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "arquivo" "text" NOT NULL,
    "checksum_sha256" "text" NOT NULL,
    "storage_path" "text",
    "registros" integer DEFAULT 0 NOT NULL,
    "totais" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "avisos" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'processando'::"text" NOT NULL,
    "erro" "text",
    "criado_por" "uuid",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "concluido_em" timestamp with time zone,
    CONSTRAINT "financeiro_importacoes_status_check" CHECK (("status" = ANY (ARRAY['processando'::"text", 'concluido'::"text", 'erro'::"text"]))),
    CONSTRAINT "financeiro_importacoes_tipo_check" CHECK (("tipo" = ANY (ARRAY['nf_entrada'::"text", 'contas_pagar'::"text", 'receita'::"text", 'folha'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."financeiro_revisoes" (
    "unit_id" "uuid" NOT NULL,
    "revisao" bigint DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."fornecedores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codigo" "text" NOT NULL,
    "nome" "text" NOT NULL,
    "cnpj" "text",
    "ativo" boolean DEFAULT true NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."fornecedores_depara" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fornecedor_id" "uuid" NOT NULL,
    "nome_origem" "text" NOT NULL,
    "origem" "text" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "nome_origem_literal" "text" NOT NULL,
    CONSTRAINT "fornecedores_depara_origem_check" CHECK (("origem" = ANY (ARRAY['nfe'::"text", 'titulo'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."gorjeta_cargo_pontos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid",
    "cargo" "text" NOT NULL,
    "pontos" integer NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "gorjeta_cargo_pontos_pontos_check" CHECK (("pontos" >= 0))
);

CREATE TABLE IF NOT EXISTS "public"."gorjeta_distribuicao" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "mes" smallint NOT NULL,
    "ano" smallint NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "cargo" "text" NOT NULL,
    "dias_trabalhados" integer NOT NULL,
    "pontuacao" numeric(10,4) NOT NULL,
    "percentual" numeric(10,8) DEFAULT 0 NOT NULL,
    "valor_bruto" numeric(12,2) DEFAULT 0 NOT NULL,
    "valor_liquido" numeric(12,2) DEFAULT 0 NOT NULL,
    "recibo_gerado_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recibo_url" "text",
    "periodo" "text",
    "colaborador_id" "uuid",
    CONSTRAINT "gorjeta_distribuicao_ano_check" CHECK (("ano" >= 2024)),
    CONSTRAINT "gorjeta_distribuicao_mes_check" CHECK ((("mes" >= 1) AND ("mes" <= 12)))
);

CREATE TABLE IF NOT EXISTS "public"."gorjeta_periodos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid",
    "data" "date" NOT NULL,
    "receita_bruta" numeric(12,2) NOT NULL,
    "imposto_pct" numeric(5,2) DEFAULT 20.00 NOT NULL,
    "receita_liquida" numeric(12,2) GENERATED ALWAYS AS ("round"(("receita_bruta" * ((1)::numeric - ("imposto_pct" / 100.0))), 2)) STORED,
    "total_pontos" integer NOT NULL,
    "valor_ponto" numeric(10,4) GENERATED ALWAYS AS ("round"((("receita_bruta" * ((1)::numeric - ("imposto_pct" / 100.0))) / ("total_pontos")::numeric), 4)) STORED,
    "fonte" "text" DEFAULT 'manual'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "gorjeta_periodos_fonte_check" CHECK (("fonte" = ANY (ARRAY['manual'::"text", 'lorean'::"text", 'import'::"text"]))),
    CONSTRAINT "gorjeta_periodos_imposto_pct_check" CHECK ((("imposto_pct" >= (0)::numeric) AND ("imposto_pct" <= (100)::numeric))),
    CONSTRAINT "gorjeta_periodos_receita_bruta_check" CHECK (("receita_bruta" >= (0)::numeric)),
    CONSTRAINT "gorjeta_periodos_total_pontos_check" CHECK (("total_pontos" > 0))
);

CREATE TABLE IF NOT EXISTS "public"."groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "icone" "text",
    "parent_id" "uuid"
);

CREATE TABLE IF NOT EXISTS "public"."ingredient_price_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ingredient_id" "uuid" NOT NULL,
    "custo_anterior" numeric(12,4),
    "custo_novo" numeric(12,4) NOT NULL,
    "motivo" "text",
    "changed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."ingredients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "codigo" "text",
    "nome" "text" NOT NULL,
    "categoria" "text" NOT NULL,
    "unidade_padrao" "text" NOT NULL,
    "custo_padrao" numeric(12,4) DEFAULT 0 NOT NULL,
    "fornecedor_id" "uuid",
    "perdas_padrao" numeric(5,2) DEFAULT 0,
    "observacoes" "text",
    "ativo" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "categoria_anvisa" "text",
    "menu_item_id" "uuid",
    CONSTRAINT "ingredients_categoria_check" CHECK (("categoria" = ANY (ARRAY['proteina'::"text", 'verdura'::"text", 'legume'::"text", 'fruta'::"text", 'graos'::"text", 'laticinios'::"text", 'panificacao'::"text", 'bebida_alcoolica'::"text", 'bebida_nao_alcoolica'::"text", 'tempero'::"text", 'oleo_gordura'::"text", 'descartavel'::"text", 'limpeza'::"text", 'outro'::"text"]))),
    CONSTRAINT "ingredients_unidade_padrao_check" CHECK (("unidade_padrao" = ANY (ARRAY['kg'::"text", 'g'::"text", 'l'::"text", 'ml'::"text", 'un'::"text", 'cx'::"text", 'fardo'::"text", 'duzia'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."job_openings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid",
    "unit_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'aberta'::"text" NOT NULL,
    "recrutador" "text",
    "sla_dias" integer DEFAULT 30,
    "status_prazo" "text",
    "motivo" "text",
    "horario" "text",
    "salario" numeric(10,2),
    "fonte_recrutamento" "text",
    "data_admissao" "date",
    "candidato_aprovado" "text",
    "fechamento_previsto" "date",
    "observacoes" "text",
    "area" "text",
    "cargo" "text",
    "data_solicitacao" "date",
    "observacao" "text",
    "responsavel_id" "uuid",
    "entrevistador_id" "uuid",
    "prioridade" "text" DEFAULT 'media'::"text",
    "salario_min" numeric(10,2),
    "salario_max" numeric(10,2),
    "must_have" "text",
    "nice_to_have" "text",
    "cargo_grupo_id" "uuid",
    "motivo_estruturado" "text",
    "horario_escala" "text",
    "forma_contratacao" "text",
    "substituido_id" "uuid",
    "periodo_exp_dias" integer DEFAULT 90,
    "congelada" boolean DEFAULT false NOT NULL,
    "cancelada" boolean DEFAULT false NOT NULL,
    "motivo_congelamento" "text",
    "congelada_em" timestamp with time zone,
    "cancelada_em" timestamp with time zone,
    CONSTRAINT "job_openings_forma_contratacao_check" CHECK ((("forma_contratacao" IS NULL) OR ("forma_contratacao" = ANY (ARRAY['CLT'::"text", 'PJ'::"text", 'freelance'::"text", 'temporario'::"text", 'estagio'::"text"])))),
    CONSTRAINT "job_openings_motivo_estruturado_check" CHECK ((("motivo_estruturado" IS NULL) OR ("motivo_estruturado" = ANY (ARRAY['abertura_casa'::"text", 'aumento_quadro'::"text", 'adequacao_quadro'::"text", 'substituicao_desligamento'::"text", 'substituicao_promocao'::"text", 'substituicao_licenca'::"text"])))),
    CONSTRAINT "job_openings_prioridade_check" CHECK (("prioridade" = ANY (ARRAY['alta'::"text", 'media'::"text", 'baixa'::"text"]))),
    CONSTRAINT "job_openings_status_prazo_check" CHECK (("status_prazo" = ANY (ARRAY['no_prazo'::"text", 'atencao'::"text", 'atrasado'::"text", 'congelada'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."kpi_snapshot" (
    "unit_id" "uuid" NOT NULL,
    "competencia" "date" NOT NULL,
    "receita_bruta" numeric(16,2),
    "receita_liquida" numeric(16,2),
    "cmv_compras" numeric(16,2),
    "mao_de_obra" numeric(16,2),
    "despesas_operacionais" numeric(16,2),
    "ebitda" numeric(16,2),
    "cmv_compras_pct" numeric(8,4),
    "mo_pct" numeric(8,4),
    "prime_cost_pct" numeric(8,4),
    "ebitda_pct" numeric(8,4),
    "clientes" integer,
    "ticket_medio" numeric(12,2),
    "cmv_por_cliente" numeric(12,2),
    "tem_nfe" boolean DEFAULT false NOT NULL,
    "pct_classificado" numeric(8,4),
    "fontes_ok" integer,
    "fontes_total" integer,
    "confianca_pct" numeric(8,4),
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "possivel_dupla_contagem" numeric(16,2),
    "tem_folha" boolean DEFAULT false NOT NULL,
    "resultado_liquido" numeric,
    "pct_compra_com_xml" numeric,
    "revisao_fonte" bigint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."lancamentos" (
    "id" bigint NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "data" "date" NOT NULL,
    "competencia" "date" NOT NULL,
    "conta_codigo" "text" NOT NULL,
    "valor" numeric(16,2) NOT NULL,
    "origem" "text" NOT NULL,
    "origem_id" "text" NOT NULL,
    "descricao" "text",
    "fornecedor_cnpj" "text",
    "fornecedor_nome" "text",
    "produto_id" "uuid",
    "reconciliado" boolean DEFAULT false NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lancamentos_origem_check" CHECK (("origem" = ANY (ARRAY['nfe_entrada'::"text", 'titulo'::"text", 'folha'::"text", 'receita'::"text", 'inventario'::"text", 'manual'::"text"])))
);

CREATE SEQUENCE IF NOT EXISTS "public"."lancamentos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."lancamentos_id_seq" OWNED BY "public"."lancamentos"."id";

CREATE TABLE IF NOT EXISTS "public"."receita_cancelamentos_detalhe" (
    "id" bigint NOT NULL,
    "workday_id_fk" "uuid" NOT NULL,
    "item" "text",
    "usuario" "text",
    "motivo" "text",
    "qtd" numeric,
    "valor" numeric,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE "public"."receita_cancelamentos_detalhe" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lorean_cancelamentos_detalhe_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS "public"."receita_descontos_detalhe" (
    "id" bigint NOT NULL,
    "workday_id_fk" "uuid" NOT NULL,
    "item" "text",
    "usuario" "text",
    "motivo" "text",
    "qtd" numeric,
    "valor" numeric,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE "public"."receita_descontos_detalhe" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lorean_descontos_detalhe_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS "public"."receita_produtos_dia" (
    "id" bigint NOT NULL,
    "workday_id_fk" "uuid" NOT NULL,
    "grupo" "text",
    "produto" "text" NOT NULL,
    "qtd" numeric,
    "cmv_pct" numeric,
    "bruto" numeric,
    "desconto" numeric,
    "gorjeta" numeric,
    "total" numeric,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE "public"."receita_produtos_dia" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lorean_produtos_dia_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS "public"."mapa_conta_dre" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "descricao_c_gerencial" "text" NOT NULL,
    "linha_dre" "text",
    "esperada_mensal" boolean DEFAULT false,
    "criado_em" timestamp with time zone DEFAULT "now"(),
    "atualizado_em" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."menu_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "unit_id" "uuid",
    "categoria" "text" NOT NULL,
    "nome" "text" NOT NULL,
    "descricao" "text",
    "preco_venda" numeric(12,2) DEFAULT 0 NOT NULL,
    "custo_total" numeric(12,4) DEFAULT 0 NOT NULL,
    "tem_ficha_tecnica" boolean DEFAULT false,
    "ativo" boolean DEFAULT true,
    "observacoes" "text",
    "ordem" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "codigo" "text",
    "rendimento" numeric(14,6) DEFAULT 1 NOT NULL,
    "is_subproduto" boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."metas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "competencia" "date" NOT NULL,
    "chave" "text" NOT NULL,
    "valor" numeric(16,4) NOT NULL,
    "tipo" "text" NOT NULL,
    "origem" "text" DEFAULT 'baseline'::"text" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "metas_origem_check" CHECK (("origem" = ANY (ARRAY['baseline'::"text", 'manual'::"text"]))),
    CONSTRAINT "metas_tipo_check" CHECK (("tipo" = ANY (ARRAY['absoluto'::"text", 'pct_receita_liquida'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."metas_dia_override" (
    "id" bigint NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "data" "date" NOT NULL,
    "meta" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE "public"."metas_dia_override" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."metas_dia_override_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS "public"."metas_dia_semana" (
    "id" bigint NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "dia_semana" integer NOT NULL,
    "meta" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "metas_dia_semana_dia_semana_check" CHECK ((("dia_semana" >= 0) AND ("dia_semana" <= 6)))
);

ALTER TABLE "public"."metas_dia_semana" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."metas_dia_semana_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS "public"."metas_projecoes" (
    "id" integer NOT NULL,
    "mes_ano" "text" NOT NULL,
    "meta_faturamento" numeric,
    "metas_diarias" "jsonb",
    "criado_em" timestamp with time zone DEFAULT "now"()
);

CREATE SEQUENCE IF NOT EXISTS "public"."metas_projecoes_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."metas_projecoes_id_seq" OWNED BY "public"."metas_projecoes"."id";

CREATE TABLE IF NOT EXISTS "public"."movimentacoes_caixa" (
    "id" bigint NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "conta_id" "uuid",
    "data" "date" NOT NULL,
    "tipo" "text" NOT NULL,
    "valor" numeric(16,2) NOT NULL,
    "descricao" "text",
    "origem" "text" NOT NULL,
    "origem_id" "text",
    "conta_codigo" "text",
    "conciliado" boolean DEFAULT false NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "movimentacoes_caixa_origem_check" CHECK (("origem" = ANY (ARRAY['extrato'::"text", 'titulo'::"text", 'receita'::"text", 'manual'::"text"]))),
    CONSTRAINT "movimentacoes_caixa_tipo_check" CHECK (("tipo" = ANY (ARRAY['entrada'::"text", 'saida'::"text"])))
);

CREATE SEQUENCE IF NOT EXISTS "public"."movimentacoes_caixa_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."movimentacoes_caixa_id_seq" OWNED BY "public"."movimentacoes_caixa"."id";

CREATE TABLE IF NOT EXISTS "public"."nfe_documentos" (
    "id" bigint NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "importacao_id" "uuid",
    "chave" "text" NOT NULL,
    "direcao" "text" NOT NULL,
    "numero" "text",
    "serie" "text",
    "emissao" timestamp with time zone NOT NULL,
    "emitente_cnpj" "text",
    "emitente_nome" "text",
    "destinatario_cnpj" "text",
    "destinatario_nome" "text",
    "valor_total" numeric(16,2) DEFAULT 0 NOT NULL,
    "status_sefaz" "text",
    "cancelada" boolean DEFAULT false NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "nfe_documentos_direcao_check" CHECK (("direcao" = ANY (ARRAY['entrada'::"text", 'saida'::"text"])))
);

CREATE SEQUENCE IF NOT EXISTS "public"."nfe_documentos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."nfe_documentos_id_seq" OWNED BY "public"."nfe_documentos"."id";

CREATE TABLE IF NOT EXISTS "public"."nfe_importacoes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "arquivo" "text" NOT NULL,
    "direcao" "text" NOT NULL,
    "total_xml" integer DEFAULT 0 NOT NULL,
    "importadas" integer DEFAULT 0 NOT NULL,
    "duplicadas" integer DEFAULT 0 NOT NULL,
    "canceladas" integer DEFAULT 0 NOT NULL,
    "rejeitadas" integer DEFAULT 0 NOT NULL,
    "valor_total" numeric(16,2) DEFAULT 0 NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "nfe_importacoes_direcao_check" CHECK (("direcao" = ANY (ARRAY['entrada'::"text", 'saida'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."origens_candidato" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codigo" "text" NOT NULL,
    "label" "text" NOT NULL,
    "automatica" boolean DEFAULT false NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    "ordem" integer DEFAULT 99 NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."payroll_extrato_dominio_colaborador" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "competencia" "text" NOT NULL,
    "cod_empresa_dominio" "text" NOT NULL,
    "cnpj" "text" NOT NULL,
    "cod_colaborador" integer NOT NULL,
    "nome" "text" NOT NULL,
    "cpf" "text" NOT NULL,
    "situacao" "text",
    "data_admissao" "date",
    "data_demissao" "date",
    "motivo_demissao" "text",
    "vinculo" "text",
    "centro_custo" integer,
    "departamento" integer,
    "cargo_codigo" integer,
    "cargo_nome" "text",
    "cbo" "text",
    "salario" numeric(12,2),
    "proventos" numeric(12,2),
    "descontos" numeric(12,2),
    "liquido" numeric(12,2),
    "base_inss" numeric(12,2),
    "base_fgts" numeric(12,2),
    "valor_fgts" numeric(12,2),
    "base_irrf" numeric(12,2),
    "employee_id" "uuid",
    "unit_id" "uuid" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."payroll_extrato_dominio_competencia" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "competencia" "text" NOT NULL,
    "cod_empresa_dominio" "text" NOT NULL,
    "cnpj" "text" NOT NULL,
    "razao_social" "text",
    "arquivo_origem" "text",
    "total_geral_proventos" numeric(16,2),
    "total_geral_descontos" numeric(16,2),
    "liquido_geral" numeric(16,2),
    "base_fgts" numeric(16,2),
    "valor_fgts" numeric(16,2),
    "base_fgts_rescisorio" numeric(16,2),
    "valor_fgts_rescisorio" numeric(16,2),
    "total_inss" numeric(16,2),
    "inss_empresa" numeric(16,2),
    "rat" numeric(16,2),
    "terceiros" numeric(16,2),
    "no_empregados" integer,
    "trabalhando" integer,
    "demitido" integer,
    "admissoes" integer,
    "no_contribuintes" integer,
    "importado_em" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."payroll_extrato_dominio_linha" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "competencia" "text" NOT NULL,
    "cod_colaborador" integer NOT NULL,
    "rubrica_codigo" integer NOT NULL,
    "valor" numeric(14,2) NOT NULL,
    "employee_id" "uuid",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "natureza" "text" NOT NULL,
    CONSTRAINT "payroll_extrato_dominio_linha_natureza_check" CHECK (("natureza" = ANY (ARRAY['PROVENTO'::"text", 'DESCONTO'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."payroll_extrato_dominio_rubrica" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "competencia" "text" NOT NULL,
    "cod_empresa_dominio" "text" NOT NULL,
    "rubrica_codigo" integer NOT NULL,
    "rubrica_descricao" "text" NOT NULL,
    "natureza" "text" NOT NULL,
    "quantidade_texto" "text",
    "valor" numeric(14,2) NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    CONSTRAINT "payroll_extrato_dominio_rubrica_natureza_check" CHECK (("natureza" = ANY (ARRAY['PROVENTO'::"text", 'DESCONTO'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."payroll_extrato_dominio_totais" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "competencia" "text" NOT NULL,
    "dimensao" "text" NOT NULL,
    "codigo" integer,
    "nome" "text",
    "proventos" numeric(14,2) NOT NULL,
    "descontos" numeric(14,2) NOT NULL,
    "liquido" numeric(14,2) NOT NULL,
    "unit_id" "uuid" NOT NULL,
    CONSTRAINT "payroll_extrato_dominio_totais_dimensao_check" CHECK (("dimensao" = ANY (ARRAY['DEPARTAMENTO'::"text", 'CENTRO_CUSTO'::"text", 'GERAL'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."payslips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "competencia" "date" NOT NULL,
    "salario_base" numeric(10,2) NOT NULL,
    "horas_extras" numeric(10,2) DEFAULT 0,
    "adicional_noturno" numeric(10,2) DEFAULT 0,
    "gorjeta" numeric(10,2) DEFAULT 0,
    "dsr_gorjeta" numeric(10,2) DEFAULT 0,
    "desconto_inss" numeric(10,2) DEFAULT 0,
    "desconto_irrf" numeric(10,2) DEFAULT 0,
    "desconto_vale_transporte" numeric(10,2) DEFAULT 0,
    "desconto_vale_refeicao" numeric(10,2) DEFAULT 0,
    "outros_descontos" numeric(10,2) DEFAULT 0,
    "outros_acrescimos" numeric(10,2) DEFAULT 0,
    "liquido" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'rascunho'::"text",
    "pdf_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "fgts_base" numeric(10,2),
    "fgts_mes" numeric(10,2),
    "faixa_irrf" "text",
    "employee_code" "text",
    "unit_id" "uuid",
    "nome" "text",
    "tipo" "text",
    "cargo" "text",
    "bonus" numeric(10,2),
    "horas_trabalhadas" numeric DEFAULT 0,
    "adiantamento" numeric DEFAULT 0,
    "vt" numeric DEFAULT 0,
    "vr" numeric DEFAULT 0,
    "inss" numeric DEFAULT 0,
    "fgts" numeric DEFAULT 0,
    "valor_liquido" numeric DEFAULT 0,
    "observacoes" "text"
);

CREATE TABLE IF NOT EXISTS "public"."plano_contas" (
    "codigo" "text" NOT NULL,
    "nome" "text" NOT NULL,
    "grupo" "text" NOT NULL,
    "ordem" integer NOT NULL,
    "ncm_capitulos" "text"[],
    "ativo" boolean DEFAULT true NOT NULL,
    CONSTRAINT "plano_contas_grupo_check" CHECK (("grupo" = ANY (ARRAY['receita'::"text", 'deducao'::"text", 'cmv'::"text", 'mao_de_obra'::"text", 'despesa_operacional'::"text", 'financeiro'::"text", 'investimento'::"text", 'imposto_lucro'::"text", 'nao_operacional'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."ponto_mensal" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "employee_id" "uuid",
    "matricula" "text",
    "nome" "text" NOT NULL,
    "cpf" "text",
    "cargo" "text",
    "departamento" "text",
    "periodo" "text" NOT NULL,
    "horas_previstas" "text",
    "horas_trabalhadas" "text",
    "horas_negativas" "text",
    "horas_positivas" "text",
    "saldo" "text",
    "banco_horas_acumulado" "text",
    "banco_horas_mes" "text",
    "compensacao_bh" "text",
    "adicional_noturno" "text",
    "falta_injustificada_horas" "text",
    "falta_injustificada_dias" integer DEFAULT 0,
    "afastamentos_horas" "text",
    "afastamentos_dias" integer DEFAULT 0,
    "ferias_horas" "text",
    "ferias_dias" integer DEFAULT 0,
    "inss_horas" "text",
    "inss_dias" integer DEFAULT 0,
    "atestado_medico" "text",
    "abonado_horas" "text",
    "abonado_dias" integer DEFAULT 0,
    "folga_domingo" "text",
    "folga_feriado" "text",
    "feriados_dias" integer DEFAULT 0,
    "confraternizacao" "text",
    "licenca_paternidade_horas" "text",
    "licenca_paternidade_dias" integer DEFAULT 0,
    "data_admissao" "text",
    "data_demissao" "text",
    "importado_em" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."produtos_catalogo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codigo" "text" NOT NULL,
    "nome" "text" NOT NULL,
    "ncm" "text",
    "unidade_padrao" "text",
    "categoria" "text",
    "ativo" boolean DEFAULT true NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."produtos_depara" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "produto_id" "uuid",
    "fornecedor_cnpj" "text" NOT NULL,
    "fornecedor_nome" "text",
    "item_codigo" "text" NOT NULL,
    "item_descricao" "text",
    "ncm" "text",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."produtos_relatorio" (
    "id" bigint NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "fornecedor_nome" "text",
    "nr_danfe" "text",
    "v_total_danfe" numeric(18,4),
    "dt_emissao" "text",
    "item_codigo" "text",
    "item_descricao" "text",
    "unidade_medida" "text",
    "tipo_item" "text",
    "q_embalagem" numeric(18,4),
    "q_estoque" numeric(18,4),
    "v_embalagem" numeric(18,4),
    "v_total_embalagem" numeric(18,4),
    "v_custo_medio" numeric(18,4),
    "v_custo_compra" numeric(18,4),
    "v_custo_total" numeric(18,4),
    "perc_variacao" numeric(18,4),
    "calcula_cmv" boolean,
    "fornecedor_codigo" "text",
    "codigo_gerencial" "text",
    "desc_gerencial" "text",
    "mes_lancamento" integer NOT NULL,
    "ano_lancamento" integer NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"(),
    "chave_nfe" "text",
    "direcao_nfe" "text",
    "cfop" "text",
    "importacao_id" "uuid",
    "observacao_origem" "text",
    "desconto_origem" numeric(14,2),
    "pedido_origem" "text",
    "produto_id" "uuid",
    "item_nfe" integer,
    CONSTRAINT "produtos_relatorio_direcao_nfe_check" CHECK (("direcao_nfe" = ANY (ARRAY['entrada'::"text", 'saida'::"text"])))
);

CREATE SEQUENCE IF NOT EXISTS "public"."produtos_relatorio_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."produtos_relatorio_id_seq" OWNED BY "public"."produtos_relatorio"."id";

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "name" "text",
    "email" "text",
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."protestos_certidoes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid",
    "data_certidao" "date",
    "nome_devedor" "text",
    "cnpj_devedor" "text",
    "protestos_declarados" integer NOT NULL,
    "storage_path" "text" NOT NULL,
    "nome_arquivo" "text" NOT NULL,
    "tamanho_bytes" bigint,
    "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."protestos_registros" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "certidao_id" "uuid" NOT NULL,
    "numero_registro" integer NOT NULL,
    "apresentante" "text",
    "cnpj_apresentante" "text",
    "especie" "text",
    "protocolo_e_data" "text",
    "motivo" "text",
    "data_protesto" "date",
    "emissao" "date",
    "vencimento" "text",
    "valor_titulo" numeric(14,2),
    "valor_protestado" numeric(14,2),
    "valor_para_cancelar" numeric(14,2),
    "numero_titulo" "text",
    "tipo_notificacao" "text",
    "livro_folha" "text",
    "situacao" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "protestos_registros_situacao_check" CHECK (("situacao" = ANY (ARRAY['em_aberto'::"text", 'cancelado'::"text"])))
);

CREATE SEQUENCE IF NOT EXISTS "public"."purchase_orders_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE IF NOT EXISTS "public"."purchase_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "numero" "text" DEFAULT ('PO-'::"text" || "lpad"(("nextval"('"public"."purchase_orders_numero_seq"'::"regclass"))::"text", 6, '0'::"text")) NOT NULL,
    "fornecedor" "text",
    "supplier_id" "uuid",
    "status" "public"."purchase_order_status" DEFAULT 'rascunho'::"public"."purchase_order_status" NOT NULL,
    "data_pedido" "date" DEFAULT CURRENT_DATE NOT NULL,
    "data_prevista" "date",
    "valor_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "observacoes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "solicitante_nome" "text",
    CONSTRAINT "purchase_orders_status_check" CHECK (("status" = ANY (ARRAY['rascunho'::"public"."purchase_order_status", 'enviado'::"public"."purchase_order_status", 'parcial'::"public"."purchase_order_status", 'recebido'::"public"."purchase_order_status", 'cancelado'::"public"."purchase_order_status"])))
);

CREATE TABLE IF NOT EXISTS "public"."recebiveis_cartao" (
    "id" bigint NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "data_venda" "date" NOT NULL,
    "bandeira" "text",
    "modalidade" "text" NOT NULL,
    "valor_bruto" numeric(16,2) NOT NULL,
    "taxa_adquirente" numeric(16,2),
    "data_prevista" "date",
    "antecipado" boolean DEFAULT false NOT NULL,
    "data_antecipacao" "date",
    "taxa_antecipacao" numeric(16,2),
    "valor_liquido" numeric(16,2),
    CONSTRAINT "recebiveis_cartao_modalidade_check" CHECK (("modalidade" = ANY (ARRAY['debito'::"text", 'credito'::"text", 'credito_parcelado'::"text", 'voucher'::"text", 'app'::"text"])))
);

CREATE SEQUENCE IF NOT EXISTS "public"."recebiveis_cartao_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."recebiveis_cartao_id_seq" OWNED BY "public"."recebiveis_cartao"."id";

CREATE TABLE IF NOT EXISTS "public"."receita_ambientes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workday_id_fk" "uuid",
    "ambiente" character varying NOT NULL,
    "clientes" integer,
    "gorjeta" numeric,
    "produto" numeric,
    "consumo" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."receita_caixas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workday_id_fk" "uuid",
    "caixa_id" integer,
    "operador" character varying,
    "abertura_at" timestamp with time zone,
    "fechamento_at" timestamp with time zone,
    "total_fechado" numeric,
    "total_recebido" numeric,
    "diferenca" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."receita_cancelamentos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workday_id_fk" "uuid",
    "motivo" character varying NOT NULL,
    "qtd" integer,
    "consumo" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."receita_descontos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workday_id_fk" "uuid",
    "motivo" character varying NOT NULL,
    "qtd" integer,
    "consumo" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."receita_dias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid",
    "data" "date" NOT NULL,
    "workday_id" integer,
    "turno" character varying DEFAULT 'dia_inteiro'::character varying NOT NULL,
    "abertura_at" timestamp with time zone,
    "fechamento_at" timestamp with time zone,
    "receita_bruta" numeric,
    "desconto" numeric,
    "gorjeta" numeric,
    "receita_liquida" numeric,
    "custo" numeric,
    "cmv_pct" numeric,
    "lucro" numeric,
    "clientes" integer,
    "ticket_medio" numeric,
    "ticket_real" numeric,
    "permanencia_media" interval,
    "previsto" numeric,
    "devedor" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"(),
    "importacao_id" "uuid",
    "gorjeta_colaborador" numeric(14,2),
    "gorjeta_casa" numeric(14,2),
    "gorjeta_terceiro" numeric(14,2)
);

CREATE TABLE IF NOT EXISTS "public"."receita_grupos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workday_id_fk" "uuid",
    "grupo" character varying NOT NULL,
    "pct_bruto" numeric,
    "bruto" numeric,
    "desconto" numeric,
    "gorjeta" numeric,
    "consumo" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."receita_horarios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workday_id_fk" "uuid",
    "hora" integer NOT NULL,
    "clientes" integer,
    "gorjeta" numeric,
    "produto" numeric,
    "consumo" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."receita_import_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email_id" character varying,
    "filename" character varying,
    "tipo" character varying,
    "data_referente" "date",
    "status" character varying,
    "erro" "text",
    "processado_em" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."receita_pagamentos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workday_id_fk" "uuid",
    "forma" character varying NOT NULL,
    "valor_fechado" numeric,
    "valor_recebido" numeric,
    "diferenca" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."receita_turnos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workday_id_fk" "uuid",
    "turno" character varying NOT NULL,
    "clientes" integer,
    "gorjeta" numeric,
    "produto" numeric,
    "consumo" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."receita_usuarios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workday_id_fk" "uuid",
    "usuario" character varying NOT NULL,
    "qtd" integer,
    "gorjeta" numeric,
    "produto" numeric,
    "consumo" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."recipe_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "menu_item_id" "uuid" NOT NULL,
    "ingredient_id" "uuid",
    "insumo" "text" DEFAULT ''::"text" NOT NULL,
    "unidade" "text",
    "quantidade" numeric(12,4) DEFAULT 0 NOT NULL,
    "custo_unitario" numeric(12,4) DEFAULT 0 NOT NULL,
    "custo_total" numeric(14,4) GENERATED ALWAYS AS (("quantidade" * "custo_unitario")) STORED,
    "perda_pct" numeric(5,2) DEFAULT 0,
    "ordem" integer DEFAULT 0,
    "observacoes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."reconciliacoes_sugeridas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "titulo_id" "text" NOT NULL,
    "chave_nfe" "text" NOT NULL,
    "score" numeric(5,2) NOT NULL,
    "valor_titulo" numeric(16,2) NOT NULL,
    "valor_nfe" numeric(16,2) NOT NULL,
    "dias_diferenca" integer NOT NULL,
    "status" "text" DEFAULT 'sugerida'::"text" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "competencia" "date",
    CONSTRAINT "reconciliacoes_sugeridas_status_check" CHECK (("status" = ANY (ARRAY['sugerida'::"text", 'confirmada'::"text", 'rejeitada'::"text", 'sem_xml'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."regras_classificacao" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid",
    "tipo" "text" NOT NULL,
    "padrao" "text" NOT NULL,
    "conta_codigo" "text" NOT NULL,
    "prioridade" integer DEFAULT 100 NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "regras_classificacao_tipo_check" CHECK (("tipo" = ANY (ARRAY['fornecedor_cnpj'::"text", 'fornecedor_nome'::"text", 'descricao_contem'::"text", 'categoria_gerencial'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "dept" "text",
    "tier" "text",
    "level" "text",
    "sector" "text",
    "permissions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "roles_tier_check" CHECK (("tier" = ANY (ARRAY['T1'::"text", 'T2A'::"text", 'T2B'::"text", 'T3'::"text", 'T4'::"text", 'T5'::"text", 'T6'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "cnpj" "text",
    "telefone" "text",
    "email" "text",
    "categoria" "text",
    "ativo" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."titulo_override" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "titulo_id" "text" NOT NULL,
    "linha_dre_corrigida" "text",
    "observacao" "text",
    "criado_em" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."titulos_a_pagar" (
    "id" "text" NOT NULL,
    "tipo" "text",
    "n_nota_fiscal" "text",
    "fantasia_fornecedor" "text",
    "razao_fornecedor" "text",
    "cnpj_cpf_fornecedor" "text",
    "t_fornecedor" "text",
    "descricao_c_gerencial" "text",
    "n_titulo" "text",
    "parcela" "text",
    "portador" "text",
    "d_lancamento" "date",
    "d_competencia" "date",
    "d_vencimento" "date",
    "v_titulo" numeric,
    "v_saldo_atual" numeric,
    "dias_atraso_atual" integer,
    "situacao_atual" "text",
    "tipo_sep" "text",
    "fluxo_de_caixa" boolean DEFAULT false,
    "importado_em" timestamp with time zone DEFAULT "now"(),
    "ref_mes" "date",
    "origem" "text",
    "empresa" "text",
    "fantasia_empresa" "text",
    "fornecedor" "text",
    "n_conta" "text",
    "grupo_economico" "text",
    "cep" "text",
    "bairro" "text",
    "cidade" "text",
    "uf" "text",
    "pais" "text",
    "condicao_compra" "text",
    "prazo_medio" numeric,
    "serie" "text",
    "documento" "text",
    "portador_num" "text",
    "c_gerencial" "text",
    "d_autorizacao_pgto" "date",
    "dia_semana" "text",
    "v_desconto" numeric,
    "v_multa_atraso" numeric,
    "v_juros_dia" numeric,
    "v_original" numeric,
    "v_saldo_anterior" numeric,
    "v_credito_periodo" numeric,
    "v_debito_periodo" numeric,
    "d_liquidacao_periodo" "date",
    "situacao_periodo" "text",
    "v_saldo_periodo" numeric,
    "dias_atraso_periodo" numeric,
    "v_atraso_periodo" numeric,
    "v_atualizado_periodo" numeric,
    "d_liquidacao_atual" "date",
    "v_atraso_atual" numeric,
    "v_atualizado_atual" numeric,
    "ano" numeric,
    "mes" "text",
    "semana" numeric,
    "trimestre" numeric,
    "quadrimestre" numeric,
    "unit_id" "uuid",
    "v_pagamento" numeric,
    "d_liquidacao" "date",
    "forma_pagamento" "text",
    "posicao" "text",
    "dre" "text",
    "importacao_id" "uuid",
    "valor_total_nf_origem" numeric(14,2),
    "liquidacao_origem" "text",
    "import_unit_id" "uuid"
);

CREATE TABLE IF NOT EXISTS "public"."unit_cnpjs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "cnpj" "text" NOT NULL,
    "razao_social" "text",
    "papel" "text" NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "unit_cnpjs_papel_check" CHECK (("papel" = ANY (ARRAY['folha'::"text", 'compras'::"text", 'faturamento'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."units" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid",
    "name" "text" NOT NULL,
    "address" "text",
    "whatsapp_number" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "cnpj" "text",
    "latitude" numeric(10,7),
    "longitude" numeric(10,7),
    "geofence_radius_m" integer DEFAULT 200
);

CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "unit_id" "uuid",
    "brand_id" "uuid",
    "group_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_roles_check" CHECK ((("unit_id" IS NOT NULL) OR ("brand_id" IS NOT NULL) OR ("group_id" IS NOT NULL)))
);

CREATE OR REPLACE VIEW "public"."v_fonte_saude" WITH ("security_invoker"='true') AS
 WITH "fontes" AS (
         SELECT 'dre_mensal'::"text" AS "fonte",
            "max"("to_date"(("dre_mensal"."mes_ano")::"text", 'YYYY-MM'::"text")) AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'mensal'::"text" AS "periodicidade_esperada",
            45 AS "limite_dias",
            ARRAY['dre-auditor-me'::"text"] AS "auditores_afetados"
           FROM "public"."dre_mensal"
          WHERE (("dre_mensal"."tipo")::"text" = 'realizado'::"text")
        UNION ALL
         SELECT 'dre_despesa_detalhada'::"text" AS "fonte",
            "max"("to_date"(("dre_despesa_detalhada"."mes_ano")::"text", 'YYYY-MM'::"text")) AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'mensal'::"text" AS "periodicidade_esperada",
            45 AS "limite_dias",
            ARRAY['despesa-caixa-auditor'::"text"] AS "auditores_afetados"
           FROM "public"."dre_despesa_detalhada"
        UNION ALL
         SELECT 'menu_items'::"text" AS "fonte",
            ("max"("menu_items"."updated_at"))::"date" AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'eventual'::"text" AS "periodicidade_esperada",
            90 AS "limite_dias",
            ARRAY['cmv-produto-auditor'::"text", 'cadastro-auditor-me'::"text"] AS "auditores_afetados"
           FROM "public"."menu_items"
          WHERE ("menu_items"."ativo" = true)
        UNION ALL
         SELECT 'ingredients'::"text" AS "fonte",
            ("max"("ingredients"."updated_at"))::"date" AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'eventual'::"text" AS "periodicidade_esperada",
            90 AS "limite_dias",
            ARRAY['cmv-produto-auditor'::"text", 'cadastro-auditor-me'::"text"] AS "auditores_afetados"
           FROM "public"."ingredients"
          WHERE ("ingredients"."ativo" = true)
        UNION ALL
         SELECT 'recipe_items'::"text" AS "fonte",
            ("max"("recipe_items"."updated_at"))::"date" AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'eventual'::"text" AS "periodicidade_esperada",
            90 AS "limite_dias",
            ARRAY['cmv-produto-auditor'::"text", 'cadastro-auditor-me'::"text"] AS "auditores_afetados"
           FROM "public"."recipe_items"
        UNION ALL
         SELECT 'gorjeta_distribuicao'::"text" AS "fonte",
            "max"("make_date"(("gorjeta_distribuicao"."ano")::integer, ("gorjeta_distribuicao"."mes")::integer, 1)) AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'mensal'::"text" AS "periodicidade_esperada",
            45 AS "limite_dias",
            ARRAY['gorjetas-auditor-me'::"text"] AS "auditores_afetados"
           FROM "public"."gorjeta_distribuicao"
        UNION ALL
         SELECT 'gorjeta_periodos'::"text" AS "fonte",
            "max"("gorjeta_periodos"."data") AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'mensal'::"text" AS "periodicidade_esperada",
            45 AS "limite_dias",
            ARRAY['gorjetas-auditor-me'::"text"] AS "auditores_afetados"
           FROM "public"."gorjeta_periodos"
        UNION ALL
         SELECT 'receita_dias'::"text" AS "fonte",
            "max"("receita_dias"."data") AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'diaria'::"text" AS "periodicidade_esperada",
            3 AS "limite_dias",
            ARRAY['receita-viva-auditor-me'::"text"] AS "auditores_afetados"
           FROM "public"."receita_dias"
        UNION ALL
         SELECT 'job_openings'::"text" AS "fonte",
            ("max"("job_openings"."created_at"))::"date" AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'eventual'::"text" AS "periodicidade_esperada",
            90 AS "limite_dias",
            ARRAY['recrutamento-auditor-me'::"text"] AS "auditores_afetados"
           FROM "public"."job_openings"
        UNION ALL
         SELECT 'candidates'::"text" AS "fonte",
            ("max"("candidates"."created_at"))::"date" AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'eventual'::"text" AS "periodicidade_esperada",
            90 AS "limite_dias",
            ARRAY['recrutamento-auditor-me'::"text"] AS "auditores_afetados"
           FROM "public"."candidates"
        UNION ALL
         SELECT 'titulos_a_pagar'::"text" AS "fonte",
            "max"(("titulos_a_pagar"."importado_em")::"date") AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'mensal'::"text" AS "periodicidade_esperada",
            45 AS "limite_dias",
            ARRAY[]::"text"[] AS "auditores_afetados"
           FROM "public"."titulos_a_pagar"
        UNION ALL
         SELECT 'ponto_mensal'::"text" AS "fonte",
            "max"(("ponto_mensal"."importado_em")::"date") AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'mensal'::"text" AS "periodicidade_esperada",
            45 AS "limite_dias",
            ARRAY[]::"text"[] AS "auditores_afetados"
           FROM "public"."ponto_mensal"
        UNION ALL
         SELECT 'purchase_orders'::"text" AS "fonte",
            "max"("purchase_orders"."data_pedido") AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'semanal'::"text" AS "periodicidade_esperada",
            10 AS "limite_dias",
            ARRAY[]::"text"[] AS "auditores_afetados"
           FROM "public"."purchase_orders"
        UNION ALL
         SELECT 'employees'::"text" AS "fonte",
            ("max"("employees"."updated_at"))::"date" AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'eventual'::"text" AS "periodicidade_esperada",
            90 AS "limite_dias",
            ARRAY[]::"text"[] AS "auditores_afetados"
           FROM "public"."employees"
          WHERE ("employees"."ativo" = true)
        UNION ALL
         SELECT 'payslips'::"text" AS "fonte",
            "max"("payslips"."competencia") AS "ultima_escrita",
            ("count"(*))::integer AS "volume_total",
            'mensal'::"text" AS "periodicidade_esperada",
            45 AS "limite_dias",
            ARRAY[]::"text"[] AS "auditores_afetados"
           FROM "public"."payslips"
        )
 SELECT "fonte",
    "ultima_escrita",
    (CURRENT_DATE - "ultima_escrita") AS "dias_sem_atualizacao",
    "volume_total",
    "periodicidade_esperada",
    "limite_dias",
        CASE
            WHEN ((CURRENT_DATE - "ultima_escrita") <= "limite_dias") THEN 'viva'::"text"
            WHEN ((CURRENT_DATE - "ultima_escrita") <= ("limite_dias" * 2)) THEN 'atrasada'::"text"
            ELSE 'morta'::"text"
        END AS "status_fonte",
    "auditores_afetados"
   FROM "fontes"
  ORDER BY
        CASE
            WHEN ((CURRENT_DATE - "ultima_escrita") > ("limite_dias" * 2)) THEN 1
            WHEN ((CURRENT_DATE - "ultima_escrita") > "limite_dias") THEN 2
            ELSE 3
        END, ("array_length"("auditores_afetados", 1)) DESC NULLS LAST, (CURRENT_DATE - "ultima_escrita") DESC;

CREATE TABLE IF NOT EXISTS "public"."vendas_consolidado_ambiente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "periodo_id" "uuid" NOT NULL,
    "ambiente" "text" NOT NULL,
    "bruto" numeric,
    "clientes" integer,
    "participacao_pct" numeric
);

CREATE TABLE IF NOT EXISTS "public"."vendas_consolidado_dia_semana" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "periodo_id" "uuid" NOT NULL,
    "dia_semana" "text" NOT NULL,
    "ordem" integer,
    "bruto" numeric,
    "clientes" integer,
    "ticket_medio" numeric
);

CREATE TABLE IF NOT EXISTS "public"."vendas_consolidado_funcionarios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "periodo_id" "uuid" NOT NULL,
    "funcionario" "text" NOT NULL,
    "bruto" numeric,
    "qtd_vendas" integer
);

CREATE TABLE IF NOT EXISTS "public"."vendas_consolidado_mensal" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "periodo_id" "uuid" NOT NULL,
    "mes" "text" NOT NULL,
    "ordem" integer,
    "bruto" numeric,
    "liquido" numeric,
    "clientes" integer,
    "ticket_medio" numeric
);

CREATE TABLE IF NOT EXISTS "public"."vendas_consolidado_periodo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "data_inicio" "date" NOT NULL,
    "data_fim" "date" NOT NULL,
    "label" "text" NOT NULL,
    "importado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."vendas_consolidado_produtos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "periodo_id" "uuid" NOT NULL,
    "grupo" "text",
    "produto" "text" NOT NULL,
    "quantidade" numeric,
    "valor_bruto" numeric,
    "valor_desconto" numeric,
    "valor_liquido" numeric,
    "participacao_pct" numeric
);

CREATE TABLE IF NOT EXISTS "public"."vendas_consolidado_resumo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "periodo_id" "uuid" NOT NULL,
    "acessos" integer,
    "permanencia_media" "text",
    "ticket_medio" numeric,
    "ticket_real" numeric,
    "bruto" numeric,
    "produto" numeric,
    "custo" numeric,
    "desconto" numeric,
    "gorjeta" numeric,
    "convite" numeric,
    "lucro" numeric,
    "entrada" numeric,
    "consumo" numeric,
    "devedor" numeric,
    "pgto_fechado" numeric,
    "pgto_recebido" numeric,
    "pgto_diferenca" numeric,
    "cash" numeric,
    "card" numeric,
    "pix" numeric
);

CREATE TABLE IF NOT EXISTS "public"."vendas_consolidado_turno" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "periodo_id" "uuid" NOT NULL,
    "turno" "text" NOT NULL,
    "bruto" numeric,
    "clientes" integer,
    "ticket_medio" numeric,
    "participacao_pct" numeric
);

CREATE TABLE IF NOT EXISTS "public"."vendas_diarias" (
    "id" integer NOT NULL,
    "data_venda" "date" NOT NULL,
    "turno" "text",
    "qtd_clientes" integer,
    "faturamento_bruto" numeric,
    "descontos_clientes" numeric,
    "descontos_socios" numeric,
    "descontos_internos" numeric,
    "gorjetas" numeric,
    "penduras" numeric,
    "perdas" numeric,
    "meta_faturamento" numeric,
    "criado_em" timestamp with time zone DEFAULT "now"()
);

CREATE SEQUENCE IF NOT EXISTS "public"."vendas_diarias_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."vendas_diarias_id_seq" OWNED BY "public"."vendas_diarias"."id";

ALTER TABLE ONLY "public"."dre_contratos_fixos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dre_contratos_fixos_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."dre_despesa_detalhada" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dre_despesa_detalhada_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."dre_faturamento_historico" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dre_faturamento_historico_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."dre_folha" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dre_folha_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."dre_gorjeta_mensal" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dre_gorjeta_mensal_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."dre_indicadores" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dre_indicadores_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."dre_linhas_detalhadas" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dre_linhas_detalhadas_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."dre_manutencao_detalhada" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dre_manutencao_detalhada_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."dre_mensal" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dre_mensal_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."dre_pessoal_detalhado" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dre_pessoal_detalhado_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."dre_prestadores" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dre_prestadores_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."dre_receita_detalhada" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dre_receita_detalhada_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."lancamentos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."lancamentos_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."metas_projecoes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."metas_projecoes_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."movimentacoes_caixa" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."movimentacoes_caixa_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."nfe_documentos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."nfe_documentos_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."produtos_relatorio" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."produtos_relatorio_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."recebiveis_cartao" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."recebiveis_cartao_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."vendas_diarias" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."vendas_diarias_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_slug_key" UNIQUE ("slug");

ALTER TABLE ONLY "public"."candidates"
    ADD CONSTRAINT "candidates_access_code_key" UNIQUE ("access_code");

ALTER TABLE ONLY "public"."candidates"
    ADD CONSTRAINT "candidates_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cargo_grupos"
    ADD CONSTRAINT "cargo_grupos_nome_key" UNIQUE ("nome");

ALTER TABLE ONLY "public"."cargo_grupos"
    ADD CONSTRAINT "cargo_grupos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cargos"
    ADD CONSTRAINT "cargos_nome_unique" UNIQUE ("nome");

ALTER TABLE ONLY "public"."cargos"
    ADD CONSTRAINT "cargos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."conferencias"
    ADD CONSTRAINT "conferencias_alerta_chave_unit_id_competencia_key" UNIQUE ("alerta_chave", "unit_id", "competencia");

ALTER TABLE ONLY "public"."conferencias"
    ADD CONSTRAINT "conferencias_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."contas_bancarias"
    ADD CONSTRAINT "contas_bancarias_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."contratos_arquivos"
    ADD CONSTRAINT "contratos_arquivos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."contratos"
    ADD CONSTRAINT "contratos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dre_contratos_fixos"
    ADD CONSTRAINT "dre_contratos_fixos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dre_despesa_detalhada"
    ADD CONSTRAINT "dre_despesa_detalhada_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dre_faturamento_historico"
    ADD CONSTRAINT "dre_faturamento_historico_mes_num_categoria_unit_id_key" UNIQUE ("mes_num", "categoria", "unit_id");

ALTER TABLE ONLY "public"."dre_faturamento_historico"
    ADD CONSTRAINT "dre_faturamento_historico_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dre_folha"
    ADD CONSTRAINT "dre_folha_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dre_gorjeta_mensal"
    ADD CONSTRAINT "dre_gorjeta_mensal_mes_ano_unit_id_key" UNIQUE ("mes_ano", "unit_id");

ALTER TABLE ONLY "public"."dre_gorjeta_mensal"
    ADD CONSTRAINT "dre_gorjeta_mensal_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dre_indicadores"
    ADD CONSTRAINT "dre_indicadores_mes_ano_tipo_indicador_unit_key" UNIQUE ("mes_ano", "tipo", "indicador", "unit_id");

ALTER TABLE ONLY "public"."dre_indicadores"
    ADD CONSTRAINT "dre_indicadores_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dre_kpis_mensais"
    ADD CONSTRAINT "dre_kpis_mensais_pkey" PRIMARY KEY ("mes_ano", "unit_id");

ALTER TABLE ONLY "public"."dre_linhas_detalhadas"
    ADD CONSTRAINT "dre_linhas_detalhadas_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dre_manutencao_detalhada"
    ADD CONSTRAINT "dre_manutencao_detalhada_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dre_mensal"
    ADD CONSTRAINT "dre_mensal_mes_ano_tipo_unit_key" UNIQUE ("mes_ano", "tipo", "unit_id");

ALTER TABLE ONLY "public"."dre_mensal"
    ADD CONSTRAINT "dre_mensal_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dre_pessoal_detalhado"
    ADD CONSTRAINT "dre_pessoal_detalhado_mes_ano_categoria_unit_id_key" UNIQUE ("mes_ano", "categoria", "unit_id");

ALTER TABLE ONLY "public"."dre_pessoal_detalhado"
    ADD CONSTRAINT "dre_pessoal_detalhado_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dre_prestadores"
    ADD CONSTRAINT "dre_prestadores_mes_ano_nome_grupo_unit_id_key" UNIQUE ("mes_ano", "nome", "grupo", "unit_id");

ALTER TABLE ONLY "public"."dre_prestadores"
    ADD CONSTRAINT "dre_prestadores_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dre_receita_detalhada"
    ADD CONSTRAINT "dre_receita_detalhada_mes_ano_bandeira_unit_id_key" UNIQUE ("mes_ano", "bandeira", "unit_id");

ALTER TABLE ONLY "public"."dre_receita_detalhada"
    ADD CONSTRAINT "dre_receita_detalhada_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dre_snapshot"
    ADD CONSTRAINT "dre_snapshot_pkey" PRIMARY KEY ("unit_id", "competencia", "conta_codigo");

ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_cpf_key" UNIQUE ("cpf");

ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."financeiro_importacoes"
    ADD CONSTRAINT "financeiro_importacoes_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."financeiro_importacoes"
    ADD CONSTRAINT "financeiro_importacoes_unit_id_checksum_sha256_key" UNIQUE ("unit_id", "checksum_sha256");

ALTER TABLE ONLY "public"."financeiro_revisoes"
    ADD CONSTRAINT "financeiro_revisoes_pkey" PRIMARY KEY ("unit_id");

ALTER TABLE ONLY "public"."fornecedores"
    ADD CONSTRAINT "fornecedores_codigo_key" UNIQUE ("codigo");

ALTER TABLE ONLY "public"."fornecedores_depara"
    ADD CONSTRAINT "fornecedores_depara_nome_origem_origem_key" UNIQUE ("nome_origem", "origem");

ALTER TABLE ONLY "public"."fornecedores_depara"
    ADD CONSTRAINT "fornecedores_depara_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."fornecedores"
    ADD CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."gorjeta_cargo_pontos"
    ADD CONSTRAINT "gorjeta_cargo_pontos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."gorjeta_cargo_pontos"
    ADD CONSTRAINT "gorjeta_cargo_pontos_unit_id_cargo_key" UNIQUE ("unit_id", "cargo");

ALTER TABLE ONLY "public"."gorjeta_distribuicao"
    ADD CONSTRAINT "gorjeta_distribuicao_periodo_emp_uq" UNIQUE ("unit_id", "periodo", "employee_id");

ALTER TABLE ONLY "public"."gorjeta_distribuicao"
    ADD CONSTRAINT "gorjeta_distribuicao_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."gorjeta_periodos"
    ADD CONSTRAINT "gorjeta_periodos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."gorjeta_periodos"
    ADD CONSTRAINT "gorjeta_periodos_unit_id_data_key" UNIQUE ("unit_id", "data");

ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_slug_key" UNIQUE ("slug");

ALTER TABLE ONLY "public"."ingredient_price_history"
    ADD CONSTRAINT "ingredient_price_history_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."job_openings"
    ADD CONSTRAINT "job_openings_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."kpi_snapshot"
    ADD CONSTRAINT "kpi_snapshot_pkey" PRIMARY KEY ("unit_id", "competencia");

ALTER TABLE ONLY "public"."lancamentos"
    ADD CONSTRAINT "lancamentos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."mapa_conta_dre"
    ADD CONSTRAINT "mapa_conta_dre_descricao_c_gerencial_key" UNIQUE ("descricao_c_gerencial");

ALTER TABLE ONLY "public"."mapa_conta_dre"
    ADD CONSTRAINT "mapa_conta_dre_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."metas_dia_override"
    ADD CONSTRAINT "metas_dia_override_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."metas_dia_override"
    ADD CONSTRAINT "metas_dia_override_unit_id_data_key" UNIQUE ("unit_id", "data");

ALTER TABLE ONLY "public"."metas_dia_semana"
    ADD CONSTRAINT "metas_dia_semana_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."metas_dia_semana"
    ADD CONSTRAINT "metas_dia_semana_unit_id_dia_semana_key" UNIQUE ("unit_id", "dia_semana");

ALTER TABLE ONLY "public"."metas"
    ADD CONSTRAINT "metas_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."metas_projecoes"
    ADD CONSTRAINT "metas_projecoes_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."metas"
    ADD CONSTRAINT "metas_unit_id_competencia_chave_key" UNIQUE ("unit_id", "competencia", "chave");

ALTER TABLE ONLY "public"."movimentacoes_caixa"
    ADD CONSTRAINT "movimentacoes_caixa_origem_origem_id_key" UNIQUE ("origem", "origem_id");

ALTER TABLE ONLY "public"."movimentacoes_caixa"
    ADD CONSTRAINT "movimentacoes_caixa_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."nfe_documentos"
    ADD CONSTRAINT "nfe_documentos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."nfe_documentos"
    ADD CONSTRAINT "nfe_documentos_unit_id_chave_key" UNIQUE ("unit_id", "chave");

ALTER TABLE ONLY "public"."nfe_importacoes"
    ADD CONSTRAINT "nfe_importacoes_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."origens_candidato"
    ADD CONSTRAINT "origens_candidato_codigo_key" UNIQUE ("codigo");

ALTER TABLE ONLY "public"."origens_candidato"
    ADD CONSTRAINT "origens_candidato_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_colaborador"
    ADD CONSTRAINT "payroll_extrato_dominio_colaborador_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_competencia"
    ADD CONSTRAINT "payroll_extrato_dominio_competencia_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_competencia"
    ADD CONSTRAINT "payroll_extrato_dominio_competencia_unit_id_competencia_key" UNIQUE ("unit_id", "competencia");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_linha"
    ADD CONSTRAINT "payroll_extrato_dominio_linha_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_rubrica"
    ADD CONSTRAINT "payroll_extrato_dominio_rubrica_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_totais"
    ADD CONSTRAINT "payroll_extrato_dominio_totais_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_emp_comp_tipo_key" UNIQUE ("employee_id", "competencia", "tipo");

ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."plano_contas"
    ADD CONSTRAINT "plano_contas_pkey" PRIMARY KEY ("codigo");

ALTER TABLE ONLY "public"."ponto_mensal"
    ADD CONSTRAINT "ponto_mensal_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."ponto_mensal"
    ADD CONSTRAINT "ponto_mensal_unit_id_periodo_matricula_key" UNIQUE ("unit_id", "periodo", "matricula");

ALTER TABLE ONLY "public"."produtos_catalogo"
    ADD CONSTRAINT "produtos_catalogo_codigo_key" UNIQUE ("codigo");

ALTER TABLE ONLY "public"."produtos_catalogo"
    ADD CONSTRAINT "produtos_catalogo_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."produtos_depara"
    ADD CONSTRAINT "produtos_depara_fornecedor_item_key" UNIQUE ("fornecedor_cnpj", "item_codigo");

ALTER TABLE ONLY "public"."produtos_depara"
    ADD CONSTRAINT "produtos_depara_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."produtos_relatorio"
    ADD CONSTRAINT "produtos_relatorio_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."protestos_certidoes"
    ADD CONSTRAINT "protestos_certidoes_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."protestos_registros"
    ADD CONSTRAINT "protestos_registros_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_numero_key" UNIQUE ("numero");

ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."recebiveis_cartao"
    ADD CONSTRAINT "recebiveis_cartao_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_ambientes"
    ADD CONSTRAINT "receita_ambientes_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_caixas"
    ADD CONSTRAINT "receita_caixas_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_cancelamentos_detalhe"
    ADD CONSTRAINT "receita_cancelamentos_detalhe_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_cancelamentos"
    ADD CONSTRAINT "receita_cancelamentos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_descontos_detalhe"
    ADD CONSTRAINT "receita_descontos_detalhe_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_descontos"
    ADD CONSTRAINT "receita_descontos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_dias"
    ADD CONSTRAINT "receita_dias_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_dias"
    ADD CONSTRAINT "receita_dias_unit_id_workday_id_key" UNIQUE ("unit_id", "workday_id");

ALTER TABLE ONLY "public"."receita_grupos"
    ADD CONSTRAINT "receita_grupos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_horarios"
    ADD CONSTRAINT "receita_horarios_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_import_log"
    ADD CONSTRAINT "receita_import_log_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_pagamentos"
    ADD CONSTRAINT "receita_pagamentos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_produtos_dia"
    ADD CONSTRAINT "receita_produtos_dia_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_turnos"
    ADD CONSTRAINT "receita_turnos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."receita_usuarios"
    ADD CONSTRAINT "receita_usuarios_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."recipe_items"
    ADD CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."reconciliacoes_sugeridas"
    ADD CONSTRAINT "reconciliacoes_sugeridas_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."reconciliacoes_sugeridas"
    ADD CONSTRAINT "reconciliacoes_sugeridas_titulo_id_chave_nfe_key" UNIQUE ("titulo_id", "chave_nfe");

ALTER TABLE ONLY "public"."regras_classificacao"
    ADD CONSTRAINT "regras_classificacao_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_name_key" UNIQUE ("name");

ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."titulo_override"
    ADD CONSTRAINT "titulo_override_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."titulo_override"
    ADD CONSTRAINT "titulo_override_titulo_id_key" UNIQUE ("titulo_id");

ALTER TABLE ONLY "public"."titulos_a_pagar"
    ADD CONSTRAINT "titulos_a_pagar_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."unit_cnpjs"
    ADD CONSTRAINT "unit_cnpjs_cnpj_key" UNIQUE ("cnpj");

ALTER TABLE ONLY "public"."unit_cnpjs"
    ADD CONSTRAINT "unit_cnpjs_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_colaborador"
    ADD CONSTRAINT "uq_extrato_colab" UNIQUE ("unit_id", "competencia", "cod_colaborador");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_linha"
    ADD CONSTRAINT "uq_extrato_linha" UNIQUE ("unit_id", "competencia", "cod_colaborador", "rubrica_codigo");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_rubrica"
    ADD CONSTRAINT "uq_extrato_rubrica" UNIQUE ("unit_id", "competencia", "rubrica_codigo", "natureza");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_totais"
    ADD CONSTRAINT "uq_extrato_totais" UNIQUE ("unit_id", "competencia", "dimensao", "codigo");

ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_role_id_unit_id_key" UNIQUE ("user_id", "role_id", "unit_id");

ALTER TABLE ONLY "public"."vendas_consolidado_ambiente"
    ADD CONSTRAINT "vendas_consolidado_ambiente_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."vendas_consolidado_dia_semana"
    ADD CONSTRAINT "vendas_consolidado_dia_semana_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."vendas_consolidado_funcionarios"
    ADD CONSTRAINT "vendas_consolidado_funcionarios_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."vendas_consolidado_mensal"
    ADD CONSTRAINT "vendas_consolidado_mensal_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."vendas_consolidado_periodo"
    ADD CONSTRAINT "vendas_consolidado_periodo_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."vendas_consolidado_produtos"
    ADD CONSTRAINT "vendas_consolidado_produtos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."vendas_consolidado_resumo"
    ADD CONSTRAINT "vendas_consolidado_resumo_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."vendas_consolidado_turno"
    ADD CONSTRAINT "vendas_consolidado_turno_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."vendas_diarias"
    ADD CONSTRAINT "vendas_diarias_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX "candidates_phone_unique" ON "public"."candidates" USING "btree" ("phone");

CREATE INDEX "employees_manager" ON "public"."employees" USING "btree" ("manager_id");

CREATE INDEX "gorjeta_distribuicao_employee_idx" ON "public"."gorjeta_distribuicao" USING "btree" ("employee_id");

CREATE INDEX "gorjeta_distribuicao_unit_period_idx" ON "public"."gorjeta_distribuicao" USING "btree" ("unit_id", "mes", "ano");

CREATE INDEX "idx_arquivos_contrato" ON "public"."contratos_arquivos" USING "btree" ("contrato_id");

CREATE INDEX "idx_brands_group" ON "public"."brands" USING "btree" ("group_id");

CREATE INDEX "idx_cancel_det_wd" ON "public"."receita_cancelamentos_detalhe" USING "btree" ("workday_id_fk");

CREATE INDEX "idx_candidates_access_code" ON "public"."candidates" USING "btree" ("access_code");

CREATE INDEX "idx_candidates_cidade" ON "public"."candidates" USING "btree" ("cidade") WHERE ("cidade" IS NOT NULL);

CREATE INDEX "idx_candidates_escolaridade" ON "public"."candidates" USING "btree" ("escolaridade_nivel") WHERE ("escolaridade_nivel" IS NOT NULL);

CREATE INDEX "idx_candidates_job_opening" ON "public"."candidates" USING "btree" ("job_opening_id");

CREATE INDEX "idx_candidates_opening" ON "public"."candidates" USING "btree" ("job_opening_id");

CREATE INDEX "idx_candidates_origem" ON "public"."candidates" USING "btree" ("origem");

CREATE INDEX "idx_candidates_pretensao" ON "public"."candidates" USING "btree" ("pretensao_salarial") WHERE ("pretensao_salarial" IS NOT NULL);

CREATE INDEX "idx_candidates_status" ON "public"."candidates" USING "btree" ("status");

CREATE INDEX "idx_candidates_unit" ON "public"."candidates" USING "btree" ("unit_id");

CREATE UNIQUE INDEX "idx_candidates_welcome_sid" ON "public"."candidates" USING "btree" ("welcome_message_sid") WHERE ("welcome_message_sid" IS NOT NULL);

CREATE INDEX "idx_conferencias_unit_competencia" ON "public"."conferencias" USING "btree" ("unit_id", "competencia");

CREATE INDEX "idx_contratos_fim" ON "public"."contratos" USING "btree" ("data_fim");

CREATE INDEX "idx_contratos_unit" ON "public"."contratos" USING "btree" ("unit_id");

CREATE INDEX "idx_descontos_det_wd" ON "public"."receita_descontos_detalhe" USING "btree" ("workday_id_fk");

CREATE INDEX "idx_dre_contratos_unit_id" ON "public"."dre_contratos_fixos" USING "btree" ("unit_id");

CREATE INDEX "idx_dre_despesa_cls" ON "public"."dre_despesa_detalhada" USING "btree" ("classificacao_dre");

CREATE INDEX "idx_dre_despesa_det_unit_id" ON "public"."dre_despesa_detalhada" USING "btree" ("unit_id");

CREATE INDEX "idx_dre_despesa_mes" ON "public"."dre_despesa_detalhada" USING "btree" ("mes_ano");

CREATE INDEX "idx_dre_despesa_tipo" ON "public"."dre_despesa_detalhada" USING "btree" ("tipo_despesa");

CREATE INDEX "idx_dre_folha_competencia" ON "public"."dre_folha" USING "btree" ("unit_id", "competencia");

CREATE INDEX "idx_dre_folha_documento" ON "public"."dre_folha" USING "btree" ("unit_id", "competencia", "documento_path");

CREATE INDEX "idx_dre_folha_unit_id" ON "public"."dre_folha" USING "btree" ("unit_id");

CREATE INDEX "idx_dre_gorjeta_unit_id" ON "public"."dre_gorjeta_mensal" USING "btree" ("unit_id");

CREATE INDEX "idx_dre_historico_unit_id" ON "public"."dre_faturamento_historico" USING "btree" ("unit_id");

CREATE INDEX "idx_dre_indicadores_unit_id" ON "public"."dre_indicadores" USING "btree" ("unit_id");

CREATE INDEX "idx_dre_kpis_unit_id" ON "public"."dre_kpis_mensais" USING "btree" ("unit_id");

CREATE INDEX "idx_dre_linhas_det_unit_id" ON "public"."dre_linhas_detalhadas" USING "btree" ("unit_id");

CREATE INDEX "idx_dre_manutencao_det_unit_id" ON "public"."dre_manutencao_detalhada" USING "btree" ("unit_id");

CREATE INDEX "idx_dre_mensal_unit_id" ON "public"."dre_mensal" USING "btree" ("unit_id");

CREATE INDEX "idx_dre_pessoal_det_unit_id" ON "public"."dre_pessoal_detalhado" USING "btree" ("unit_id");

CREATE INDEX "idx_dre_prestadores_unit_id" ON "public"."dre_prestadores" USING "btree" ("unit_id");

CREATE INDEX "idx_dre_receita_det_unit_id" ON "public"."dre_receita_detalhada" USING "btree" ("unit_id");

CREATE INDEX "idx_employees_employee_code" ON "public"."employees" USING "btree" ("employee_code");

CREATE INDEX "idx_employees_score" ON "public"."employees" USING "btree" ("score" DESC);

CREATE INDEX "idx_employees_status_rh" ON "public"."employees" USING "btree" ("status_rh");

CREATE INDEX "idx_employees_unit" ON "public"."employees" USING "btree" ("unit_id");

CREATE INDEX "idx_fornecedores_depara_fornecedor_id" ON "public"."fornecedores_depara" USING "btree" ("fornecedor_id");

CREATE INDEX "idx_gorjeta_periodo_emp" ON "public"."gorjeta_distribuicao" USING "btree" ("unit_id", "periodo");

CREATE INDEX "idx_gorjeta_periodos_unit_data" ON "public"."gorjeta_periodos" USING "btree" ("unit_id", "data");

CREATE INDEX "idx_gorjeta_recibo_pendente" ON "public"."gorjeta_distribuicao" USING "btree" ("unit_id", "mes", "ano") WHERE ("recibo_gerado_at" IS NULL);

CREATE INDEX "idx_ingredients_ativo" ON "public"."ingredients" USING "btree" ("ativo") WHERE ("ativo" = true);

CREATE INDEX "idx_ingredients_categoria" ON "public"."ingredients" USING "btree" ("categoria");

CREATE UNIQUE INDEX "idx_ingredients_codigo_group" ON "public"."ingredients" USING "btree" ("group_id", "codigo") WHERE ("codigo" IS NOT NULL);

CREATE INDEX "idx_ingredients_group" ON "public"."ingredients" USING "btree" ("group_id");

CREATE INDEX "idx_job_openings_ativas" ON "public"."job_openings" USING "btree" ("unit_id", "status") WHERE (("congelada" = false) AND ("cancelada" = false));

CREATE INDEX "idx_job_openings_cargo_grupo" ON "public"."job_openings" USING "btree" ("cargo_grupo_id");

CREATE INDEX "idx_manutencao_mes" ON "public"."dre_manutencao_detalhada" USING "btree" ("mes_ano");

CREATE INDEX "idx_menu_items_ativo" ON "public"."menu_items" USING "btree" ("ativo") WHERE ("ativo" = true);

CREATE INDEX "idx_menu_items_brand" ON "public"."menu_items" USING "btree" ("brand_id");

CREATE INDEX "idx_menu_items_categoria" ON "public"."menu_items" USING "btree" ("categoria");

CREATE INDEX "idx_menu_items_unit" ON "public"."menu_items" USING "btree" ("unit_id") WHERE ("unit_id" IS NOT NULL);

CREATE INDEX "idx_movimentacoes_caixa_unit_data" ON "public"."movimentacoes_caixa" USING "btree" ("unit_id", "data");

CREATE INDEX "idx_payslips_employee" ON "public"."payslips" USING "btree" ("employee_id", "competencia" DESC);

CREATE INDEX "idx_payslips_employee_code" ON "public"."payslips" USING "btree" ("employee_code");

CREATE INDEX "idx_pr_categoria" ON "public"."produtos_relatorio" USING "btree" ("unit_id", "desc_gerencial");

CREATE INDEX "idx_pr_unit_mes" ON "public"."produtos_relatorio" USING "btree" ("unit_id", "ano_lancamento", "mes_lancamento");

CREATE INDEX "idx_prestadores_mes" ON "public"."dre_prestadores" USING "btree" ("mes_ano");

CREATE INDEX "idx_price_history_ingredient" ON "public"."ingredient_price_history" USING "btree" ("ingredient_id", "created_at" DESC);

CREATE INDEX "idx_produtos_depara_produto_id" ON "public"."produtos_depara" USING "btree" ("produto_id");

CREATE INDEX "idx_produtos_dia_wd" ON "public"."receita_produtos_dia" USING "btree" ("workday_id_fk");

CREATE INDEX "idx_produtos_relatorio_produto_id" ON "public"."produtos_relatorio" USING "btree" ("produto_id");

CREATE INDEX "idx_produtos_relatorio_unit_direcao_periodo" ON "public"."produtos_relatorio" USING "btree" ("unit_id", "direcao_nfe", "ano_lancamento", "mes_lancamento");

CREATE INDEX "idx_produtos_relatorio_unit_mes" ON "public"."produtos_relatorio" USING "btree" ("unit_id", "ano_lancamento", "mes_lancamento");

CREATE INDEX "idx_protestos_certidoes_unit" ON "public"."protestos_certidoes" USING "btree" ("unit_id");

CREATE INDEX "idx_protestos_registros_certidao" ON "public"."protestos_registros" USING "btree" ("certidao_id");

CREATE INDEX "idx_protestos_registros_situacao" ON "public"."protestos_registros" USING "btree" ("situacao");

CREATE INDEX "idx_purchase_orders_brand" ON "public"."purchase_orders" USING "btree" ("brand_id");

CREATE INDEX "idx_purchase_orders_data_pedido" ON "public"."purchase_orders" USING "btree" ("data_pedido" DESC);

CREATE INDEX "idx_purchase_orders_status" ON "public"."purchase_orders" USING "btree" ("status");

CREATE INDEX "idx_purchase_orders_unit" ON "public"."purchase_orders" USING "btree" ("unit_id");

CREATE INDEX "idx_recebiveis_cartao_unit_data" ON "public"."recebiveis_cartao" USING "btree" ("unit_id", "data_venda");

CREATE INDEX "idx_recipe_items_ingredient" ON "public"."recipe_items" USING "btree" ("ingredient_id") WHERE ("ingredient_id" IS NOT NULL);

CREATE INDEX "idx_recipe_items_menu" ON "public"."recipe_items" USING "btree" ("menu_item_id");

CREATE INDEX "idx_suppliers_ativo" ON "public"."suppliers" USING "btree" ("ativo");

CREATE INDEX "idx_suppliers_brand" ON "public"."suppliers" USING "btree" ("brand_id");

CREATE INDEX "idx_suppliers_unit" ON "public"."suppliers" USING "btree" ("unit_id");

CREATE INDEX "idx_titulo_override_titulo" ON "public"."titulo_override" USING "btree" ("titulo_id");

CREATE INDEX "idx_titulos_unit_vencimento" ON "public"."titulos_a_pagar" USING "btree" ("unit_id", "d_vencimento");

CREATE INDEX "idx_units_brand" ON "public"."units" USING "btree" ("brand_id");

CREATE INDEX "idx_user_roles_brand" ON "public"."user_roles" USING "btree" ("brand_id");

CREATE INDEX "idx_user_roles_unit" ON "public"."user_roles" USING "btree" ("unit_id");

CREATE INDEX "idx_user_roles_user" ON "public"."user_roles" USING "btree" ("user_id");

CREATE INDEX "idx_vcamb_periodo" ON "public"."vendas_consolidado_ambiente" USING "btree" ("periodo_id");

CREATE INDEX "idx_vcdia_periodo" ON "public"."vendas_consolidado_dia_semana" USING "btree" ("periodo_id", "ordem");

CREATE INDEX "idx_vcfunc_periodo" ON "public"."vendas_consolidado_funcionarios" USING "btree" ("periodo_id", "bruto" DESC);

CREATE INDEX "idx_vcmensal_periodo" ON "public"."vendas_consolidado_mensal" USING "btree" ("periodo_id", "ordem");

CREATE INDEX "idx_vcp_unit" ON "public"."vendas_consolidado_periodo" USING "btree" ("unit_id", "data_inicio" DESC);

CREATE INDEX "idx_vcprod_periodo" ON "public"."vendas_consolidado_produtos" USING "btree" ("periodo_id", "valor_liquido" DESC);

CREATE UNIQUE INDEX "idx_vcr_periodo" ON "public"."vendas_consolidado_resumo" USING "btree" ("periodo_id");

CREATE INDEX "idx_vcturno_periodo" ON "public"."vendas_consolidado_turno" USING "btree" ("periodo_id");

CREATE UNIQUE INDEX "ingredients_group_codigo_uniq" ON "public"."ingredients" USING "btree" ("group_id", "codigo") WHERE ("codigo" IS NOT NULL);

CREATE INDEX "ix_extrato_colab_comp" ON "public"."payroll_extrato_dominio_colaborador" USING "btree" ("competencia");

CREATE INDEX "ix_extrato_colab_cpf" ON "public"."payroll_extrato_dominio_colaborador" USING "btree" ("cpf");

CREATE INDEX "ix_extrato_colab_emp" ON "public"."payroll_extrato_dominio_colaborador" USING "btree" ("employee_id");

CREATE INDEX "ix_extrato_linha_comp" ON "public"."payroll_extrato_dominio_linha" USING "btree" ("competencia", "rubrica_codigo");

CREATE INDEX "ix_extrato_linha_emp" ON "public"."payroll_extrato_dominio_linha" USING "btree" ("employee_id");

CREATE INDEX "lancamentos_conta_codigo_idx" ON "public"."lancamentos" USING "btree" ("conta_codigo");

CREATE INDEX "lancamentos_origem_idx" ON "public"."lancamentos" USING "btree" ("origem", "origem_id");

CREATE UNIQUE INDEX "lancamentos_source_scope" ON "public"."lancamentos" USING "btree" ("unit_id", "competencia", "origem", "origem_id", "conta_codigo");

CREATE INDEX "lancamentos_unit_competencia_idx" ON "public"."lancamentos" USING "btree" ("unit_id", "competencia");

CREATE UNIQUE INDEX "menu_items_unit_codigo_uniq" ON "public"."menu_items" USING "btree" ("unit_id", "codigo") WHERE ("codigo" IS NOT NULL);

CREATE INDEX "payroll_extrato_dominio_competencia_cnpj_idx" ON "public"."payroll_extrato_dominio_competencia" USING "btree" ("cnpj");

CREATE UNIQUE INDEX "produtos_relatorio_identity" ON "public"."produtos_relatorio" USING "btree" ("unit_id", "nr_danfe", "item_codigo", "fornecedor_codigo", "chave_nfe", "item_nfe") NULLS NOT DISTINCT;

CREATE UNIQUE INDEX "produtos_relatorio_nfe_position" ON "public"."produtos_relatorio" USING "btree" ("unit_id", "chave_nfe", "item_nfe") WHERE ("chave_nfe" IS NOT NULL);

CREATE INDEX "receita_cancelamentos_workday" ON "public"."receita_cancelamentos" USING "btree" ("workday_id_fk");

CREATE INDEX "receita_horarios_workday" ON "public"."receita_horarios" USING "btree" ("workday_id_fk");

CREATE INDEX "receita_usuarios_workday" ON "public"."receita_usuarios" USING "btree" ("workday_id_fk");

CREATE INDEX "recipe_items_menu_item_idx" ON "public"."recipe_items" USING "btree" ("menu_item_id");

CREATE INDEX "titulos_import_scope" ON "public"."titulos_a_pagar" USING "btree" ("import_unit_id", "d_competencia", "origem");

CREATE INDEX "unit_cnpjs_unit_id_idx" ON "public"."unit_cnpjs" USING "btree" ("unit_id");

CREATE UNIQUE INDEX "units_cnpj_key" ON "public"."units" USING "btree" ("cnpj") WHERE ("cnpj" IS NOT NULL);

CREATE UNIQUE INDEX "uq_protestos_certidoes_devedor_data" ON "public"."protestos_certidoes" USING "btree" ("cnpj_devedor", "data_certidao") NULLS NOT DISTINCT;

CREATE UNIQUE INDEX "uq_protestos_registros_certidao_numero" ON "public"."protestos_registros" USING "btree" ("certidao_id", "numero_registro");

CREATE UNIQUE INDEX "uq_titulos_chave" ON "public"."titulos_a_pagar" USING "btree" ("n_titulo", "parcela", "fantasia_empresa", "ref_mes") NULLS NOT DISTINCT;

CREATE UNIQUE INDEX "user_roles_scope_key" ON "public"."user_roles" USING "btree" ("user_id", "role_id", COALESCE("unit_id", '00000000-0000-0000-0000-000000000000'::"uuid"), COALESCE("brand_id", '00000000-0000-0000-0000-000000000000'::"uuid"), COALESCE("group_id", '00000000-0000-0000-0000-000000000000'::"uuid"));

CREATE OR REPLACE TRIGGER "candidates_updated_at" BEFORE UPDATE ON "public"."candidates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

CREATE OR REPLACE TRIGGER "financeiro_revision" AFTER INSERT OR DELETE OR UPDATE ON "public"."fornecedores" FOR EACH ROW EXECUTE FUNCTION "public"."financeiro_source_changed"();

CREATE OR REPLACE TRIGGER "financeiro_revision" AFTER INSERT OR DELETE OR UPDATE ON "public"."fornecedores_depara" FOR EACH ROW EXECUTE FUNCTION "public"."financeiro_source_changed"();

CREATE OR REPLACE TRIGGER "financeiro_revision" AFTER INSERT OR DELETE OR UPDATE ON "public"."lancamentos" FOR EACH ROW EXECUTE FUNCTION "public"."financeiro_source_changed"();

CREATE OR REPLACE TRIGGER "financeiro_revision" AFTER INSERT OR DELETE OR UPDATE ON "public"."payroll_extrato_dominio_competencia" FOR EACH ROW EXECUTE FUNCTION "public"."financeiro_source_changed"();

CREATE OR REPLACE TRIGGER "financeiro_revision" AFTER INSERT OR DELETE OR UPDATE ON "public"."payroll_extrato_dominio_linha" FOR EACH ROW EXECUTE FUNCTION "public"."financeiro_source_changed"();

CREATE OR REPLACE TRIGGER "financeiro_revision" AFTER INSERT OR DELETE OR UPDATE ON "public"."plano_contas" FOR EACH ROW EXECUTE FUNCTION "public"."financeiro_source_changed"();

CREATE OR REPLACE TRIGGER "financeiro_revision" AFTER INSERT OR DELETE OR UPDATE ON "public"."produtos_catalogo" FOR EACH ROW EXECUTE FUNCTION "public"."financeiro_source_changed"();

CREATE OR REPLACE TRIGGER "financeiro_revision" AFTER INSERT OR DELETE OR UPDATE ON "public"."produtos_depara" FOR EACH ROW EXECUTE FUNCTION "public"."financeiro_source_changed"();

CREATE OR REPLACE TRIGGER "financeiro_revision" AFTER INSERT OR DELETE OR UPDATE ON "public"."produtos_relatorio" FOR EACH ROW EXECUTE FUNCTION "public"."financeiro_source_changed"();

CREATE OR REPLACE TRIGGER "financeiro_revision" AFTER INSERT OR DELETE OR UPDATE ON "public"."receita_cancelamentos" FOR EACH ROW EXECUTE FUNCTION "public"."financeiro_source_changed"();

CREATE OR REPLACE TRIGGER "financeiro_revision" AFTER INSERT OR DELETE OR UPDATE ON "public"."receita_dias" FOR EACH ROW EXECUTE FUNCTION "public"."financeiro_source_changed"();

CREATE OR REPLACE TRIGGER "financeiro_revision" AFTER INSERT OR DELETE OR UPDATE ON "public"."regras_classificacao" FOR EACH ROW EXECUTE FUNCTION "public"."financeiro_source_changed"();

CREATE OR REPLACE TRIGGER "financeiro_revision" AFTER INSERT OR DELETE OR UPDATE ON "public"."titulos_a_pagar" FOR EACH ROW EXECUTE FUNCTION "public"."financeiro_source_changed"();

CREATE OR REPLACE TRIGGER "trg_gorjeta_cargo_pontos_updated_at" BEFORE UPDATE ON "public"."gorjeta_cargo_pontos" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();

CREATE OR REPLACE TRIGGER "trg_gorjeta_periodos_updated_at" BEFORE UPDATE ON "public"."gorjeta_periodos" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();

CREATE OR REPLACE TRIGGER "trg_ingredient_price_change" AFTER UPDATE ON "public"."ingredients" FOR EACH ROW EXECUTE FUNCTION "public"."fn_ingredient_price_change"();

CREATE OR REPLACE TRIGGER "trg_job_openings_status_prazo" BEFORE INSERT OR UPDATE ON "public"."job_openings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_recalc_status_prazo"();

CREATE OR REPLACE TRIGGER "trg_purchase_orders_updated_at" BEFORE UPDATE ON "public"."purchase_orders" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();

CREATE OR REPLACE TRIGGER "trg_recipe_items_recalc" AFTER INSERT OR DELETE OR UPDATE ON "public"."recipe_items" FOR EACH ROW EXECUTE FUNCTION "public"."fn_recalc_menu_item_custo"();

CREATE OR REPLACE TRIGGER "trg_sync_employee_tier" BEFORE INSERT OR UPDATE OF "role_id" ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."_sync_employee_tier"();

ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."candidates"
    ADD CONSTRAINT "candidates_cargo_id_fkey" FOREIGN KEY ("cargo_id") REFERENCES "public"."cargos"("id");

ALTER TABLE ONLY "public"."candidates"
    ADD CONSTRAINT "candidates_entrevistador_id_fkey" FOREIGN KEY ("entrevistador_id") REFERENCES "public"."employees"("id");

ALTER TABLE ONLY "public"."candidates"
    ADD CONSTRAINT "candidates_job_opening_id_fkey" FOREIGN KEY ("job_opening_id") REFERENCES "public"."job_openings"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."candidates"
    ADD CONSTRAINT "candidates_origem_id_fkey" FOREIGN KEY ("origem_id") REFERENCES "public"."origens_candidato"("id");

ALTER TABLE ONLY "public"."candidates"
    ADD CONSTRAINT "candidates_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "public"."employees"("id");

ALTER TABLE ONLY "public"."candidates"
    ADD CONSTRAINT "candidates_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."cargos"
    ADD CONSTRAINT "cargos_reporta_a_cargo_id_fkey" FOREIGN KEY ("reporta_a_cargo_id") REFERENCES "public"."cargos"("id");

ALTER TABLE ONLY "public"."conferencias"
    ADD CONSTRAINT "conferencias_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."contas_bancarias"
    ADD CONSTRAINT "contas_bancarias_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."contratos_arquivos"
    ADD CONSTRAINT "contratos_arquivos_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "public"."contratos"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."dre_snapshot"
    ADD CONSTRAINT "dre_snapshot_conta_codigo_fkey" FOREIGN KEY ("conta_codigo") REFERENCES "public"."plano_contas"("codigo");

ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id");

ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");

ALTER TABLE ONLY "public"."financeiro_importacoes"
    ADD CONSTRAINT "financeiro_importacoes_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "auth"."users"("id");

ALTER TABLE ONLY "public"."financeiro_importacoes"
    ADD CONSTRAINT "financeiro_importacoes_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."financeiro_revisoes"
    ADD CONSTRAINT "financeiro_revisoes_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."fornecedores_depara"
    ADD CONSTRAINT "fornecedores_depara_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedores"("id");

ALTER TABLE ONLY "public"."gorjeta_cargo_pontos"
    ADD CONSTRAINT "gorjeta_cargo_pontos_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."gorjeta_distribuicao"
    ADD CONSTRAINT "gorjeta_distribuicao_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "public"."employees"("id");

ALTER TABLE ONLY "public"."gorjeta_distribuicao"
    ADD CONSTRAINT "gorjeta_distribuicao_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."gorjeta_distribuicao"
    ADD CONSTRAINT "gorjeta_distribuicao_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."gorjeta_periodos"
    ADD CONSTRAINT "gorjeta_periodos_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."groups"("id");

ALTER TABLE ONLY "public"."ingredient_price_history"
    ADD CONSTRAINT "ingredient_price_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."ingredient_price_history"
    ADD CONSTRAINT "ingredient_price_history_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."job_openings"
    ADD CONSTRAINT "job_openings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");

ALTER TABLE ONLY "public"."job_openings"
    ADD CONSTRAINT "job_openings_cargo_grupo_id_fkey" FOREIGN KEY ("cargo_grupo_id") REFERENCES "public"."cargo_grupos"("id");

ALTER TABLE ONLY "public"."job_openings"
    ADD CONSTRAINT "job_openings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");

ALTER TABLE ONLY "public"."job_openings"
    ADD CONSTRAINT "job_openings_entrevistador_id_fkey" FOREIGN KEY ("entrevistador_id") REFERENCES "public"."employees"("id");

ALTER TABLE ONLY "public"."job_openings"
    ADD CONSTRAINT "job_openings_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "public"."employees"("id");

ALTER TABLE ONLY "public"."job_openings"
    ADD CONSTRAINT "job_openings_substituido_id_fkey" FOREIGN KEY ("substituido_id") REFERENCES "public"."employees"("id");

ALTER TABLE ONLY "public"."job_openings"
    ADD CONSTRAINT "job_openings_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."lancamentos"
    ADD CONSTRAINT "lancamentos_conta_codigo_fkey" FOREIGN KEY ("conta_codigo") REFERENCES "public"."plano_contas"("codigo");

ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."movimentacoes_caixa"
    ADD CONSTRAINT "movimentacoes_caixa_conta_codigo_fkey" FOREIGN KEY ("conta_codigo") REFERENCES "public"."plano_contas"("codigo");

ALTER TABLE ONLY "public"."movimentacoes_caixa"
    ADD CONSTRAINT "movimentacoes_caixa_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "public"."contas_bancarias"("id");

ALTER TABLE ONLY "public"."movimentacoes_caixa"
    ADD CONSTRAINT "movimentacoes_caixa_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."nfe_documentos"
    ADD CONSTRAINT "nfe_documentos_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "public"."nfe_importacoes"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."nfe_documentos"
    ADD CONSTRAINT "nfe_documentos_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."nfe_importacoes"
    ADD CONSTRAINT "nfe_importacoes_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_colaborador"
    ADD CONSTRAINT "payroll_extrato_dominio_colaborador_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_colaborador"
    ADD CONSTRAINT "payroll_extrato_dominio_colaborador_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_competencia"
    ADD CONSTRAINT "payroll_extrato_dominio_competencia_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_linha"
    ADD CONSTRAINT "payroll_extrato_dominio_linha_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_linha"
    ADD CONSTRAINT "payroll_extrato_dominio_linha_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_rubrica"
    ADD CONSTRAINT "payroll_extrato_dominio_rubrica_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."payroll_extrato_dominio_totais"
    ADD CONSTRAINT "payroll_extrato_dominio_totais_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."ponto_mensal"
    ADD CONSTRAINT "ponto_mensal_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."ponto_mensal"
    ADD CONSTRAINT "ponto_mensal_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."produtos_depara"
    ADD CONSTRAINT "produtos_depara_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos_catalogo"("id");

ALTER TABLE ONLY "public"."produtos_relatorio"
    ADD CONSTRAINT "produtos_relatorio_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "public"."financeiro_importacoes"("id");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");

ALTER TABLE ONLY "public"."protestos_registros"
    ADD CONSTRAINT "protestos_registros_certidao_id_fkey" FOREIGN KEY ("certidao_id") REFERENCES "public"."protestos_certidoes"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");

ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");

ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");

ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."recebiveis_cartao"
    ADD CONSTRAINT "recebiveis_cartao_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."receita_ambientes"
    ADD CONSTRAINT "receita_ambientes_workday_id_fk_fkey" FOREIGN KEY ("workday_id_fk") REFERENCES "public"."receita_dias"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."receita_caixas"
    ADD CONSTRAINT "receita_caixas_workday_id_fk_fkey" FOREIGN KEY ("workday_id_fk") REFERENCES "public"."receita_dias"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."receita_cancelamentos_detalhe"
    ADD CONSTRAINT "receita_cancelamentos_detalhe_workday_id_fk_fkey" FOREIGN KEY ("workday_id_fk") REFERENCES "public"."receita_dias"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."receita_cancelamentos"
    ADD CONSTRAINT "receita_cancelamentos_workday_id_fk_fkey" FOREIGN KEY ("workday_id_fk") REFERENCES "public"."receita_dias"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."receita_descontos_detalhe"
    ADD CONSTRAINT "receita_descontos_detalhe_workday_id_fk_fkey" FOREIGN KEY ("workday_id_fk") REFERENCES "public"."receita_dias"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."receita_descontos"
    ADD CONSTRAINT "receita_descontos_workday_id_fk_fkey" FOREIGN KEY ("workday_id_fk") REFERENCES "public"."receita_dias"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."receita_dias"
    ADD CONSTRAINT "receita_dias_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "public"."financeiro_importacoes"("id");

ALTER TABLE ONLY "public"."receita_dias"
    ADD CONSTRAINT "receita_dias_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."receita_grupos"
    ADD CONSTRAINT "receita_grupos_workday_id_fk_fkey" FOREIGN KEY ("workday_id_fk") REFERENCES "public"."receita_dias"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."receita_horarios"
    ADD CONSTRAINT "receita_horarios_workday_id_fk_fkey" FOREIGN KEY ("workday_id_fk") REFERENCES "public"."receita_dias"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."receita_pagamentos"
    ADD CONSTRAINT "receita_pagamentos_workday_id_fk_fkey" FOREIGN KEY ("workday_id_fk") REFERENCES "public"."receita_dias"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."receita_produtos_dia"
    ADD CONSTRAINT "receita_produtos_dia_workday_id_fk_fkey" FOREIGN KEY ("workday_id_fk") REFERENCES "public"."receita_dias"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."receita_turnos"
    ADD CONSTRAINT "receita_turnos_workday_id_fk_fkey" FOREIGN KEY ("workday_id_fk") REFERENCES "public"."receita_dias"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."receita_usuarios"
    ADD CONSTRAINT "receita_usuarios_workday_id_fk_fkey" FOREIGN KEY ("workday_id_fk") REFERENCES "public"."receita_dias"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."recipe_items"
    ADD CONSTRAINT "recipe_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."recipe_items"
    ADD CONSTRAINT "recipe_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."regras_classificacao"
    ADD CONSTRAINT "regras_classificacao_conta_codigo_fkey" FOREIGN KEY ("conta_codigo") REFERENCES "public"."plano_contas"("codigo");

ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");

ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."titulos_a_pagar"
    ADD CONSTRAINT "titulos_a_pagar_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "public"."financeiro_importacoes"("id");

ALTER TABLE ONLY "public"."unit_cnpjs"
    ADD CONSTRAINT "unit_cnpjs_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id");

ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id");

ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."vendas_consolidado_ambiente"
    ADD CONSTRAINT "vendas_consolidado_ambiente_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."vendas_consolidado_periodo"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."vendas_consolidado_dia_semana"
    ADD CONSTRAINT "vendas_consolidado_dia_semana_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."vendas_consolidado_periodo"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."vendas_consolidado_funcionarios"
    ADD CONSTRAINT "vendas_consolidado_funcionarios_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."vendas_consolidado_periodo"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."vendas_consolidado_mensal"
    ADD CONSTRAINT "vendas_consolidado_mensal_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."vendas_consolidado_periodo"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."vendas_consolidado_produtos"
    ADD CONSTRAINT "vendas_consolidado_produtos_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."vendas_consolidado_periodo"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."vendas_consolidado_resumo"
    ADD CONSTRAINT "vendas_consolidado_resumo_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."vendas_consolidado_periodo"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."vendas_consolidado_turno"
    ADD CONSTRAINT "vendas_consolidado_turno_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."vendas_consolidado_periodo"("id") ON DELETE CASCADE;

ALTER TABLE "public"."brands" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."candidates" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cargo_grupos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cargos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."conferencias" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."contas_bancarias" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."contratos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."contratos_arquivos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_contratos_fixos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_despesa_detalhada" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_faturamento_historico" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_folha" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_gorjeta_mensal" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_indicadores" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_kpis_mensais" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_linhas_detalhadas" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_manutencao_detalhada" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_mensal" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_pessoal_detalhado" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_prestadores" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_receita_detalhada" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dre_snapshot" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "financeiro_delete" ON "public"."conferencias" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."contas_bancarias" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."contratos" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."contratos_arquivos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."contratos" "p"
  WHERE (("p"."id" = "contratos_arquivos"."contrato_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."dre_contratos_fixos" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."dre_despesa_detalhada" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."dre_faturamento_historico" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."dre_folha" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."dre_gorjeta_mensal" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."dre_indicadores" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."dre_kpis_mensais" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."dre_linhas_detalhadas" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."dre_manutencao_detalhada" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."dre_mensal" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."dre_pessoal_detalhado" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."dre_prestadores" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."dre_receita_detalhada" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."dre_snapshot" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."financeiro_importacoes" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."fornecedores" FOR DELETE TO "authenticated" USING ("public"."kph_is_founder"());

CREATE POLICY "financeiro_delete" ON "public"."fornecedores_depara" FOR DELETE TO "authenticated" USING ("public"."kph_is_founder"());

CREATE POLICY "financeiro_delete" ON "public"."kpi_snapshot" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."lancamentos" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."mapa_conta_dre" FOR DELETE TO "authenticated" USING ("public"."kph_is_founder"());

CREATE POLICY "financeiro_delete" ON "public"."metas" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."movimentacoes_caixa" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."nfe_documentos" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."nfe_importacoes" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."payroll_extrato_dominio_colaborador" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."payroll_extrato_dominio_competencia" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."payroll_extrato_dominio_linha" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."payroll_extrato_dominio_rubrica" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."payroll_extrato_dominio_totais" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."plano_contas" FOR DELETE TO "authenticated" USING ("public"."kph_is_founder"());

CREATE POLICY "financeiro_delete" ON "public"."produtos_catalogo" FOR DELETE TO "authenticated" USING ("public"."kph_is_founder"());

CREATE POLICY "financeiro_delete" ON "public"."produtos_depara" FOR DELETE TO "authenticated" USING ("public"."kph_is_founder"());

CREATE POLICY "financeiro_delete" ON "public"."produtos_relatorio" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."protestos_certidoes" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."protestos_registros" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."protestos_certidoes" "p"
  WHERE (("p"."id" = "protestos_registros"."certidao_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."recebiveis_cartao" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."receita_ambientes" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_ambientes"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."receita_caixas" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_caixas"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."receita_cancelamentos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_cancelamentos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."receita_cancelamentos_detalhe" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_cancelamentos_detalhe"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."receita_descontos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_descontos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."receita_descontos_detalhe" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_descontos_detalhe"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."receita_dias" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."receita_grupos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_grupos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."receita_horarios" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_horarios"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."receita_pagamentos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_pagamentos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."receita_produtos_dia" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_produtos_dia"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."receita_turnos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_turnos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."receita_usuarios" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_usuarios"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."reconciliacoes_sugeridas" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."regras_classificacao" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."titulo_override" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."titulos_a_pagar" "p"
  WHERE (("p"."id" = "titulo_override"."titulo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."titulos_a_pagar" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."unit_cnpjs" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."vendas_consolidado_ambiente" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_ambiente"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."vendas_consolidado_dia_semana" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_dia_semana"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."vendas_consolidado_funcionarios" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_funcionarios"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."vendas_consolidado_mensal" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_mensal"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."vendas_consolidado_periodo" FOR DELETE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_delete" ON "public"."vendas_consolidado_produtos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_produtos"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."vendas_consolidado_resumo" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_resumo"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_delete" ON "public"."vendas_consolidado_turno" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_turno"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

ALTER TABLE "public"."financeiro_importacoes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "financeiro_insert" ON "public"."conferencias" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."contas_bancarias" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."contratos" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."contratos_arquivos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."contratos" "p"
  WHERE (("p"."id" = "contratos_arquivos"."contrato_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."dre_contratos_fixos" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."dre_despesa_detalhada" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."dre_faturamento_historico" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."dre_folha" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."dre_gorjeta_mensal" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."dre_indicadores" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."dre_kpis_mensais" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."dre_linhas_detalhadas" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."dre_manutencao_detalhada" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."dre_mensal" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."dre_pessoal_detalhado" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."dre_prestadores" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."dre_receita_detalhada" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."dre_snapshot" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."financeiro_importacoes" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."fornecedores" FOR INSERT TO "authenticated" WITH CHECK ("public"."kph_is_founder"());

CREATE POLICY "financeiro_insert" ON "public"."fornecedores_depara" FOR INSERT TO "authenticated" WITH CHECK ("public"."kph_is_founder"());

CREATE POLICY "financeiro_insert" ON "public"."kpi_snapshot" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."lancamentos" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."mapa_conta_dre" FOR INSERT TO "authenticated" WITH CHECK ("public"."kph_is_founder"());

CREATE POLICY "financeiro_insert" ON "public"."metas" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."movimentacoes_caixa" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."nfe_documentos" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."nfe_importacoes" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."payroll_extrato_dominio_colaborador" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."payroll_extrato_dominio_competencia" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."payroll_extrato_dominio_linha" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."payroll_extrato_dominio_rubrica" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."payroll_extrato_dominio_totais" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."plano_contas" FOR INSERT TO "authenticated" WITH CHECK ("public"."kph_is_founder"());

CREATE POLICY "financeiro_insert" ON "public"."produtos_catalogo" FOR INSERT TO "authenticated" WITH CHECK ("public"."kph_is_founder"());

CREATE POLICY "financeiro_insert" ON "public"."produtos_depara" FOR INSERT TO "authenticated" WITH CHECK ("public"."kph_is_founder"());

CREATE POLICY "financeiro_insert" ON "public"."produtos_relatorio" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."protestos_certidoes" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."protestos_registros" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."protestos_certidoes" "p"
  WHERE (("p"."id" = "protestos_registros"."certidao_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."recebiveis_cartao" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."receita_ambientes" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_ambientes"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."receita_caixas" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_caixas"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."receita_cancelamentos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_cancelamentos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."receita_cancelamentos_detalhe" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_cancelamentos_detalhe"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."receita_descontos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_descontos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."receita_descontos_detalhe" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_descontos_detalhe"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."receita_dias" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."receita_grupos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_grupos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."receita_horarios" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_horarios"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."receita_pagamentos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_pagamentos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."receita_produtos_dia" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_produtos_dia"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."receita_turnos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_turnos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."receita_usuarios" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_usuarios"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."reconciliacoes_sugeridas" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."regras_classificacao" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."titulo_override" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."titulos_a_pagar" "p"
  WHERE (("p"."id" = "titulo_override"."titulo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."titulos_a_pagar" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."unit_cnpjs" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."vendas_consolidado_ambiente" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_ambiente"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."vendas_consolidado_dia_semana" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_dia_semana"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."vendas_consolidado_funcionarios" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_funcionarios"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."vendas_consolidado_mensal" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_mensal"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."vendas_consolidado_periodo" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_insert" ON "public"."vendas_consolidado_produtos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_produtos"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."vendas_consolidado_resumo" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_resumo"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_insert" ON "public"."vendas_consolidado_turno" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_turno"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."conferencias" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."contas_bancarias" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."contratos" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."contratos_arquivos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."contratos" "p"
  WHERE (("p"."id" = "contratos_arquivos"."contrato_id") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."dre_contratos_fixos" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."dre_despesa_detalhada" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."dre_faturamento_historico" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."dre_folha" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."dre_gorjeta_mensal" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."dre_indicadores" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."dre_kpis_mensais" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."dre_linhas_detalhadas" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."dre_manutencao_detalhada" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."dre_mensal" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."dre_pessoal_detalhado" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."dre_prestadores" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."dre_receita_detalhada" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."dre_snapshot" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."financeiro_importacoes" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."fornecedores" FOR SELECT TO "authenticated" USING ("public"."financeiro_has_membership"());

CREATE POLICY "financeiro_read" ON "public"."fornecedores_depara" FOR SELECT TO "authenticated" USING ("public"."financeiro_has_membership"());

CREATE POLICY "financeiro_read" ON "public"."kpi_snapshot" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."lancamentos" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."mapa_conta_dre" FOR SELECT TO "authenticated" USING ("public"."financeiro_has_membership"());

CREATE POLICY "financeiro_read" ON "public"."metas" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."movimentacoes_caixa" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."nfe_documentos" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."nfe_importacoes" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."payroll_extrato_dominio_colaborador" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."payroll_extrato_dominio_competencia" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."payroll_extrato_dominio_linha" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."payroll_extrato_dominio_rubrica" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."payroll_extrato_dominio_totais" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."plano_contas" FOR SELECT TO "authenticated" USING ("public"."financeiro_has_membership"());

CREATE POLICY "financeiro_read" ON "public"."produtos_catalogo" FOR SELECT TO "authenticated" USING ("public"."financeiro_has_membership"());

CREATE POLICY "financeiro_read" ON "public"."produtos_depara" FOR SELECT TO "authenticated" USING ("public"."financeiro_has_membership"());

CREATE POLICY "financeiro_read" ON "public"."produtos_relatorio" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."protestos_certidoes" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."protestos_registros" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."protestos_certidoes" "p"
  WHERE (("p"."id" = "protestos_registros"."certidao_id") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."recebiveis_cartao" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."receita_ambientes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_ambientes"."workday_id_fk") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."receita_caixas" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_caixas"."workday_id_fk") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."receita_cancelamentos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_cancelamentos"."workday_id_fk") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."receita_cancelamentos_detalhe" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_cancelamentos_detalhe"."workday_id_fk") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."receita_descontos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_descontos"."workday_id_fk") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."receita_descontos_detalhe" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_descontos_detalhe"."workday_id_fk") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."receita_dias" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."receita_grupos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_grupos"."workday_id_fk") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."receita_horarios" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_horarios"."workday_id_fk") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."receita_pagamentos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_pagamentos"."workday_id_fk") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."receita_produtos_dia" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_produtos_dia"."workday_id_fk") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."receita_turnos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_turnos"."workday_id_fk") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."receita_usuarios" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_usuarios"."workday_id_fk") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."reconciliacoes_sugeridas" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."regras_classificacao" FOR SELECT TO "authenticated" USING (("public"."financeiro_can_read"("unit_id") OR (("unit_id" IS NULL) AND "public"."financeiro_has_membership"())));

CREATE POLICY "financeiro_read" ON "public"."titulo_override" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."titulos_a_pagar" "p"
  WHERE (("p"."id" = "titulo_override"."titulo_id") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."titulos_a_pagar" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."unit_cnpjs" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."vendas_consolidado_ambiente" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_ambiente"."periodo_id") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."vendas_consolidado_dia_semana" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_dia_semana"."periodo_id") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."vendas_consolidado_funcionarios" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_funcionarios"."periodo_id") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."vendas_consolidado_mensal" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_mensal"."periodo_id") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."vendas_consolidado_periodo" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_read" ON "public"."vendas_consolidado_produtos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_produtos"."periodo_id") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."vendas_consolidado_resumo" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_resumo"."periodo_id") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_read" ON "public"."vendas_consolidado_turno" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_turno"."periodo_id") AND "public"."financeiro_can_read"("p"."unit_id")))));

CREATE POLICY "financeiro_revision_insert" ON "public"."financeiro_revisoes" FOR INSERT TO "authenticated" WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_revision_read" ON "public"."financeiro_revisoes" FOR SELECT TO "authenticated" USING ("public"."financeiro_can_read"("unit_id"));

CREATE POLICY "financeiro_revision_update" ON "public"."financeiro_revisoes" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

ALTER TABLE "public"."financeiro_revisoes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "financeiro_update" ON "public"."conferencias" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."contas_bancarias" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."contratos" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."contratos_arquivos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."contratos" "p"
  WHERE (("p"."id" = "contratos_arquivos"."contrato_id") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."contratos" "p"
  WHERE (("p"."id" = "contratos_arquivos"."contrato_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."dre_contratos_fixos" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."dre_despesa_detalhada" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."dre_faturamento_historico" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."dre_folha" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."dre_gorjeta_mensal" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."dre_indicadores" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."dre_kpis_mensais" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."dre_linhas_detalhadas" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."dre_manutencao_detalhada" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."dre_mensal" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."dre_pessoal_detalhado" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."dre_prestadores" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."dre_receita_detalhada" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."dre_snapshot" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."financeiro_importacoes" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."fornecedores" FOR UPDATE TO "authenticated" USING ("public"."kph_is_founder"()) WITH CHECK ("public"."kph_is_founder"());

CREATE POLICY "financeiro_update" ON "public"."fornecedores_depara" FOR UPDATE TO "authenticated" USING ("public"."kph_is_founder"()) WITH CHECK ("public"."kph_is_founder"());

CREATE POLICY "financeiro_update" ON "public"."kpi_snapshot" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."lancamentos" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."mapa_conta_dre" FOR UPDATE TO "authenticated" USING ("public"."kph_is_founder"()) WITH CHECK ("public"."kph_is_founder"());

CREATE POLICY "financeiro_update" ON "public"."metas" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."movimentacoes_caixa" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."nfe_documentos" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."nfe_importacoes" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."payroll_extrato_dominio_colaborador" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."payroll_extrato_dominio_competencia" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."payroll_extrato_dominio_linha" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."payroll_extrato_dominio_rubrica" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."payroll_extrato_dominio_totais" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."plano_contas" FOR UPDATE TO "authenticated" USING ("public"."kph_is_founder"()) WITH CHECK ("public"."kph_is_founder"());

CREATE POLICY "financeiro_update" ON "public"."produtos_catalogo" FOR UPDATE TO "authenticated" USING ("public"."kph_is_founder"()) WITH CHECK ("public"."kph_is_founder"());

CREATE POLICY "financeiro_update" ON "public"."produtos_depara" FOR UPDATE TO "authenticated" USING ("public"."kph_is_founder"()) WITH CHECK ("public"."kph_is_founder"());

CREATE POLICY "financeiro_update" ON "public"."produtos_relatorio" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."protestos_certidoes" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."protestos_registros" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."protestos_certidoes" "p"
  WHERE (("p"."id" = "protestos_registros"."certidao_id") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."protestos_certidoes" "p"
  WHERE (("p"."id" = "protestos_registros"."certidao_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."recebiveis_cartao" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."receita_ambientes" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_ambientes"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_ambientes"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."receita_caixas" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_caixas"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_caixas"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."receita_cancelamentos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_cancelamentos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_cancelamentos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."receita_cancelamentos_detalhe" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_cancelamentos_detalhe"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_cancelamentos_detalhe"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."receita_descontos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_descontos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_descontos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."receita_descontos_detalhe" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_descontos_detalhe"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_descontos_detalhe"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."receita_dias" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."receita_grupos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_grupos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_grupos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."receita_horarios" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_horarios"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_horarios"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."receita_pagamentos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_pagamentos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_pagamentos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."receita_produtos_dia" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_produtos_dia"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_produtos_dia"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."receita_turnos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_turnos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_turnos"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."receita_usuarios" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_usuarios"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."receita_dias" "p"
  WHERE (("p"."id" = "receita_usuarios"."workday_id_fk") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."reconciliacoes_sugeridas" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."regras_classificacao" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."titulo_override" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."titulos_a_pagar" "p"
  WHERE (("p"."id" = "titulo_override"."titulo_id") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."titulos_a_pagar" "p"
  WHERE (("p"."id" = "titulo_override"."titulo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."titulos_a_pagar" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."unit_cnpjs" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."vendas_consolidado_ambiente" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_ambiente"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_ambiente"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."vendas_consolidado_dia_semana" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_dia_semana"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_dia_semana"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."vendas_consolidado_funcionarios" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_funcionarios"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_funcionarios"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."vendas_consolidado_mensal" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_mensal"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_mensal"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."vendas_consolidado_periodo" FOR UPDATE TO "authenticated" USING ("public"."financeiro_can_write"("unit_id")) WITH CHECK ("public"."financeiro_can_write"("unit_id"));

CREATE POLICY "financeiro_update" ON "public"."vendas_consolidado_produtos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_produtos"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_produtos"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."vendas_consolidado_resumo" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_resumo"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_resumo"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

CREATE POLICY "financeiro_update" ON "public"."vendas_consolidado_turno" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_turno"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendas_consolidado_periodo" "p"
  WHERE (("p"."id" = "vendas_consolidado_turno"."periodo_id") AND "public"."financeiro_can_write"("p"."unit_id")))));

ALTER TABLE "public"."fornecedores" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."fornecedores_depara" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."gorjeta_cargo_pontos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."gorjeta_distribuicao" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."gorjeta_periodos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."groups" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ingredient_price_history" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ingredients" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."job_openings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."kpi_snapshot" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."lancamentos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."mapa_conta_dre" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."menu_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."metas" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."metas_dia_override" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."metas_dia_semana" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."movimentacoes_caixa" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."nfe_documentos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."nfe_importacoes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."origens_candidato" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."payroll_extrato_dominio_colaborador" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."payroll_extrato_dominio_competencia" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."payroll_extrato_dominio_linha" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."payroll_extrato_dominio_rubrica" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."payroll_extrato_dominio_totais" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."payslips" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."plano_contas" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ponto_mensal" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."produtos_catalogo" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."produtos_depara" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."produtos_relatorio" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."protestos_certidoes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."protestos_registros" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."purchase_orders" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."recebiveis_cartao" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_ambientes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_caixas" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_cancelamentos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_cancelamentos_detalhe" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_descontos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_descontos_detalhe" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_dias" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_grupos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_horarios" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_import_log" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_pagamentos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_produtos_dia" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_turnos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."receita_usuarios" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."recipe_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."reconciliacoes_sugeridas" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."regras_classificacao" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."titulo_override" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."titulos_a_pagar" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."unit_cnpjs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."units" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."vendas_consolidado_ambiente" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."vendas_consolidado_dia_semana" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."vendas_consolidado_funcionarios" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."vendas_consolidado_mensal" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."vendas_consolidado_periodo" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."vendas_consolidado_produtos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."vendas_consolidado_resumo" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."vendas_consolidado_turno" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."brands" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."candidates" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."cargo_grupos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."cargos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."conferencias" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."contas_bancarias" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."contratos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."contratos_arquivos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_contratos_fixos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_despesa_detalhada" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_faturamento_historico" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_folha" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_gorjeta_mensal" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_indicadores" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_kpis_mensais" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_linhas_detalhadas" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_manutencao_detalhada" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_mensal" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_pessoal_detalhado" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_prestadores" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_receita_detalhada" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dre_snapshot" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."employees" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."financeiro_importacoes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."financeiro_revisoes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fornecedores" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fornecedores_depara" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."gorjeta_cargo_pontos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."gorjeta_distribuicao" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."gorjeta_periodos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."groups" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."ingredient_price_history" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."ingredients" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."job_openings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."kpi_snapshot" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."lancamentos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."mapa_conta_dre" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."menu_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."metas" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."metas_dia_override" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."metas_dia_semana" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."metas_projecoes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."movimentacoes_caixa" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."nfe_documentos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."nfe_importacoes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."origens_candidato" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."payroll_extrato_dominio_colaborador" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."payroll_extrato_dominio_competencia" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."payroll_extrato_dominio_linha" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."payroll_extrato_dominio_rubrica" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."payroll_extrato_dominio_totais" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."payslips" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."plano_contas" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."ponto_mensal" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."produtos_catalogo" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."produtos_depara" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."produtos_relatorio" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."profiles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."protestos_certidoes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."protestos_registros" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."purchase_orders" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."recebiveis_cartao" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_ambientes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_caixas" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_cancelamentos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_cancelamentos_detalhe" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_descontos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_descontos_detalhe" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_dias" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_grupos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_horarios" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_import_log" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_pagamentos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_produtos_dia" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_turnos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receita_usuarios" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."recipe_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."reconciliacoes_sugeridas" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."regras_classificacao" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."roles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."suppliers" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."titulo_override" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."titulos_a_pagar" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."unit_cnpjs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."units" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."user_roles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."vendas_consolidado_ambiente" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."vendas_consolidado_dia_semana" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."vendas_consolidado_funcionarios" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."vendas_consolidado_mensal" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."vendas_consolidado_periodo" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."vendas_consolidado_produtos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."vendas_consolidado_resumo" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."vendas_consolidado_turno" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."vendas_diarias" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

CREATE POLICY own_roles ON public.user_roles FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.kph_is_founder());

CREATE POLICY read_roles ON public.roles FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY own_profile ON public.profiles FOR SELECT TO authenticated USING (id=auth.uid() OR public.kph_is_founder());

CREATE POLICY accessible_units ON public.units FOR SELECT TO authenticated USING (public.kph_is_founder() OR id IN (SELECT public.kph_accessible_unit_ids()));

CREATE POLICY accessible_brands ON public.brands FOR SELECT TO authenticated USING (public.kph_is_founder() OR id IN (SELECT brand_id FROM public.units));

CREATE POLICY accessible_groups ON public.groups FOR SELECT TO authenticated USING (public.kph_is_founder() OR id IN (SELECT group_id FROM public.brands));

CREATE POLICY ork_read ON public."candidates" FOR SELECT TO authenticated USING (public.financeiro_can_read(unit_id));

CREATE POLICY ork_insert ON public."candidates" FOR INSERT TO authenticated WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_update ON public."candidates" FOR UPDATE TO authenticated USING (public.financeiro_can_write(unit_id)) WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_delete ON public."candidates" FOR DELETE TO authenticated USING (public.financeiro_can_write(unit_id));

CREATE POLICY ork_read ON public."cargo_grupos" FOR SELECT TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_insert ON public."cargo_grupos" FOR INSERT TO authenticated WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_update ON public."cargo_grupos" FOR UPDATE TO authenticated USING (public.kph_is_founder()) WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_delete ON public."cargo_grupos" FOR DELETE TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_read ON public."cargos" FOR SELECT TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_insert ON public."cargos" FOR INSERT TO authenticated WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_update ON public."cargos" FOR UPDATE TO authenticated USING (public.kph_is_founder()) WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_delete ON public."cargos" FOR DELETE TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_read ON public."employees" FOR SELECT TO authenticated USING (public.financeiro_can_read(unit_id));

CREATE POLICY ork_insert ON public."employees" FOR INSERT TO authenticated WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_update ON public."employees" FOR UPDATE TO authenticated USING (public.financeiro_can_write(unit_id)) WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_delete ON public."employees" FOR DELETE TO authenticated USING (public.financeiro_can_write(unit_id));

CREATE POLICY ork_read ON public."gorjeta_cargo_pontos" FOR SELECT TO authenticated USING (public.financeiro_can_read(unit_id));

CREATE POLICY ork_insert ON public."gorjeta_cargo_pontos" FOR INSERT TO authenticated WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_update ON public."gorjeta_cargo_pontos" FOR UPDATE TO authenticated USING (public.financeiro_can_write(unit_id)) WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_delete ON public."gorjeta_cargo_pontos" FOR DELETE TO authenticated USING (public.financeiro_can_write(unit_id));

CREATE POLICY ork_read ON public."gorjeta_distribuicao" FOR SELECT TO authenticated USING (public.financeiro_can_read(unit_id));

CREATE POLICY ork_insert ON public."gorjeta_distribuicao" FOR INSERT TO authenticated WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_update ON public."gorjeta_distribuicao" FOR UPDATE TO authenticated USING (public.financeiro_can_write(unit_id)) WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_delete ON public."gorjeta_distribuicao" FOR DELETE TO authenticated USING (public.financeiro_can_write(unit_id));

CREATE POLICY ork_read ON public."gorjeta_periodos" FOR SELECT TO authenticated USING (public.financeiro_can_read(unit_id));

CREATE POLICY ork_insert ON public."gorjeta_periodos" FOR INSERT TO authenticated WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_update ON public."gorjeta_periodos" FOR UPDATE TO authenticated USING (public.financeiro_can_write(unit_id)) WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_delete ON public."gorjeta_periodos" FOR DELETE TO authenticated USING (public.financeiro_can_write(unit_id));

CREATE POLICY ork_read ON public."ingredient_price_history" FOR SELECT TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_insert ON public."ingredient_price_history" FOR INSERT TO authenticated WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_update ON public."ingredient_price_history" FOR UPDATE TO authenticated USING (public.kph_is_founder()) WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_delete ON public."ingredient_price_history" FOR DELETE TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_read ON public."ingredients" FOR SELECT TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_insert ON public."ingredients" FOR INSERT TO authenticated WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_update ON public."ingredients" FOR UPDATE TO authenticated USING (public.kph_is_founder()) WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_delete ON public."ingredients" FOR DELETE TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_read ON public."job_openings" FOR SELECT TO authenticated USING (public.financeiro_can_read(unit_id));

CREATE POLICY ork_insert ON public."job_openings" FOR INSERT TO authenticated WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_update ON public."job_openings" FOR UPDATE TO authenticated USING (public.financeiro_can_write(unit_id)) WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_delete ON public."job_openings" FOR DELETE TO authenticated USING (public.financeiro_can_write(unit_id));

CREATE POLICY ork_read ON public."menu_items" FOR SELECT TO authenticated USING (public.financeiro_can_read(unit_id));

CREATE POLICY ork_insert ON public."menu_items" FOR INSERT TO authenticated WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_update ON public."menu_items" FOR UPDATE TO authenticated USING (public.financeiro_can_write(unit_id)) WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_delete ON public."menu_items" FOR DELETE TO authenticated USING (public.financeiro_can_write(unit_id));

CREATE POLICY ork_read ON public."metas_dia_override" FOR SELECT TO authenticated USING (public.financeiro_can_read(unit_id));

CREATE POLICY ork_insert ON public."metas_dia_override" FOR INSERT TO authenticated WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_update ON public."metas_dia_override" FOR UPDATE TO authenticated USING (public.financeiro_can_write(unit_id)) WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_delete ON public."metas_dia_override" FOR DELETE TO authenticated USING (public.financeiro_can_write(unit_id));

CREATE POLICY ork_read ON public."metas_dia_semana" FOR SELECT TO authenticated USING (public.financeiro_can_read(unit_id));

CREATE POLICY ork_insert ON public."metas_dia_semana" FOR INSERT TO authenticated WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_update ON public."metas_dia_semana" FOR UPDATE TO authenticated USING (public.financeiro_can_write(unit_id)) WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_delete ON public."metas_dia_semana" FOR DELETE TO authenticated USING (public.financeiro_can_write(unit_id));

CREATE POLICY ork_read ON public."metas_projecoes" FOR SELECT TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_insert ON public."metas_projecoes" FOR INSERT TO authenticated WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_update ON public."metas_projecoes" FOR UPDATE TO authenticated USING (public.kph_is_founder()) WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_delete ON public."metas_projecoes" FOR DELETE TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_read ON public."origens_candidato" FOR SELECT TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_insert ON public."origens_candidato" FOR INSERT TO authenticated WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_update ON public."origens_candidato" FOR UPDATE TO authenticated USING (public.kph_is_founder()) WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_delete ON public."origens_candidato" FOR DELETE TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_read ON public."payslips" FOR SELECT TO authenticated USING (public.financeiro_can_read(unit_id));

CREATE POLICY ork_insert ON public."payslips" FOR INSERT TO authenticated WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_update ON public."payslips" FOR UPDATE TO authenticated USING (public.financeiro_can_write(unit_id)) WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_delete ON public."payslips" FOR DELETE TO authenticated USING (public.financeiro_can_write(unit_id));

CREATE POLICY ork_read ON public."ponto_mensal" FOR SELECT TO authenticated USING (public.financeiro_can_read(unit_id));

CREATE POLICY ork_insert ON public."ponto_mensal" FOR INSERT TO authenticated WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_update ON public."ponto_mensal" FOR UPDATE TO authenticated USING (public.financeiro_can_write(unit_id)) WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_delete ON public."ponto_mensal" FOR DELETE TO authenticated USING (public.financeiro_can_write(unit_id));

CREATE POLICY ork_read ON public."purchase_orders" FOR SELECT TO authenticated USING (public.financeiro_can_read(unit_id));

CREATE POLICY ork_insert ON public."purchase_orders" FOR INSERT TO authenticated WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_update ON public."purchase_orders" FOR UPDATE TO authenticated USING (public.financeiro_can_write(unit_id)) WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_delete ON public."purchase_orders" FOR DELETE TO authenticated USING (public.financeiro_can_write(unit_id));

CREATE POLICY ork_read ON public."receita_import_log" FOR SELECT TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_insert ON public."receita_import_log" FOR INSERT TO authenticated WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_update ON public."receita_import_log" FOR UPDATE TO authenticated USING (public.kph_is_founder()) WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_delete ON public."receita_import_log" FOR DELETE TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_read ON public."recipe_items" FOR SELECT TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_insert ON public."recipe_items" FOR INSERT TO authenticated WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_update ON public."recipe_items" FOR UPDATE TO authenticated USING (public.kph_is_founder()) WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_delete ON public."recipe_items" FOR DELETE TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_read ON public."suppliers" FOR SELECT TO authenticated USING (public.financeiro_can_read(unit_id));

CREATE POLICY ork_insert ON public."suppliers" FOR INSERT TO authenticated WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_update ON public."suppliers" FOR UPDATE TO authenticated USING (public.financeiro_can_write(unit_id)) WITH CHECK (public.financeiro_can_write(unit_id));

CREATE POLICY ork_delete ON public."suppliers" FOR DELETE TO authenticated USING (public.financeiro_can_write(unit_id));

CREATE POLICY ork_read ON public."vendas_diarias" FOR SELECT TO authenticated USING (public.kph_is_founder());

CREATE POLICY ork_insert ON public."vendas_diarias" FOR INSERT TO authenticated WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_update ON public."vendas_diarias" FOR UPDATE TO authenticated USING (public.kph_is_founder()) WITH CHECK (public.kph_is_founder());

CREATE POLICY ork_delete ON public."vendas_diarias" FOR DELETE TO authenticated USING (public.kph_is_founder());

ALTER VIEW public."v_fonte_saude" SET (security_invoker=true);
