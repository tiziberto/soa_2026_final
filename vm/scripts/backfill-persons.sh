#!/usr/bin/env bash
# Crea la fila en 'persons' para toda cuenta de Keycloak que no la tenga.
# Idempotente: ON CONFLICT por email actualiza el keycloak_user_id.
# Útil para cuentas registradas antes de que /register creara la persona solo.
#
# Uso (en el server):
#   cd ~/tp-integrador-soa
#   set -a; . ./.env; set +a
#   KC_URL=https://soagbct2026.mooo.com/auth ./scripts/backfill-persons.sh
set -euo pipefail
KC_URL="${KC_URL:-http://soa_keycloak:8080}"
REALM="${KC_REALM:-atalaya}"
: "${KEYCLOAK_ADMIN:?falta KEYCLOAK_ADMIN}"
: "${KEYCLOAK_ADMIN_PASSWORD:?falta KEYCLOAK_ADMIN_PASSWORD}"
: "${POSTGRES_USER:?falta POSTGRES_USER}"
: "${POSTGRES_DB:?falta POSTGRES_DB}"

echo ">> token admin"
TOKEN=$(curl -fsS -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d client_id=admin-cli -d grant_type=password \
  --data-urlencode "username=${KEYCLOAK_ADMIN}" \
  --data-urlencode "password=${KEYCLOAK_ADMIN_PASSWORD}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

echo ">> usuarios de Keycloak"
USERS=$(curl -fsS -H "Authorization: Bearer ${TOKEN}" "${KC_URL}/admin/realms/${REALM}/users?max=2000")

SQL=$(printf '%s' "$USERS" | python3 -c '
import sys, json
us = json.load(sys.stdin)
q = chr(39)
def esc(s): return q + str(s).replace(q, q+q) + q
rows = []
for u in us:
    e = (u.get("email") or "").strip().lower()
    if not e: continue
    f = u.get("firstName") or e
    l = u.get("lastName") or e
    rows.append("(%s,%s,%s,%s)" % (esc(f), esc(l), esc(e), esc(u.get("id"))))
if rows:
    print("INSERT INTO persons (first_name,last_name,email,keycloak_user_id) VALUES "
          + ",".join(rows)
          + " ON CONFLICT (email) DO UPDATE SET keycloak_user_id = EXCLUDED.keycloak_user_id;")
')

if [ -z "$SQL" ]; then echo "no hay usuarios con email; nada que hacer"; exit 0; fi

echo ">> aplicando en Postgres"
printf '%s\n' "$SQL" | docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"
echo ">> listo"
