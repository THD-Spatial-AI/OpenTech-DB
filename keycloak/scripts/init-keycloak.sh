#!/usr/bin/env bash
set -euo pipefail

keycloak_url="${KEYCLOAK_URL:-http://keycloak:8080}"
realm="${KEYCLOAK_REALM:-opentechdb}"
client_id="${KEYCLOAK_CLIENT_ID:-opentechdb-auth}"
callback_url="${OPENTECHDB_AUTH_CALLBACK_URL:?set OPENTECHDB_AUTH_CALLBACK_URL}"
frontend_url="${OPENTECHDB_FRONTEND_URL:?set OPENTECHDB_FRONTEND_URL}"
kcadm="/opt/keycloak/bin/kcadm.sh"

for attempt in $(seq 1 60); do
  if "$kcadm" config credentials \
    --server "$keycloak_url" \
    --realm master \
    --user "$KEYCLOAK_ADMIN_USERNAME" \
    --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "Keycloak administration API did not become ready" >&2
    exit 1
  fi
  sleep 2
done

for attempt in $(seq 1 30); do
  if "$kcadm" get "realms/$realm" >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "Realm '$realm' was not imported" >&2
    exit 1
  fi
  sleep 2
done

service_account="service-account-$client_id"
echo "Assigning service-account permissions"
for role in manage-users view-users query-users view-realm; do
  "$kcadm" add-roles \
    --target-realm "$realm" \
    --uusername "$service_account" \
    --cclientid realm-management \
    --rolename "$role"
done

echo "Configuring OpenTech client callbacks"
client_uuid="$($kcadm get clients --target-realm "$realm" --query "clientId=$client_id" --fields id --format csv --noquotes)"
if [ -z "$client_uuid" ]; then
  echo "Client '$client_id' was not imported" >&2
  exit 1
fi

"$kcadm" update "clients/$client_uuid" \
  --target-realm "$realm" \
  --set standardFlowEnabled=true \
  --set "redirectUris=[\"$callback_url\"]" \
  --set "webOrigins=[\"$frontend_url\"]"

# Existing realms are not overwritten by --import-realm. Apply the restricted
# username/email-only profile and default contributor role on every startup.
echo "Applying username/email-only user profile"
"$kcadm" update users/profile \
  --target-realm "$realm" \
  --file /realm/opentechdb-user-profile.json
echo "Configuring default contributor role"
"$kcadm" add-roles \
  --target-realm "$realm" \
  --rname "default-roles-$realm" \
  --rolename contributor

echo "OpenTech DB realm and service-account permissions are ready"
