// Autenticación con Keycloak vía OIDC Authorization Code + PKCE (cliente público).
// Sin dependencias: usa fetch + Web Crypto. Reemplaza el login local placeholder.
//
// >>> AJUSTÁ ESTO para que coincida con tu Keycloak <<<
const CONFIG = {
  base: 'https://soagbct2026.mooo.com/auth',  // = KC_HOSTNAME (nginx /auth/)
  realm: 'atalaya',                            // nombre de tu realm
  clientId: 'atalaya-frontend',                // client id público (PKCE S256)
  redirectUri: location.origin + '/',          // debe estar en "Valid redirect URIs"
}

const ISS = () => `${CONFIG.base}/realms/${encodeURIComponent(CONFIG.realm)}`
const EP = {
  auth:          () => `${ISS()}/protocol/openid-connect/auth`,
  registrations: () => `${ISS()}/protocol/openid-connect/registrations`,
  token:         () => `${ISS()}/protocol/openid-connect/token`,
  logout:        () => `${ISS()}/protocol/openid-connect/logout`,
}

const TK_KEY = 'atalaya.kc'
const PKCE_KEY = 'atalaya.pkce'
// Marcador de "ya pasé el 2FA en esta sesión" (lo usa Login). Vive lo mismo que
// el token: se borra junto con él (logout/expiración), así un re-login re-pide 2FA.
const TFA_KEY = 'atalaya.2fa'
let tokens = (() => { try { return JSON.parse(sessionStorage.getItem(TK_KEY) || 'null') } catch (e) { return null } })()
function saveTokens(t) { tokens = t; try { sessionStorage.setItem(TK_KEY, JSON.stringify(t)) } catch (e) {} }
function clearTokens() { tokens = null; try { sessionStorage.removeItem(TK_KEY) } catch (e) {} try { sessionStorage.removeItem(TFA_KEY) } catch (e) {} }

// --- helpers PKCE / JWT ---
function b64url(buf) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function randStr(n = 48) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a) }
async function challengeFrom(verifier) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64url(d)
}
function decodeJwt(t) {
  try { return JSON.parse(decodeURIComponent(escape(atob(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))) }
  catch (e) { return {} }
}
function accessExpired() {
  if (!tokens || !tokens.access_token) return true
  const exp = (decodeJwt(tokens.access_token).exp || 0) * 1000
  return Date.now() > exp - 5000
}

async function authorize(endpoint) {
  const verifier = randStr()
  const state = randStr(16)
  try { sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state })) } catch (e) {}
  const params = new URLSearchParams({
    client_id: CONFIG.clientId,
    redirect_uri: CONFIG.redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    state,
    code_challenge: await challengeFrom(verifier),
    code_challenge_method: 'S256',
  })
  location.href = `${endpoint}?${params.toString()}`
}

export const auth = {
  get token() { return tokens && tokens.access_token }, // sin chequear expiración (lo maneja el refresh)
  get authenticated() { return !!(tokens && tokens.access_token && !accessExpired()) },

  login() { return authorize(EP.auth()) },
  register() { return authorize(EP.registrations()) },

  // Logout local + revocación en segundo plano (POST al endpoint de logout),
  // SIN redirigir a la pantalla de Keycloak. Como entramos por Direct Grant no
  // hay sesión de navegador en Keycloak, así que no hace falta su confirmación.
  async logout() {
    const rt = tokens && tokens.refresh_token
    clearTokens()
    if (rt) {
      try {
        await fetch(EP.logout(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: CONFIG.clientId, refresh_token: rt }),
        })
      } catch (e) { /* mejor esfuerzo: la sesión local ya quedó limpia */ }
    }
  },

  // Datos de identidad desde el id_token (o access_token).
  // Los ROLES viven en el access_token (realm_access.roles y, si se mapean,
  // resource_access[client].roles): Keycloak no los pone en el id_token por
  // defecto. Los exponemos como `roles` para el control de acceso del front.
  profile() {
    const c = tokens ? decodeJwt(tokens.id_token || tokens.access_token) : {}
    const a = tokens ? decodeJwt(tokens.access_token) : {}
    const realmRoles = (a.realm_access && a.realm_access.roles) || []
    const cli = (a.resource_access && a.resource_access[CONFIG.clientId] && a.resource_access[CONFIG.clientId].roles) || []
    const roles = [...new Set([...realmRoles, ...cli])]
    return {
      sub: c.sub,
      email: c.email || null,
      given_name: c.given_name || null,
      family_name: c.family_name || null,
      name: c.name || [c.given_name, c.family_name].filter(Boolean).join(' ') || c.preferred_username || c.email || null,
      roles,
    }
  },

  // Procesa el redirect (?code=) y canjea por tokens. Devuelve true si quedó logueado.
  async init() {
    const url = new URL(location.href)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (code) {
      let saved = null
      try { saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null') } catch (e) {}
      try { sessionStorage.removeItem(PKCE_KEY) } catch (e) {}
      history.replaceState({}, '', CONFIG.redirectUri)  // limpia ?code de la URL
      if (!saved || saved.state !== state) return false
      try {
        const res = await fetch(EP.token(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CONFIG.clientId,
            code,
            redirect_uri: CONFIG.redirectUri,
            code_verifier: saved.verifier,
          }),
        })
        if (!res.ok) return false
        saveTokens(await res.json())
        return true
      } catch (e) { return false }
    }
    // Sin code: si el access venció pero hay refresh, renovamos en silencio.
    if (!this.authenticated && tokens && tokens.refresh_token) {
      await this.refresh()
    }
    return this.authenticated
  },

  // Renueva el access_token con el refresh_token. Devuelve true si lo logró.
  async refresh() {
    if (!tokens || !tokens.refresh_token) return false
    try {
      const res = await fetch(EP.token(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CONFIG.clientId,
          refresh_token: tokens.refresh_token,
        }),
      })
      if (!res.ok) { clearTokens(); return false }
      saveTokens(await res.json())
      return true
    } catch (e) { clearTokens(); return false }
  },

  // Login directo con email+contraseña (Direct Access Grant / ROPC). Mantiene
  // el formulario propio sin redirigir a Keycloak. Requiere "Direct access
  // grants" habilitado en el cliente. Devuelve { ok, status }.
  async loginWithPassword(username, password) {
    try {
      const res = await fetch(EP.token(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: CONFIG.clientId,
          username,
          password,
          scope: 'openid profile email',
        }),
      })
      if (!res.ok) return { ok: false, status: res.status }
      saveTokens(await res.json())
      return { ok: true }
    } catch (e) { return { ok: false, status: 0 } }
  },

  // Limpia los tokens locales SIN redirigir a Keycloak (para cancelar un login
  // a medias o forzar volver al formulario propio).
  clearSession() { clearTokens() },
}
