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

# PostgREST caches the schema at startup; tell it to pick up new tables.
echo "Reloading PostgREST schema cache..."
docker exec "$DB" psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';" >/dev/null

echo "Migrations up to date."
