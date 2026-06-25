#!/usr/bin/env bash
# Diagnostico de roles del realm ATALAYA (tolerante a errores).
# Muestra: todos los roles del realm, que hereda un usuario nuevo
# (composites de default-roles-*), la jerarquia, y los roles de un usuario.
#
# Uso:
#   set -a; . ./.env; set +a
#   KC_URL=https://soagbct2026.mooo.com/auth ./scripts/keycloak-debug-roles.sh "Red Jhon"
#   (el argumento puede ser email, username, nombre o apellido)
set -uo pipefail
KC_URL="${KC_URL:-http://soa_keycloak:8080}"
REALM="${KC_REALM:-atalaya}"
TERM_="${1:-}"
: "${KEYCLOAK_ADMIN:?falta KEYCLOAK_ADMIN}"
: "${KEYCLOAK_ADMIN_PASSWORD:?falta KEYCLOAK_ADMIN_PASSWORD}"

TOKEN=$(curl -fsS -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d client_id=admin-cli -d grant_type=password \
  --data-urlencode "username=${KEYCLOAK_ADMIN}" \
  --data-urlencode "password=${KEYCLOAK_ADMIN_PASSWORD}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
[ -z "$TOKEN" ] && { echo "!! no pude obtener token admin"; exit 1; }

# GET tolerante: imprime el body si 200, o "(HTTP xxx)" si falla. Nunca aborta.
kc_get() {
  local body code
  body=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer ${TOKEN}" "${KC_URL}$1")
  code=$(printf '%s' "$body" | tail -n1)
  body=$(printf '%s' "$body" | sed '$d')
  if [ "$code" = "200" ]; then printf '%s' "$body"; else printf '__HTTP_%s__' "$code"; fi
}
names() { python3 -c 'import sys,json
s=sys.stdin.read()
if s.startswith("__HTTP_"): print("(error "+s.strip("_")+")"); sys.exit()
try: d=json.loads(s)
except: print("(respuesta no-JSON)"); sys.exit()
print(", ".join(sorted(r.get("name","?") for r in d)) or "(ninguno)")'; }

echo "=== TODOS los roles del realm ${REALM} ==="
kc_get "/admin/realms/${REALM}/roles" | names

echo "=== composites de default-roles-${REALM} (lo que hereda un usuario nuevo) ==="
kc_get "/admin/realms/${REALM}/roles/default-roles-${REALM}/composites" | names

echo "=== jerarquia (admin debe incluir operator; operator debe incluir viewer) ==="
for r in admin operator viewer; do
  printf "  %-9s incluye: " "$r"
  kc_get "/admin/realms/${REALM}/roles/${r}/composites" | names
done

if [ -n "$TERM_" ]; then
  Q=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$TERM_")
  RES=$(kc_get "/admin/realms/${REALM}/users?search=${Q}")
  echo "=== usuarios que matchean '${TERM_}' ==="
  echo "$RES" | python3 -c 'import sys,json
s=sys.stdin.read()
if s.startswith("__HTTP_"): print("  (error "+s.strip("_")+")"); sys.exit()
d=json.loads(s)
if not d: print("  (ninguno)"); sys.exit()
for u in d: print("  - id=%s username=%s email=%s nombre=%s %s" % (u.get("id"),u.get("username"),u.get("email"),u.get("firstName",""),u.get("lastName","")))'
  for UID_ in $(echo "$RES" | python3 -c 'import sys,json
s=sys.stdin.read()
if s.startswith("__HTTP_"): sys.exit()
[print(u["id"]) for u in json.loads(s)]'); do
    echo "--- usuario ${UID_} ---"
    echo -n "  roles ASIGNADOS directamente: "
    kc_get "/admin/realms/${REALM}/users/${UID_}/role-mappings/realm" | names
    echo -n "  roles EFECTIVOS (con composites): "
    kc_get "/admin/realms/${REALM}/users/${UID_}/role-mappings/realm/composite" | names
  done
fi
