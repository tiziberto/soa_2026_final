import { createApp, h, Transition } from 'vue'
import { Icon } from './icons.js'
import { ui } from './components/ui.js'
import { Shell } from './components/Shell.js'
import { route, setRoutes, resolve, navigate } from './router.js'
import { session, signOut } from './util.js'
import { demo } from './api.js'
import { auth } from './auth.js'

import { Login } from './views/Login.js'
import { Dashboard } from './views/Dashboard.js'
import { Detections } from './views/Detections.js'
import { Recognition } from './views/Recognition.js'
import { Persons } from './views/Persons.js'
import { PersonDetail } from './views/PersonDetail.js'
import { Models } from './views/Models.js'

// Las rutas espejan los nombres de los endpoints de Node-RED (/detections,
// /persons, /models, /reconocimiento) para que la URL del navegador coincida.
const routes = [
  { path: '/login',          view: Login,        bare: true },
  { path: '/',               view: Dashboard },
  { path: '/detections',     view: Detections },
  { path: '/reconocimiento', view: Recognition },
  { path: '/persons',        view: Persons },
  { path: '/persons/:id',    view: PersonDetail },
  { path: '/models',         view: Models },
  { path: '*',               view: Dashboard },
]
setRoutes(routes)

// Recordamos la sección en la que se recargó la página (la URL actual del
// navegador) para volver a ella tras el login/2FA, en vez de caer siempre en el
// panel. Se captura ahora, antes de que el guard redirija a /login.
try {
  const boot = location.pathname
  if (boot && boot !== '/login') sessionStorage.setItem('atalaya.route', boot)
} catch (e) { /* sin almacenamiento */ }

const Root = {
  setup() {
    return () => {
      // Leer route.path y demo.on establece las dependencias reactivas: así este
      // render se re-ejecuta al navegar y al alternar el modo desarrollador.
      route.path
      demo.on
      const def = resolve()

      // Guard de sesión: sin usuario, todo lleva a /login.
      if (!session.user && !def.bare) {
        navigate('/login')
        return h(Login)
      }
      if (session.user && def.bare) {
        navigate('/')
        return h(Dashboard)
      }

      // La key incluye el modo demo: al alternarlo, la vista se remonta y
      // vuelve a pedir los datos (reales o de demostración).
      const view = h(Transition, { name: 'fade', mode: 'out-in' },
        () => h(def.view, { key: route.path + (demo.on ? '#demo' : '') }))

      return def.bare ? view : h(Shell, null, { default: () => view })
    }
  },
}

const app = createApp(Root)

// Componentes globales (disponibles en todas las plantillas).
app.component('Icon', Icon)
app.component('Frame', ui.Frame)
app.component('Conf', ui.Conf)
app.component('Spinner', ui.Spinner)
app.component('Empty', ui.Empty)
app.component('DemoToggle', ui.DemoToggle)
app.component('Alert', ui.Alert)
app.component('ImageUpload', ui.ImageUpload)
app.component('FaceCapture', ui.FaceCapture)
app.component('FaceEnroll', ui.FaceEnroll)
app.component('DetectionViewer', ui.DetectionViewer)
app.component('Pager', ui.Pager)
app.component('MapPicker', ui.MapPicker)
app.component('DetectionsMap', ui.DetectionsMap)

// Arranque: procesar el estado de Keycloak antes de montar.
//
// SEGURIDAD 2FA: NO creamos ni confiamos en una sesión local persistida acá. Si
// hay un token de Keycloak válido, dejamos que Login re-derive la sesión y exija
// la verificación facial si la cuenta tiene 2FA — incluso tras un refresco o si
// se manipula la URL. La única vía al panel es pasar por Login.proceedAfterAuth().
;(async () => {
  try { await auth.init() } catch (e) { /* sin Keycloak, queda deslogueado */ }
  signOut()  // descarta cualquier sesión local guardada: se re-deriva con el 2FA
  app.mount('#app')
})()
