#!/usr/bin/env bash
# Configura la jerarquia de roles del realm ATALAYA en Keycloak:
#   admin  ⊃ operator ⊃ viewer   (roles compuestos)
#
# Idempotente: se puede correr varias veces sin romper nada.
# Requiere: realm "atalaya" con los roles realm "admin", "operator" y "viewer"
# ya creados, y el rol "viewer" agregado a "default-roles-atalaya".
#
# Uso (desde el server donde corre el stack):
#   KEYCLOAK_ADMIN=... KEYCLOAK_ADMIN_PASSWORD=... ./scripts/keycloak-setup-roles.sh
#   # o si tenes las vars en .env:  set -a; . ./.env; set +a; ./scripts/keycloak-setup-roles.sh
set -euo pipefail

# Si Keycloak es alcanzable por la red de Docker usa el nombre del contenedor;
# si lo corres desde fuera, exporta KC_URL=https://tu-dominio/auth
KC_URL="${KC_URL:-http://soa_keycloak:8080}"
REALM="${KC_REALM:-atalaya}"
: "${KEYCLOAK_ADMIN:?falta KEYCLOAK_ADMIN}"
: "${KEYCLOAK_ADMIN_PASSWORD:?falta KEYCLOAK_ADMIN_PASSWORD}"

echo ">> Obteniendo token de admin en ${KC_URL}"
TOKEN=$(curl -fsS -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d client_id=admin-cli -d grant_type=password \
  --data-urlencode "username=${KEYCLOAK_ADMIN}" \
  --data-urlencode "password=${KEYCLOAK_ADMIN_PASSWORD}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

AUTH=(-H "Authorization: Bearer ${TOKEN}")

# Devuelve la representacion JSON de un rol realm por nombre
get_role() { curl -fsS "${AUTH[@]}" "${KC_URL}/admin/realms/${REALM}/roles/$1"; }

# Agrega $2 (rol hijo) como asociado del rol compuesto $1 (rol padre).
# Marca el padre como composite automaticamente.
add_composite() {
  local parent="$1" child="$2"
  echo ">> ${parent} ⊃ ${child}"
  local child_rep
  child_rep=$(get_role "$child")
  curl -fsS -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/roles/${parent}/composites" \
    -d "[${child_rep}]" >/dev/null
}

add_composite operator viewer    # operator hereda lo de viewer
add_composite admin    operator  # admin hereda operator (y transitivamente viewer)

echo ">> Jerarquia configurada: admin ⊃ operator ⊃ viewer"
