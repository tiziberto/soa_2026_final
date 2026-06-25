// Utilidades de formato y una sesión mínima (placeholder de Keycloak).
import { reactive } from 'vue'

// --- tema claro/oscuro ------------------------------------------------------
// El valor inicial lo fija un script en <head> (anti-parpadeo) leyendo
// localStorage o, si no hay preferencia, el tema del sistema. Aquí solo lo
// reflejamos en un estado reactivo y exponemos el conmutador.
const THEME_KEY = 'atalaya.theme'
export const theme = reactive({ mode: document.documentElement.dataset.theme || 'light' })
export function toggleTheme() {
  theme.mode = theme.mode === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme.mode
  try { localStorage.setItem(THEME_KEY, theme.mode) } catch (e) { /* almacenamiento no disponible */ }
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = theme.mode === 'dark' ? '#17150F' : '#F6F4EF'
}

export function timeAgo(iso) {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'hace instantes'
  const m = Math.floor(s / 60); if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60); if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24); if (d < 30) return `hace ${d} d`
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '·'
}

export const pct = (v) => `${Math.round((v || 0) * 100)}%`

// --- sesión (placeholder) ---------------------------------------------------
// Hoy guarda una sesión local. Aquí se integra Keycloak (OIDC) cuando el
// equipo defina realm + client-id; ver /auth/ en nginx.conf.
const KEY = 'atalaya.session'
export const session = reactive({
  user: JSON.parse(localStorage.getItem(KEY) || 'null'),
})
// Acepta un nombre suelto o un objeto { name, email, personId, role }.
export function signIn(u) {
  const base = { name: 'Operador', role: 'Operador' }
  session.user = typeof u === 'string'
    ? { ...base, name: u || 'Operador' }
    : { ...base, ...u, name: (u && u.name) || 'Operador' }
  localStorage.setItem(KEY, JSON.stringify(session.user))
}
// --- cuentas locales (placeholder de auth, hasta integrar Keycloak) ----------
// Guardan { email, password, name, personId, twoFactor } por email. Sirven para
// validar el login con mail+contraseña y saber si la cuenta tiene 2FA.
const ACCOUNTS_KEY = 'atalaya.accounts'
function readAccounts() { try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '{}') } catch (e) { return {} } }
export function getAccount(email) {
  return email ? (readAccounts()[String(email).trim().toLowerCase()] || null) : null
}
export function upsertAccount(acc) {
  if (!acc || !acc.email) return
  const all = readAccounts(); const k = String(acc.email).trim().toLowerCase()
  all[k] = { ...(all[k] || {}), ...acc, email: String(acc.email).trim() }
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(all)) } catch (e) { /* sin almacenamiento */ }
}

// --- roles (Keycloak) -------------------------------------------------------
// Jerarquía: admin > operator > viewer.
//   viewer   -> solo lectura
//   operator -> lectura + carga de imágenes/análisis y alta de datos
//   admin    -> todo (incluye operaciones destructivas)
// Sin ningún rol reconocido caemos a 'operator' por compatibilidad mientras se
// terminan de asignar los roles en Keycloak; endurecé a 'viewer' si querés
// denegar por defecto. La autorización REAL la hace el backend (Node-RED);
// esto solo decide qué se muestra/oculta en la interfaz.
const ROLE_FALLBACK = 'operator'
export function pickRole(roles = []) {
  if (roles.includes('admin')) return 'admin'
  if (roles.includes('operator')) return 'operator'
  if (roles.includes('viewer')) return 'viewer'
  return ROLE_FALLBACK
}
export function userRoles() { return (session.user && session.user.roles) || [] }
export function primaryRole() { return (session.user && session.user.role) || pickRole(userRoles()) }
export function isAdmin() { return primaryRole() === 'admin' }
export function isViewer() { return primaryRole() === 'viewer' }
// Puede escribir (alta de personas, muestras, análisis de imágenes): operator o admin.
export function canWrite() { const r = primaryRole(); return r === 'operator' || r === 'admin' }

// Mezcla cambios en la sesión actual y los persiste (p. ej. personId, twoFactor).
export function updateUser(patch) {
  if (!session.user) return
  session.user = { ...session.user, ...patch }
  localStorage.setItem(KEY, JSON.stringify(session.user))
}
export function signOut() {
  session.user = null
  localStorage.removeItem(KEY)
}
