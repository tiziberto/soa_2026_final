// Reconocimiento facial: subir una imagen, evaluarla y ver el historial.
import { api } from '../api.js'
import { timeAgo, pct } from '../util.js'

const POLL_MS = 10000

export const Recognition = {
  data: () => ({
    loading: true, refreshing: false, history: [], source: 'api',
    file: null, preview: null, running: false, result: null, error: null,
    threshold: 0.9,   // nivel de confianza mínimo por defecto (90%)
    page: 1, pageSize: 8, timer: null,
  }),
  created() { this.loadHistory() },
  mounted() { this.timer = setInterval(() => this.loadHistory(true), POLL_MS) },
  beforeUnmount() { clearInterval(this.timer) },
  computed: {
    paged() { return this.history.slice((this.page - 1) * this.pageSize, this.page * this.pageSize) },
  },
  methods: {
    timeAgo, pct,
    // Recarga el historial desde la base. silent = refresco en segundo plano.
    async loadHistory(silent = false) {
      if (silent) this.refreshing = true; else this.loading = true
      const r = await api.getRecognition()
      this.history = r.data || []
      this.source = r.source
      this.loading = false; this.refreshing = false
    },
    onSelect({ file, preview }) {
      this.file = file; this.preview = preview; this.result = null; this.error = null
    },
    async run() {
      if (!this.preview) return
      this.running = true; this.error = null; this.result = null
      try {
        // El backend espera la imagen en base64 (sin el prefijo data:).
        const b64 = this.preview.split(',')[1]
        this.result = await api.faceRecognition({ image: b64, threshold: this.threshold })
        // El backend registra el reconocimiento de forma asíncrona; para no depender
        // de esa carrera, lo agregamos ya al historial (optimista). Al recargar la
        // página, el listado viene completo desde la base.
        if (this.result) {
          this.history.unshift({
            id: 'tmp-' + Date.now(),
            personId: this.result.personId || null,
            name: this.result.name || 'Sin coincidencia',
            confidence: this.result.confidence || 0,
            ts: new Date().toISOString(),
          })
          this.page = 1
        }
      } catch (e) {
        // Si el backend respondió con un error (p. ej. varias caras, sin rostro),
        // mostramos ese motivo; si fue caída de red, el genérico.
        this.error = (e && e.status)
          ? (e.message || 'La imagen no pudo procesarse.')
          : 'No se pudo contactar al servicio de reconocimiento (/api/face-recognition).'
      } finally {
        this.running = false
      }
    },
  },
  template: `
  <div>
    <div class="intro">
      <h2>Reconocimiento</h2>
      <p>Subí una imagen para identificar a una persona del padrón, o revisá el historial reciente.</p>
    </div>

    <div>
      <section class="panel">
        <div class="panel__head"><h3>Identificar una imagen</h3></div>
        <div class="panel__body">
          <div class="field" style="margin-bottom:16px">
            <label for="thr">Nivel de confianza mínimo: <b>{{ Math.round(threshold * 100) }}%</b></label>
            <input id="thr" type="range" min="0.3" max="0.95" step="0.01" v-model.number="threshold"
                   :disabled="running" style="width:100%;accent-color:var(--accent)" />
            <div class="hint" style="display:block;margin-top:4px">
              Más alto = más estricto (menos falsos positivos, pero puede no reconocer a la persona).
              Más bajo = más permisivo. Por debajo de este umbral, se considera “sin coincidencia”.
            </div>
          </div>

          <ImageUpload v-if="!preview" title="Arrastrá una foto" @select="onSelect">JPG o PNG, un rostro bien visible</ImageUpload>

          <div v-else>
            <div class="thumb thumb--lg"><img :src="preview" alt="vista previa" /></div>
            <div class="row mt gap-sm">
              <button class="btn btn--primary" :disabled="running" @click="run">
                <Icon name="scan" :size="16" /> {{ running ? 'Analizando…' : 'Reconocer' }}
              </button>
              <button class="btn btn--ghost" @click="preview = null; file = null; result = null">Cambiar</button>
            </div>

            <div v-if="result" class="panel mt" style="box-shadow:none">
              <div class="panel__body">
                <div class="eyebrow">Resultado</div>
                <template v-if="result.personId || result.name">
                  <div class="row gap-sm mt" style="align-items:center">
                    <div class="avatar">{{ (result.name || '·').slice(0,1) }}</div>
                    <div>
                      <div style="font-weight:600;font-size:16px">{{ result.name || 'Coincidencia' }}</div>
                      <div class="mono muted" style="font-size:12px">{{ result.personId || '—' }}</div>
                    </div>
                  </div>
                  <div class="mt"><Conf :value="result.confidence || 0" /></div>
                </template>
                <template v-else>
                  <div class="row gap-sm mt" style="align-items:center">
                    <div class="avatar" style="background:var(--surface-3);color:var(--ink-3)">?</div>
                    <div>
                      <div style="font-weight:600;font-size:16px">No se encontró ninguna persona</div>
                      <div class="muted" style="font-size:13px">Ningún rostro del padrón supera el umbral elegido.</div>
                    </div>
                  </div>
                  <div v-if="result.confidence" class="mt">
                    <div class="muted" style="font-size:12.5px;margin-bottom:4px">Parecido máximo encontrado (por debajo del umbral):</div>
                    <Conf :value="result.confidence" />
                  </div>
                </template>
              </div>
            </div>

            <Alert v-if="error" spaced>{{ error }}</Alert>
          </div>
        </div>
      </section>

      <section class="panel mt-lg">
        <div class="panel__head">
          <h3>Historial</h3>
          <button class="btn btn--ghost btn--sm" :disabled="refreshing" @click="loadHistory(true)" title="Actualizar">
            <Icon name="refresh" :size="15" :style="refreshing ? 'animation:spin .7s linear infinite' : ''" />
            Actualizar
          </button>
        </div>
        <div class="panel__body--flush">
          <div v-if="loading"><Spinner /></div>
          <template v-else>
            <div class="table-wrap">
            <table class="table">
              <tbody>
                <tr v-for="r in paged" :key="r.id">
                  <td>
                    <div style="font-weight:600">{{ r.name }}</div>
                    <div class="mono" style="font-size:12px;color:var(--ink-3)">{{ r.personId || 'sin coincidencia' }}</div>
                  </td>
                  <td><Conf :value="r.confidence" /></td>
                  <td style="text-align:right;color:var(--ink-3);font-size:13px">{{ timeAgo(r.ts) }}</td>
                </tr>
              </tbody>
            </table>
            </div>
            <Empty v-if="!history.length" icon="scan" title="Sin reconocimientos" />
            <div style="padding:0 16px 12px"><Pager v-model:page="page" :page-size="pageSize" :total="history.length" /></div>
          </template>
        </div>
      </section>
    </div>
  </div>`,
}
