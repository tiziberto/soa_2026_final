// Router mínimo en modo history (nginx ya hace fallback a /index.html).
// Soporta rutas con un parámetro, p. ej. /personas/:id.
import { reactive } from 'vue'

export const route = reactive({ path: location.pathname, params: {} })

let routes = []

export function setRoutes(defs) { routes = defs }

function match(path) {
  for (const r of routes) {
    if (!r.path.includes(':')) {
      if (r.path === path) return { def: r, params: {} }
      continue
    }
    const rp = r.path.split('/'), pp = path.split('/')
    if (rp.length !== pp.length) continue
    const params = {}; let ok = true
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith(':')) params[rp[i].slice(1)] = decodeURIComponent(pp[i])
      else if (rp[i] !== pp[i]) { ok = false; break }
    }
    if (ok) return { def: r, params }
  }
  return { def: routes.find(r => r.path === '*') || routes[0], params: {} }
}

export function resolve() {
  const m = match(location.pathname)
  route.path = location.pathname
  route.params = m.params
  return m.def
}

export function navigate(path) {
  if (path === location.pathname) return
  history.pushState({}, '', path)
  resolve()
}

window.addEventListener('popstate', resolve)

// Intercepta clics en [data-link] para navegación SPA.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]')
  if (!a) return
  const href = a.getAttribute('href')
  if (!href || href.startsWith('http')) return
  e.preventDefault()
  navigate(href)
  window.scrollTo({ top: 0 })
})
