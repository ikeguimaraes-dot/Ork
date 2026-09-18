// Tipos do módulo Pessoas (Fase 1).
// Espelha supabase/migrations/003_pessoas.sql.
//
// NUMERIC do Postgres vem como string no JSON da API REST (preserva precisão).
// Mantemos como string e convertemos pra Number só onde for fazer cálculo na UI.

import type { Json } from "./database";

export type ShiftTipo = "normal" | "extra" | "folga" | "feriado";

export type PunchTipo = "entrada" | "saida" | "intervalo_inicio" | "intervalo_fim";

export type PayslipStatus = "rascunho" | "aprovado" | "pago";

export type TipoConta = "corrente" | "poupanca" | "salario" | string;

// Migration 011 (HOS RH) adicionou 23 campos opcionais ao employees.
// `score` e `status_rh` são NOT NULL com defaults — opcionais no Insert.
export type TipoContrato = "CLT" | "PJ" | "temporario" | "estagiario";
export type StatusRH = "ativo" | "inativo" | "ferias" | "afastado";

export type Employee = {
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
  salario_base: string;          // NUMERIC(10,2)
  data_admissao: string;         // ISO date
  data_demissao: string | null;
  ativo: boolean;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  tipo_conta: TipoConta | null;
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
  tipo_contrato: TipoContrato | null;
  jornada: string | null;
  telefone: string | null;
  email: string | null;
  contato_emergencia_nome: string | null;
  contato_emergencia_tel: string | null;
  photo_url: string | null;
  status_rh: StatusRH;
  score: number;
  created_at: string;
  updated_at: string;
};

export type EmployeeInsert = {
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
  tipo_contrato?: TipoContrato | null;
  jornada?: string | null;
  telefone?: string | null;
  email?: string | null;
  contato_emergencia_nome?: string | null;
  contato_emergencia_tel?: string | null;
  photo_url?: string | null;
  status_rh?: StatusRH;
  score?: number;
};

export type EmployeeUpdate = Partial<Omit<EmployeeInsert, "unit_id">>;

// ── Dependentes (IRRF) ─────────────────────────────────────────
export type Dependent = {
  id: string;
  employee_id: string;
  nome: string;
  cpf: string | null;
  data_nascimento: string | null;
  parentesco: string;
  ordem: number;
  created_at: string;
};

export type DependentInsert = {
  id?: string;
  employee_id: string;
  nome: string;
  cpf?: string | null;
  data_nascimento?: string | null;
  parentesco: string;
  ordem?: number;
};

export type DependentUpdate = Partial<Omit<DependentInsert, "employee_id">>;

// ── Faltas / atestados ─────────────────────────────────────────
export type AbsenceTipo =
  | "justificada"
  | "injustificada"
  | "atestado"
  | "falta_abono"
  | string;

export type Absence = {
  id: string;
  employee_id: string;
  data: string;
  tipo: AbsenceTipo;
  motivo: string | null;
  score_impact: number;
  atestado_path: string | null;
  created_at: string;
};

export type AbsenceInsert = {
  id?: string;
  employee_id: string;
  data: string;
  tipo: AbsenceTipo;
  motivo?: string | null;
  score_impact?: number;
  atestado_path?: string | null;
};

export type AbsenceUpdate = Partial<Omit<AbsenceInsert, "employee_id">>;

// ── Advertências (CLT) ─────────────────────────────────────────
export type WarningNivel = "verbal" | "escrita" | "suspensao" | string;

export type Warning = {
  id: string;
  employee_id: string;
  nivel: WarningNivel;
  descricao: string;
  score_impact: number;
  documento_path: string | null;
  data: string;
  created_at: string;
};

export type WarningInsert = {
  id?: string;
  employee_id: string;
  nivel: WarningNivel;
  descricao: string;
  score_impact?: number;
  documento_path?: string | null;
  data?: string;
};

export type WarningUpdate = Partial<Omit<WarningInsert, "employee_id">>;

// ── Score / gamificação RH ─────────────────────────────────────
export type ScoreEvent = {
  id: string;
  employee_id: string;
  tipo: string;
  delta: number;
  descricao: string | null;
  referencia_id: string | null;
  created_at: string;
};

export type ScoreEventInsert = {
  id?: string;
  employee_id: string;
  tipo: string;
  delta: number;
  descricao?: string | null;
  referencia_id?: string | null;
};

// Joined types pra listagens de Disciplina.
export type EmployeeStub = Pick<
  Employee,
  "id" | "nome" | "sobrenome" | "funcao" | "departamento"
>;

export type WarningWithEmployee = Warning & { employee: EmployeeStub | null };
export type AbsenceWithEmployee = Absence & { employee: EmployeeStub | null };

export type EmployeeScore = {
  employee: EmployeeStub & { ativo: boolean };
  score: number;
  warnings_count: number;
  absences_count: number;
};

export type PunchWithEmployee = TimeClockPunch & { employee: EmployeeStub | null };

/** Status agregado pra cada colaborador no dia: punches + total trabalhado. */
export type PunchDaySummary = {
  employee: EmployeeStub;
  punches: TimeClockPunch[];
  worked_minutes: number;
  break_minutes: number;
  pending_count: number; // punches com aprovado=null
};

export type Shift = {
  id: string;
  employee_id: string;
  unit_id: string;
  data: string;                  // ISO date
  hora_inicio: string;           // HH:MM:SS
  hora_fim: string;
  tipo: ShiftTipo | string;
  labor_cost: string | null;
  observacao: string | null;
  created_at: string;
};

export type ShiftInsert = {
  id?: string;
  employee_id: string;
  unit_id: string;
  data: string;
  hora_inicio: string;
  hora_fim: string;
  tipo?: ShiftTipo | string;
  labor_cost?: string | number | null;
  observacao?: string | null;
};

export type ShiftUpdate = Partial<Omit<ShiftInsert, "employee_id" | "unit_id">>;

export type TimeClockPunch = {
  id: string;
  employee_id: string;
  tipo: PunchTipo | string;
  timestamp_punch: string;
  latitude: string | null;
  longitude: string | null;
  device_info: string | null;
  aprovado: boolean | null;      // null = pendente
  created_at: string;
};

export type TimeClockPunchInsert = {
  id?: string;
  employee_id: string;
  tipo: PunchTipo;
  timestamp_punch?: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  device_info?: string | null;
  aprovado?: boolean | null;
};

export type TimeBankBalance = {
  id: string;
  employee_id: string;
  saldo_minutos: number;
  ultimo_calculo: string | null;
  updated_at: string;
};

export type TimeBankBalanceUpsert = {
  id?: string;
  employee_id: string;
  saldo_minutos?: number;
  ultimo_calculo?: string | null;
};

export type Payslip = {
  id: string;
  employee_id: string;
  competencia: string;           // primeiro dia do mês (ISO date)
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
  status: PayslipStatus | string;
  pdf_url: string | null;
  created_at: string;
};

export type PayslipInsert = {
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
  status?: PayslipStatus | string;
  pdf_url?: string | null;
};

export type PayslipUpdate = Partial<Omit<PayslipInsert, "employee_id" | "competencia">>;

// Holerite com employee anexo (resultado do listPayslips/getPayslip).
export type PayslipWithEmployee = Payslip & {
  employee: Pick<Employee, "id" | "nome" | "sobrenome" | "funcao" | "salario_base"> | null;
};

export type GeneratePayslipInput = {
  employeeId: string;
  mes: number;
  ano: number;
  gorjeta?: number;
  dependentes?: number;
  descontoVT?: number;
  descontoVR?: number;
};

export type CCTVersion = {
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

export type CCTVersionInsert = {
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
};

// ── HOS RH expansion (migrations 011–018) ──────────────────────

// Documentos pessoais (storage path no bucket `employee-documents`).
export type DocumentTipo = "RG" | "CPF" | "CTPS" | "contrato" | "exame" | "outro";

export type Document = {
  id: string;
  employee_id: string;
  unit_id: string;
  name: string;
  type: DocumentTipo;
  storage_path: string;
  notes: string | null;
  uploaded_at: string;
};

export type DocumentInsert = {
  id?: string;
  employee_id: string;
  unit_id: string;
  name: string;
  type: DocumentTipo;
  storage_path: string;
  notes?: string | null;
};

export type DocumentUpdate = Partial<Omit<DocumentInsert, "employee_id" | "unit_id">>;
export type DocumentWithEmployee = Document & { employee: EmployeeStub | null };

// Auth do app mobile (sem auth.users — bcrypt em CPF).
export type EmployeeAuth = {
  id: string;
  employee_id: string;
  cpf: string;
  password_hash: string;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeAuthInsert = {
  id?: string;
  employee_id: string;
  cpf: string;
  password_hash: string;
  is_active?: boolean;
};

export type EmployeeAuthUpdate = Partial<Omit<EmployeeAuthInsert, "employee_id">>;

// Gorjetas — pontos_liquidos é GENERATED no banco.
export type TipsRecord = {
  id: string;
  employee_id: string;
  unit_id: string;
  periodo: string;          // DATE — primeiro dia do mês
  valor_ponto: string;      // NUMERIC(10,4)
  total_pontos: number;
  abatimento_pontos: number;
  pontos_liquidos: number;  // GENERATED
  observacoes: string | null;
  created_at: string;
};

export type TipsRecordInsert = {
  id?: string;
  employee_id: string;
  unit_id: string;
  periodo: string;
  valor_ponto: string | number;
  total_pontos: number;
  abatimento_pontos?: number;
  observacoes?: string | null;
};

export type TipsRecordUpdate = Partial<Omit<TipsRecordInsert, "employee_id" | "unit_id">>;
export type TipsRecordWithEmployee = TipsRecord & { employee: EmployeeStub | null };

// Vale Transporte — desconto_funcionario padrão 6%, valor_empresa = bruto - desconto.
export type TransportVoucher = {
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

export type TransportVoucherInsert = {
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
};

export type TransportVoucherUpdate = Partial<
  Omit<TransportVoucherInsert, "employee_id" | "unit_id">
>;
export type TransportVoucherWithEmployee = TransportVoucher & {
  employee: EmployeeStub | null;
};

// Banco de horas / Totvs (read-only no UI normal — vem por importação).
export type TimeRecord = {
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

export type TimeRecordInsert = Omit<TimeRecord, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type TimeRecordUpdate = Partial<Omit<TimeRecordInsert, "employee_id" | "unit_id">>;
export type TimeRecordWithEmployee = TimeRecord & { employee: EmployeeStub | null };

// Férias.
export type VacationStatus = "agendada" | "em_andamento" | "concluida" | "cancelada";

export type Vacation = {
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
  status: VacationStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type VacationInsert = {
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
  status?: VacationStatus;
  notes?: string | null;
  created_by?: string | null;
};

export type VacationUpdate = Partial<Omit<VacationInsert, "employee_id" | "unit_id">>;
export type VacationWithEmployee = Vacation & { employee: EmployeeStub | null };

// Horas Extras (manuais ou Totvs).
export type OvertimeType = "50" | "100" | "banco";
export type OvertimeSource = "manual" | "totvs";

export type OvertimeRecord = {
  id: string;
  employee_id: string;
  unit_id: string;
  date: string;
  hours: string;
  type: OvertimeType;
  reason: string | null;
  approved: boolean | null;
  approved_by: string | null;
  periodo: string | null;
  source: OvertimeSource;
  created_at: string;
};

export type OvertimeRecordInsert = {
  id?: string;
  employee_id: string;
  unit_id: string;
  date: string;
  hours: string | number;
  type: OvertimeType;
  reason?: string | null;
  approved?: boolean | null;
  approved_by?: string | null;
  periodo?: string | null;
  source?: OvertimeSource;
};

export type OvertimeRecordUpdate = Partial<
  Omit<OvertimeRecordInsert, "employee_id" | "unit_id">
>;
export type OvertimeRecordWithEmployee = OvertimeRecord & {
  employee: EmployeeStub | null;
};

// Logs de importação.
export type ImportTipo = "ponto" | "holerites" | "gorjetas" | "vt";

export type ImportLog = {
  id: string;
  unit_id: string;
  periodo: string;
  tipo: ImportTipo;
  total_linhas: number | null;
  importados: number | null;
  nao_encontrados: number | null;
  erros: number | null;
  detalhes: Json | null;
  imported_by: string | null;
  imported_at: string;
};

export type ImportLogInsert = {
  id?: string;
  unit_id: string;
  periodo: string;
  tipo: ImportTipo;
  total_linhas?: number | null;
  importados?: number | null;
  nao_encontrados?: number | null;
  erros?: number | null;
  detalhes?: Json | null;
  imported_by?: string | null;
};

export type ImportLogUpdate = Partial<Omit<ImportLogInsert, "unit_id">>;

// ── Employee Documents (migration 027) ────────────────────────────

export type EmployeeDocumentTipo =
  | "aso_admissional" | "aso_periodico" | "aso_demissional"
  | "ctps" | "rg" | "cpf" | "cnh" | "comprovante_residencia"
  | "titulo_eleitor" | "reservista" | "pis_pasep"
  | "certidao_nascimento" | "certidao_casamento"
  | "comprovante_escolaridade" | "certificado_curso"
  | "epi_recibo" | "uniforme_recibo"
  | "contrato_trabalho" | "contrato_aditivo"
  | "rescisao" | "termo_quitacao"
  | "atestado_medico" | "declaracao" | "outro";

export const DOCUMENT_TIPO_LABELS: Record<EmployeeDocumentTipo, string> = {
  aso_admissional: "ASO Admissional",
  aso_periodico: "ASO Periódico",
  aso_demissional: "ASO Demissional",
  ctps: "CTPS",
  rg: "RG",
  cpf: "CPF",
  cnh: "CNH",
  comprovante_residencia: "Comprovante de Residência",
  titulo_eleitor: "Título de Eleitor",
  reservista: "Reservista",
  pis_pasep: "PIS/PASEP",
  certidao_nascimento: "Certidão de Nascimento",
  certidao_casamento: "Certidão de Casamento",
  comprovante_escolaridade: "Comprovante de Escolaridade",
  certificado_curso: "Certificado de Curso",
  epi_recibo: "Recibo de EPI",
  uniforme_recibo: "Recibo de Uniforme",
  contrato_trabalho: "Contrato de Trabalho",
  contrato_aditivo: "Aditivo Contratual",
  rescisao: "Rescisão",
  termo_quitacao: "Termo de Quitação",
  atestado_medico: "Atestado Médico",
  declaracao: "Declaração",
  outro: "Outro",
};

export interface EmployeeDocument {
  id: string;
  employee_id: string;
  tipo: EmployeeDocumentTipo;
  nome: string;
  descricao: string | null;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  data_emissao: string | null;
  data_validade: string | null;
  observacoes: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeDocumentWithEmployee extends EmployeeDocument {
  employee: { id: string; nome: string; sobrenome: string; funcao: string; unit_id: string } | null;
}

export type DocStatus = "valido" | "vencendo" | "vencido" | "sem_validade";

export function getDocStatus(data_validade: string | null): DocStatus {
  if (!data_validade) return "sem_validade";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in30 = new Date(today);
  in30.setDate(in30.getDate() + 30);
  const todayStr = today.toISOString().slice(0, 10);
  const in30Str = in30.toISOString().slice(0, 10);
  if (data_validade < todayStr) return "vencido";
  if (data_validade <= in30Str) return "vencendo";
  return "valido";
}
