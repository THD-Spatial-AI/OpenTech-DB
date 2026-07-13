#!/usr/bin/env bash
# Generate production Supabase secrets (once) and patch /opt/opentech-db/.env
# so the backend container and the frontend build pick up the right URLs/keys.
# Idempotent: existing secrets are kept, only missing pieces are (re)written.
set -euo pipefail

ENV_FILE=/opt/opentech-db/.env
SB_ENV=/opt/opentech-db/supabase.env
SITE_URL=https://otdb.th-deg.de
SUPABASE_PUBLIC_URL="$SITE_URL/supabase"

mkdir -p /opt/opentech-db/supabase/db-data

# ── Generate secrets on first run ─────────────────────────────────────────────
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

sign_jwt() {  # sign_jwt <role> <secret> — HS256 JWT valid for 10 years
  local role=$1 secret=$2
  local iat exp header payload h p s
  iat=$(date +%s)
  exp=$((iat + 315360000))
  header='{"alg":"HS256","typ":"JWT"}'
  payload="{\"role\":\"$role\",\"iss\":\"supabase\",\"iat\":$iat,\"exp\":$exp}"
  h=$(printf '%s' "$header" | b64url)
  p=$(printf '%s' "$payload" | b64url)
  s=$(printf '%s' "$h.$p" | openssl dgst -sha256 -hmac "$secret" -binary | b64url)
  printf '%s.%s.%s' "$h" "$p" "$s"
}

if [ ! -f "$SB_ENV" ]; then
  echo "Generating new Supabase production secrets → $SB_ENV"
  JWT_SECRET=$(openssl rand -hex 32)
  POSTGRES_PASSWORD=$(openssl rand -hex 16)
  ANON_KEY=$(sign_jwt anon "$JWT_SECRET")
  SERVICE_ROLE_KEY=$(sign_jwt service_role "$JWT_SECRET")

  cat > "$SB_ENV" <<EOF
# Supabase self-hosted production secrets — generated $(date -Is). DO NOT COMMIT.
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SITE_URL=$SITE_URL
API_EXTERNAL_URL=$SUPABASE_PUBLIC_URL/auth/v1
# Optional GitHub OAuth login for Supabase Auth:
GITHUB_OAUTH_ENABLED=false
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_SECRET=
EOF
  chmod 600 "$SB_ENV"
else
  echo "Using existing secrets from $SB_ENV"
fi

set -a; source "$SB_ENV"; set +a
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
sed -e "s|\${SUPABASE_ANON_KEY}|$ANON_KEY|g" \
    -e "s|\${SUPABASE_SERVICE_KEY}|$SERVICE_ROLE_KEY|g" \
    "$SCRIPT_DIR/kong.yml" > /opt/opentech-db/kong.yml
chmod 644 /opt/opentech-db/kong.yml

set_kv() {  # set_kv <key> <value>
  if grep -q "^$1=" "$ENV_FILE"; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}

set_kv SUPABASE_URL "http://supabase-kong:8000"
set_kv SUPABASE_SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
set_kv SUPABASE_JWT_SECRET "$JWT_SECRET"
set_kv VITE_SUPABASE_URL "$SUPABASE_PUBLIC_URL"
set_kv VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY "$ANON_KEY"

echo "Patched $ENV_FILE (SUPABASE_URL, keys, VITE_ vars)."
