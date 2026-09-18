// Re-exporta os tipos do schema Supabase. A source of truth é database.ts.

export type {
  Database,
  Tables,
  Group,
  Brand,
  Unit,
  RoleRow,
  UserRole,
  AuditLogEntry,
  RoleName,
  Json,
} from "./database";
