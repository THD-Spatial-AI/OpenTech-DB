#!/usr/bin/env bash
set -euo pipefail

DB=supabase-db
PSQL=(docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1)

echo "Waiting for Postgres..."
for i in $(seq 1 60); do
  docker exec "$DB" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  [ "$i" = 60 ] && { echo "Postgres did not become ready"; exit 1; }
  sleep 2
done

# Migration 005 references auth.users, which GoTrue creates on first boot.
echo "Waiting for GoTrue to initialise the auth schema..."
for i in $(seq 1 60); do
  ok=$(docker exec "$DB" psql -U postgres -d postgres -tAc \
       "SELECT 1 FROM pg_tables WHERE schemaname='auth' AND tablename='users'" 2>/dev/null || true)
  [ "$ok" = "1" ] && break
  [ "$i" = 60 ] && { echo "auth schema never appeared — is supabase-auth running?"; exit 1; }
  sleep 2
done

"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS public._applied_migrations (
  name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());" >/dev/null

for f in supabase/migrations/*.sql; do
  name=$(basename "$f")
  done_flag=$(docker exec "$DB" psql -U postgres -d postgres -tAc \
    "SELECT 1 FROM public._applied_migrations WHERE name='$name'")
  if [ "$done_flag" = "1" ]; then
    echo "  skip  $name"
    continue
  fi
  echo "  apply $name"
  "${PSQL[@]}" --single-transaction < "$f"
  "${PSQL[@]}" -c "INSERT INTO public._applied_migrations (name) VALUES ('$name')" >/dev/null
done

echo "Migrations up to date."
