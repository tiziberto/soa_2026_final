// Detalle de una persona del padrón. Permite agregar más muestras (embeddings)
// con la cámara o subiendo imágenes (POST /persons/:id/embeddings).
import { api } from '../api.js'
import { route, navigate } from '../router.js'
import { timeAgo, fmtDate, initials, canWrite, isAdmin } from '../util.js'

export const PersonDetail = {
  data: () => ({
    loading: true, person: null, source: 'api',
    // agregar muestras
    photos: [], enrollKey: 0,
    saving: false, error: null, savedMsg: null,
    progress: { done: 0, total: 0, ok: 0, rejected: 0 },
    photoStatus: [],   // 'pending' | 'ok' | 'fail' por cada foto
    // administración (solo admin): confirmación de acciones destructivas
    confirm: null,     // null | 'delete' | 'clear'
    busy: false, adminMsg: null, adminError: null,
  }),
  async created() { await this.load() },
  methods: {
    timeAgo, fmtDate, initials, navigate, canWrite, isAdmin,
    // --- administración ---
    askDelete() { this.adminError = null; this.confirm = 'delete' },
    askClear()  { this.adminError = null; this.confirm = 'clear' },
    closeConfirm() { if (!this.busy) this.confirm = null },
    async doDelete() {
      if (!this.person?.id || this.busy) return
      this.busy = true; this.adminError = null
      try {
        await api.deletePerson(this.person.id)
        navigate('/persons')   // volvemos al padrón; la persona ya no existe
      } catch (e) {
        this.adminError = 'No se pudo eliminar la persona. ' + (e && e.message ? e.message : 'Verificá el backend.')
        this.busy = false
      }
    },
    async doClear() {
      if (!this.person?.id || this.busy) return
      this.busy = true; this.adminError = null
      try {
        await api.clearEmbeddings(this.person.id)
        this.confirm = null
        await this.load()
        this.adminMsg = 'Se eliminaron todas las muestras faciales de esta persona.'
      } catch (e) {
        this.adminError = 'No se pudieron limpiar las muestras. ' + (e && e.message ? e.message : 'Verificá el backend.')
      } finally {
        this.busy = false
      }
    },
    async load() {
      const r = await api.getPerson(route.params.id)
      this.person = r.data
      this.source = r.source
      this.loading = false
    },
    onEnroll(arr) { this.photos = arr; this.savedMsg = null },
    async saveSamples() {
      if (!this.photos.length || !this.person?.id || !canWrite()) return
      this.saving = true; this.error = null; this.savedMsg = null
      const total = this.photos.length
      this.progress = { done: 0, total, ok: 0, rejected: 0 }
      this.photoStatus = this.photos.map(() => 'pending')
      // Subimos de a una para mostrar el progreso (y evitar requests gigantes).
      for (let i = 0; i < this.photos.length; i++) {
        try {
          const res = await api.addEmbeddings(this.person.id, [this.photos[i].base64])
          const valid = (res && typeof res.validEmbeddings === 'number') ? res.validEmbeddings : 1
          if (valid > 0) { this.progress.ok += valid; this.photoStatus[i] = 'ok' }
          else { this.progress.rejected++; this.photoStatus[i] = 'fail' }
        } catch (e) {
          this.progress.rejected++; this.photoStatus[i] = 'fail'
        }
        this.progress.done++
      }
      await this.load()  // refresca el conteo de muestras
      const { ok, rejected } = this.progress
      if (!ok) {
        this.error = 'No se pudo guardar ninguna muestra (sin rostro detectado o sin conexión con el backend).'
      } else {
        this.savedMsg = `Se agregaron ${ok} muestra(s)` + (rejected ? `, ${rejected} sin rostro detectado.` : '.')
      }
      this.photos = []; this.enrollKey++; this.photoStatus = []
      this.saving = false
    },
  },
  template: `
  <div>
    <a class="btn btn--ghost btn--sm" href="/persons" data-link style="margin-bottom:16px">
      <Icon name="chevron" :size="14" style="transform:rotate(180deg)" /> Personas
    </a>

    <div v-if="loading"><Spinner /></div>

    <template v-else-if="person">
      <div class="row gap-sm" style="align-items:center;margin-bottom:22px">
        <div class="avatar" style="width:60px;height:60px;font-size:22px">{{ initials(person.name) }}</div>
        <div>
          <h2 class="serif" style="font-size:25px">{{ person.name }}</h2>
          <div class="mono muted" style="font-size:13px">{{ person.id }}</div>
        </div>
      </div>

      <div class="grid grid--2">
        <section class="panel">
          <div class="panel__head"><h3>Información</h3></div>
          <div class="panel__body">
            <dl class="dl">
              <dt>Identificador</dt><dd class="mono">{{ person.id }}</dd>
              <dt>Muestras</dt><dd>{{ person.embeddings ?? '—' }} embeddings</dd>
              <dt>Alta</dt><dd>{{ fmtDate(person.createdAt) }}</dd>
            </dl>
          </div>
        </section>

        <section class="panel">
          <div class="panel__head"><h3>Muestras faciales</h3></div>
          <div class="panel__body">
            <template v-if="person.embeddings">
              <div class="row gap-sm" style="align-items:baseline;margin-bottom:12px">
                <span class="serif" style="font-size:30px;line-height:1">{{ person.embeddings }}</span>
                <span class="muted" style="font-size:12.5px">muestra{{ person.embeddings === 1 ? '' : 's' }} · vector facial de 128-d c/u</span>
              </div>
              <div class="sample-chips">
                <span v-for="n in person.embeddings" :key="n" class="sample-chip" :title="'Muestra ' + n">
                  <Icon name="people" :size="13" /><span class="mono">{{ n }}</span>
                </span>
              </div>
              <p class="muted" style="font-size:12px;margin:12px 0 0">Por privacidad no se almacena la fotografía original.</p>
            </template>
            <Empty v-else icon="image" title="Sin muestras" text="Agregá una fotografía para mejorar la identificación." />
          </div>
        </section>
      </div>

      <!-- Agregar muestras (embeddings) — solo operator/admin -->
      <section v-if="canWrite()" class="panel mt-lg">
        <div class="panel__head"><h3>Agregar muestras</h3></div>
        <div class="panel__body">
          <p class="muted" style="font-size:13.5px;margin-bottom:16px">
            Sumá fotos del rostro de <b>{{ person.name }}</b> (con la cámara o seleccionando varias imágenes a la vez) para mejorar la identificación.
            Cada foto se guarda como un embedding. Conviene variar ángulo y luz.
          </p>
          <div style="max-width:520px">
            <FaceEnroll :key="enrollKey" @change="onEnroll" />
            <button class="btn btn--primary btn--block mt" :disabled="!photos.length || saving" @click="saveSamples">
              <Icon name="check" :size="16" /> {{ saving ? 'Guardando ' + progress.done + '/' + progress.total + '…' : 'Guardar ' + photos.length + ' muestra(s)' }}
            </button>

            <!-- Progreso de carga: barra + estado por foto -->
            <div v-if="saving" class="mt">
              <div style="height:6px;background:var(--line);border-radius:4px;overflow:hidden">
                <div :style="{ width: (progress.total ? progress.done / progress.total * 100 : 0) + '%', height: '100%', background: 'var(--accent)', transition: 'width .25s' }"></div>
              </div>
              <div class="muted" style="font-size:12.5px;margin-top:6px">Cargando {{ progress.done }} de {{ progress.total }} — {{ progress.ok }} ok{{ progress.rejected ? ', ' + progress.rejected + ' sin rostro' : '' }}</div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
                <div v-for="(p, i) in photos" :key="i" style="position:relative;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid var(--line)">
                  <img :src="p.preview" alt="muestra" style="width:100%;height:100%;object-fit:cover" />
                  <span style="position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.4)">
                    <Icon v-if="photoStatus[i] === 'ok'" name="check" :size="20" style="color:#7CDFA7" />
                    <Icon v-else-if="photoStatus[i] === 'fail'" name="close" :size="20" style="color:#F2A6A6" />
                    <Icon v-else name="refresh" :size="16" style="color:#fff;animation:spin .7s linear infinite" />
                  </span>
                </div>
              </div>
            </div>

            <Alert v-if="error" spaced>{{ error }}</Alert>
              <div v-if="savedMsg" class="note mt" style="background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent-deep)">
                <Icon name="check" :size="16" /><div>{{ savedMsg }}</div>
              </div>
          </div>
        </div>
      </section>

      <!-- Administración (solo admin): acciones destructivas -->
      <section v-if="isAdmin()" class="panel mt-lg" style="border-color:#E6C8BE">
        <div class="panel__head"><h3>Administración</h3></div>
        <div class="panel__body">
          <p class="muted" style="font-size:13.5px;margin:0 0 14px">
            Acciones irreversibles sobre <b>{{ person.name }}</b>. Requieren rol administrador.
          </p>
          <div class="row gap-sm">
            <button class="btn btn--danger-ghost" :disabled="busy" @click="askClear">
              <Icon name="image" :size="16" /> Limpiar muestras
            </button>
            <button class="btn btn--danger" :disabled="busy" @click="askDelete">
              <Icon name="close" :size="16" /> Eliminar persona
            </button>
          </div>
          <div v-if="adminMsg" class="note mt" style="background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent-deep)">
            <Icon name="check" :size="16" /><div>{{ adminMsg }}</div>
          </div>
          <Alert v-if="adminError && !confirm" spaced>{{ adminError }}</Alert>
        </div>
      </section>
    </template>

    <Empty v-else icon="people" title="Persona no encontrada" text="El identificador no corresponde a ningún registro." />

    <!-- Confirmación de acción destructiva -->
    <Teleport to="body">
      <Transition name="lb">
        <div v-if="confirm" class="modal-scrim" @click="closeConfirm">
          <div class="modal" @click.stop role="dialog" :aria-label="confirm === 'delete' ? 'Eliminar persona' : 'Limpiar muestras'">
            <div class="modal__head">
              <h3>{{ confirm === 'delete' ? 'Eliminar persona' : 'Limpiar muestras' }}</h3>
              <button class="linkbtn" @click="closeConfirm" aria-label="Cerrar"><Icon name="close" :size="18" /></button>
            </div>
            <div class="modal__body">
              <template v-if="confirm === 'delete'">
                <p style="margin:0 0 14px">¿Eliminar a <b>{{ person?.name }}</b> del padrón? Se borrarán también todas sus muestras faciales.</p>
                <div class="note note--error">
                  <Icon name="info" :size="16" />
                  <div><b>Atención:</b> si esta persona tiene una cuenta de acceso (Keycloak) vinculada por su email, <b>también se eliminará su cuenta</b> y no podrá volver a iniciar sesión.</div>
                </div>
              </template>
              <template v-else>
                <p style="margin:0">¿Eliminar todas las muestras faciales de <b>{{ person?.name }}</b>? La persona se mantiene en el padrón, pero quedará sin embeddings para la identificación.</p>
              </template>
              <Alert v-if="adminError" spaced>{{ adminError }}</Alert>
            </div>
            <div class="modal__foot">
              <button class="btn btn--ghost" :disabled="busy" @click="closeConfirm">Cancelar</button>
              <button v-if="confirm === 'delete'" class="btn btn--danger" :disabled="busy" @click="doDelete">
                <Icon name="close" :size="16" /> {{ busy ? 'Eliminando…' : 'Eliminar definitivamente' }}
              </button>
              <button v-else class="btn btn--danger" :disabled="busy" @click="doClear">
                <Icon name="image" :size="16" /> {{ busy ? 'Limpiando…' : 'Limpiar muestras' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>`,
}
