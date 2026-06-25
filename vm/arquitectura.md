# Arquitectura — ATALAYA (TP Integrador SOA)

Consola de **visión por computadora y reconocimiento facial**. Permite subir imágenes,
detectar objetos con modelos YOLO, registrar personas con su rostro, identificarlas y
observar todo el sistema en tiempo real. Toda la plataforma corre como un conjunto de
contenedores orquestados con **Docker Compose**, detrás de un único dominio
(`https://soagbct2026.mooo.com`) servido por **Nginx**.

---

## 1. Vista general

```
                           Internet (HTTPS)
                                  │
                        ┌─────────▼──────────┐
                        │   NGINX (TLS)      │  reverse proxy + archivos estáticos
                        └─┬───┬───┬───┬───┬──┘
            /  /assets    │   │   │   │   │
         (frontend Vue)   │   │   │   │   └── /grafana/  → Grafana
                          │   │   │   └────── /auth/     → Keycloak
                          │   │   └────────── /adminer/  → Adminer
                          │   └────────────── /storage/  → SeaweedFS
                          └────────────────── /api/      → Node-RED (HTTP API)
                                                  │
                  ┌───────────────┬──────────────┼───────────────┐
                  ▼               ▼              ▼                ▼
            PostgreSQL        SeaweedFS      Keycloak        FastAPI (GPU remota)
            + pgvector       (imágenes)     (Admin API)     YOLO + embeddings faciales
                                                                 10.158.125.189:8000

   Observabilidad:  Telegraf ──► InfluxDB ──► Grafana   (TIG stack)
                    (scrapea Docker, sistema, /metrics de Node-RED y de FastAPI)
```

Red interna Docker: `soa-network` (bridge). Los servicios se hablan por nombre de
contenedor (`soa_postgres`, `soa_keycloak`, `seaweedfs`, etc.).

---

## 2. Tecnologías por capa

### 2.1 Reverse proxy y TLS — Nginx
- **`nginx:alpine`**. Único punto de entrada (puertos 80/443). El 80 redirige a 443.
- **TLS con Let's Encrypt** (certificados montados desde `/etc/letsencrypt`).
- Sirve el **frontend estático** desde `./frontend` y hace de **reverse proxy** hacia el
  resto de los servicios por subpath:
  - `/` y `/assets` → frontend (con `try_files … /index.html` para que funcione la SPA).
  - `/api/` → Node-RED (`soa_nodered:1880`). Incluye `proxy_read_timeout 300s` para
    tolerar el procesamiento de imágenes en la GPU.
  - `/auth/` → Keycloak, `/grafana/` → Grafana, `/adminer/` → Adminer, `/storage/` → SeaweedFS.
- Config en `nginx/nginx.conf`.

### 2.2 Frontend — Vue 3 (sin build) + Leaflet
- **Vue 3** en su build *ESM para navegador* (`/vendor/vue.esm-browser.prod.js`),
  cargado por **import maps** desde `index.html`. **No hay bundler ni paso de compilación**:
  los `.js` se sirven tal cual como módulos ES nativos. Editar y recargar, listo.
- **Router SPA propio y mínimo** (`assets/router.js`) en modo *history*, con soporte de
  parámetros (`/persons/:id`). Nginx hace el fallback a `index.html`.
- **Leaflet** (CDN) para el mapa de detecciones georreferenciadas.
- Estilos en un único `assets/styles.css` (con tema claro/oscuro por variables CSS).
- Autenticación contra Keycloak por **OIDC**: *Authorization Code + PKCE* y también
  *Direct Access Grant* (login con formulario propio), implementado a mano con `fetch` +
  Web Crypto (`assets/auth.js`). El token vive en `sessionStorage`.
- Estructura: vistas en `assets/views/` (Dashboard, Detections, Recognition, Persons,
  PersonDetail, Models, Login) y componentes reutilizables en `assets/components/`.

### 2.3 IAM / Seguridad — Keycloak
- **`quay.io/keycloak/keycloak:latest`** en modo `start-dev --proxy-headers xforwarded`
  (entiende que Nginx termina el HTTPS). Expuesto en `/auth/`.
- **Realm:** `atalaya`. Cliente público `atalaya-frontend` (PKCE).
- **Roles de realm:** `viewer`, `operator`, `admin`, con **jerarquía por roles compuestos**:
  `admin ⊃ operator ⊃ viewer`. El rol `viewer` está en el **default-role** del realm, así
  que toda cuenta nueva nace como `viewer`.
- **Promoción automática:** al activar el 2FA, una cuenta `viewer` pasa a `operator`
  (ver §5). El rol `admin` **solo se asigna manualmente desde Keycloak**.
- Node-RED usa la **Admin API** de Keycloak (token `admin-cli` del realm `master`) para
  crear usuarios, asignar roles y borrar cuentas.

### 2.4 Orquestación / Backend — Node-RED
- **`nodered/node-red:latest`**. Es el **backend de la aplicación**: expone la API HTTP
  bajo `/api/` (ver §4) mediante nodos *http in / function / postgresql / http request*.
- **Seguridad por RBAC** en `settings.js` (`httpNodeMiddleware`): valida el *Bearer token*
  contra el endpoint `userinfo` de Keycloak y aplica la política de acceso por método +
  ruta + rol. Adjunta `req.kcRole` y `req.kcEmail` para que los flujos validen *propiedad*
  (un `viewer` solo puede tocar su propia persona).
- **Módulo `http` nativo** expuesto vía `functionGlobalContext` (el sandbox de las
  funciones no trae `fetch`); se usa para las llamadas a la Admin API de Keycloak.
- **Métricas Prometheus** habilitadas (`PROMETHEUS_COLLECT_DEFAULT_METRICS=true`),
  expuestas en `/metrics`.
- Persistencia de flujos y configuración en `./nodered_data` (incluye `flows.json`,
  `settings.js` y los `node_modules` de los paquetes instalados).

### 2.5 Procesamiento de imágenes — sharp (thumbnails)
- **`sharp`** (libvips), vía el paquete de paleta **`@soupbowl/node-red-sharp`**
  (nodo `sharp-resize`). Genera las **miniaturas** de los frames bajo demanda:
  `GET /api/frames/:id?thumbnail=true` redimensiona a **máx 200×200** (`fit: inside`,
  conserva proporción) y devuelve el JPEG reducido.
- **Por qué sharp y no jimp:** la implementación original usaba `jimp`, que decodifica la
  imagen completa en memoria. Con fotos grandes (cámaras/celulares) eso **agotaba la RAM y
  tiraba todo Node-RED** (502 y errores de conexión a Postgres como efecto secundario).
  `sharp` usa libvips, procesa en streaming con bajísimo consumo de memoria y es mucho más
  rápido, eliminando el riesgo de OOM. Los nodos `jimp` fueron retirados del flujo.

### 2.6 Base de datos — PostgreSQL + pgvector
- **`pgvector/pgvector:pg15`**: PostgreSQL 15 con la extensión **`vector`** para búsqueda
  por similitud (reconocimiento facial). Esquema en `init.sql` (ver §3).
- Vectores faciales de **128 dimensiones**, con índice **IVFFlat** sobre distancia coseno
  (`vector_cosine_ops`). La función SQL **`match_face(vector, threshold)`** devuelve la
  persona más parecida cuyo `confidence` (= `1 - distancia_coseno`) supera el umbral.
- Datos persistidos en `./postgres_data`.

### 2.7 Almacenamiento de objetos — SeaweedFS
- **`chrislusf/seaweedfs:latest`**: almacén de objetos para las **imágenes/frames**. Cada
  frame se guarda con su FID, que se usa como `frame_id` en Postgres. Node-RED recupera la
  imagen desde `http://seaweedfs:8080/<fid>` y la sirve (original o thumbnail). Datos en
  `./seaweedfs_data`.

### 2.8 Inferencia — FastAPI sobre GPU (remota)
- Servicio externo en **`10.158.125.189:8000`** (GPU), **fuera** del Docker Compose.
  Node-RED lo consume por HTTP:
  - `POST /detect/base64` — detección de objetos con **YOLO** (varios modelos `.pt`).
  - `POST /embeddings/base64` — extracción de **embeddings faciales** (vector 128-d) y
    `face_count` (cantidad de rostros detectados).
  - `GET /models`, `GET /models/:name/classes`, `GET /health`, `GET /metrics`.
- Es el componente más pesado y el que define la latencia de detección/reconocimiento
  (de ahí los timeouts amplios en Nginx y en el frontend).

### 2.9 Observabilidad — TIG stack (Telegraf + InfluxDB + Grafana)
- **Telegraf** (`telegraf:alpine`): recolecta cada 10s métricas de **Docker** (vía
  `docker.sock`), **CPU/memoria/red/disco/sistema** y scrapea endpoints **Prometheus** de
  **Node-RED** (`/metrics`) y de la **FastAPI** (`:8000/metrics`).
- **InfluxDB 1.8** (`influxdb:1.8-alpine`): base de series temporales (`soa_metrics`).
- **Grafana** (`grafana/grafana:latest`): dashboards, servido bajo `/grafana/`
  (`GF_SERVER_SERVE_FROM_SUB_PATH=true`). Provisioning en `./grafana_provisioning`.

### 2.10 Administración de BD — Adminer
- **`adminer:latest`** bajo `/adminer/`: gestor web de PostgreSQL para inspección/debug.

### 2.11 Contenedores — Docker Compose
- `docker-compose.yml` define todos los servicios, volúmenes y la red `soa-network`.
- Configuración sensible y parametrización por **`.env`** (`DOMAIN_NAME`, credenciales de
  Postgres, Keycloak, InfluxDB y Grafana).

---

## 3. Modelo de datos (PostgreSQL — `init.sql`)

| Tabla | Propósito | Campos clave |
|-------|-----------|--------------|
| `frames` | Fotogramas analizados | `frame_id` (FID de SeaweedFS), `latitude`, `longitude`, `metadata` (JSONB), `created_at` |
| `detections` | Resultados de YOLO | `frame_id` (FK), `class_name`, `confidence`, `bbox` (JSONB), `model_id` |
| `persons` | Padrón de personas | `person_id`, `first_name`, `last_name`, `email` (único), `extra` (JSONB, guarda `two_factor`), `keycloak_user_id` |
| `embeddings` | Vectores faciales | `person_id` (FK, `ON DELETE CASCADE`), `vector VECTOR(128)` |
| `recognitions` | Historial de reconocimientos | `person_id` (FK, `ON DELETE SET NULL`), `confidence`, `created_at` |

Índices destacados: GIN sobre `frames.metadata`, IVFFlat sobre `embeddings.vector`.
Función: `match_face(query_vector, threshold)`.

> Nota: el vínculo **cuenta ↔ persona** es por **email** (la persona se crea en el
> registro con el mismo email del usuario de Keycloak; `keycloak_user_id` la enlaza además).

---

## 4. API HTTP (Node-RED, bajo `/api/`)

| Método | Ruta | Descripción | Acceso |
|--------|------|-------------|--------|
| POST | `/register` | Crea el usuario en Keycloak (Admin API) **y** la persona del padrón | Público |
| POST | `/face-recognition` | Identifica un rostro (FastAPI + `match_face`); valida 1 sola cara (`face_count`) | Autenticado |
| GET | `/reconocimiento` | Historial de reconocimientos | Autenticado |
| POST | `/detections1` | Detección de objetos en una imagen (YOLO) | operator / admin |
| GET | `/frames/:id` | Imagen del frame; `?thumbnail=true` devuelve la miniatura (sharp) | Autenticado |
| GET | `/frames/search` | Listado de frames + detecciones | Autenticado |
| GET | `/persons`, `/persons/:id` | Padrón / detalle | Autenticado (lectura) |
| POST | `/persons` | Alta de persona | operator / admin (las cuentas nuevas se crean vía `/register`) |
| POST | `/persons/:id/embeddings` | Agrega muestras faciales | operator/admin, o el **viewer dueño** (su propio 2FA) |
| POST | `/persons/:id/twofactor` | Activa/desactiva 2FA; dispara la promoción a `operator` | operator/admin, o el **viewer dueño** |
| DELETE | `/persons/:id` | Elimina la persona **y** su cuenta de Keycloak | admin |
| DELETE | `/persons/:id/embeddings` | Limpia las muestras | admin |
| GET | `/models`, `/models/:name/classes` | Modelos YOLO disponibles y sus clases | Autenticado |
| GET | `/health/yolo`, `/health/storage` | Salud de FastAPI y SeaweedFS | Autenticado |

---

## 5. Modelo de seguridad y flujos clave

### Roles y RBAC
- **viewer** (default): solo lectura (GET).
- **operator**: escrituras (detección, alta de personas, muestras).
- **admin**: todo, incluidas operaciones destructivas (DELETE) — **solo se otorga desde Keycloak**.
- Doble control: el frontend oculta acciones según el rol, y Node-RED las **valida de
  verdad** en el middleware (Keycloak es la única fuente del rol).
- **Propiedad:** un `viewer` solo puede subir embeddings / activar 2FA sobre **su propia
  persona** (se compara el email del token con el de la persona).

### Registro de cuenta
`/register` → crea el usuario en Keycloak (token admin) → crea la fila en `persons` con el
mismo email. El usuario nace como `viewer`.

### Doble factor (2FA) por rostro y promoción
1. El usuario enrola su rostro: `POST /persons/:id/embeddings` (FastAPI genera el vector).
2. `POST /persons/:id/twofactor {enabled:true}` marca `extra.two_factor = true`.
3. Ese mismo flujo, en un nodo función con el módulo `http`, **promueve la cuenta a
   `operator`** en Keycloak (busca el usuario por email y le asigna el rol).
4. El frontend **refresca el token** para reflejar el rol nuevo sin re-login.
5. El 2FA se valida una vez por sesión (marcador en `sessionStorage`, atado al token).

### Detección de objetos
Frontend → `POST /api/detections1` → Node-RED → FastAPI (`/detect/base64`) → guarda el
frame en SeaweedFS y las detecciones en Postgres.

### Reconocimiento facial
Frontend (con umbral elegible) → `POST /api/face-recognition` → FastAPI (`/embeddings/base64`)
→ si hay más de un rostro, error → si no, `match_face` busca el más parecido; el flujo
decide *match / sin coincidencia* contra el umbral y registra en `recognitions`.

### Miniaturas (thumbnails)
`GET /api/frames/:id?thumbnail=true` → Node-RED trae la imagen de SeaweedFS → `sharp-resize`
(máx 200×200) → JPEG reducido. Sin `?thumbnail=true`, devuelve la imagen original.

---

## 6. Despliegue y operación

- **Arranque:** `docker compose up -d` (con el `.env` configurado). `init.sql` crea el
  esquema en el primer arranque de Postgres.
- **Frontend:** archivos estáticos; alcanza con recargar el navegador tras editarlos.
- **Node-RED:** los cambios en `settings.js` requieren `docker compose restart nodered`.
  Cuidado: el **editor de Node-RED es dueño de `flows.json`** — un *Deploy* desde una
  sesión vieja del editor puede pisar ediciones hechas al archivo por fuera.
- **Nginx:** tras tocar `nginx.conf`, `docker compose exec nginx nginx -s reload`.
- **Volúmenes persistentes:** `postgres_data`, `seaweedfs_data`, `influxdb_data`,
  `grafana_data`, `nodered_data`.

---

## 7. Resumen de stack

| Capa | Tecnología |
|------|------------|
| Proxy / TLS | Nginx + Let's Encrypt |
| Frontend | Vue 3 (ESM, sin build), Leaflet, router propio |
| IAM | Keycloak (OIDC, PKCE, RBAC) |
| Backend / API | Node-RED |
| Imágenes (thumbnails) | sharp / libvips (`@soupbowl/node-red-sharp`) |
| Base de datos | PostgreSQL 15 + pgvector |
| Almacenamiento | SeaweedFS |
| Inferencia | FastAPI + YOLO + embeddings faciales (GPU remota) |
| Observabilidad | Telegraf + InfluxDB + Grafana (TIG) + Prometheus |
| Admin BD | Adminer |
| Orquestación | Docker Compose |
