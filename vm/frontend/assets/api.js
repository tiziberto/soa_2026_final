// Capa de acceso al backend (Node-RED tras Nginx, mismo dominio => sin CORS).
// Todas las rutas cuelgan de /api/ según nginx.conf.
//
// Fuente de datos REAL e independiente de la FastAPI (GPU remota):
//   GET /api/frames/search  -> JSON de frames + sus detecciones (Postgres)
//   GET /api/frames/<fid>   -> imagen JPEG del frame (SeaweedFS)
// De ahí derivamos detecciones y modelos. Lo que sí depende de la FastAPI
// (o hoy no responde, como /persons) cae a datos de demostración (mock.js).

import { reactive } from 'vue'
import { mockModels, mockDetections, mockPersons, mockRecognition } from './mock.js'
import { auth } from './auth.js'
import { signOut } from './util.js'
import { navigate } from './router.js'

const BASE = '/api'

// Estado de conectividad compartido (lo lee el indicador del topbar y el panel
// de servicios). `reachable`: null = sin comprobar, true/false = última señal.
// Se actualiza solo: si fetch resuelve (con cualquier código) el backend está
// accesible; si la red falla o vence el timeout, lo marcamos caído.
export const health = reactive({ reachable: null, lastOk: null })

// --- modo desarrollador (datos hardcodeados) --------------------------------
// Cuando está activo, todos los getters devuelven datos de DEMOSTRACIÓN (mock),
// sin tocar el backend. Sirve solo para mostrar el front: NO son datos reales.
// Se persiste para que sobreviva a recargas durante el desarrollo.
export const demo = reactive({ on: (() => { try { return localStorage.getItem('atalaya.demo') === '1' } catch (e) { return false } })() })
export function toggleDemo() {
  demo.on = !demo.on
  try { localStorage.setItem('atalaya.demo', demo.on ? '1' : '0') } catch (e) { /* sin almacenamiento */ }
}
const MOCK = (data) => ({ data, source: 'mock' })

// fetch con timeout, para que un endpoint colgado no congele la UI.
// Adjunta el token de Keycloak; ante un 401 intenta refrescar y reintenta una vez.
async function req(path, opts = {}, timeout = 8000, _retried = false) {
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), timeout)
  let responded = false
  try {
    const res = await fetch(BASE + path, {
      signal: ctrl.signal,
      headers: {
        'Accept': 'application/json',
        ...(auth.token ? { 'Authorization': 'Bearer ' + auth.token } : {}),
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...opts,
    })
    // El servidor contestó (aunque sea un 4xx/5xx): la red está bien.
    responded = true
    health.reachable = true
    health.lastOk = Date.now()
    if (res.status === 401 && !_retried) {
      const ok = await auth.refresh()
      if (ok) return req(path, opts, timeout, true)
      // Sesión vencida y sin posibilidad de refrescar: limpiamos tokens y la
      // sesión local, y volvemos al login por el router (SPA). NO recargamos:
      // un location.reload() con la sesión local intacta vuelve a montar una
      // vista protegida, que repite el 401 y dispara un bucle de recargas.
      auth.clearSession()
      signOut()
      navigate('/login')
      throw new Error('No autenticado')
    }
    if (!res.ok) {
      // Adjuntamos el cuerpo del error (p. ej. { error: "..." } del backend) para
      // que las vistas puedan mostrar el motivo real en vez de un genérico.
      let body = null
      try { body = await res.json() } catch (e) { /* sin cuerpo JSON */ }
      const err = new Error((body && body.error) || `HTTP ${res.status} en ${path}`)
      err.status = res.status
      err.body = body
      throw err
    }
    const ct = res.headers.get('content-type') || ''
    return ct.includes('application/json') ? res.json() : res.text()
  } catch (e) {
    if (!responded) health.reachable = false // red caída o timeout
    throw e
  } finally {
    clearTimeout(tid)
  }
}

async function getOrMock(path, fallback, opts) {
  try { return { data: await req(path, opts), source: 'api' } }
  catch { return { data: fallback, source: 'mock' } }
}

// --- frames/search con caché breve (lo consumen varias vistas) -------------
let _frames = null, _framesTs = 0
async function framesSearch() {
  if (_frames && Date.now() - _framesTs < 4000) return _frames
  const data = await req('/frames/search')
  _frames = Array.isArray(data) ? data : []
  _framesTs = Date.now()
  return _frames
}

// Normaliza una persona del backend (tabla `persons`: person_id, first_name,
// last_name, email, extra, created_at) a la forma que usan las vistas. Tolera
// también la forma del mock por si el endpoint todavía no existe.
function mapPerson(p = {}) {
  // GET /persons/:id devuelve la fila dentro de un array ([{...}]); la desenvolvemos.
  if (Array.isArray(p)) p = p[0] || {}
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
  return {
    id: p.person_id || p.id || '—',
    name: name || p.name || 'Sin nombre',
    email: p.email || null,
    embeddings: p.embeddings ?? p.embedding_count ?? p.samples ?? 0,
    createdAt: p.created_at || p.createdAt || null,
    lastSeen: p.last_seen || p.lastSeen || null,
    // Estado del doble factor guardado en el servidor (persons.extra.two_factor).
    // null = nunca se eligió explícitamente.
    twoFactor: (typeof p.two_factor === 'boolean') ? p.two_factor
      : (p.extra && typeof p.extra.two_factor === 'boolean') ? p.extra.two_factor
      : null,
  }
}

export function prettyModel(id = '') {
  const base = String(id).replace(/\.pt$/i, '')
  const m = base.match(/yolov(\d+)([a-z])?/i)
  let name = m ? `YOLOv${m[1]}${m[2] ? m[2] : ''}` : base
  if (/oiv7/i.test(base)) name += ' · Open Images V7'
  return name
}

export const api = {
  // Sonda liviana de conectividad (actualiza `health`). Reutiliza la caché de
  // framesSearch para no pegar de más al backend.
  ping: () => framesSearch().then(() => true).catch(() => false),

  // Estado real de un servicio externo vía proxy de Node-RED:
  //   GET /api/health/yolo     -> motor de inferencia (FastAPI /health, GPU remota)
  //   GET /api/health/storage  -> SeaweedFS
  async checkHealth(service) {
    try {
      const d = await req('/health/' + service, {}, 5000)
      return !!(d && d.ok)
    } catch { return false }
  },

  // URL pública de la imagen de un frame (sirve directo en <img>).
  // thumbnail=true pide al backend la versión reducida (jimp) del frame.
  frameUrl: (frameId, thumbnail = false) => `${BASE}/frames/${frameId}${thumbnail ? '?thumbnail=true' : ''}`,

  // Clases que reconoce un modelo, leídas en vivo del .pt vía FastAPI
  // (proxy Node-RED GET /models/:name/classes). Devuelve { model, count, classes }.
  getModelClasses: (id) => req('/models/' + encodeURIComponent(id) + '/classes'),

  // Frames con sus detecciones (dato real).
  getFrames: () => (demo.on ? Promise.resolve(MOCK([])) : getOrMock('/frames/search', [])),

  // Detecciones: aplanado de frames/search (una fila por objeto detectado).
  async getDetections() {
    try {
      const frames = await framesSearch()
      const rows = []
      frames.forEach((f) => (f.detections || []).forEach((d, i) => rows.push({
        id: `${f.frameId}#${i + 1}`,
        frameId: f.frameId,
        label: d.class_name,
        confidence: d.confidence,
        model: d.model_id,
        bbox: d.bbox,
        sensor: f.metadata?.sensor,
        lat: f.metadata?.lat,
        lon: f.metadata?.lon,
        meta: f.metadata || {},
      })))
      return { data: rows, source: 'api' }
    } catch {
      // Sin datos hardcodeados: si el backend no responde, queda vacío.
      return { data: [], source: 'api' }
    }
  },

  // Modelos: derivados de las detecciones reales (la FastAPI /models está caída).
  async getModels() {
    try {
      const frames = await framesSearch()
      const acc = new Map()
      frames.forEach((f) => (f.detections || []).forEach((d) => {
        const id = d.model_id || 'desconocido'
        const e = acc.get(id) || { id, name: prettyModel(id), task: 'Detección de objetos', device: 'GPU', loaded: true, status: 'activo', classes: new Set(), count: 0 }
        e.classes.add(d.class_name); e.count++
        acc.set(id, e)
      }))
      const models = [...acc.values()].map((m) => ({ ...m, classes: m.classes.size }))
      return { data: models, source: 'api' }
    } catch {
      // Sin datos hardcodeados: si el backend no responde, la vista queda vacía.
      return { data: [], source: 'api' }
    }
  },

  // Historial real de reconocimientos (sin mock): vacío si el backend no responde.
  getRecognition: () => getOrMock('/reconocimiento', []),

  // Padrón de personas. Intenta el listado real (GET /persons); si el backend
  // aún no expone ese endpoint, cae a datos de demostración. OJO: hoy Node-RED
  // solo tiene POST /persons y GET /persons/:id, así que hasta que se agregue
  // GET /persons las personas registradas no pueden listarse y se ve el mock.
  async getPersons() {
    try {
      const data = await req('/persons')
      const rows = (Array.isArray(data) ? data : [data]).filter(Boolean).map(mapPerson)
      return { data: rows, source: 'api' }
    } catch {
      // Sin datos hardcodeados: si el backend no responde, queda vacío.
      return { data: [], source: 'api' }
    }
  },
  // Resuelve la persona asociada a un email (un usuario ⇒ una persona). Lo usa
  // el 2FA para saber a qué persona colgar los embeddings sin volver a pedir el mail.
  async findPersonByEmail(email) {
    if (!email) return null
    const { data } = await this.getPersons()
    const t = String(email).trim().toLowerCase()
    return (data || []).find(p => (p.email || '').toLowerCase() === t) || null
  },
  async getPerson(id) {
    if (demo.on) return MOCK(mockPersons.find(p => p.id === id) || null)
    try {
      const data = await req(`/persons/${id}`)
      return { data: mapPerson(data), source: 'api' }
    } catch {
      return { data: mockPersons.find(p => p.id === id) || null, source: 'mock' }
    }
  },

  // Detección de objetos/clases en una imagen subida (YOLO vía FastAPI).
  // POST /detections1 espera { modelId, image(base64), metadata }.
  detectObjects: (payload) => req('/detections1', { method: 'POST', body: JSON.stringify(payload) }, 30000),

  // Escrituras (van directo al backend).
  createPerson:    (payload)     => req('/persons', { method: 'POST', body: JSON.stringify(payload) }),
  // Acciones destructivas (solo admin; el backend valida el rol por RBAC).
  // Eliminar persona: borra la fila (sus embeddings caen por ON DELETE CASCADE) y,
  // si tiene cuenta de Keycloak vinculada, también la elimina de Keycloak.
  // Devuelve { ok, deletedFromKeycloak }.
  deletePerson:    (id)          => req(`/persons/${id}`, { method: 'DELETE' }, 20000),
  // Limpiar muestras: borra todos los embeddings de la persona (la persona se mantiene).
  clearEmbeddings: (id)          => req(`/persons/${id}/embeddings`, { method: 'DELETE' }, 15000),
  // Persiste el estado del doble factor de la persona en el servidor.
  setTwoFactor:    (id, enabled) => req(`/persons/${id}/twofactor`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  // Agrega muestras faciales a una persona. El backend
  // (POST /persons/:personId/embeddings) espera { images: [base64, ...] }.
  // Acepta un base64 suelto, un array, o el objeto { image }/{ images } por compatibilidad.
  addEmbeddings: (id, input) => {
    const arr = Array.isArray(input) ? input
      : (input && input.images) ? input.images
      : [input && input.image ? input.image : input]
    const images = arr.filter(Boolean)
    // timeout amplio: el backend procesa las imágenes de a una (secuencial) contra
    // la GPU; puede tardar (model cold-start + N imágenes). Alineado con nginx (300s).
    return req(`/persons/${id}/embeddings`, { method: 'POST', body: JSON.stringify({ images }) }, 300000)
  },
  faceRecognition: (payload)     => req('/face-recognition', { method: 'POST', body: JSON.stringify(payload) }, 20000),

  // Alta de cuenta. El backend (Node-RED POST /register) crea el usuario en
  // Keycloak vía Admin API (token admin del lado servidor: nunca en el front).
  // No crea la persona acá: al entrar después con Direct Grant, el login resuelve
  // (o crea) la persona vinculada por email. Devuelve { ok, status, error }.
  async register(payload) {
    try {
      const res = await fetch(BASE + '/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      })
      let data = null
      try { data = await res.json() } catch (e) { /* respuesta sin cuerpo JSON */ }
      if (!res.ok) return { ok: false, status: res.status, error: (data && data.error) || null }
      return { ok: true, status: res.status, data }
    } catch (e) { return { ok: false, status: 0 } }
  },
}
