// Panel: resumen sereno del estado del sistema.
import { api, health } from '../api.js'
import { timeAgo, pct } from '../util.js'
import { navigate } from '../router.js'

const POLL_MS = 10000

export const Dashboard = {
  data: () => ({
    loading: true, refreshing: false,
    detections: [], models: [], persons: [], recognition: [],
    src: { det: 'api', models: 'api' },
    source: 'api', updatedAt: null, health,
    svc: { yolo: null, nodered: null, storage: null },
    timer: null,
  }),
  created() { this.load() },
  mounted() { this.timer = setInterval(() => this.load(true), POLL_MS) },
  beforeUnmount() { clearInterval(this.timer) },
  methods: {
    timeAgo, pct, navigate,
    onRowKey(e, path) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(path) } },
    async load(silent = false) {
      if (silent) this.refreshing = true; else this.loading = true
      const [d, m, p, r] = await Promise.all([
        api.getDetections(), api.getModels(), api.getPersons(), api.getRecognition(),
      ])
      this.detections = d.data || []
      this.models = m.data || []
      this.persons = p.data || []
      this.recognition = r.data || []
      this.src = { det: d.source, models: m.source }
      this.source = [d, m, p, r].some(x => x.source === 'mock') ? 'mock' : 'api'
      this.updatedAt = new Date().toISOString()
      this.loading = false; this.refreshing = false
      // Estado real de los servicios externos (no derivado de api/mock).
      const [yolo, storage] = await Promise.all([api.checkHealth('yolo'), api.checkHealth('storage')])
      this.svc = { yolo, storage, nodered: this.health.reachable === true }
    },
  },
  computed: {
    framesCount() { return new Set(this.detections.map(d => d.frameId)).size },
    // Detecciones recientes agrupadas por imagen (1 fila por frame con sus clases).
    recentFrames() {
      const map = new Map()
      for (const d of this.detections) {
        let f = map.get(d.frameId)
        if (!f) { f = { frameId: d.frameId, sensor: d.sensor, classes: new Set(), count: 0 }; map.set(d.frameId, f) }
        f.classes.add(d.label); f.count++
      }
      return [...map.values()].slice(0, 6).map(f => ({ ...f, classes: [...f.classes] }))
    },
    // Estado honesto de cada servicio, derivado de la conectividad real y de si
    // los datos vinieron del backend (api) o de demostración (mock).
    services() {
      return [
        { label: 'Motor de inferencia (YOLO)', icon: 'detect', ok: this.svc.yolo === true, checking: this.svc.yolo === null },
        { label: 'Flujos Node-RED',            icon: 'layers', ok: this.svc.nodered === true, checking: this.svc.nodered === null },
        { label: 'Almacenamiento de imágenes', icon: 'image',  ok: this.svc.storage === true, checking: this.svc.storage === null },
      ]
    },
  },
  template: `
  <div>
    <div class="intro row row--between">
      <div>
        <h2>Buen día. Todo en orden.</h2>
        <p>Resumen de la actividad reciente del sistema de visión y reconocimiento.</p>
      </div>
      <button class="btn btn--ghost btn--sm" :disabled="refreshing" @click="load(true)" title="Actualizar">
        <Icon name="refresh" :size="15" :style="refreshing ? 'animation:spin .7s linear infinite' : ''" />
        Actualizar
      </button>
    </div>

    <div v-if="loading"><Spinner /></div>

    <template v-else>
      <div class="grid grid--stats">
        <div class="stat">
          <div class="stat__label"><Icon name="detect" :size="16" /> Detecciones</div>
          <div class="stat__value">{{ detections.length }}</div>
          <div class="stat__meta up">en {{ framesCount }} frames analizados</div>
        </div>
        <div class="stat">
          <div class="stat__label"><Icon name="people" :size="16" /> Personas registradas</div>
          <div class="stat__value">{{ persons.length }}</div>
          <div class="stat__meta">en el padrón facial</div>
        </div>
        <div class="stat">
          <div class="stat__label"><Icon name="scan" :size="16" /> Reconocimientos</div>
          <div class="stat__value">{{ recognition.length }}</div>
          <div class="stat__meta">coincidencias evaluadas</div>
        </div>
        <div class="stat">
          <div class="stat__label"><Icon name="layers" :size="16" /> Modelos en uso</div>
          <div class="stat__value">{{ models.length }}</div>
          <div class="stat__meta">con detecciones registradas</div>
        </div>
      </div>

      <div class="grid grid--2 mt-lg">
        <section class="panel">
          <div class="panel__head">
            <h3>Detecciones recientes</h3>
            <a class="btn btn--ghost btn--sm" href="/detections" data-link>Ver todas <Icon name="chevron" :size="14" /></a>
          </div>
          <div class="panel__body--flush table-wrap">
            <table class="table">
              <tbody>
                <tr v-for="f in recentFrames" :key="f.frameId" tabindex="0" role="button"
                    :aria-label="'Ver detección del frame ' + f.frameId"
                    @click="navigate('/detections?frame=' + f.frameId)" @keydown="onRowKey($event, '/detections?frame=' + f.frameId)">
                  <td style="width:72px"><Frame :frame-id="f.frameId" /></td>
                  <td>
                    <div class="chips">
                      <span v-for="c in f.classes.slice(0, 3)" :key="c" class="pill">{{ c }}</span>
                      <span v-if="f.classes.length > 3" class="muted" style="font-size:12px">+{{ f.classes.length - 3 }}</span>
                    </div>
                    <div class="mono" style="font-size:11px;color:var(--ink-3);margin-top:4px">{{ f.count }} objeto(s) · {{ f.frameId }}</div>
                  </td>
                  <td style="text-align:right;color:var(--ink-3);font-size:13px">{{ f.sensor || '—' }}</td>
                </tr>
              </tbody>
            </table>
            <Empty v-if="!recentFrames.length" icon="detect" title="Sin detecciones" text="Todavía no hay imágenes analizadas." />
          </div>
        </section>

        <section class="panel">
          <div class="panel__head">
            <h3>Servicios</h3>
            <span v-if="updatedAt" class="muted mono" style="font-size:11.5px">act. {{ timeAgo(updatedAt) }}</span>
          </div>
          <div class="panel__body" style="display:flex;flex-direction:column;gap:13px">
            <div v-for="s in services" :key="s.label" class="row row--between">
              <div class="row gap-sm"><Icon :name="s.icon" :size="17" style="color:var(--accent)" /> {{ s.label }}</div>
              <span class="pill" :class="s.checking ? '' : (s.ok ? 'pill--ok' : 'pill--warn')">
                <span class="pill__dot"></span> {{ s.checking ? 'verificando…' : (s.ok ? 'activo' : 'sin respuesta') }}
              </span>
            </div>
            <div class="row row--between">
              <div class="row gap-sm"><Icon name="gauge" :size="17" style="color:var(--accent)" /> Observabilidad (Grafana)</div>
              <a class="pill" href="/grafana/dashboards/f/ffpxy93acwwe8b/soa" target="_blank" rel="noopener noreferrer" style="text-decoration:none">abrir <Icon name="arrow" :size="13" /></a>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>`,
}
