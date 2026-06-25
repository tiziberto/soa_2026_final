// Estructura principal: barra lateral de navegación + cabecera + contenido.
import { route, navigate } from '../router.js'
import { session, signOut, initials, theme, toggleTheme } from '../util.js'
import { api, health, demo } from '../api.js'
import { AccountMenu } from './Account.js'

const NAV = [
  { group: 'Operación', items: [
    { path: '/',              label: 'Panel',          icon: 'panel' },
    { path: '/detections',    label: 'Detecciones',    icon: 'detect' },
    { path: '/reconocimiento',label: 'Reconocimiento', icon: 'scan' },
  ]},
  { group: 'Registro', items: [
    { path: '/persons',       label: 'Personas',       icon: 'people' },
    { path: '/models',        label: 'Modelos',        icon: 'layers' },
  ]},
]

const TITLES = {
  '/': 'Panel', '/detections': 'Detecciones', '/reconocimiento': 'Reconocimiento',
  '/persons': 'Personas', '/models': 'Modelos',
}

export const Shell = {
  components: { AccountMenu },
  data: () => ({ nav: NAV, session, health, theme, demo, menuOpen: false }),
  watch: {
    // Cerrar el drawer al cambiar de ruta (navegación móvil).
    'route.path'() { this.menuOpen = false },
  },
  mounted() { api.ping() }, // comprobación inicial de conectividad
  computed: {
    title() {
      const p = route.path
      if (p.startsWith('/persons/')) return 'Detalle de persona'
      return TITLES[p] || 'Atalaya'
    },
    userInitials() { return initials(this.session.user?.name) },
    // Indicador de salud honesto: refleja la última señal real del backend.
    status() {
      if (this.health.reachable === false) return { cls: 'pill--warn', label: 'Sin conexión' }
      if (this.health.reachable === true) return { cls: 'pill--live', label: 'En servicio' }
      return { cls: '', label: 'Comprobando…' }
    },
  },
  methods: {
    isActive(path) {
      if (path === '/') return route.path === '/'
      return route.path === path || route.path.startsWith(path + '/')
    },
    logout() { signOut(); navigate('/login') },
    toggleTheme,
  },
  template: `
  <div class="shell">
    <Transition name="scrim">
      <div v-if="menuOpen" class="scrim" @click="menuOpen = false"></div>
    </Transition>

    <aside class="sidebar" :class="{ 'is-open': menuOpen }">
      <div class="brand">
        <Icon name="tower" class="brand__mark" :size="34" />
        <div>
          <div class="brand__name">Atalaya</div>
          <div class="brand__sub">Consola de visión</div>
        </div>
      </div>

      <nav class="nav">
        <template v-for="g in nav" :key="g.group">
          <div class="nav__label">{{ g.group }}</div>
          <a v-for="it in g.items" :key="it.path"
             :href="it.path" data-link
             class="nav__link" :class="{ 'is-active': isActive(it.path) }"
             :aria-current="isActive(it.path) ? 'page' : null">
            <Icon :name="it.icon" :size="18" />
            <span>{{ it.label }}</span>
          </a>
        </template>
      </nav>

      <AccountMenu />
    </aside>

    <div class="main">
      <header class="topbar">
        <button class="topbar__menu" @click="menuOpen = true"
                aria-label="Abrir menú" :aria-expanded="menuOpen">
          <Icon name="menu" :size="20" />
        </button>
        <div class="topbar__title">
          <h1>{{ title }}</h1>
        </div>
        <div class="topbar__actions">
          <span v-if="demo.on" class="pill pill--warn" title="Datos de demostración (no reales)">
            <span class="pill__dot"></span> Modo demo
          </span>
          <button class="topbar__icon" @click="toggleTheme"
                  :aria-label="theme.mode === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'"
                  :title="theme.mode === 'dark' ? 'Tema claro' : 'Tema oscuro'">
            <Icon :name="theme.mode === 'dark' ? 'sun' : 'moon'" :size="18" />
          </button>
          <span class="pill" :class="status.cls"><span class="pill__dot"></span> {{ status.label }}</span>
        </div>
      </header>
      <main class="content">
        <div class="content__inner">
          <slot></slot>
        </div>
      </main>
    </div>
  </div>`,
  setup() { return { route } },
}
