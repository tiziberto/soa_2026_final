// Acceso con el formulario propio (estilo Atalaya):
//  - Email + contraseña validados contra Keycloak vía Direct Grant (sin redirigir).
//  - Si la cuenta tiene doble factor, después pide verificación facial
//    (POST /api/face-recognition) contra su persona.
//  - "Crear cuenta" usa el formulario propio: crea el usuario en Keycloak vía el
//    backend (POST /api/register, con token admin del lado servidor) y luego entra
//    por Direct Grant, que crea la persona vinculada por email.
import { auth } from '../auth.js'
import { session, signIn, signOut, updateUser, getAccount, upsertAccount, pickRole } from '../util.js'
import { api } from '../api.js'
import { navigate } from '../router.js'

// Marcador de "2FA superado en esta sesión", atado al sub del usuario. Vive en
// sessionStorage (sobrevive al refresh, se va al cerrar la pestaña) y auth.js lo
// borra junto con el token (logout/expiración) → un re-login vuelve a pedir 2FA.
const TFA_KEY = 'atalaya.2fa'
function markFacePassed(sub) { try { sessionStorage.setItem(TFA_KEY, String(sub || '1')) } catch (e) {} }
function facePassed(sub) { try { return !!sub && sessionStorage.getItem(TFA_KEY) === String(sub) } catch (e) { return false } }

export const Login = {
  data: () => ({
    mode: 'signin',   // 'signin' | 'signup'
    email: '', pass: '', loggingIn: false, error: null, resuming: false,
    // alta de cuenta (formulario propio, sin pantalla de Keycloak)
    rFirst: '', rLast: '', rEmail: '', rPass: '', rPass2: '',
    registering: false, regError: null,
    // 2º factor
    needs2fa: false, account: null, profile: null, pid: null,
    faceImg: null, verifying: false, faceError: null,
    faceKey: 0, attempts: 0,
    serverTwoFactor: null, hasFace: false,   // estado 2FA del servidor
  }),
  // Al cargar la app con un token de Keycloak válido pero sin sesión local
  // (refresco, URL manipulada, pestaña nueva): re-derivamos la sesión y exigimos
  // el 2FA si corresponde, antes de dar acceso. Nunca se entra sin pasar por acá.
  async mounted() {
    if (auth.authenticated && !session.user) {
      this.resuming = true
      try { await this.proceedAfterAuth() }
      catch (e) { this.error = 'No se pudo verificar la sesión.' }
      finally { this.resuming = false }
    }
  },
  computed: { maxAttempts() { return 3 } },
  methods: {
    // Cambia entre "ingresar" y "crear cuenta" usando SIEMPRE el formulario propio.
    showSignup() { this.mode = 'signup'; this.error = null; this.regError = null },
    showSignin() { this.mode = 'signin'; this.error = null; this.regError = null },

    // Alta de cuenta con el formulario propio: crea el usuario en Keycloak vía el
    // backend (POST /api/register) y, si sale bien, entra solo con Direct Grant.
    // Ese login dispara proceedAfterAuth → resolvePerson, que crea la persona
    // vinculada por el email indicado. Misma lógica que el ingreso normal.
    async submitRegister() {
      this.regError = null
      const email = this.rEmail.trim()
      if (!email || !this.rPass) { this.regError = 'Completá email y contraseña.'; return }
      if (this.rPass.length < 6) { this.regError = 'La contraseña debe tener al menos 6 caracteres.'; return }
      if (this.rPass !== this.rPass2) { this.regError = 'Las contraseñas no coinciden.'; return }
      this.registering = true
      try {
        const r = await api.register({
          email,
          password: this.rPass,
          first_name: this.rFirst.trim(),
          last_name: this.rLast.trim(),
        })
        if (!r.ok) {
          this.regError = r.status === 409 ? 'Ya existe una cuenta con ese email.'
            : r.status === 0 ? 'No se pudo contactar al servidor.'
            : (r.error || 'No se pudo crear la cuenta. Probá de nuevo.')
          return
        }
        // Cuenta creada: entrar directo con las mismas credenciales (Direct Grant).
        const login = await auth.loginWithPassword(email, this.rPass)
        if (!login.ok) {
          // El alta salió bien pero el ingreso automático falló: caer al login.
          this.mode = 'signin'; this.email = email; this.pass = ''
          this.error = 'Cuenta creada. Ingresá con tu email y contraseña.'
          return
        }
        await this.proceedAfterAuth()
      } catch (e) {
        this.regError = 'No se pudo crear la cuenta. Probá de nuevo.'
      } finally {
        this.registering = false
      }
    },

    async submit() {
      if (!this.email.trim() || !this.pass) return
      this.loggingIn = true; this.error = null
      try {
        const r = await auth.loginWithPassword(this.email.trim(), this.pass)
        if (!r.ok) {
          this.error = r.status === 0 ? 'No se pudo contactar a Keycloak.' : 'Email o contraseña incorrectos.'
          return
        }
        await this.proceedAfterAuth()
      } catch (e) {
        this.error = 'No se pudo iniciar sesión. Probá de nuevo.'
      } finally {
        this.loggingIn = false
      }
    },

    // Tras autenticar con Keycloak (login o resumen al refrescar): resuelve la
    // persona, decide si exige 2FA y, si no, entra. Es el ÚNICO camino al panel.
    async proceedAfterAuth() {
      const p = auth.profile()
      this.profile = p
      const person = await this.resolvePerson(p)
      const acc = getAccount(p.email)
      // 2FA: el SERVIDOR es la única fuente de verdad (persons.extra.two_factor).
      // Si eligió 2FA, eso manda; si no (null), lo inferimos por los embeddings
      // REALES de la persona. NO usamos el flag local (localStorage): quedaba viejo
      // y, al recrear una cuenta borrada con el mismo email, pedía 2FA sin existir.
      this.serverTwoFactor = (person && typeof person.twoFactor === 'boolean') ? person.twoFactor : null
      this.hasFace = !!(person && person.embeddings > 0)
      const has2fa = (this.serverTwoFactor != null) ? this.serverTwoFactor : this.hasFace
      // Si el servidor dice que NO hay 2FA, limpiamos cualquier respaldo local
      // obsoleto de este email para que no reaparezca.
      if (!has2fa && acc && acc.twoFactor) {
        upsertAccount({ email: p.email, twoFactor: false, twoFactorConfigured: false, personId: (person && person.id) || acc.personId, name: acc.name })
      }
      if (has2fa) {
        // Si ya pasó el 2FA en esta sesión (refresh), no lo volvemos a pedir.
        if (facePassed(p.sub)) { this.enter(); return }
        this.account = acc
        this.pid = (person && person.id) || (acc && acc.personId) || this.pid
        this.needs2fa = true; this.faceImg = null; this.faceError = null
        this.attempts = 0; this.faceKey++
      } else {
        this.enter()
      }
    },

    // Encuentra la persona del padrón ligada por email. La persona se crea en el
    // REGISTRO (POST /register, server-side); el login NO la crea, solo la resuelve.
    async resolvePerson(p) {
      try {
        const person = await api.findPersonByEmail(p.email)
        if (person && person.id) { this.pid = person.id; updateUser({ personId: person.id }) }
        return person
      } catch (e) { return null }
    },

    enter() {
      const p = this.profile || {}
      const configured = this.hasFace || this.serverTwoFactor === true
      const enabled = this.serverTwoFactor != null ? this.serverTwoFactor : this.hasFace
      const roles = p.roles || []
      signIn({ name: p.name || p.email || 'Usuario', email: p.email, personId: this.pid || undefined, twoFactor: enabled, twoFactorConfigured: configured, roles, role: pickRole(roles) })
      // Volver a la sección en la que se recargó (si la hay); si no, al panel.
      let dest = '/'
      try { dest = sessionStorage.getItem('atalaya.route') || '/' } catch (e) {}
      if (dest === '/login') dest = '/'
      navigate(dest)
    },

    // --- 2º factor facial ---
    onFace(x) { this.faceImg = x ? x.base64 : null; this.faceError = null },
    async verify2fa() {
      if (!this.faceImg) { this.faceError = 'Capturá o subí una foto de tu rostro.'; return }
      this.verifying = true; this.faceError = null
      try {
        let res = (await api.faceRecognition({ image: this.faceImg })) || {}
        if (Array.isArray(res)) res = res[0] || {}
        if (res.match || res.result) res = res.match || res.result
        const id = res.person_id || res.personId
        const expected = this.pid || (this.account && this.account.personId)
        if (id && expected && String(id) === String(expected)) {
          // Recordamos que pasó el 2FA para no re-pedirlo en cada refresh.
          markFacePassed(this.profile && this.profile.sub)
          this.enter()
          return
        }
        // Fallo: contar el intento. Al agotarlos, se cierra sesión.
        this.attempts++
        const left = this.maxAttempts - this.attempts
        if (left <= 0) {
          this.faceError = 'Demasiados intentos fallidos. Cerrando sesión…'
          setTimeout(() => this.cancel2fa(), 1500)
        } else {
          this.faceError = (id ? 'El rostro no coincide con tu cuenta.' : 'No se reconoció ningún rostro.') +
            ` Te queda(n) ${left} intento(s).`
          this.faceImg = null; this.faceKey++  // reinicia el capturador para reintentar
        }
      } catch (e) {
        // Error del servicio (no cuenta como intento): dejar reintentar.
        this.faceError = 'No se pudo verificar (servicio de reconocimiento facial). Probá de nuevo.'
      } finally {
        this.verifying = false
      }
    },
    cancel2fa() {
      this.needs2fa = false; this.account = null; this.faceImg = null; this.faceError = null
      this.attempts = 0
      auth.clearSession(); signOut()  // cierra el login a medias y limpia la sesión
    },
  },
  template: `
  <div class="login">
    <div class="login__card">
      <div class="login__brand">
        <Icon name="tower" class="brand__mark" :size="38" />
        <div>
          <div class="brand__name serif" style="font-size:22px">Atalaya</div>
          <div class="brand__sub">Consola de visión</div>
        </div>
      </div>

      <!-- 2º factor -->
      <template v-if="needs2fa">
        <h2 class="serif" style="font-size:22px">Verificación facial</h2>
        <p class="sub">Tu cuenta tiene doble factor. Confirmá tu identidad con tu rostro.</p>
        <FaceCapture :key="faceKey" @change="onFace" />
        <button class="btn btn--primary btn--block mt" :disabled="verifying || !faceImg" @click="verify2fa">
          <Icon name="scan" :size="16" /> {{ verifying ? 'Verificando…' : 'Verificar e ingresar' }}
        </button>
        <button class="btn btn--block mt" @click="cancel2fa"><Icon name="logout" :size="16" /> Cancelar y salir</button>
        <Alert v-if="faceError" spaced>{{ faceError }}</Alert>
      </template>

      <!-- resumen de sesión tras refresco (token de Keycloak válido) -->
      <template v-else-if="resuming">
        <h2 class="serif" style="font-size:22px">Verificando sesión…</h2>
        <p class="sub">Un momento.</p>
        <div style="padding:18px 0"><Spinner /></div>
      </template>

      <!-- crear cuenta (formulario propio, sin pantalla de Keycloak) -->
      <template v-else-if="mode === 'signup'">
        <h2 class="serif" style="font-size:24px">Crear cuenta</h2>
        <p class="sub">Registrate para acceder al panel. Tu cuenta se vincula a tu email.</p>

        <form @submit.prevent="submitRegister">
          <div class="field">
            <label for="su-first">Nombre</label>
            <input id="su-first" class="input" v-model="rFirst" type="text" placeholder="Tu nombre" autocomplete="given-name" />
          </div>
          <div class="field">
            <label for="su-last">Apellido</label>
            <input id="su-last" class="input" v-model="rLast" type="text" placeholder="Tu apellido" autocomplete="family-name" />
          </div>
          <div class="field">
            <label for="su-mail">Email</label>
            <input id="su-mail" class="input" v-model="rEmail" type="email" placeholder="tu@correo.com" autocomplete="username" />
          </div>
          <div class="field">
            <label for="su-pass">Contraseña</label>
            <input id="su-pass" class="input" v-model="rPass" type="password" placeholder="mínimo 6 caracteres" autocomplete="new-password" />
          </div>
          <div class="field">
            <label for="su-pass2">Repetir contraseña</label>
            <input id="su-pass2" class="input" v-model="rPass2" type="password" placeholder="••••••••" autocomplete="new-password" />
          </div>
          <button class="btn btn--primary btn--block" type="submit" :disabled="registering">
            {{ registering ? 'Creando cuenta…' : 'Crear cuenta' }} <Icon name="arrow" :size="16" />
          </button>
          <Alert v-if="regError" spaced>{{ regError }}</Alert>
        </form>

        <div class="login__sep"><span>¿ya tenés cuenta?</span></div>
        <button class="btn btn--block" @click="showSignin">Ingresar</button>
      </template>

      <!-- email + contraseña -->
      <template v-else>
        <h2 class="serif" style="font-size:24px">Bienvenido</h2>
        <p class="sub">Ingresá con tu cuenta para acceder al panel.</p>

        <form @submit.prevent="submit">
          <div class="field">
            <label for="li-mail">Email</label>
            <input id="li-mail" class="input" v-model="email" type="email" placeholder="tu@correo.com" autocomplete="username" />
          </div>
          <div class="field">
            <label for="li-pass">Contraseña</label>
            <input id="li-pass" class="input" v-model="pass" type="password" placeholder="••••••••" autocomplete="current-password" />
          </div>
          <button class="btn btn--primary btn--block" type="submit" :disabled="loggingIn">
            {{ loggingIn ? 'Ingresando…' : 'Ingresar' }} <Icon name="arrow" :size="16" />
          </button>
          <Alert v-if="error" spaced>{{ error }}</Alert>
        </form>

        <div class="login__sep"><span>¿no tenés cuenta?</span></div>
        <button class="btn btn--block" @click="showSignup">Crear cuenta</button>
      </template>

      <div class="login__foot">
        Autenticación gestionada por Keycloak (SSO) del proyecto.
      </div>
    </div>
  </div>`,
}
