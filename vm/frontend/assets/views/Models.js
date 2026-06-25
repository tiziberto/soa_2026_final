// Modelos disponibles en el motor de inferencia.
import { api } from '../api.js'

export const Models = {
  data: () => ({ loading: true, rows: [], source: 'api', page: 1, pageSize: 12, expanded: {}, classesById: {}, loadingClasses: {} }),
  async created() {
    const r = await api.getModels()
    this.rows = r.data || []
    this.source = r.source
    this.loading = false
    // Traemos las clases reales de cada modelo desde el endpoint (en vivo del .pt).
    this.rows.forEach(m => this.loadClasses(m.id || m.name))
  },
  methods: {
    toggle(id) { this.expanded = { ...this.expanded, [id]: !this.expanded[id] } },
    async loadClasses(id) {
      if (!id || this.classesById[id] || this.loadingClasses[id]) return
      this.loadingClasses = { ...this.loadingClasses, [id]: true }
      try {
        const cls = await api.getModelClasses(id)
        const list = cls.classes || []
        this.classesById = { ...this.classesById, [id]: { count: cls.count ?? list.length, classes: list } }
      } catch (e) {
        this.classesById = { ...this.classesById, [id]: { count: null, classes: [] } }
      } finally {
        this.loadingClasses = { ...this.loadingClasses, [id]: false }
      }
    },
    norm(m) {
      // Tolera distintas formas de respuesta del backend.
      const id = m.id || m.name || '—'
      const c = this.classesById[id]
      return {
        id,
        name: m.name || m.id || 'Modelo',
        task: m.task || m.type || 'Inferencia',
        classes: c ? c.count : null,
        classList: c ? c.classes : [],
        loadingClasses: !!this.loadingClasses[id],
        device: m.device || 'GPU',
        active: m.loaded ?? (m.status === 'activo'),
      }
    },
  },
  computed: {
    models() { return this.rows.map(this.norm) },
    paged() { return this.models.slice((this.page - 1) * this.pageSize, this.page * this.pageSize) },
  },
  template: `
  <div>
    <div class="intro">
      <h2>Modelos</h2>
      <p>Redes cargadas en el motor de inferencia. La ejecución corre sobre GPU en el nodo remoto.</p>
    </div>

    <div v-if="loading"><Spinner /></div>

    <template v-else>
      <div class="grid grid--cards">
        <div v-for="m in paged" :key="m.id" class="card">
          <div class="card__body">
            <div class="row row--between" style="align-items:flex-start">
              <Icon name="layers" :size="22" style="color:var(--accent)" />
              <span class="pill" :class="m.active ? 'pill--ok' : ''">
                <span class="pill__dot"></span> {{ m.active ? 'activo' : 'en reposo' }}
              </span>
            </div>
            <div class="card__title" style="margin-top:12px">{{ m.name }}</div>
            <div class="card__meta">{{ m.id }}</div>
            <dl class="dl mt" style="grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px">
              <dt>Tarea</dt><dd>{{ m.task }}</dd>
              <dt>Clases totales</dt><dd>{{ m.classes != null ? m.classes : (m.loadingClasses ? 'cargando…' : '—') }}</dd>
              <dt>Clases</dt>
              <dd>
                <a v-if="m.classList.length" href="#" @click.prevent="toggle(m.id)" style="color:var(--accent);text-decoration:none">
                  {{ expanded[m.id] ? 'ver menos ▲' : 'ver más ▼' }}
                </a>
                <span v-else-if="m.loadingClasses" class="muted">cargando…</span>
                <span v-else class="muted">—</span>
              </dd>
            </dl>
            <div v-if="expanded[m.id]" class="mt" style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--bg-soft)">
              <div class="muted" style="font-size:12px;margin-bottom:8px">{{ m.classList.length }} clases que reconoce el modelo</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                <span v-for="c in m.classList" :key="c" class="pill" style="font-size:11px">{{ c }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Empty v-if="!models.length" icon="layers" title="Sin modelos" text="El motor no reportó modelos cargados." />
      <Pager v-model:page="page" :page-size="pageSize" :total="models.length" />
    </template>
  </div>`,
}
