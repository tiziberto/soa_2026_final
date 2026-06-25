// Personas: padrón facial, "Mi persona" (la del usuario logueado) y alta de personas.
import { api } from '../api.js'
import { timeAgo, initials, session, updateUser, canWrite } from '../util.js'
import { navigate } from '../router.js'

export const Persons = {
  data: () => ({
    loading: true, rows: [], source: 'api',
    // mi persona
    mine: null, mineChecked: false,
    // alta
    showForm: false, name: '', email: '', preview: null, saving: false, error: null,
    page: 1, pageSize: 10,
  }),
  async created() { await this.load(); this.resolveMine() },
  computed: {
    // Padrón sin "mi persona": no me muestro a mí mismo (ya aparezco arriba).
    others() {
      const myId = session.user && session.user.personId
      const myEmail = ((session.user && session.user.email) || '').toLowerCase()
      const mineId = this.mine && this.mine.id
      return this.rows.filter(p => {
        if (mineId && p.id === mineId) return false
        if (myId && p.id === myId) return false
        if (myEmail && (p.email || '').toLowerCase() === myEmail) return false
        return true
      })
    },
    paged() { return this.others.slice((this.page - 1) * this.pageSize, this.page * this.pageSize) },
    emailOk() { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim()) },
    canSave() { return !!this.name.trim() && this.emailOk },
  },
  methods: {
    timeAgo, initials, navigate, canWrite,
    onRowKey(e, id) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/persons/' + id) } },
    async load() {
      this.loading = true
      const r = await api.getPersons()
      this.rows = r.data || []
      this.source = r.source
      this.loading = false
    },
    // Resuelve la persona del usuario logueado (por personId o por su email).
    async resolveMine() {
      const u = session.user
      try {
        if (u && u.personId) {
          const r = await api.getPerson(u.personId)
          this.mine = r.data
        } else if (u && u.email) {
          const p = await api.findPersonByEmail(u.email)
          if (p) { this.mine = p; if (p.id) updateUser({ personId: p.id }) }
        }
      } catch (e) { /* sin conexión: queda sin "mi persona" */ }
      this.mineChecked = true
    },
    onSelect({ preview }) { this.preview = preview },
    async save() {
      if (!this.canSave || !canWrite()) return
      this.saving = true; this.error = null
      try {
        // POST /persons exige first_name, last_name y email.
        const parts = this.name.trim().split(/\s+/)
        const first_name = parts[0]
        const last_name = parts.slice(1).join(' ') || parts[0]
        const person = await api.createPerson({ first_name, last_name, email: this.email.trim() })
        const pid = person && (person.person_id || person.id)
        if (this.preview && pid) {
          await api.addEmbeddings(pid, this.preview.split(',')[1])
        }
        this.showForm = false; this.name = ''; this.email = ''; this.preview = null
        await this.load()
        if (pid) navigate('/persons/' + pid)   // ir a su detalle para sumar más muestras
      } catch (e) {
        this.error = 'No se pudo registrar. ¿El email ya existe o el backend no responde?'
      } finally {
        this.saving = false
      }
    },
  },
  template: `
  <div>
    <div class="intro row row--between">
      <div>
        <h2>Personas</h2>
        <p>Padrón de rostros conocidos. Cada persona puede tener varias muestras para mejorar la identificación.</p>
      </div>
      <button v-if="canWrite()" class="btn btn--primary" @click="showForm = !showForm"><Icon name="plus" :size="16" /> Registrar persona</button>
    </div>

    <section v-if="showForm" class="panel" style="margin-bottom:18px">
      <div class="panel__head"><h3>Nueva persona</h3></div>
      <div class="panel__body">
        <div class="grid grid--2" style="gap:22px">
          <div>
            <div class="field">
              <label for="np-name">Nombre completo</label>
              <input id="np-name" class="input" v-model="name" placeholder="Nombre y apellido" autocomplete="name" />
            </div>
            <div class="field">
              <label for="np-mail">Email</label>
              <input id="np-mail" class="input" v-model="email" type="email" placeholder="persona@correo.com" autocomplete="email" />
              <div v-if="email && !emailOk" class="field__err">Email inválido</div>
              <div class="hint" style="display:block;margin-top:6px">Identifica unívocamente a la persona (clave del padrón).</div>
            </div>
            <div class="row gap-sm">
              <button class="btn btn--primary" :disabled="saving || !canSave" @click="save">
                <Icon name="check" :size="16" /> {{ saving ? 'Guardando…' : 'Guardar' }}
              </button>
              <button class="btn btn--ghost" @click="showForm = false">Cancelar</button>
            </div>
            <Alert v-if="error" spaced>{{ error }}</Alert>
          </div>
          <div class="field" style="margin:0">
            <label>Fotografía de referencia <span class="hint">opcional</span></label>
            <ImageUpload v-if="!preview" title="Subir una foto" hint="" @select="onSelect">Se enviará como muestra (embedding)</ImageUpload>
            <template v-else>
              <div class="thumb thumb--lg"><img :src="preview" alt="vista previa" /></div>
              <button class="btn btn--ghost btn--sm mt" @click="preview = null">Cambiar foto</button>
            </template>
          </div>
        </div>
      </div>
    </section>

    <!-- Mi persona -->
    <section style="margin-bottom:22px">
      <div class="eyebrow" style="margin-bottom:10px">Mi persona</div>
      <div v-if="mine" class="panel mine-card" tabindex="0" role="button"
           :aria-label="'Mi persona: ' + mine.name"
           @click="navigate('/persons/' + mine.id)" @keydown="onRowKey($event, mine.id)">
        <div class="avatar">{{ initials(mine.name) }}</div>
        <div style="flex:1;min-width:0">
          <div class="person__name">{{ mine.name }} <span class="pill pill--ok" style="margin-left:6px">vos</span></div>
          <div class="person__id">{{ mine.id }} · {{ mine.embeddings }} muestras</div>
        </div>
        <span class="btn btn--ghost btn--sm">Ver / agregar muestras <Icon name="chevron" :size="14" /></span>
      </div>
      <div v-else-if="mineChecked" class="note">
        <Icon name="info" :size="16" />
        <div>Tu cuenta todavía no está vinculada a una persona del padrón. Registrate (con tu email) o activá el doble factor para crearla.</div>
      </div>
    </section>

    <div v-if="loading"><Spinner /></div>

    <template v-else>
      <div class="eyebrow" style="margin-bottom:10px">Padrón</div>
      <section class="panel">
        <div class="panel__body--flush">
          <div v-for="p in paged" :key="p.id" class="person" tabindex="0" role="button"
               :aria-label="'Ver ' + p.name"
               @click="navigate('/persons/' + p.id)" @keydown="onRowKey($event, p.id)">
            <div class="avatar">{{ initials(p.name) }}</div>
            <div style="flex:1;min-width:0">
              <div class="person__name">{{ p.name }}</div>
              <div class="person__id">{{ p.id }} · {{ p.embeddings }} muestras</div>
            </div>
            <Icon name="chevron" :size="16" style="color:var(--ink-3)" />
          </div>
          <Empty v-if="!others.length" icon="people" title="Padrón vacío" text="No hay otras personas registradas todavía." />
        </div>
      </section>

      <Pager v-model:page="page" :page-size="pageSize" :total="others.length" />
    </template>
  </div>`,
}
