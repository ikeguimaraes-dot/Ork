// Tipos do schema Supabase do ORK.
//
// Mantido manualmente — quando o schema crescer, considerar gerar via
// `supabase gen types typescript`. Por enquanto, single source of truth aqui.

export type RoleName =
  | "founder"
  | "cfo"
  | "gm"
  | "pessoas"
  | "chef"
  | "comprador"
  | "colaborador"
  | "socio_readonly"
  | "comercial"
  | "operacional";

export type BrandLinkKind =
  | "drive"
  | "dashboard"
  | "instagram"
  | "site"
  | "report"
  | "other";

// ── Fase E2 / Eventos (O.S.) ───────────────────────────────────
// Migration 011_events_expand expandiu o enum event_status com
// 'confirmado' e 'realizado' (paridade HOS legado).
export type EventStatus =
  | "rascunho"
  | "pendente_aprovacao"
  | "aprovado"
  | "confirmado"
  | "em_andamento"
  | "realizado"
  | "concluido"
  | "cancelado";

export type MenuItemCategory =
  | "bar"
  | "cozinha"
  | "bebida_alcoolica"
  | "bebida_nao_alcoolica"
  | "entrada"
  | "prato_principal"
  | "sobremesa"
  | "outros";

// ── Fase E4 / Financeiro ───────────────────────────────────────
export type LancamentoNatureza = "receita" | "despesa";

export type LancamentoRegime = "caixa" | "competencia";

export type LancamentoStatus =
  | "rascunho"
  | "pendente_aprovacao"
  | "aprovado"
  | "rejeitado"
  | "pago"
  | "cancelado";

export type CategoriaReceita =
  | "vendas_salao"
  | "vendas_delivery"
  | "vendas_bar"
  | "eventos_private_dining"
  | "gorjeta"
  | "outras_receitas";

export type CategoriaDespesa =
  // CMV
  | "cmv_cozinha"
  | "cmv_bar"
  | "cmv_delivery"
  // Folha
  | "folha_salarios"
  | "folha_encargos"
  | "folha_beneficios"
  | "folha_gorjeta_repasse"
  // Ocupação
  | "aluguel"
  | "condominio"
  | "iptu"
  // Utilidades
  | "energia_eletrica"
  | "gas"
  | "agua"
  | "telefone_internet"
  // Operacional
  | "manutencao"
  | "limpeza_higiene"
  | "uniformes_epi"
  | "descartaveis_embalagens"
  // Comercial
  | "marketing_publicidade"
  | "delivery_taxas_plataforma"
  | "comissoes"
  // Administrativo
  | "contabilidade"
  | "juridico"
  | "seguros"
  | "software_sistemas"
  | "cartao_taxas"
  // Tributos
  | "pis_cofins"
  | "irpj_csll"
  | "iss"
  | "outros_tributos"
  // Capex
  | "depreciacao"
  | "investimento_capex"
  // Outros
  | "outras_despesas";

export type ApprovalStatus = "pendente" | "aprovado" | "rejeitado";
export type FinancialPeriodStatus = "aberto" | "fechado" | "revisao";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      groups: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          created_at?: string;
        };
      };
      brands: {
        Row: {
          id: string;
          group_id: string | null;
          name: string;
          slug: string;
          color: string;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          group_id?: string | null;
          name: string;
          slug: string;
          color?: string;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string | null;
          name?: string;
          slug?: string;
          color?: string;
          active?: boolean;
          created_at?: string;
        };
      };
      units: {
        Row: {
          id: string;
          brand_id: string | null;
          name: string;
          address: string | null;
          whatsapp_number: string | null;
          cnpj: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          brand_id?: string | null;
          name: string;
          address?: string | null;
          whatsapp_number?: string | null;
          cnpj?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          brand_id?: string | null;
          name?: string;
          address?: string | null;
          whatsapp_number?: string | null;
          cnpj?: string | null;
          active?: boolean;
          created_at?: string;
        };
      };
      brand_links: {
        Row: {
          id: string;
          brand_id: string;
          kind: BrandLinkKind;
          url: string;
          label: string | null;
          ordem: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          brand_id: string;
          kind: BrandLinkKind;
          url: string;
          label?: string | null;
          ordem?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          brand_id?: string;
          kind?: BrandLinkKind;
          url?: string;
          label?: string | null;
          ordem?: number;
          created_at?: string;
        };
      };
      roles: {
        Row: {
          id: string;
          name: RoleName;
          description: string | null;
        };
        Insert: {
          id?: string;
          name: RoleName;
          description?: string | null;
        };
        Update: {
          id?: string;
          name?: RoleName;
          description?: string | null;
        };
      };
      user_roles: {
        Row: {
          id: string;
          user_id: string;
          role_id: string;
          unit_id: string | null;
          brand_id: string | null;
          group_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role_id: string;
          unit_id?: string | null;
          brand_id?: string | null;
          group_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          role_id?: string;
          unit_id?: string | null;
          brand_id?: string | null;
          group_id?: string | null;
          created_at?: string;
        };
      };
      audit_log: {
        Row: {
          id: string;
          user_id: string | null;
          action: string;
          resource: string;
          resource_id: string | null;
          old_data: Json | null;
          new_data: Json | null;
          ip_address: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          action: string;
          resource: string;
          resource_id?: string | null;
          old_data?: Json | null;
          new_data?: Json | null;
          ip_address?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          action?: string;
          resource?: string;
          resource_id?: string | null;
          old_data?: Json | null;
          new_data?: Json | null;
          ip_address?: string | null;
          created_at?: string;
        };
      };
      // ── Fase 1 / Pessoas ──────────────────────────────────────
      employees: {
        // Migration 011 (HOS RH): adicionou 23 colunas operacionais —
        // employee_code, esocial_code, nome_social, dados de nascimento,
        // contrato/jornada, contato, emergência, eleitoral, RNE, status_rh,
        // score, ctps_expedicao.
        Row: {
          id: string;
          unit_id: string;
          user_id: string | null;
          nome: string;
          sobrenome: string;
          cpf: string | null;
          ctps: string | null;
          ctps_serie: string | null;
          ctps_uf: string | null;
          ctps_expedicao: string | null;
          rg: string | null;
          rg_orgao: string | null;
          rg_uf: string | null;
          pis: string | null;
          titulo_eleitor: string | null;
          zona_eleitoral: string | null;
          secao_eleitoral: string | null;
          reservista: string | null;
          rne: string | null;
          rne_orgao: string | null;
          rne_expedicao: string | null;
          rua: string | null;
          numero: string | null;
          complemento: string | null;
          bairro: string | null;
          cidade: string | null;
          estado: string | null;
          cep: string | null;
          escolaridade: string | null;
          raca: string | null;
          genero: string | null;
          nome_mae: string | null;
          nome_pai: string | null;
          departamento: string | null;
          funcao: string;
          salario_base: string;
          data_admissao: string;
          data_demissao: string | null;
          ativo: boolean;
          banco: string | null;
          agencia: string | null;
          conta: string | null;
          tipo_conta: string | null;
          pix: string | null;
          // ─ HOS RH expansion ─
          employee_code: string | null;
          esocial_code: string | null;
          nome_social: string | null;
          data_nascimento: string | null;
          cidade_nascimento: string | null;
          uf_nascimento: string | null;
          pais_nascimento: string | null;
          estado_civil: string | null;
          tipo_contrato: "CLT" | "PJ" | "temporario" | "estagiario" | null;
          jornada: string | null;
          telefone: string | null;
          email: string | null;
          contato_emergencia_nome: string | null;
          contato_emergencia_tel: string | null;
          photo_url: string | null;
          status_rh: "ativo" | "inativo" | "ferias" | "afastado";
          score: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          unit_id: string;
          user_id?: string | null;
          nome: string;
          sobrenome: string;
          cpf?: string | null;
          ctps?: string | null;
          ctps_serie?: string | null;
          ctps_uf?: string | null;
          ctps_expedicao?: string | null;
          rg?: string | null;
          rg_orgao?: string | null;
          rg_uf?: string | null;
          pis?: string | null;
          titulo_eleitor?: string | null;
          zona_eleitoral?: string | null;
          secao_eleitoral?: string | null;
          reservista?: string | null;
          rne?: string | null;
          rne_orgao?: string | null;
          rne_expedicao?: string | null;
          rua?: string | null;
          numero?: string | null;
          complemento?: string | null;
          bairro?: string | null;
          cidade?: string | null;
          estado?: string | null;
          cep?: string | null;
          escolaridade?: string | null;
          raca?: string | null;
          genero?: string | null;
          nome_mae?: string | null;
          nome_pai?: string | null;
          departamento?: string | null;
          funcao: string;
          salario_base?: string | number;
          data_admissao: string;
          data_demissao?: string | null;
          ativo?: boolean;
          banco?: string | null;
          agencia?: string | null;
          conta?: string | null;
          tipo_conta?: string | null;
          pix?: string | null;
          employee_code?: string | null;
          esocial_code?: string | null;
          nome_social?: string | null;
          data_nascimento?: string | null;
          cidade_nascimento?: string | null;
          uf_nascimento?: string | null;
          pais_nascimento?: string | null;
          estado_civil?: string | null;
          tipo_contrato?: "CLT" | "PJ" | "temporario" | "estagiario" | null;
          jornada?: string | null;
          telefone?: string | null;
          email?: string | null;
          contato_emergencia_nome?: string | null;
          contato_emergencia_tel?: string | null;
          photo_url?: string | null;
          status_rh?: "ativo" | "inativo" | "ferias" | "afastado";
          score?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          unit_id?: string;
          user_id?: string | null;
          nome?: string;
          sobrenome?: string;
          cpf?: string | null;
          ctps?: string | null;
          ctps_serie?: string | null;
          ctps_uf?: string | null;
          ctps_expedicao?: string | null;
          rg?: string | null;
          rg_orgao?: string | null;
          rg_uf?: string | null;
          pis?: string | null;
          titulo_eleitor?: string | null;
          zona_eleitoral?: string | null;
          secao_eleitoral?: string | null;
          reservista?: string | null;
          rne?: string | null;
          rne_orgao?: string | null;
          rne_expedicao?: string | null;
          rua?: string | null;
          numero?: string | null;
          complemento?: string | null;
          bairro?: string | null;
          cidade?: string | null;
          estado?: string | null;
          cep?: string | null;
          escolaridade?: string | null;
          raca?: string | null;
          genero?: string | null;
          nome_mae?: string | null;
          nome_pai?: string | null;
          departamento?: string | null;
          funcao?: string;
          salario_base?: string | number;
          data_admissao?: string;
          data_demissao?: string | null;
          ativo?: boolean;
          banco?: string | null;
          agencia?: string | null;
          conta?: string | null;
          tipo_conta?: string | null;
          pix?: string | null;
          employee_code?: string | null;
          esocial_code?: string | null;
          nome_social?: string | null;
          data_nascimento?: string | null;
          cidade_nascimento?: string | null;
          uf_nascimento?: string | null;
          pais_nascimento?: string | null;
          estado_civil?: string | null;
          tipo_contrato?: "CLT" | "PJ" | "temporario" | "estagiario" | null;
          jornada?: string | null;
          telefone?: string | null;
          email?: string | null;
          contato_emergencia_nome?: string | null;
          contato_emergencia_tel?: string | null;
          photo_url?: string | null;
          status_rh?: "ativo" | "inativo" | "ferias" | "afastado";
          score?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      shifts: {
        Row: {
          id: string;
          employee_id: string;
          unit_id: string;
          data: string;
          hora_inicio: string;
          hora_fim: string;
          tipo: string;
          labor_cost: string | null;
          observacao: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          unit_id: string;
          data: string;
          hora_inicio: string;
          hora_fim: string;
          tipo?: string;
          labor_cost?: string | number | null;
          observacao?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          unit_id?: string;
          data?: string;
          hora_inicio?: string;
          hora_fim?: string;
          tipo?: string;
          labor_cost?: string | number | null;
          observacao?: string | null;
          created_at?: string;
        };
      };
      time_clock_punches: {
        Row: {
          id: string;
          employee_id: string;
          tipo: string;
          timestamp_punch: string;
          latitude: string | null;
          longitude: string | null;
          device_info: string | null;
          aprovado: boolean | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          tipo: string;
          timestamp_punch?: string;
          latitude?: string | number | null;
          longitude?: string | number | null;
          device_info?: string | null;
          aprovado?: boolean | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          tipo?: string;
          timestamp_punch?: string;
          latitude?: string | number | null;
          longitude?: string | number | null;
          device_info?: string | null;
          aprovado?: boolean | null;
          created_at?: string;
        };
      };
      time_bank_balance: {
        Row: {
          id: string;
          employee_id: string;
          saldo_minutos: number;
          ultimo_calculo: string | null;
          source: string | null;
          observacao: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          saldo_minutos?: number;
          ultimo_calculo?: string | null;
          source?: string | null;
          observacao?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          saldo_minutos?: number;
          ultimo_calculo?: string | null;
          source?: string | null;
          observacao?: string | null;
          updated_at?: string;
        };
      };
      dependents: {
        Row: {
          id: string;
          employee_id: string;
          nome: string;
          cpf: string | null;
          data_nascimento: string | null;
          parentesco: string;
          ordem: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          nome: string;
          cpf?: string | null;
          data_nascimento?: string | null;
          parentesco: string;
          ordem?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          nome?: string;
          cpf?: string | null;
          data_nascimento?: string | null;
          parentesco?: string;
          ordem?: number;
          created_at?: string;
        };
      };
      absences: {
        Row: {
          id: string;
          employee_id: string;
          data: string;
          tipo: string;
          motivo: string | null;
          score_impact: number;
          atestado_path: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          data: string;
          tipo: string;
          motivo?: string | null;
          score_impact?: number;
          atestado_path?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          data?: string;
          tipo?: string;
          motivo?: string | null;
          score_impact?: number;
          atestado_path?: string | null;
          created_at?: string;
        };
      };
      warnings: {
        Row: {
          id: string;
          employee_id: string;
          nivel: string;
          descricao: string;
          score_impact: number;
          documento_path: string | null;
          data: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          nivel: string;
          descricao: string;
          score_impact?: number;
          documento_path?: string | null;
          data?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          nivel?: string;
          descricao?: string;
          score_impact?: number;
          documento_path?: string | null;
          data?: string;
          created_at?: string;
        };
      };
      score_events: {
        Row: {
          id: string;
          employee_id: string;
          tipo: string;
          delta: number;
          descricao: string | null;
          referencia_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          tipo: string;
          delta: number;
          descricao?: string | null;
          referencia_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          tipo?: string;
          delta?: number;
          descricao?: string | null;
          referencia_id?: string | null;
          created_at?: string;
        };
      };
      payslips: {
        // Migration 011: +fgts_base, +fgts_mes, +faixa_irrf, +employee_code.
        Row: {
          id: string;
          employee_id: string;
          competencia: string;
          salario_base: string;
          horas_extras: string;
          adicional_noturno: string;
          gorjeta: string;
          dsr_gorjeta: string;
          desconto_inss: string;
          desconto_irrf: string;
          desconto_vale_transporte: string;
          desconto_vale_refeicao: string;
          outros_descontos: string;
          outros_acrescimos: string;
          liquido: string;
          status: string;
          pdf_url: string | null;
          fgts_base: string | null;
          fgts_mes: string | null;
          faixa_irrf: string | null;
          employee_code: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          competencia: string;
          salario_base: string | number;
          horas_extras?: string | number;
          adicional_noturno?: string | number;
          gorjeta?: string | number;
          dsr_gorjeta?: string | number;
          desconto_inss?: string | number;
          desconto_irrf?: string | number;
          desconto_vale_transporte?: string | number;
          desconto_vale_refeicao?: string | number;
          outros_descontos?: string | number;
          outros_acrescimos?: string | number;
          liquido: string | number;
          status?: string;
          pdf_url?: string | null;
          fgts_base?: string | number | null;
          fgts_mes?: string | number | null;
          faixa_irrf?: string | null;
          employee_code?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          competencia?: string;
          salario_base?: string | number;
          horas_extras?: string | number;
          adicional_noturno?: string | number;
          gorjeta?: string | number;
          dsr_gorjeta?: string | number;
          desconto_inss?: string | number;
          desconto_irrf?: string | number;
          desconto_vale_transporte?: string | number;
          desconto_vale_refeicao?: string | number;
          outros_descontos?: string | number;
          outros_acrescimos?: string | number;
          liquido?: string | number;
          status?: string;
          pdf_url?: string | null;
          fgts_base?: string | number | null;
          fgts_mes?: string | number | null;
          faixa_irrf?: string | null;
          employee_code?: string | null;
          created_at?: string;
        };
      };

      // ── HOS RH expansion (migrations 011–018) ────────────────

      employee_auth: {
        // Auth do app mobile (CPF + bcrypt). NÃO usa auth.users do Supabase.
        Row: {
          id: string;
          employee_id: string;
          cpf: string;
          password_hash: string;
          is_active: boolean;
          last_login: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          cpf: string;
          password_hash: string;
          is_active?: boolean;
          last_login?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          cpf?: string;
          password_hash?: string;
          is_active?: boolean;
          last_login?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };

      documents: {
        // Documentos pessoais do colaborador (storage path, type ENUM-like).
        Row: {
          id: string;
          employee_id: string;
          unit_id: string;
          name: string;
          type: "RG" | "CPF" | "CTPS" | "contrato" | "exame" | "outro";
          storage_path: string;
          notes: string | null;
          uploaded_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          unit_id: string;
          name: string;
          type: "RG" | "CPF" | "CTPS" | "contrato" | "exame" | "outro";
          storage_path: string;
          notes?: string | null;
          uploaded_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          unit_id?: string;
          name?: string;
          type?: "RG" | "CPF" | "CTPS" | "contrato" | "exame" | "outro";
          storage_path?: string;
          notes?: string | null;
          uploaded_at?: string;
        };
      };

      tips_records: {
        // Gorjetas por período. pontos_liquidos = total_pontos - abatimento (GENERATED).
        Row: {
          id: string;
          employee_id: string;
          unit_id: string;
          periodo: string; // DATE — primeiro dia do mês
          valor_ponto: string; // NUMERIC(10,4)
          total_pontos: number;
          abatimento_pontos: number;
          pontos_liquidos: number; // GENERATED
          observacoes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          unit_id: string;
          periodo: string;
          valor_ponto: string | number;
          total_pontos: number;
          abatimento_pontos?: number;
          observacoes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          unit_id?: string;
          periodo?: string;
          valor_ponto?: string | number;
          total_pontos?: number;
          abatimento_pontos?: number;
          observacoes?: string | null;
          created_at?: string;
        };
      };

      transport_vouchers: {
        // VT por período. valor_empresa = total_bruto - desconto_funcionario.
        Row: {
          id: string;
          employee_id: string;
          unit_id: string;
          periodo: string;
          dias_uteis: number;
          valor_diario: string;
          total_bruto: string;
          desconto_funcionario: string;
          valor_empresa: string;
          operadora: string | null;
          observacoes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          unit_id: string;
          periodo: string;
          dias_uteis: number;
          valor_diario: string | number;
          total_bruto: string | number;
          desconto_funcionario?: string | number;
          valor_empresa: string | number;
          operadora?: string | null;
          observacoes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          unit_id?: string;
          periodo?: string;
          dias_uteis?: number;
          valor_diario?: string | number;
          total_bruto?: string | number;
          desconto_funcionario?: string | number;
          valor_empresa?: string | number;
          operadora?: string | null;
          observacoes?: string | null;
          created_at?: string;
        };
      };

      time_records: {
        // Importação de ponto/banco horas (Totvs). Read-only no UI normal.
        Row: {
          id: string;
          employee_id: string;
          unit_id: string;
          periodo: string;
          horas_previstas: string | null;
          horas_trabalhadas: string | null;
          banco_horas_positivo: string | null;
          banco_horas_negativo: string | null;
          saldo_banco: string | null;
          banco_horas_acumulado: string | null;
          faltas_injustificadas_dias: number | null;
          atestado_horas: string | null;
          afastamentos_dias: number | null;
          ferias_dias: number | null;
          adicional_noturno: string | null;
          fonte: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          unit_id: string;
          periodo: string;
          horas_previstas?: string | null;
          horas_trabalhadas?: string | null;
          banco_horas_positivo?: string | null;
          banco_horas_negativo?: string | null;
          saldo_banco?: string | null;
          banco_horas_acumulado?: string | null;
          faltas_injustificadas_dias?: number | null;
          atestado_horas?: string | null;
          afastamentos_dias?: number | null;
          ferias_dias?: number | null;
          adicional_noturno?: string | null;
          fonte?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          unit_id?: string;
          periodo?: string;
          horas_previstas?: string | null;
          horas_trabalhadas?: string | null;
          banco_horas_positivo?: string | null;
          banco_horas_negativo?: string | null;
          saldo_banco?: string | null;
          banco_horas_acumulado?: string | null;
          faltas_injustificadas_dias?: number | null;
          atestado_horas?: string | null;
          afastamentos_dias?: number | null;
          ferias_dias?: number | null;
          adicional_noturno?: string | null;
          fonte?: string | null;
          notes?: string | null;
          created_at?: string;
        };
      };

      vacations: {
        Row: {
          id: string;
          employee_id: string;
          unit_id: string;
          start_date: string;
          end_date: string;
          acquisitive_period_start: string | null;
          acquisitive_period_end: string | null;
          days_entitled: number;
          days_taken: number | null;
          abono_days: number | null;
          is_double_pay: boolean;
          status: "agendada" | "em_andamento" | "concluida" | "cancelada";
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          unit_id: string;
          start_date: string;
          end_date: string;
          acquisitive_period_start?: string | null;
          acquisitive_period_end?: string | null;
          days_entitled?: number;
          days_taken?: number | null;
          abono_days?: number | null;
          is_double_pay?: boolean;
          status?: "agendada" | "em_andamento" | "concluida" | "cancelada";
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          unit_id?: string;
          start_date?: string;
          end_date?: string;
          acquisitive_period_start?: string | null;
          acquisitive_period_end?: string | null;
          days_entitled?: number;
          days_taken?: number | null;
          abono_days?: number | null;
          is_double_pay?: boolean;
          status?: "agendada" | "em_andamento" | "concluida" | "cancelada";
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };

      overtime_records: {
        Row: {
          id: string;
          employee_id: string;
          unit_id: string;
          date: string;
          hours: string;
          type: "50" | "100" | "banco";
          reason: string | null;
          approved: boolean | null;
          approved_by: string | null;
          periodo: string | null;
          source: "manual" | "totvs";
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          unit_id: string;
          date: string;
          hours: string | number;
          type: "50" | "100" | "banco";
          reason?: string | null;
          approved?: boolean | null;
          approved_by?: string | null;
          periodo?: string | null;
          source?: "manual" | "totvs";
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          unit_id?: string;
          date?: string;
          hours?: string | number;
          type?: "50" | "100" | "banco";
          reason?: string | null;
          approved?: boolean | null;
          approved_by?: string | null;
          periodo?: string | null;
          source?: "manual" | "totvs";
          created_at?: string;
        };
      };

      import_logs: {
        Row: {
          id: string;
          unit_id: string;
          periodo: string;
          tipo: "ponto" | "holerites" | "gorjetas" | "vt";
          total_linhas: number | null;
          importados: number | null;
          nao_encontrados: number | null;
          erros: number | null;
          detalhes: Json | null;
          imported_by: string | null;
          imported_at: string;
        };
        Insert: {
          id?: string;
          unit_id: string;
          periodo: string;
          tipo: "ponto" | "holerites" | "gorjetas" | "vt";
          total_linhas?: number | null;
          importados?: number | null;
          nao_encontrados?: number | null;
          erros?: number | null;
          detalhes?: Json | null;
          imported_by?: string | null;
          imported_at?: string;
        };
        Update: {
          id?: string;
          unit_id?: string;
          periodo?: string;
          tipo?: "ponto" | "holerites" | "gorjetas" | "vt";
          total_linhas?: number | null;
          importados?: number | null;
          nao_encontrados?: number | null;
          erros?: number | null;
          detalhes?: Json | null;
          imported_by?: string | null;
          imported_at?: string;
        };
      };

      campaigns: {
        // Comunicação interna (saúde/evento/comunicado) target=all|department.
        Row: {
          id: string;
          brand_id: string | null;
          unit_id: string | null;
          title: string;
          description: string | null;
          image_url: string | null;
          category: "saude" | "evento" | "comunicado";
          target: "all" | "department";
          target_value: string | null;
          active: boolean;
          starts_at: string | null;
          ends_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          brand_id?: string | null;
          unit_id?: string | null;
          title: string;
          description?: string | null;
          image_url?: string | null;
          category: "saude" | "evento" | "comunicado";
          target?: "all" | "department";
          target_value?: string | null;
          active?: boolean;
          starts_at?: string | null;
          ends_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          brand_id?: string | null;
          unit_id?: string | null;
          title?: string;
          description?: string | null;
          image_url?: string | null;
          category?: "saude" | "evento" | "comunicado";
          target?: "all" | "department";
          target_value?: string | null;
          active?: boolean;
          starts_at?: string | null;
          ends_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
      };

      job_openings: {
        Row: {
          id: string;
          brand_id: string;
          unit_id: string | null;
          title: string;
          description: string | null;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          brand_id: string;
          unit_id?: string | null;
          title: string;
          description?: string | null;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          brand_id?: string;
          unit_id?: string | null;
          title?: string;
          description?: string | null;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
      };

      candidates: {
        // status = decisão RH; interview_status = ciclo do app.
        Row: {
          id: string;
          job_opening_id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          access_code: string;
          status: "pendente" | "aprovado" | "reprovado";
          interview_status: "pendente" | "em_andamento" | "concluido";
          created_at: string;
        };
        Insert: {
          id?: string;
          job_opening_id: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          access_code: string;
          status?: "pendente" | "aprovado" | "reprovado";
          interview_status?: "pendente" | "em_andamento" | "concluido";
          created_at?: string;
        };
        Update: {
          id?: string;
          job_opening_id?: string;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          access_code?: string;
          status?: "pendente" | "aprovado" | "reprovado";
          interview_status?: "pendente" | "em_andamento" | "concluido";
          created_at?: string;
        };
      };

      interview_questions: {
        Row: {
          id: string;
          job_opening_id: string;
          order_num: number;
          question_text: string;
          video_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          job_opening_id: string;
          order_num: number;
          question_text: string;
          video_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          job_opening_id?: string;
          order_num?: number;
          question_text?: string;
          video_url?: string | null;
          created_at?: string;
        };
      };

      interview_responses: {
        Row: {
          id: string;
          candidate_id: string;
          question_id: string;
          video_url: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          candidate_id: string;
          question_id: string;
          video_url: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          candidate_id?: string;
          question_id?: string;
          video_url?: string;
          created_at?: string;
        };
      };

      cct_versions: {
        Row: {
          id: string;
          sindicato: string;
          vigencia_inicio: string;
          vigencia_fim: string;
          piso_salarial: string | null;
          adicional_noturno_pct: string;
          hora_extra_50_pct: string;
          hora_extra_100_pct: string;
          gorjeta_percentual: string | null;
          dsr_sobre_gorjeta: boolean;
          dados_completos: Json | null;
          ativo: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          sindicato: string;
          vigencia_inicio: string;
          vigencia_fim: string;
          piso_salarial?: string | number | null;
          adicional_noturno_pct?: string | number;
          hora_extra_50_pct?: string | number;
          hora_extra_100_pct?: string | number;
          gorjeta_percentual?: string | number | null;
          dsr_sobre_gorjeta?: boolean;
          dados_completos?: Json | null;
          ativo?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          sindicato?: string;
          vigencia_inicio?: string;
          vigencia_fim?: string;
          piso_salarial?: string | number | null;
          adicional_noturno_pct?: string | number;
          hora_extra_50_pct?: string | number;
          hora_extra_100_pct?: string | number;
          gorjeta_percentual?: string | number | null;
          dsr_sobre_gorjeta?: boolean;
          dados_completos?: Json | null;
          ativo?: boolean;
          created_at?: string;
        };
      };
      // ── Fase E2 / Eventos (O.S.) ─────────────────────────────
      events: {
        Row: {
          id: string;
          group_id: string;
          brand_id: string;
          unit_id: string | null;
          nome: string;
          tipo: string | null;
          data_inicio: string;
          data_fim: string | null;
          num_convidados: number | null;
          responsavel_interno: string | null;
          contato_cliente: string | null;
          telefone_cliente: string | null;
          email_cliente: string | null;
          empresa_cliente: string | null;
          observacoes: string | null;
          status: EventStatus;
          valor_total: number | null;
          valor_sinal: number | null;
          valor_sinal_pago: boolean;
          created_by: string | null;
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          brand_id: string;
          unit_id?: string | null;
          nome: string;
          tipo?: string | null;
          data_inicio: string;
          data_fim?: string | null;
          num_convidados?: number | null;
          responsavel_interno?: string | null;
          contato_cliente?: string | null;
          telefone_cliente?: string | null;
          email_cliente?: string | null;
          empresa_cliente?: string | null;
          observacoes?: string | null;
          status?: EventStatus;
          valor_total?: number | null;
          valor_sinal?: number | null;
          valor_sinal_pago?: boolean;
          created_by?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          brand_id?: string;
          unit_id?: string | null;
          nome?: string;
          tipo?: string | null;
          data_inicio?: string;
          data_fim?: string | null;
          num_convidados?: number | null;
          responsavel_interno?: string | null;
          contato_cliente?: string | null;
          telefone_cliente?: string | null;
          email_cliente?: string | null;
          empresa_cliente?: string | null;
          observacoes?: string | null;
          status?: EventStatus;
          valor_total?: number | null;
          valor_sinal?: number | null;
          valor_sinal_pago?: boolean;
          created_by?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      event_menu_items: {
        Row: {
          id: string;
          event_id: string;
          categoria: MenuItemCategory;
          nome: string;
          descricao: string | null;
          quantidade: number | null;
          unidade: string | null;
          preco_unitario: number | null;
          observacoes: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          categoria: MenuItemCategory;
          nome: string;
          descricao?: string | null;
          quantidade?: number | null;
          unidade?: string | null;
          preco_unitario?: number | null;
          observacoes?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          categoria?: MenuItemCategory;
          nome?: string;
          descricao?: string | null;
          quantidade?: number | null;
          unidade?: string | null;
          preco_unitario?: number | null;
          observacoes?: string | null;
          sort_order?: number;
          created_at?: string;
        };
      };
      event_infra_items: {
        Row: {
          id: string;
          event_id: string;
          categoria: string;
          item: string;
          quantidade: number;
          responsavel: string | null;
          status: string;
          observacoes: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          categoria: string;
          item: string;
          quantidade?: number;
          responsavel?: string | null;
          status?: string;
          observacoes?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          categoria?: string;
          item?: string;
          quantidade?: number;
          responsavel?: string | null;
          status?: string;
          observacoes?: string | null;
          sort_order?: number;
          created_at?: string;
        };
      };
      event_staff: {
        Row: {
          id: string;
          event_id: string;
          employee_id: string | null;
          nome_externo: string | null;
          funcao: string;
          horario_entrada: string | null;
          horario_saida: string | null;
          observacoes: string | null;
          confirmado: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          employee_id?: string | null;
          nome_externo?: string | null;
          funcao: string;
          horario_entrada?: string | null;
          horario_saida?: string | null;
          observacoes?: string | null;
          confirmado?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          employee_id?: string | null;
          nome_externo?: string | null;
          funcao?: string;
          horario_entrada?: string | null;
          horario_saida?: string | null;
          observacoes?: string | null;
          confirmado?: boolean;
          created_at?: string;
        };
      };
      event_attachments: {
        Row: {
          id: string;
          event_id: string;
          nome: string;
          tipo: string | null;
          storage_path: string;
          tamanho_bytes: number | null;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          nome: string;
          tipo?: string | null;
          storage_path: string;
          tamanho_bytes?: number | null;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          nome?: string;
          tipo?: string | null;
          storage_path?: string;
          tamanho_bytes?: number | null;
          uploaded_by?: string | null;
          created_at?: string;
        };
      };
      event_status_log: {
        Row: {
          id: string;
          event_id: string;
          status_anterior: EventStatus | null;
          status_novo: EventStatus;
          changed_by: string | null;
          motivo: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          status_anterior?: EventStatus | null;
          status_novo: EventStatus;
          changed_by?: string | null;
          motivo?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          status_anterior?: EventStatus | null;
          status_novo?: EventStatus;
          changed_by?: string | null;
          motivo?: string | null;
          created_at?: string;
        };
      };
      // ── Fase E4 / Financeiro ─────────────────────────────────
      financial_periods: {
        Row: {
          id: string;
          group_id: string;
          brand_id: string;
          unit_id: string | null;
          competencia: string;
          status: FinancialPeriodStatus;
          fechado_por: string | null;
          fechado_at: string | null;
          observacoes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          brand_id: string;
          unit_id?: string | null;
          competencia: string;
          status?: FinancialPeriodStatus;
          fechado_por?: string | null;
          fechado_at?: string | null;
          observacoes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          brand_id?: string;
          unit_id?: string | null;
          competencia?: string;
          status?: FinancialPeriodStatus;
          fechado_por?: string | null;
          fechado_at?: string | null;
          observacoes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      cash_flow_projections: {
        Row: {
          id: string;
          period_id: string;
          natureza: LancamentoNatureza;
          categoria_receita: CategoriaReceita | null;
          categoria_despesa: CategoriaDespesa | null;
          descricao: string | null;
          valor_projetado: number;
          is_evento: boolean;
          criado_por: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          period_id: string;
          natureza: LancamentoNatureza;
          categoria_receita?: CategoriaReceita | null;
          categoria_despesa?: CategoriaDespesa | null;
          descricao?: string | null;
          valor_projetado?: number;
          is_evento?: boolean;
          criado_por?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          period_id?: string;
          natureza?: LancamentoNatureza;
          categoria_receita?: CategoriaReceita | null;
          categoria_despesa?: CategoriaDespesa | null;
          descricao?: string | null;
          valor_projetado?: number;
          is_evento?: boolean;
          criado_por?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      cash_flow_entries: {
        Row: {
          id: string;
          period_id: string;
          natureza: LancamentoNatureza;
          categoria_receita: CategoriaReceita | null;
          categoria_despesa: CategoriaDespesa | null;
          descricao: string;
          valor: number;
          data_lancamento: string;
          data_vencimento: string | null;
          data_pagamento: string | null;
          status: LancamentoStatus;
          regime: LancamentoRegime;
          fornecedor: string | null;
          numero_documento: string | null;
          centro_custo: string | null;
          event_id: string | null;
          requer_aprovacao: boolean;
          aprovado_por: string | null;
          aprovado_at: string | null;
          rejeitado_por: string | null;
          rejeitado_at: string | null;
          motivo_rejeicao: string | null;
          criado_por: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          period_id: string;
          natureza: LancamentoNatureza;
          categoria_receita?: CategoriaReceita | null;
          categoria_despesa?: CategoriaDespesa | null;
          descricao: string;
          valor: number;
          data_lancamento: string;
          data_vencimento?: string | null;
          data_pagamento?: string | null;
          status?: LancamentoStatus;
          regime?: LancamentoRegime;
          fornecedor?: string | null;
          numero_documento?: string | null;
          centro_custo?: string | null;
          event_id?: string | null;
          aprovado_por?: string | null;
          aprovado_at?: string | null;
          rejeitado_por?: string | null;
          rejeitado_at?: string | null;
          motivo_rejeicao?: string | null;
          criado_por?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          period_id?: string;
          natureza?: LancamentoNatureza;
          categoria_receita?: CategoriaReceita | null;
          categoria_despesa?: CategoriaDespesa | null;
          descricao?: string;
          valor?: number;
          data_lancamento?: string;
          data_vencimento?: string | null;
          data_pagamento?: string | null;
          status?: LancamentoStatus;
          regime?: LancamentoRegime;
          fornecedor?: string | null;
          numero_documento?: string | null;
          centro_custo?: string | null;
          event_id?: string | null;
          aprovado_por?: string | null;
          aprovado_at?: string | null;
          rejeitado_por?: string | null;
          rejeitado_at?: string | null;
          motivo_rejeicao?: string | null;
          criado_por?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      menu_items: {
        Row: {
          id: string;
          brand_id: string;
          unit_id: string | null;
          nome: string;
          categoria: string;
          preco_venda: number;
          custo_total: number | null;
          cmv_pct: number | null;
          tem_ficha_tecnica: boolean;
          ativo: boolean;
          observacoes: string | null;
          criado_por: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          brand_id: string;
          unit_id?: string | null;
          nome: string;
          categoria: string;
          preco_venda: number;
          custo_total?: number | null;
          tem_ficha_tecnica?: boolean;
          ativo?: boolean;
          observacoes?: string | null;
          criado_por?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          brand_id?: string;
          unit_id?: string | null;
          nome?: string;
          categoria?: string;
          preco_venda?: number;
          custo_total?: number | null;
          tem_ficha_tecnica?: boolean;
          ativo?: boolean;
          observacoes?: string | null;
          criado_por?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      approval_requests: {
        Row: {
          id: string;
          entry_id: string;
          brand_id: string;
          solicitante_id: string;
          aprovador_id: string | null;
          valor: number;
          descricao: string;
          justificativa: string | null;
          status: ApprovalStatus;
          respondido_em: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          entry_id: string;
          brand_id: string;
          solicitante_id: string;
          aprovador_id?: string | null;
          valor: number;
          descricao: string;
          justificativa?: string | null;
          status?: ApprovalStatus;
          respondido_em?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          entry_id?: string;
          brand_id?: string;
          solicitante_id?: string;
          aprovador_id?: string | null;
          valor?: number;
          descricao?: string;
          justificativa?: string | null;
          status?: ApprovalStatus;
          respondido_em?: string | null;
          created_at?: string;
        };
      };
      brand_financial_config: {
        Row: {
          id: string;
          brand_id: string;
          threshold_aprovacao: number;
          meta_cmv_pct: number | null;
          meta_ebitda_pct: number | null;
          meta_prime_cost_pct: number | null;
          alerta_desvio_pct: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          brand_id: string;
          threshold_aprovacao?: number;
          meta_cmv_pct?: number | null;
          meta_ebitda_pct?: number | null;
          meta_prime_cost_pct?: number | null;
          alerta_desvio_pct?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          brand_id?: string;
          threshold_aprovacao?: number;
          meta_cmv_pct?: number | null;
          meta_ebitda_pct?: number | null;
          meta_prime_cost_pct?: number | null;
          alerta_desvio_pct?: number | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      // ── Compras (migration 019) ───────────────────────────────
      suppliers: {
        Row: {
          id: string;
          unit_id: string;
          brand_id: string;
          nome: string;
          cnpj: string | null;
          telefone: string | null;
          email: string | null;
          categoria: string | null;
          ativo: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          unit_id: string;
          brand_id: string;
          nome: string;
          cnpj?: string | null;
          telefone?: string | null;
          email?: string | null;
          categoria?: string | null;
          ativo?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          unit_id?: string;
          brand_id?: string;
          nome?: string;
          cnpj?: string | null;
          telefone?: string | null;
          email?: string | null;
          categoria?: string | null;
          ativo?: boolean;
          created_at?: string;
        };
      };
      purchase_orders: {
        Row: {
          id: string;
          unit_id: string;
          brand_id: string;
          numero: string;
          fornecedor: string | null;
          supplier_id: string | null;
          status: PurchaseOrderStatus;
          data_pedido: string;
          data_prevista: string | null;
          valor_total: number;
          observacoes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          unit_id: string;
          brand_id: string;
          numero?: string;
          fornecedor?: string | null;
          supplier_id?: string | null;
          status?: PurchaseOrderStatus;
          data_pedido?: string;
          data_prevista?: string | null;
          valor_total?: number;
          observacoes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          unit_id?: string;
          brand_id?: string;
          numero?: string;
          fornecedor?: string | null;
          supplier_id?: string | null;
          status?: PurchaseOrderStatus;
          data_pedido?: string;
          data_prevista?: string | null;
          valor_total?: number;
          observacoes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      purchase_order_items: {
        Row: {
          id: string;
          order_id: string;
          nome: string;
          unidade: string | null;
          quantidade: number;
          quantidade_recebida: number;
          preco_unitario: number;
          total: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          nome: string;
          unidade?: string | null;
          quantidade?: number;
          quantidade_recebida?: number;
          preco_unitario?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          nome?: string;
          unidade?: string | null;
          quantidade?: number;
          quantidade_recebida?: number;
          preco_unitario?: number;
          created_at?: string;
        };
      };
      // ── Cliente / CRM (migration 020) ─────────────────────────
      clients: {
        Row: {
          id: string;
          brand_id: string;
          unit_id: string;
          nome: string;
          email: string | null;
          telefone: string | null;
          empresa: string | null;
          origem: ClientOrigem | null;
          observacoes: string | null;
          ativo: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          brand_id: string;
          unit_id: string;
          nome: string;
          email?: string | null;
          telefone?: string | null;
          empresa?: string | null;
          origem?: ClientOrigem | null;
          observacoes?: string | null;
          ativo?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          brand_id?: string;
          unit_id?: string;
          nome?: string;
          email?: string | null;
          telefone?: string | null;
          empresa?: string | null;
          origem?: ClientOrigem | null;
          observacoes?: string | null;
          ativo?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      client_interactions: {
        Row: {
          id: string;
          client_id: string;
          tipo: ClientInteractionTipo;
          descricao: string | null;
          data: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          tipo: ClientInteractionTipo;
          descricao?: string | null;
          data?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          tipo?: ClientInteractionTipo;
          descricao?: string | null;
          data?: string;
          created_by?: string | null;
          created_at?: string;
        };
      };
      // ── Treinamentos / Onboarding (migration 021) ─────────────
      training_templates: {
        Row: {
          id: string;
          brand_id: string;
          unit_id: string | null;
          nome: string;
          descricao: string | null;
          funcao: string | null;
          obrigatorio: boolean;
          validade_dias: number | null;
          ativo: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          brand_id: string;
          unit_id?: string | null;
          nome: string;
          descricao?: string | null;
          funcao?: string | null;
          obrigatorio?: boolean;
          validade_dias?: number | null;
          ativo?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          brand_id?: string;
          unit_id?: string | null;
          nome?: string;
          descricao?: string | null;
          funcao?: string | null;
          obrigatorio?: boolean;
          validade_dias?: number | null;
          ativo?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      training_records: {
        Row: {
          id: string;
          employee_id: string;
          template_id: string;
          status: TrainingStatus;
          data_inicio: string | null;
          data_conclusao: string | null;
          validade_dias_snapshot: number | null;
          validade_ate: string | null;
          observacoes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          template_id: string;
          status?: TrainingStatus;
          data_inicio?: string | null;
          data_conclusao?: string | null;
          validade_dias_snapshot?: number | null;
          observacoes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          template_id?: string;
          status?: TrainingStatus;
          data_inicio?: string | null;
          data_conclusao?: string | null;
          validade_dias_snapshot?: number | null;
          observacoes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      // ── Avaliação de desempenho (migration 022) ───────────────
      performance_templates: {
        Row: {
          id: string;
          brand_id: string;
          unit_id: string | null;
          nome: string;
          descricao: string | null;
          funcao: string | null;
          periodicidade: PerformancePeriodicidade;
          criterios: PerformanceCriterio[];
          ativo: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          brand_id: string;
          unit_id?: string | null;
          nome: string;
          descricao?: string | null;
          funcao?: string | null;
          periodicidade: PerformancePeriodicidade;
          criterios?: PerformanceCriterio[];
          ativo?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          brand_id?: string;
          unit_id?: string | null;
          nome?: string;
          descricao?: string | null;
          funcao?: string | null;
          periodicidade?: PerformancePeriodicidade;
          criterios?: PerformanceCriterio[];
          ativo?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      performance_reviews: {
        Row: {
          id: string;
          employee_id: string;
          template_id: string;
          avaliador_id: string | null;
          periodo: string;
          status: PerformanceReviewStatus;
          nota_geral: string | null;
          respostas: Record<string, string | number | boolean | null>;
          pontos_fortes: string | null;
          pontos_melhoria: string | null;
          plano_acao: string | null;
          data_avaliacao: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          template_id: string;
          avaliador_id?: string | null;
          periodo: string;
          status?: PerformanceReviewStatus;
          nota_geral?: string | number | null;
          respostas?: Record<string, string | number | boolean | null>;
          pontos_fortes?: string | null;
          pontos_melhoria?: string | null;
          plano_acao?: string | null;
          data_avaliacao?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          template_id?: string;
          avaliador_id?: string | null;
          periodo?: string;
          status?: PerformanceReviewStatus;
          nota_geral?: string | number | null;
          respostas?: Record<string, string | number | boolean | null>;
          pontos_fortes?: string | null;
          pontos_melhoria?: string | null;
          plano_acao?: string | null;
          data_avaliacao?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      // ── Metas por marca (migration 023) ──────────────────────
      brand_targets: {
        Row: {
          id: string;
          brand_id: string;
          unit_id: string | null;
          periodo: string;
          receita_meta: string | null;
          cmv_meta_pct: string | null;
          prime_cost_meta_pct: string | null;
          ticket_medio_meta: string | null;
          nps_meta: string | null;
          headcount_meta: number | null;
          eventos_meta: number | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          brand_id: string;
          unit_id?: string | null;
          periodo: string;
          receita_meta?: string | number | null;
          cmv_meta_pct?: string | number | null;
          prime_cost_meta_pct?: string | number | null;
          ticket_medio_meta?: string | number | null;
          nps_meta?: string | number | null;
          headcount_meta?: number | null;
          eventos_meta?: number | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          brand_id?: string;
          unit_id?: string | null;
          periodo?: string;
          receita_meta?: string | number | null;
          cmv_meta_pct?: string | number | null;
          prime_cost_meta_pct?: string | number | null;
          ticket_medio_meta?: string | number | null;
          nps_meta?: string | number | null;
          headcount_meta?: number | null;
          eventos_meta?: number | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      target_notes: {
        Row: {
          id: string;
          target_id: string;
          nota: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          target_id: string;
          nota: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          target_id?: string;
          nota?: string;
          created_by?: string | null;
          created_at?: string;
        };
      };
      // ── Notificações in-app (migration 024) ──────────────────
      // Note: hos_jobs e hos_runs (migration 033) usam (supabase as any) nos
      // agentes do orquestrador — supabase-js v2 não infere corretamente tabelas
      // com colunas JSONB em tipos manuais. Ver CLAUDE.md §5.5.
      notifications: {
        Row: {
          id: string;
          user_id: string;
          tipo: string;
          titulo: string;
          mensagem: string | null;
          link: string | null;
          lida: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          tipo: string;
          titulo: string;
          mensagem?: string | null;
          link?: string | null;
          lida?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          tipo?: string;
          titulo?: string;
          mensagem?: string | null;
          link?: string | null;
          lida?: boolean;
          created_at?: string;
        };
      };
    };
    Views: {
      // ── Fase E3 / Dashboard ──────────────────────────────────
      v_eventos_kpi: {
        Row: {
          brand_id: string;
          brand_name: string;
          brand_color: string;
          brand_slug: string;
          mes: string;
          total_eventos: number;
          eventos_aprovados: number;
          eventos_em_andamento: number;
          eventos_concluidos: number;
          eventos_cancelados: number;
          eventos_pendentes: number;
          receita_prevista: number;
          receita_realizada: number;
          total_convidados: number;
        };
      };
      v_headcount_por_marca: {
        Row: {
          brand_id: string;
          brand_name: string;
          brand_slug: string;
          headcount_ativo: number;
          demissoes_mes: number;
          admissoes_mes: number;
          folha_bruta: number;
        };
      };
      v_proximos_eventos: {
        Row: {
          id: string;
          nome: string;
          data_inicio: string;
          data_fim: string | null;
          status: EventStatus;
          num_convidados: number | null;
          valor_total: number | null;
          tipo: string | null;
          contato_cliente: string | null;
          brand_name: string;
          brand_color: string;
          brand_slug: string;
          unit_name: string | null;
          total_itens_cardapio: number;
          total_equipe: number;
        };
      };
      v_alertas: {
        Row: {
          tipo_alerta: string;
          severidade: "warning" | "error";
          brand_id: string;
          brand_name: string;
          resource_id: string;
          mensagem: string;
          created_at: string;
        };
      };
      // ── Fase E4 / Financeiro ─────────────────────────────────
      v_dre_consolidado: {
        Row: {
          brand_id: string;
          brand_name: string;
          brand_slug: string;
          competencia: string;
          receita_bruta: number;
          vendas_salao: number;
          vendas_eventos: number;
          vendas_bar: number;
          vendas_delivery: number;
          cmv_total: number;
          cmv_pct: number | null;
          folha_total: number;
          folha_pct: number | null;
          prime_cost: number;
          prime_cost_pct: number | null;
          ocupacao_total: number;
          utilidades_total: number;
          comercial_total: number;
          tributos_total: number;
          despesa_total: number;
          ebitda: number;
          ebitda_pct: number | null;
        };
      };
      v_gap_projecao_realizado: {
        Row: {
          period_id: string;
          brand_id: string;
          brand_name: string;
          brand_slug: string;
          competencia: string;
          natureza: LancamentoNatureza | null;
          categoria: string | null;
          is_evento: boolean | null;
          valor_projetado: number;
          valor_realizado: number;
          gap_absoluto: number;
          gap_pct: number | null;
          acima_threshold: boolean | null;
        };
      };
      v_aprovacoes_pendentes: {
        Row: {
          id: string;
          entry_id: string;
          brand_id: string;
          brand_name: string;
          valor: number;
          descricao: string;
          justificativa: string | null;
          status: ApprovalStatus;
          created_at: string;
          categoria_despesa: CategoriaDespesa | null;
          fornecedor: string | null;
          data_vencimento: string | null;
          solicitante_email: string | null;
        };
      };
      v_cmv_dashboard: {
        Row: {
          brand_id: string;
          brand_name: string;
          brand_slug: string;
          total_itens: number;
          sem_ficha_tecnica: number;
          itens_criticos_acima_40: number;
          itens_atencao_30_40: number;
          cmv_medio_pct: number | null;
          cmv_medio_criticos: number | null;
        };
      };
    };
    Functions: {
      kph_is_founder: { Args: Record<string, never>; Returns: boolean };
      kph_is_founder_or_cfo: { Args: Record<string, never>; Returns: boolean };
      kph_has_role_for_unit: { Args: { p_unit_id: string }; Returns: boolean };
      kph_has_role_for_brand: { Args: { p_brand_id: string }; Returns: boolean };
      kph_has_role_for_group: { Args: { p_group_id: string }; Returns: boolean };
      kph_can_write_event_brand: { Args: { p_brand_id: string }; Returns: boolean };
      kph_can_delete_event_brand: { Args: { p_brand_id: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
  };
};

// Helpers ergonômicos pra o app — pegar Row de uma tabela sem repetir caminho.
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type Views<T extends keyof Database["public"]["Views"]> =
  Database["public"]["Views"][T]["Row"];

export type EventosKpiRow = Views<"v_eventos_kpi">;
export type HeadcountMarcaRow = Views<"v_headcount_por_marca">;
export type ProximoEventoRow = Views<"v_proximos_eventos">;
export type AlertaRow = Views<"v_alertas">;

// ── Fase E4 / Financeiro ───────────────────────────────────────
export type FinancialPeriodRow = Tables<"financial_periods">;
export type CashFlowProjectionRow = Tables<"cash_flow_projections">;
export type CashFlowEntryRow = Tables<"cash_flow_entries">;
export type MenuItemRow = Tables<"menu_items">;
export type ApprovalRequestRow = Tables<"approval_requests">;
export type BrandFinancialConfigRow = Tables<"brand_financial_config">;

export type DreConsolidadoRow = Views<"v_dre_consolidado">;
export type GapProjecaoRealizadoRow = Views<"v_gap_projecao_realizado">;
export type AprovacaoPendenteRow = Views<"v_aprovacoes_pendentes">;
export type CmvDashboardRow = Views<"v_cmv_dashboard">;

export type CashFlowEntryWithPeriod = CashFlowEntryRow & {
  period: FinancialPeriodRow;
};

export type DreComMetas = DreConsolidadoRow & {
  config: BrandFinancialConfigRow;
};

export type Group = Tables<"groups">;
export type Brand = Tables<"brands">;
export type Unit = Tables<"units">;
export type BrandLink = Tables<"brand_links">;
export type RoleRow = Tables<"roles">;
export type UserRole = Tables<"user_roles">;
export type AuditLogEntry = Tables<"audit_log">;
export type EventRow = Tables<"events">;
export type EventMenuItem = Tables<"event_menu_items">;
export type EventInfraItem = Tables<"event_infra_items">;
export type EventStaff = Tables<"event_staff">;
export type EventAttachment = Tables<"event_attachments">;
export type EventStatusLog = Tables<"event_status_log">;

// Evento + relacionamentos resolvidos (usado em listagens e detalhe).
export type EventWithRelations = EventRow & {
  brand_name: string | null;
  unit_name: string | null;
  menu_items: EventMenuItem[];
  infra_items: EventInfraItem[];
  staff: EventStaff[];
};

// ── HOS RH expansion (migrations 011–018) ─────────────────────
export type EmployeeAuthRow = Tables<"employee_auth">;
export type DocumentRow = Tables<"documents">;
export type TipsRecordRow = Tables<"tips_records">;
export type TransportVoucherRow = Tables<"transport_vouchers">;
export type TimeRecordRow = Tables<"time_records">;
export type VacationRow = Tables<"vacations">;
export type OvertimeRecordRow = Tables<"overtime_records">;
export type ImportLogRow = Tables<"import_logs">;
export type CampaignRow = Tables<"campaigns">;
export type JobOpeningRow = Tables<"job_openings">;
export type CandidateRow = Tables<"candidates">;
export type InterviewQuestionRow = Tables<"interview_questions">;
export type InterviewResponseRow = Tables<"interview_responses">;

// Enums refletindo CHECK constraints das migrations
export type DocumentType = "RG" | "CPF" | "CTPS" | "contrato" | "exame" | "outro";
export type TipoContrato = "CLT" | "PJ" | "temporario" | "estagiario";
export type StatusRH = "ativo" | "inativo" | "ferias" | "afastado";
export type VacationStatus = "agendada" | "em_andamento" | "concluida" | "cancelada";
export type OvertimeType = "50" | "100" | "banco";
export type OvertimeSource = "manual" | "totvs";
export type ImportTipo = "ponto" | "holerites" | "gorjetas" | "vt";
export type CampaignCategory = "saude" | "evento" | "comunicado";
export type CampaignTarget = "all" | "department";
export type CandidateStatus = "pendente" | "aprovado" | "reprovado";
export type CandidateInterviewStatus = "pendente" | "em_andamento" | "concluido";

// ── Compras (migration 019) ───────────────────────────────────
export type PurchaseOrderStatus =
  | "rascunho"
  | "enviado"
  | "parcial"
  | "recebido"
  | "cancelado";

export type SupplierRow = Tables<"suppliers">;
export type PurchaseOrderRow = Tables<"purchase_orders">;
export type PurchaseOrderItemRow = Tables<"purchase_order_items">;

// ── Cliente / CRM (migration 020) ─────────────────────────────
export type ClientOrigem =
  | "indicacao"
  | "site"
  | "instagram"
  | "whatsapp"
  | "evento"
  | "outro";

export type ClientInteractionTipo =
  | "ligacao"
  | "email"
  | "whatsapp"
  | "reuniao"
  | "visita"
  | "outro";

export type ClientRow = Tables<"clients">;
export type ClientInteractionRow = Tables<"client_interactions">;

// ── Treinamentos / Onboarding (migration 021) ─────────────────
export type TrainingStatus =
  | "pendente"
  | "em_andamento"
  | "concluido"
  | "vencido";

export type TrainingTemplateRow = Tables<"training_templates">;
export type TrainingRecordRow = Tables<"training_records">;

// ── Avaliação de desempenho (migration 022) ───────────────────
export type PerformancePeriodicidade =
  | "mensal"
  | "trimestral"
  | "semestral"
  | "anual";

export type PerformanceReviewStatus = "rascunho" | "concluida" | "aprovada";

export type PerformanceCriterioTipo = "nota_1_5" | "sim_nao" | "texto";

export type PerformanceCriterio = {
  id: string;
  nome: string;
  descricao?: string | null;
  peso: number;
  tipo: PerformanceCriterioTipo;
};

export type PerformanceTemplateRow = Tables<"performance_templates">;
export type PerformanceReviewRow = Tables<"performance_reviews">;

// ── Metas por marca (migration 023) ───────────────────────────
export type BrandTargetRow = Tables<"brand_targets">;
export type TargetNoteRow = Tables<"target_notes">;

// ── Notificações in-app (migration 024) ───────────────────────
export type NotificationRow = Tables<"notifications">;

// ── Quality Checklists (migration 029) ────────────────────────
export type ChecklistTurno = "abertura" | "almoco" | "jantar" | "fechamento";
export type ChecklistArea  = "cozinha" | "bar" | "salao" | "higiene" | "geral";

export type ChecklistItem = {
  id: string;
  texto: string;
  obrigatorio: boolean;
};

export type QualityChecklistRow = {
  id: string;
  unit_id: string;
  nome: string;
  area: ChecklistArea;
  turno: ChecklistTurno;
  items: ChecklistItem[];
  ativo: boolean;
  created_at: string;
};

export type ChecklistRecordRow = {
  id: string;
  checklist_id: string;
  unit_id: string;
  data: string;
  turno: ChecklistTurno;
  responsavel_id: string | null;
  respostas: Record<string, boolean>;
  score_pct: number | null;
  observacoes: string | null;
  created_at: string;
};

// ── Reservations (migration 031) ──────────────────────────────
export type ReservationStatus = "pendente" | "confirmada" | "cancelada" | "no_show" | "finalizada";
export type ReservationOrigem = "whatsapp" | "telefone" | "email" | "tagme" | "presencial" | "instagram";

export type ReservationRow = {
  id: string;
  unit_id: string;
  data: string;
  hora: string;
  pax: number;
  status: ReservationStatus;
  origem: ReservationOrigem;
  cliente_nome: string;
  cliente_telefone: string | null;
  cliente_email: string | null;
  mesa: string | null;
  observacoes: string | null;
  confirmado_por: string | null;
  confirmado_em: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// ── Price Quotes (migration 032) ──────────────────────────────
export type QuoteStatus = "rascunho" | "enviada" | "recebida" | "aprovada" | "cancelada";

export type PriceQuoteRow = {
  id: string;
  unit_id: string;
  supplier_id: string | null;
  periodo: string;
  status: QuoteStatus;
  titulo: string | null;
  observacoes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PriceQuoteItemRow = {
  id: string;
  quote_id: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  preco_unitario: number | null;
  total: number | null;
  observacoes: string | null;
  created_at: string;
};
