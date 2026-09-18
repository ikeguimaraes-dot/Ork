#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Explicitly local: resets only the disposable Ork development database.
supabase start --exclude studio,imgproxy,edge-runtime,realtime,logflare,vector,postgres-meta
supabase db reset --local
docker exec -i supabase_db_ork psql -U postgres -v ON_ERROR_STOP=1 < tests/sql/financeiro-integridade.sql
printf '%s\n' 'OK: instalação limpa Supabase, RLS, rollback, substituição e revisão.'
