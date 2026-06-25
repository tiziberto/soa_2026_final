// Menú de cuenta (pie de la barra lateral). El avatar/nombre es interactuable:
// abre un menú con el estado del doble factor (2FA) y cerrar sesión. El 2FA por
// reconocimiento facial exige enrolar un mínimo de 3 fotos, que se guardan como
// embeddings de la persona asociada (POST /persons/:id/embeddings).
import { session, signOut, initials, updateUser, upsertAccount, primaryRole, pickRole } from '../util.js'
import { navigate } from '../router.js'
import { api } from '../api.js'
import { auth } from '../auth.js'

const MIN_PHOTOS = 3

export const AccountMenu = {
  data: () => ({
    session,
    open: false,
    // modal 2FA
    modalOpen: false,
    photos: [],            // [{ preview, base64 }] (lo maneja FaceEnroll)
    enrollKey: 0,          // para remontar FaceEnroll y limpiar
    saving: false, error: null, done: false,
    togglingTF: false,
  }),
  computed: {
    userInitials() { return initials(this.session.user?.name) },
    // Rol legible (admin/operator/viewer) para mostrar en el menú de cuenta.
    roleLabel() {
      return ({ admin: 'Administrador', operator: 'Operador', viewer: 'Solo lectura' })[primaryRole()] || '—'
    },
    enabled() { return !!this.session.user?.twoFactor },
    // "Configurado" = ya enroló su rostro alguna vez (puede estar activo o no).
    configured() { return !!(this.session.user?.twoFactorConfigured || this.session.user?.twoFactor) },
    email() { return this.session.user?.email || null },
    enough() { return this.photos.length >= MIN_PHOTOS },
    canSave() { return this.enough },
    min() { return MIN_PHOTOS },
  },
  methods: {
    toggle() { this.open = !this.open },
    logout() { this.open = false; signOut(); auth.logout(); navigate('/login') },  // local + revoca; vuelve a tu login

    openTwoFA() {
      this.open = false
      this.photos = []; this.enrollKey++; this.error = null; this.done = false
      this.modalOpen = true
    },
    // Activa/desactiva el 2FA ya configurado (sin volver a enrolar el rostro).
    // Persiste en el servidor (persons.extra.two_factor) y deja respaldo local.
    async setTwoFactor(val) {
      // Cualquiera (incluido viewer) puede activar su 2FA: al hacerlo, el backend
      // lo promueve a operator. La autorización real la valida Node-RED.
      if (this.togglingTF) return
      this.togglingTF = true
      // Optimista: reflejamos el cambio ya en la UI.
      updateUser({ twoFactor: val, twoFactorConfigured: true })
      upsertAccount({ email: this.email, twoFactor: val, twoFactorConfigured: true, personId: this.session.user?.personId, name: this.session.user?.name })
      try {
        let pid = this.session.user?.personId
        if (!pid && this.email) {
          const person = await api.findPersonByEmail(this.email)
          pid = person && person.id
          if (pid) updateUser({ personId: pid })
        }
        if (pid) await api.setTwoFactor(pid, val)
        // Al ACTIVAR, el backend promueve a operator: refrescamos el token para
        // que el rol nuevo aparezca en la página sin tener que re-loguear.
        if (val) this.syncRoleAfter2fa()
      } catch (e) {
        // Si el servidor falla, lo dejamos guardado local igual (respaldo).
      } finally {
        this.togglingTF = false
      }
    },
    // La promoción a operator corre async en Node-RED; reintentamos el refresh del
    // token hasta ver el rol nuevo (o agotar intentos), y actualizamos la sesión.
    async syncRoleAfter2fa() {
      for (let i = 0; i < 4; i++) {
        await new Promise(r => setTimeout(r, 1200))
        const ok = await auth.refresh()
        if (!ok) return
        const roles = auth.profile().roles || []
        updateUser({ roles, role: pickRole(roles) })
        if (roles.includes('operator') || roles.includes('admin')) return
      }
    },
    closeModal() { this.modalOpen = false },

    onEnroll(arr) { this.photos = arr },

    async save() {
      if (!this.canSave) return
      this.saving = true; this.error = null
      if (!this.email) {
        this.error = 'Tu sesión no tiene email asociado. Iniciá sesión con tu cuenta para configurar el doble factor.'
        this.saving = false; return
      }
      // Paso 1: resolver el personId (la persona ya existe desde el REGISTRO).
      // El 2FA NO crea personas: solo busca la propia por email.
      let pid = this.session.user?.personId
      if (!pid) {
        try {
          const person = await api.findPersonByEmail(this.email)
          pid = person && person.id
          if (pid) updateUser({ personId: pid })
        } catch (e) { /* lo reportamos abajo si quedó sin pid */ }
      }
      if (!pid) {
        this.error = 'Tu cuenta no tiene una persona asociada en el padrón. Cerrá sesión y volvé a entrar; si persiste, hay que recrear tu persona (contactá al administrador).'
        this.saving = false; return
      }
      // Paso 2: guardar las muestras faciales y activar el 2FA en el servidor.
      try {
        await api.addEmbeddings(pid, this.photos.map(p => p.base64))
        try { await api.setTwoFactor(pid, true) } catch (e) { /* respaldo local abajo */ }
        updateUser({ twoFactor: true, twoFactorConfigured: true })
        // Marcar la cuenta con 2FA para que el login lo pida la próxima vez.
        upsertAccount({ email: this.email, twoFactor: true, twoFactorConfigured: true, personId: pid, name: this.session.user?.name })
        this.done = true
        // Refrescar el token para reflejar el rol operator recién otorgado.
        this.syncRoleAfter2fa()
      } catch (e) {
        this.error = `No se pudieron guardar las fotos (POST /api/persons/${pid}/embeddings falló: ${e && e.message ? e.message : 'sin detalle'}).`
      } finally {
        this.saving = false
      }
    },
  },
  template: `
  <div class="acct">
    <button class="acct__btn" @click="toggle" :aria-expanded="open" aria-haspopup="menu">
      <div class="avatar">{{ userInitials }}</div>
      <div class="who">
        <b>{{ session.user?.name || 'Invitado' }}</b>
        <span>{{ roleLabel }}{{ enabled ? ' · 2FA' : '' }}</span>
      </div>
      <Icon name="chevron" :size="16" :style="open ? 'transform:rotate(-90deg)' : 'transform:rotate(-90deg);opacity:.5'" />
    </button>

    <div v-if="open" class="acct__scrim" @click="open = false"></div>
    <Transition name="pop">
      <div v-if="open" class="acct__menu" role="menu">
        <div class="acct__menu-head">
          <b>{{ session.user?.name || 'Invitado' }}</b>
          <span class="mono">{{ session.user?.email || 'sin email' }}</span>
        </div>
        <div v-if="configured" class="acct__item" role="menuitemcheckbox" :aria-checked="enabled ? 'true' : 'false'">
          <Icon name="shield" :size="17" />
          <span>Doble factor</span>
          <button class="switch" :class="{ 'switch--on': enabled }" @click.stop="setTwoFactor(!enabled)"
                  :aria-label="enabled ? 'Desactivar doble factor' : 'Activar doble factor'">
            <span class="switch__knob"></span>
          </button>
        </div>
        <button v-else class="acct__item" role="menuitem" @click="openTwoFA">
          <Icon name="shield" :size="17" />
          <span>Doble factor</span>
          <span class="pill">Configurar</span>
        </button>
        <button class="acct__item acct__item--danger" role="menuitem" @click="logout">
          <Icon name="logout" :size="17" />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </Transition>

    <Teleport to="body">
      <Transition name="lb">
        <div v-if="modalOpen" class="modal-scrim" @click="closeModal">
          <div class="modal" @click.stop role="dialog" aria-label="Configurar doble factor">
            <div class="modal__head">
              <h3>Doble factor — Reconocimiento facial</h3>
              <button class="linkbtn" @click="closeModal" aria-label="Cerrar"><Icon name="close" :size="18" /></button>
            </div>

            <div class="modal__body">
              <template v-if="done">
                <div class="note" style="background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent-deep)">
                  <Icon name="check" :size="16" />
                  <div><b>Doble factor activado.</b> Tu rostro quedó registrado con {{ photos.length }} fotos. Vas a poder ingresar con la cámara.</div>
                </div>
              </template>

              <template v-else>
                <p class="muted" style="font-size:13.5px;margin-bottom:14px">
                  Agregá al menos {{ min }} fotos de tu rostro (con la cámara o subiéndolas). Mejor si variás un poco el ángulo y la luz.
                </p>

                <div class="tfa-account">
                  <Icon name="people" :size="16" />
                  <span>Se vinculará a tu persona: <b class="mono">{{ email || 'tu cuenta' }}</b></span>
                </div>

                <FaceEnroll :key="enrollKey" @change="onEnroll" />
                <div class="enroll__count" :class="{ ok: enough }">{{ photos.length }} / {{ min }} mínimo {{ enough ? '✓' : '' }}</div>

                <Alert v-if="error" spaced>{{ error }}</Alert>
              </template>
            </div>

            <div class="modal__foot">
              <template v-if="done">
                <button class="btn btn--primary" @click="closeModal">Listo</button>
              </template>
              <template v-else>
                <button class="btn btn--ghost" @click="closeModal">Cancelar</button>
                <button class="btn btn--primary" :disabled="!canSave || saving" @click="save">
                  <Icon name="shield" :size="16" /> {{ saving ? 'Guardando…' : 'Activar doble factor' }}
                </button>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>`,
}
