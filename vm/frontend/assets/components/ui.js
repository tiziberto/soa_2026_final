// Componentes de UI reutilizables, registrados globalmente en app.js.
import { Icon } from '../icons.js'
import { api, demo, toggleDemo } from '../api.js'

// Miniatura de un frame almacenado; muestra un marcador sereno si no hay imagen.
// Al pasar el mouse aparece una lupa y, al hacer clic, se abre la imagen en grande.
export const Frame = {
  props: { frameId: { default: null }, large: Boolean },
  data: () => ({ failed: false, open: false, thumb: false, imgLoading: false }),
  computed: {
    src() { return this.frameId ? api.frameUrl(this.frameId) : null },
    zoomable() { return !!this.src && !this.failed },
    // Imagen del lightbox: original o la versión reducida (thumbnail) del backend.
    lightboxSrc() { return this.frameId ? api.frameUrl(this.frameId, this.thumb) : null },
  },
  methods: {
    show() {
      if (!this.zoomable) return
      this.open = true; this.thumb = false; this.imgLoading = false
      document.addEventListener('keydown', this.onKey)
      // NO precargamos el thumbnail: la generación (jimp) es pesada y solo debe
      // dispararse cuando el usuario activa el toggle a propósito.
    },
    close() { this.open = false; this.thumb = false; this.imgLoading = false; document.removeEventListener('keydown', this.onKey) },
    toggleThumb() { if (this.imgLoading) return; this.imgLoading = true; this.thumb = !this.thumb },
    onKey(e) { if (e.key === 'Escape') this.close() },
  },
  beforeUnmount() { document.removeEventListener('keydown', this.onKey) },
  template: `
    <div class="thumb" :class="{ 'thumb--lg': large, 'thumb--zoom': zoomable }"
         @click="show" :title="zoomable ? 'Ver imagen en grande' : null">
      <img v-if="zoomable" :src="src" @error="failed = true" alt="frame" loading="lazy" decoding="async" />
      <Icon v-else name="image" :size="large ? 28 : 18" />
      <span v-if="zoomable" class="thumb__zoom" aria-hidden="true"><Icon name="search" /></span>
    </div>
    <Teleport to="body">
      <Transition name="lb">
        <div v-if="open" class="lightbox" @click="close">
          <button class="lightbox__toggle" :class="{ 'is-on': thumb }" @click.stop="toggleThumb"
                  :disabled="imgLoading" :aria-pressed="thumb ? 'true' : 'false'" title="Alternar miniatura / original">
            <Icon :name="imgLoading ? 'refresh' : 'image'" :size="15" :style="imgLoading ? 'animation:spin .7s linear infinite' : ''" />
            {{ imgLoading ? 'Cargando…' : (thumb ? 'Thumbnail: ON' : 'Thumbnail: OFF') }}
          </button>
          <button class="lightbox__close" @click.stop="close" aria-label="Cerrar"><Icon name="close" :size="18" /></button>
          <img class="lightbox__img" :src="lightboxSrc" :style="imgLoading ? 'opacity:.45;transition:opacity .15s' : 'transition:opacity .15s'"
               @load="imgLoading = false" @error="imgLoading = false" alt="frame ampliado" @click.stop />
          <div v-if="frameId" class="lightbox__cap mono">{{ frameId }}</div>
        </div>
      </Transition>
    </Teleport>`,
}

// Paginación reutilizable. v-model:page para la página actual.
export const Pager = {
  props: { page: { type: Number, default: 1 }, pageSize: { type: Number, default: 12 }, total: { type: Number, default: 0 } },
  emits: ['update:page'],
  computed: {
    pages() { return Math.max(1, Math.ceil(this.total / this.pageSize)) },
    from() { return this.total ? (this.page - 1) * this.pageSize + 1 : 0 },
    to() { return Math.min(this.page * this.pageSize, this.total) },
  },
  methods: { go(p) { if (p >= 1 && p <= this.pages) this.$emit('update:page', p) } },
  template: `
    <div class="pager" v-if="pages > 1">
      <span class="pager__info mono">{{ from }}–{{ to }} de {{ total }}</span>
      <div class="row gap-sm">
        <button class="btn btn--sm" :disabled="page <= 1" @click="go(page - 1)">
          <Icon name="chevron" :size="14" style="transform:rotate(180deg)" /> Anterior
        </button>
        <span class="pager__page mono">{{ page }} / {{ pages }}</span>
        <button class="btn btn--sm" :disabled="page >= pages" @click="go(page + 1)">
          Siguiente <Icon name="chevron" :size="14" />
        </button>
      </div>
    </div>`,
}

// Medidor de confianza.
export const Conf = {
  props: { value: { type: Number, default: 0 } },
  computed: { p() { return Math.round(this.value * 100) } },
  template: `
    <div class="conf">
      <div class="conf__bar"><i :style="{ width: p + '%' }"></i></div>
      <span class="conf__num">{{ p }}%</span>
    </div>`,
}

export const Spinner = { template: `<div class="spinner" role="status" aria-label="Cargando"></div>` }

export const Empty = {
  props: { icon: { default: 'inbox' }, title: String, text: String },
  template: `
    <div class="empty">
      <Icon :name="icon" :size="34" />
      <b>{{ title }}</b>
      <div v-if="text">{{ text }}</div>
    </div>`,
}

// Conmutador de "modo desarrollador": alterna entre datos reales del backend y
// datos de demostración (hardcodeados). Va en cada vista con respaldo a mock y
// deja claro que el modo demo NO son datos reales (solo para mostrar el front).
export const DemoToggle = {
  props: { source: String },
  data: () => ({ demo }),
  computed: { showsMock() { return this.demo.on || this.source === 'mock' } },
  methods: { toggleDemo },
  template: `
    <div class="demobar" :class="{ 'demobar--on': showsMock }">
      <div class="demobar__txt">
        <Icon name="info" :size="16" />
        <span v-if="demo.on">
          <b>Modo desarrollador</b> — datos de demostración, <b>no reales</b>. Solo sirven para mostrar el front.
        </span>
        <span v-else-if="source === 'mock'">
          Algunos datos de esta vista provienen de <b>demostración</b> (no reales) porque el backend (<code class="mono">/api</code>) no respondió a todo.
        </span>
        <span v-else>Datos reales del backend.</span>
      </div>
      <button class="btn btn--sm" @click="toggleDemo"
              :title="demo.on ? 'Volver a los datos reales' : 'Mostrar datos hardcodeados (desarrollador)'">
        <Icon name="refresh" :size="14" />
        {{ demo.on ? 'Ver datos reales' : 'Ver datos de demostración' }}
      </button>
    </div>`,
}

// Nota de error/aviso reutilizable (antes era HTML+estilos inline repetidos).
export const Alert = {
  props: { type: { default: 'error' }, spaced: Boolean },
  template: `
    <div class="note" :class="[type === 'error' ? 'note--error' : '', { mt: spaced }]">
      <Icon name="info" :size="16" />
      <div><slot /></div>
    </div>`,
}

// Carga de imagen reutilizable: zona para arrastrar/soltar (o clic), accesible
// por teclado, que lee el archivo y emite { file, preview, base64 }.
// La vista decide cómo mostrar la vista previa (Detecciones dibuja recuadros,
// Reconocimiento muestra una miniatura), así que aquí solo va la entrada.
export const ImageUpload = {
  props: {
    accept: { default: 'image/*' },
    title: { default: 'Arrastrá una imagen' },
    hint: { default: 'o hacé clic para elegir' },
  },
  emits: ['select'],
  data: () => ({ over: false }),
  methods: {
    pick() { this.$refs.file.click() },
    onFile(e) { this.read(e.target.files[0]); e.target.value = '' },
    onDrop(e) { this.over = false; this.read(e.dataTransfer.files[0]) },
    read(f) {
      if (!f || !f.type.startsWith('image/')) return
      const r = new FileReader()
      r.onload = () => this.$emit('select', { file: f, preview: r.result, base64: String(r.result).split(',')[1] })
      r.readAsDataURL(f)
    },
  },
  template: `
    <div class="dropzone" :class="{ 'is-over': over }"
         role="button" tabindex="0" :aria-label="title"
         @click="pick" @keydown.enter.prevent="pick" @keydown.space.prevent="pick"
         @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="onDrop">
      <input ref="file" type="file" :accept="accept" hidden @change="onFile" />
      <Icon name="upload" :size="26" />
      <div><b>{{ title }}</b> {{ hint }}</div>
      <div v-if="$slots.default" class="small"><slot /></div>
    </div>`,
}

// Captura de rostro: enciende la cámara (getUserMedia) o deja subir una imagen.
// Emite `change` con { preview, base64 } al capturar/subir, o null al quitar.
// Apaga el stream al capturar, al quitar y al desmontarse.
export const FaceCapture = {
  emits: ['change'],
  data: () => ({ camOn: false, stream: null, preview: null, error: null }),
  beforeUnmount() { this.stop() },
  methods: {
    async start() {
      this.error = null
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.error = 'Este navegador no permite usar la cámara (se necesita HTTPS).'
        return
      }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
        this.camOn = true
        await this.$nextTick()
        if (this.$refs.video) this.$refs.video.srcObject = this.stream
      } catch (e) {
        this.error = e && e.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Habilitalo en el navegador.'
          : 'No se pudo acceder a la cámara.'
        this.camOn = false
      }
    },
    stop() {
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null }
      this.camOn = false
    },
    shoot() {
      const v = this.$refs.video
      if (!v || !v.videoWidth) return
      const c = document.createElement('canvas')
      c.width = v.videoWidth; c.height = v.videoHeight
      c.getContext('2d').drawImage(v, 0, 0)
      this.set(c.toDataURL('image/jpeg', 0.9))
      this.stop()
    },
    onUpload({ preview }) { this.set(preview) },
    set(preview) { this.preview = preview; this.$emit('change', { preview, base64: String(preview).split(',')[1] }) },
    clear() { this.preview = null; this.error = null; this.$emit('change', null) },
  },
  template: `
    <div class="facecap">
      <template v-if="preview">
        <div class="thumb thumb--lg"><img :src="preview" alt="rostro capturado" /></div>
        <button type="button" class="btn btn--ghost btn--sm mt" @click="clear">Quitar foto</button>
      </template>
      <template v-else-if="camOn">
        <div class="facecap__video"><video ref="video" autoplay playsinline muted></video></div>
        <div class="row gap-sm mt">
          <button type="button" class="btn btn--primary" @click="shoot"><Icon name="camera" :size="16" /> Capturar</button>
          <button type="button" class="btn btn--ghost" @click="stop">Apagar cámara</button>
        </div>
      </template>
      <template v-else>
        <button type="button" class="btn btn--block" @click="start"><Icon name="camera" :size="16" /> Encender cámara</button>
        <div class="facecap__or"><span>o subí una imagen</span></div>
        <ImageUpload title="Subir una foto" hint="" @select="onUpload">Un rostro bien visible</ImageUpload>
      </template>
      <Alert v-if="error" spaced>{{ error }}</Alert>
    </div>`,
}

// Enrolamiento de varias muestras: cámara (capturar de a una) o subir VARIAS
// imágenes a la vez. Mantiene la lista internamente y emite 'change' con el
// array [{ preview, base64 }]. Apaga el stream al desmontarse.
export const FaceEnroll = {
  emits: ['change'],
  data: () => ({ photos: [], camOn: false, stream: null, error: null, over: false }),
  beforeUnmount() { this.stop() },
  methods: {
    sync() { this.$emit('change', this.photos) },
    async start() {
      this.error = null
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.error = 'Este navegador no permite usar la cámara (se necesita HTTPS).'
        return
      }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
        this.camOn = true
        await this.$nextTick()
        if (this.$refs.video) this.$refs.video.srcObject = this.stream
      } catch (e) {
        this.error = e && e.name === 'NotAllowedError' ? 'Permiso de cámara denegado.' : 'No se pudo acceder a la cámara.'
        this.camOn = false
      }
    },
    stop() {
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null }
      this.camOn = false
    },
    shoot() {
      const v = this.$refs.video
      if (!v || !v.videoWidth) return
      const c = document.createElement('canvas')
      c.width = v.videoWidth; c.height = v.videoHeight
      c.getContext('2d').drawImage(v, 0, 0)
      this.push(c.toDataURL('image/jpeg', 0.9))   // la cámara queda encendida para tomar más
    },
    pick() { this.$refs.file.click() },
    onFiles(e) { this.addFiles(e.target.files); e.target.value = '' },
    onDrop(e) { this.over = false; this.addFiles(e.dataTransfer.files) },
    addFiles(list) {
      Array.from(list || []).forEach((f) => {
        if (!f.type.startsWith('image/')) return
        const r = new FileReader()
        r.onload = () => this.push(r.result)
        r.readAsDataURL(f)
      })
    },
    push(preview) { this.photos.push({ preview, base64: String(preview).split(',')[1] }); this.sync() },
    remove(i) { this.photos.splice(i, 1); this.sync() },
  },
  template: `
    <div class="enroll">
      <template v-if="camOn">
        <div class="facecap__video"><video ref="video" autoplay playsinline muted></video></div>
        <div class="row gap-sm mt">
          <button type="button" class="btn btn--primary" @click="shoot"><Icon name="camera" :size="16" /> Capturar</button>
          <button type="button" class="btn btn--ghost" @click="stop">Apagar cámara</button>
        </div>
      </template>
      <template v-else>
        <button type="button" class="btn btn--block" @click="start"><Icon name="camera" :size="16" /> Encender cámara</button>
        <div class="facecap__or"><span>o subí una o varias imágenes</span></div>
        <input ref="file" type="file" accept="image/*" multiple hidden @change="onFiles" />
        <div class="dropzone" :class="{ 'is-over': over }" role="button" tabindex="0"
             @click="pick" @keydown.enter.prevent="pick" @keydown.space.prevent="pick"
             @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="onDrop">
          <Icon name="upload" :size="26" />
          <div><b>Elegí varias fotos</b> o arrastralas acá</div>
          <div class="small">Podés seleccionar más de una a la vez</div>
        </div>
      </template>

      <Alert v-if="error" spaced>{{ error }}</Alert>

      <div v-if="photos.length" class="enroll__grid">
        <div v-for="(p, i) in photos" :key="i" class="enroll__item">
          <img :src="p.preview" alt="muestra" />
          <button type="button" class="enroll__rm" @click="remove(i)" aria-label="Quitar"><Icon name="close" :size="12" /></button>
        </div>
      </div>
      <div class="enroll__count" :class="{ ok: photos.length }">{{ photos.length }} foto(s) en cola</div>
    </div>`,
}

// Visor de una imagen con sus cajas de detección (bounding boxes) interactivas:
// permite mostrar/ocultar todas, y activar/seleccionar cada una por separado.
export const DetectionViewer = {
  props: {
    src: String,
    detections: { type: Array, default: () => [] },
  },
  data: () => ({ nat: { w: 0, h: 0 }, showAll: true, hidden: {}, selected: -1, failed: false }),
  computed: {
    list() {
      return (this.detections || []).map((d, i) => {
        const b = d.bbox || {}
        return {
          i,
          label: d.label || d.class_name || '—',
          confidence: d.confidence != null ? d.confidence : 0,
          bbox: b,
          hasBox: b && b.x1 != null && b.x2 != null,
          on: !this.hidden[i],
        }
      })
    },
    visibleCount() { return this.list.filter(d => this.showAll && d.on).length },
  },
  methods: {
    pct(v) { return Math.round((v || 0) * 100) + '%' },
    onLoad(e) { this.nat = { w: e.target.naturalWidth, h: e.target.naturalHeight } },
    boxStyle(b) {
      const w = this.nat.w || 1, h = this.nat.h || 1
      return {
        left: (b.x1 / w * 100) + '%', top: (b.y1 / h * 100) + '%',
        width: ((b.x2 - b.x1) / w * 100) + '%', height: ((b.y2 - b.y1) / h * 100) + '%',
      }
    },
    toggleAll() { this.showAll = !this.showAll },
    toggleOne(i) { this.hidden = { ...this.hidden, [i]: !this.hidden[i] } },
    select(i) { this.selected = this.selected === i ? -1 : i },
  },
  template: `
    <div class="dviewer">
      <div class="dviewer__stage">
        <img :src="src" alt="detección" @load="onLoad" @error="failed = true" />
        <template v-if="!failed">
          <div v-for="d in list" :key="d.i" v-show="showAll && d.on && d.hasBox"
               class="detbox" :class="{ 'detbox--sel': selected === d.i }" :style="boxStyle(d.bbox)"
               @click.stop="select(d.i)" :title="d.label">
            <span class="detbox__tag">{{ d.label }} {{ pct(d.confidence) }}</span>
          </div>
        </template>
      </div>

      <div class="dviewer__side">
        <div class="row row--between" style="margin-bottom:10px">
          <b style="font-size:13.5px">Clases ({{ list.length }})</b>
          <button class="btn btn--sm" @click="toggleAll">
            <Icon :name="showAll ? 'detect' : 'image'" :size="14" /> {{ showAll ? 'Ocultar cajas' : 'Mostrar cajas' }}
          </button>
        </div>
        <div class="dlist">
          <div v-for="d in list" :key="d.i" class="dlist__item" :class="{ 'is-sel': selected === d.i }">
            <input type="checkbox" :checked="d.on" :disabled="!d.hasBox" @change="toggleOne(d.i)"
                   :aria-label="'Mostrar caja de ' + d.label" />
            <button class="dlist__btn" @click="select(d.i)" :disabled="!d.hasBox">
              <span class="dlist__name">{{ d.label }}</span>
              <span class="dlist__conf mono">{{ pct(d.confidence) }}</span>
            </button>
          </div>
          <div v-if="!list.length" class="muted" style="font-size:13px;padding:8px">Sin detecciones en esta imagen.</div>
        </div>
      </div>
    </div>`,
}

export const MapPicker = {
  props: { modelValue: { type: Object, default: () => ({ lat: null, lon: null }) } },
  emits: ['update:modelValue'],
  data: () => ({ map: null, marker: null, initialized: false, lat: -34.6037, lon: -58.3816 }),
  watch: {
    'modelValue.lat'(v) { if (v != null && this.map) this.updateMarker(v, this.modelValue.lon) }
  },
  mounted() {
    this.$nextTick(() => {
      const el = this.$refs.mapcontainer
      if (!el) return
      if (!window.L) { console.error('Leaflet no cargó'); return }
      this.map = window.L.map(el).setView([this.lat, this.lon], 13)
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(this.map)
      this.map.on('click', (e) => {
        this.updateMarker(e.latlng.lat, e.latlng.lng)
        this.$emit('update:modelValue', { lat: e.latlng.lat, lon: e.latlng.lng })
      })
      if (this.modelValue.lat != null) this.updateMarker(this.modelValue.lat, this.modelValue.lon)
      this.initialized = true
      // El contenedor puede no tener su tamaño final al inicializar: forzamos recálculo.
      setTimeout(() => { if (this.map) this.map.invalidateSize() }, 200)
    })
  },
  methods: {
    updateMarker(lat, lon) {
      if (!this.map) return
      if (this.marker) this.map.removeLayer(this.marker)
      this.marker = window.L.marker([lat, lon]).addTo(this.map)
      this.map.setView([lat, lon], 13)
    }
  },
  template: `
    <div style="border-radius:8px;overflow:hidden;border:1px solid var(--line)">
      <div ref="mapcontainer" style="width:100%;height:300px;background:var(--bg-soft)"></div>
      <div class="muted" style="font-size:12px;padding:8px;background:var(--bg-soft);border-top:1px solid var(--line)">
        <Icon name="pin" :size="14" style="vertical-align:middle;margin-right:4px" />
        <span v-if="modelValue.lat && modelValue.lon">
          <b>Ubicación:</b> {{ modelValue.lat.toFixed(4) }}, {{ modelValue.lon.toFixed(4) }}
        </span>
        <span v-else><b>Hacé click en el mapa</b> para seleccionar una ubicación (obligatorio)</span>
      </div>
    </div>`,
}

// Mapa con la ubicación de cada frame detectado. Cada pin es la miniatura de la
// foto + el número de objetos; al clickear emite 'open' con el frame.
export const DetectionsMap = {
  props: { frames: { type: Array, default: () => [] } },
  emits: ['open'],
  data: () => ({ map: null, fitted: false, pins: {} }),
  watch: { frames() { this.render() } },
  mounted() {
    this.$nextTick(() => {
      const el = this.$refs.map
      if (!el || !window.L) { console.error('Leaflet no cargó'); return }
      this.map = window.L.map(el).setView([-31.42, -64.18], 12) // Córdoba por defecto
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap'
      }).addTo(this.map)
      this.render()
      setTimeout(() => { if (this.map) this.map.invalidateSize() }, 200)
    })
  },
  beforeUnmount() {
    if (this.map) { this.map.remove(); this.map = null }
  },
  methods: {
    // Render incremental: agrupa por coordenada y hace un diff contra los pines ya
    // dibujados. Los marcadores sin cambios NO se tocan (no se recrean), así el
    // refresco automático o cambiar de modelo no los "traba" durante zoom/pan.
    render() {
      if (!this.map) return
      const groups = new Map()
      this.frames.forEach((f) => {
        const lat = Number(f.lat), lon = Number(f.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
        const key = lat.toFixed(6) + ',' + lon.toFixed(6)
        if (!groups.has(key)) groups.set(key, { key, lat, lon, items: [] })
        groups.get(key).items.push(f)
      })
      const seen = {}
      const pts = []
      groups.forEach((g) => {
        const gsig = g.items.map(it => it.frameId + ':' + (it.detections ? it.detections.length : 0)).join(',')
        seen[g.key] = true
        pts.push([g.lat, g.lon])
        const existing = this.pins[g.key]
        if (existing && existing.sig === gsig) return // sin cambios: dejar el pin tal cual
        if (existing) this.map.removeLayer(existing.marker)
        const marker = this.makeMarker(g)
        marker.addTo(this.map)
        this.pins[g.key] = { sig: gsig, marker }
      })
      // Quitar pines de puntos que ya no están en el conjunto actual.
      Object.keys(this.pins).forEach((k) => {
        if (!seen[k]) { this.map.removeLayer(this.pins[k].marker); delete this.pins[k] }
      })
      // Encuadrar solo la primera vez (no pisar el zoom/posición del usuario).
      if (pts.length && !this.fitted) {
        this.map.fitBounds(pts, { padding: [60, 60], maxZoom: 15 })
        this.fitted = true
      }
    },
    makeMarker(g) {
      const cover = g.items[0]
      const multi = g.items.length > 1
      const badge = multi ? (g.items.length + ' fotos') : ((cover.detections ? cover.detections.length : 0) + '')
      const icon = window.L.divIcon({
        className: 'photo-pin',
        html: '<div class="photo-pin__box' + (multi ? ' photo-pin__box--multi' : '') + '">' +
              '<img src="' + cover.url + '" loading="lazy" alt="frame"/>' +
              '<span class="photo-pin__count">' + badge + '</span></div>' +
              '<span class="photo-pin__tip"></span>',
        iconSize: [60, 70], iconAnchor: [30, 70],
      })
      const mk = window.L.marker([g.lat, g.lon], { icon })
      if (!multi) {
        mk.on('click', () => this.$emit('open', cover))
      } else {
        const html = '<div class="pin-pop">' +
          '<div class="pin-pop__title">' + g.items.length + ' fotos en este punto</div>' +
          '<div class="pin-pop__grid">' +
          g.items.map((it, i) =>
            '<button class="pin-pop__item" data-idx="' + i + '">' +
            '<img src="' + it.url + '" loading="lazy" alt="frame"/>' +
            '<span class="pin-pop__obj">' + (it.detections ? it.detections.length : 0) + ' obj</span>' +
            '</button>').join('') +
          '</div></div>'
        mk.bindPopup(html, { minWidth: 240, maxWidth: 280, className: 'pin-pop-wrap' })
        mk.on('popupopen', (e) => {
          const root = e.popup.getElement()
          if (!root) return
          root.querySelectorAll('.pin-pop__item').forEach((el) => {
            el.addEventListener('click', () => {
              this.$emit('open', g.items[+el.dataset.idx])
              mk.closePopup()
            })
          })
        })
      }
      return mk
    },
  },
  template: `
    <div>
      <div ref="map" style="width:100%;height:560px;border-radius:10px;overflow:hidden;border:1px solid var(--line)"></div>
      <div v-if="!frames.length" class="muted" style="font-size:13px;padding:10px 4px">
        No hay detecciones con ubicación todavía. Subí una imagen eligiendo un punto en el mapa.
      </div>
    </div>`,
}

export const ui = { Frame, Conf, Spinner, Empty, DemoToggle, Alert, ImageUpload, FaceCapture, FaceEnroll, DetectionViewer, Pager, Icon, MapPicker, DetectionsMap }
