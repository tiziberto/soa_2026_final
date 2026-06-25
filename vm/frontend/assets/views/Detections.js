// Detecciones: (1) subir una imagen para detectar objetos/clases con YOLO,
// (2) registro consultable y paginado de lo ya detectado.
import { api, prettyModel } from '../api.js'
import { timeAgo, fmtDate, pct, canWrite } from '../util.js'

const POLL_MS = 10000

export const Detections = {
  data: () => ({
    loading: true, refreshing: false, rows: [], source: 'api', filter: 'todos', page: 1, pageSize: 12,
    // panel de detección por carga de imagen
    modelOpts: [], modelId: '',
    file: null, preview: null, zoom: false, activeFrame: null,
    detecting: false, result: null, error: null,
    nat: { w: 0, h: 0 }, timer: null,
    location: { lat: null, lon: null },
    showMap: false,
    metaPairs: [{ key: '', value: '' }],   // datos adicionales clave/valor
    search: '',                            // filtro por objeto o metadato
  }),
  async created() { await this.load(); await this.loadModels(); this.openFromQuery() },
  mounted() { this.timer = setInterval(() => this.load(true), POLL_MS) },
  beforeUnmount() { clearInterval(this.timer) },
  watch: { filter() { this.page = 1 }, search() { this.page = 1 } },
  computed: {
    models() { return ['todos', ...new Set(this.rows.map(r => r.model).filter(Boolean))] },
    shown() { return this.filter === 'todos' ? this.rows : this.rows.filter(r => r.model === this.filter) },
    // Una fila por frame (imagen): agrupa las detecciones por frameId.
    frames() {
      const map = new Map()
      for (const d of this.shown) {
        let f = map.get(d.frameId)
        if (!f) { f = { frameId: d.frameId, sensor: d.sensor, lat: d.lat, lon: d.lon, meta: d.meta || {}, models: new Set(), classes: new Set(), detections: [] }; map.set(d.frameId, f) }
        f.detections.push({ label: d.label, confidence: d.confidence, bbox: d.bbox, model: d.model })
        f.classes.add(d.label)
        if (d.model) f.models.add(d.model)
      }
      return [...map.values()].map(f => ({ ...f, classes: [...f.classes], models: [...f.models] }))
    },
    // Filtro por texto: busca en objetos detectados, modelo, frameId y metadatos.
    // Soporta varias palabras (AND): "person celular" exige ambas; "sensor:x" matchea
    // clave:valor. Insensible a mayúsculas.
    filteredFrames() {
      const q = this.search.trim().toLowerCase()
      if (!q) return this.frames
      const terms = q.split(/\s+/).filter(Boolean)
      return this.frames.filter(f => {
        const hay = [
          f.frameId,
          ...f.classes.map(c => String(c)),
          ...f.models.map(m => String(m)),
          ...f.models.map(m => prettyModel(m)),
          ...Object.entries(f.meta || {}).map(([k, v]) => k + ':' + v),
          ...Object.values(f.meta || {}).map(v => String(v)),
        ].join(' ').toLowerCase()
        return terms.every(t => hay.includes(t))
      })
    },
    pagedFrames() { return this.filteredFrames.slice((this.page - 1) * this.pageSize, this.page * this.pageSize) },
    // Frames con ubicación, listos para el mapa (con la URL de la miniatura).
    framesGeo() {
      return this.filteredFrames
        .filter(f => f.lat != null && f.lon != null)
        .map(f => ({ ...f, url: api.frameUrl(f.frameId) }))
    },
  },
  methods: {
    timeAgo, fmtDate, pct,
    modelLabel(id) { return id === 'todos' ? 'Todos' : prettyModel(id) },
    coords(d) { return (d.lat != null && d.lon != null) ? `${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}` : '—' },
    // Metadatos a mostrar como "datos adicionales" (sin lat/lon, que ya van en Ubicación).
    extraMeta(f) { return Object.entries(f.meta || {}).filter(([k]) => k !== 'lat' && k !== 'lon') },
    addPair() { this.metaPairs.push({ key: '', value: '' }) },
    removePair(i) { this.metaPairs.splice(i, 1); if (!this.metaPairs.length) this.metaPairs.push({ key: '', value: '' }) },
    frameUrl(id) { return api.frameUrl(id) },
    openFrame(f) { this.activeFrame = f },
    // Si venimos del Panel con ?frame=<id>, abrimos esa detección directamente.
    openFromQuery() {
      const id = new URLSearchParams(location.search).get('frame')
      if (!id) return
      const f = this.frames.find(x => x.frameId === id)
      if (f) this.openFrame(f)
    },
    onRowKey(e, f) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openFrame(f) } },
    async load(silent = false) {
      if (silent) this.refreshing = true; else this.loading = true
      const r = await api.getDetections()
      this.rows = r.data || []
      this.source = r.source
      this.loading = false; this.refreshing = false
    },
    async loadModels() {
      const r = await api.getModels()
      this.modelOpts = (r.data || []).map(m => m.id)
      if (this.modelOpts.length && !this.modelId) this.modelId = this.modelOpts[0]
    },
    // --- carga de imagen (la lee el componente ImageUpload) ---
    onSelect({ file, preview }) {
      this.file = file; this.preview = preview; this.result = null; this.error = null
    },
    onImgLoad(e) { this.nat = { w: e.target.naturalWidth, h: e.target.naturalHeight } },
    boxStyle(d) {
      const b = d.bbox || {}
      const w = this.nat.w || 1, h = this.nat.h || 1
      return {
        left: (b.x1 / w * 100) + '%', top: (b.y1 / h * 100) + '%',
        width: ((b.x2 - b.x1) / w * 100) + '%', height: ((b.y2 - b.y1) / h * 100) + '%',
      }
    },
    canWrite,
    async detect() {
      if (!this.preview || !this.modelId || !canWrite()) return
      if (this.location.lat == null || this.location.lon == null) {
        this.error = 'Ubicación requerida: seleccioná un punto en el mapa'
        return
      }
      this.detecting = true; this.error = null; this.result = null
      try {
        const image = this.preview.split(',')[1] // base64 sin el prefijo data:
        // metadata: ubicación + datos adicionales clave/valor cargados por el usuario.
        const metadata = { lat: this.location.lat, lon: this.location.lon }
        this.metaPairs.forEach(p => { const k = p.key.trim(); if (k) metadata[k] = p.value.trim() })
        if (!metadata.sensor) metadata.sensor = 'web-upload'
        this.result = await api.detectObjects({ modelId: this.modelId, image, metadata })
        await this.load() // el frame nuevo queda guardado: refrescamos el listado
      } catch (e) {
        this.error = 'No se pudo procesar la imagen. El motor de detección (FastAPI, GPU remota) no respondió.'
      } finally {
        this.detecting = false
      }
    },
    reset() {
      this.preview = null; this.file = null; this.result = null; this.error = null; this.metaPairs = [{ key: '', value: '' }]
      // Volver arriba: tras detectar, la página suele quedar scrolleada en el historial.
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
  },
  template: `
  <div>
    <div class="intro">
      <h2>Detecciones</h2>
      <p>Subí una imagen para detectar objetos y clases con el motor de visión, o consultá lo ya detectado.</p>
    </div>

    <!-- 1. Detectar objetos en una imagen (carga) — solo operator/admin -->
    <section v-if="canWrite()" class="panel" style="margin-bottom:22px">
      <div class="panel__head">
        <h3>Detectar objetos en una imagen</h3>
        <div class="field" style="margin:0;min-width:220px">
          <select class="input" v-model="modelId" :disabled="!modelOpts.length" aria-label="Modelo de detección">
            <option v-if="!modelOpts.length" value="">Sin modelos disponibles</option>
            <option v-for="m in modelOpts" :key="m" :value="m">{{ modelLabel(m) }}</option>
          </select>
        </div>
      </div>
      <div class="panel__body">
        <ImageUpload v-if="!preview" @select="onSelect">Se analiza con el modelo seleccionado para identificar objetos y clases</ImageUpload>

        <div v-else class="grid grid--2" style="gap:22px;align-items:start">
          <div>
            <div class="detview detview--zoom" @click="zoom = true" title="Ampliar imagen">
              <img :src="preview" alt="imagen a analizar" @load="onImgLoad" />
              <template v-if="result && result.detections">
                <div v-for="(d, i) in result.detections" :key="i" class="detbox" :style="boxStyle(d)">
                  <span class="detbox__tag">{{ d.class_name }} {{ pct(d.confidence) }}</span>
                </div>
              </template>
              <span class="detview__zoom" aria-hidden="true"><Icon name="search" :size="16" /></span>
            </div>
            <div class="mt">
              <div class="eyebrow">Ubicación (obligatorio)</div>
              <MapPicker v-model="location" />
            </div>
            <div class="mt">
              <div class="eyebrow">Datos adicionales (opcional)</div>
              <div v-for="(p, i) in metaPairs" :key="i" class="row gap-sm mt" style="align-items:center">
                <input class="input" v-model="p.key" placeholder="clave (ej. sensor)" style="flex:1" />
                <input class="input" v-model="p.value" placeholder="valor (ej. celular)" style="flex:1" />
                <button class="btn btn--ghost btn--sm" @click="removePair(i)" title="Quitar"><Icon name="close" :size="14" /></button>
              </div>
              <button class="btn btn--ghost btn--sm mt" @click="addPair"><Icon name="plus" :size="14" /> Agregar dato</button>
            </div>
            <div class="row mt gap-sm">
              <button class="btn btn--primary" :disabled="detecting || !modelId || !location.lat" @click="detect">
                <Icon name="detect" :size="16" /> {{ detecting ? 'Analizando…' : 'Detectar objetos' }}
              </button>
              <button class="btn btn--ghost" @click="reset">Cambiar</button>
            </div>
          </div>

          <div>
            <div v-if="result">
              <div class="eyebrow">Resultado</div>
              <div class="row gap-sm" style="margin:8px 0 14px">
                <span class="stat__value serif" style="font-size:30px">{{ result.detection_count ?? (result.detections ? result.detections.length : 0) }}</span>
                <span class="muted">objetos detectados</span>
              </div>
              <div v-if="result.classes_detected && result.classes_detected.length" class="chips" style="margin-bottom:16px">
                <span v-for="c in result.classes_detected" :key="c" class="pill pill--ok">{{ c }}</span>
              </div>
              <table class="table" v-if="result.detections && result.detections.length">
                <thead><tr><th>Clase</th><th>Confianza</th></tr></thead>
                <tbody>
                  <tr v-for="(d, i) in result.detections" :key="i">
                    <td style="font-weight:600">{{ d.class_name }}</td>
                    <td><Conf :value="d.confidence" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Alert v-else-if="error">{{ error }}</Alert>
            <div v-else class="empty" style="padding:32px 12px">
              <Icon name="detect" :size="34" />
              <b>Listo para analizar</b>
              <div>Elegí un modelo y presioná “Detectar objetos”.</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 2. Registro -->
    <div v-if="loading"><Spinner /></div>

    <template v-else>
      <div class="field" style="margin-bottom:12px">
        <input class="input" v-model="search" placeholder="Buscar por objeto (person, car…), modelo o metadato (sensor:celular). Varias palabras filtran por todas." style="width:100%" />
      </div>
      <div class="row row--between" style="margin-bottom:14px">
        <div class="segmented">
          <button v-for="m in models" :key="m" :class="{ 'is-active': filter === m }" @click="filter = m">{{ modelLabel(m) }}</button>
        </div>
        <div class="row gap-sm">
          <span class="muted mono" style="font-size:12.5px">{{ filteredFrames.length }} imágenes</span>
          <button class="btn btn--ghost btn--sm" @click="showMap = !showMap" :title="showMap ? 'Ver lista' : 'Ver mapa'">
            <Icon :name="showMap ? 'detect' : 'pin'" :size="15" /> {{ showMap ? 'Ver lista' : 'Ver mapa' }}
          </button>
          <button class="btn btn--ghost btn--sm" :disabled="refreshing" @click="load(true)" title="Actualizar">
            <Icon name="refresh" :size="15" :style="refreshing ? 'animation:spin .7s linear infinite' : ''" />
          </button>
        </div>
      </div>

      <section v-if="showMap" class="panel" style="margin-bottom:18px">
        <div class="panel__body">
          <DetectionsMap :key="filter" :frames="framesGeo" @open="openFrame" />
        </div>
      </section>

      <section v-else class="panel">
        <div class="panel__body--flush table-wrap">
          <table class="table table--wide">
            <thead>
              <tr><th>Frame</th><th>Clases detectadas</th><th>Objetos</th><th>Modelo</th><th>Datos adicionales</th><th style="text-align:right">Ubicación</th></tr>
            </thead>
            <tbody>
              <tr v-for="f in pagedFrames" :key="f.frameId" tabindex="0" role="button"
                  :aria-label="'Ver detección del frame ' + f.frameId"
                  @click="openFrame(f)" @keydown="onRowKey($event, f)">
                <td style="width:72px" @click.stop><Frame :frame-id="f.frameId" /></td>
                <td>
                  <div class="chips">
                    <span v-for="c in f.classes.slice(0, 4)" :key="c" class="pill">{{ c }}</span>
                    <span v-if="f.classes.length > 4" class="muted" style="font-size:12px">+{{ f.classes.length - 4 }}</span>
                  </div>
                  <div class="mono" style="font-size:11px;color:var(--ink-3);margin-top:4px">{{ f.frameId }}</div>
                </td>
                <td><b>{{ f.detections.length }}</b></td>
                <td><span class="pill">{{ modelLabel(f.models[0]) }}</span></td>
                <td>
                  <div class="chips">
                    <span v-for="([k, v]) in extraMeta(f)" :key="k" class="pill" style="font-size:11px">{{ k }}: {{ v }}</span>
                    <span v-if="!extraMeta(f).length" class="muted">—</span>
                  </div>
                </td>
                <td class="mono" style="text-align:right;color:var(--ink-3);font-size:12.5px">{{ coords(f) }}</td>
              </tr>
            </tbody>
          </table>
          <Empty v-if="!frames.length" icon="detect" title="Sin detecciones" text="Todavía no hay eventos en el registro." />
        </div>
      </section>

      <Pager v-if="!showMap" v-model:page="page" :page-size="pageSize" :total="filteredFrames.length" />
    </template>

    <!-- Detalle del frame del registro: imagen + cajas interactivas -->
    <Teleport to="body">
      <Transition name="lb">
        <div v-if="activeFrame" class="modal-scrim" @click="activeFrame = null">
          <div class="modal modal--wide" @click.stop role="dialog" aria-label="Detalle de detección">
            <div class="modal__head">
              <h3>Detección <span class="mono muted" style="font-size:12px">· {{ activeFrame.frameId }}</span></h3>
              <button class="linkbtn" @click="activeFrame = null" aria-label="Cerrar"><Icon name="close" :size="18" /></button>
            </div>
            <div class="modal__body">
              <div class="row gap-sm" style="flex-wrap:wrap;margin-bottom:14px">
                <span class="pill">Modelo: {{ activeFrame.models.map(modelLabel).join(', ') || '—' }}</span>
                <span v-if="activeFrame.lat != null" class="pill">Ubicación: {{ coords(activeFrame) }}</span>
                <span v-for="([k, v]) in extraMeta(activeFrame)" :key="k" class="pill">{{ k }}: {{ v }}</span>
              </div>
              <DetectionViewer :src="frameUrl(activeFrame.frameId)" :detections="activeFrame.detections" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Zoom interactivo de la imagen recién analizada -->
    <Teleport to="body">
      <Transition name="lb">
        <div v-if="zoom" class="modal-scrim" @click="zoom = false">
          <div class="modal modal--wide" @click.stop role="dialog" aria-label="Imagen analizada">
            <div class="modal__head">
              <h3>Imagen analizada</h3>
              <button class="linkbtn" @click="zoom = false" aria-label="Cerrar"><Icon name="close" :size="18" /></button>
            </div>
            <div class="modal__body">
              <DetectionViewer :src="preview" :detections="result ? result.detections : []" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>`,
}
