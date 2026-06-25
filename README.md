<div align="center">

# ATALAYA

### Consola de Visión por Computadora y Reconocimiento Facial

*Trabajo Final Integrador — Sistemas Orientados a Servicios (SOA)*

[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![Node-RED](https://img.shields.io/badge/Node--RED-Backend-8F0000?logo=nodered&logoColor=white)](https://nodered.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%20+%20pgvector-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Keycloak](https://img.shields.io/badge/Keycloak-OIDC%20+%20RBAC-4D4D4D?logo=keycloak&logoColor=white)](https://www.keycloak.org/)
[![YOLO](https://img.shields.io/badge/YOLO-GPU-00FFFF?logo=yolo&logoColor=black)](https://docs.ultralytics.com/)

**[soagbct2026.mooo.com](https://soagbct2026.mooo.com)**

</div>

---

## ¿Qué es ATALAYA?

**ATALAYA** es una plataforma web que permite **subir imágenes, detectar objetos con modelos YOLO, registrar personas con su rostro e identificarlas**, todo observado en tiempo real desde un panel de control.

En pocas palabras, te deja:

- **Detectar objetos** en una foto usando varios modelos YOLO.
- **Registrar personas** y su rostro en un padrón.
- **Reconocer caras** comparándolas contra el padrón (búsqueda por similitud vectorial).
- **Ver detecciones georreferenciadas** en un mapa.
- **Monitorear todo el sistema** (CPU, RAM, contenedores, latencias) con dashboards en vivo.
- **Gestionar usuarios y permisos** con login seguro y roles.

Toda la plataforma corre como un conjunto de **contenedores Docker** detrás de un único dominio servido por **Nginx**.

---

## ¿Cómo funciona? (Arquitectura)

```
                           Internet (HTTPS)
                                  │
                        ┌─────────▼──────────┐
                        │   NGINX (TLS)      │  reverse proxy + estáticos
                        └─┬───┬───┬───┬───┬──┘
            /  /assets    │   │   │   │   │
         (frontend Vue)   │   │   │   │   └── /grafana/  → Grafana
                          │   │   │   └────── /auth/     → Keycloak
                          │   │   └────────── /adminer/  → Adminer
                          │   └────────────── /storage/  → SeaweedFS
                          └────────────────── /api/      → Node-RED (API)
                                                  │
                  ┌───────────────┬──────────────┼───────────────┐
                  ▼               ▼              ▼                ▼
            PostgreSQL        SeaweedFS      Keycloak        FastAPI (GPU remota)
            + pgvector       (imágenes)     (Admin API)     YOLO + embeddings
                                                            10.158.125.189:8000

   Observabilidad:  Telegraf ──► InfluxDB ──► Grafana   (TIG stack)
```

El **frontend** (Vue) habla con **Node-RED** (el backend / API), que orquesta todo: guarda imágenes en **SeaweedFS**, persiste datos en **PostgreSQL**, valida usuarios contra **Keycloak** y delega la inferencia pesada (YOLO + rostros) a un servicio **FastAPI sobre GPU**. **Telegraf + InfluxDB + Grafana** observan el sistema completo.

> Para el detalle técnico fino (modelo de datos, endpoints, flujos de seguridad) ver **[vm/arquitectura.md](vm/arquitectura.md)**.

---

## Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Proxy / TLS | Nginx + Let's Encrypt |
| Frontend | Vue 3 (ESM, **sin build**), Leaflet, router propio |
| IAM / Seguridad | Keycloak (OIDC, PKCE, RBAC) |
| Backend / API | Node-RED |
| Thumbnails | sharp / libvips |
| Base de datos | PostgreSQL 15 + pgvector |
| Almacenamiento | SeaweedFS |
| Inferencia | FastAPI + YOLO + embeddings faciales (GPU remota) |
| Observabilidad | Telegraf + InfluxDB + Grafana (TIG) |
| Admin BD | Adminer |
| Orquestación | Docker Compose |

---

## Cómo usarlo

### Requisitos previos

- **Docker** y **Docker Compose** instalados.
- Un dominio apuntando al servidor (o usar `localhost` para pruebas).
- Certificados TLS (Let's Encrypt) en `/etc/letsencrypt` — opcional en local.
- El servicio de inferencia **FastAPI (GPU)** corriendo y accesible (por defecto en `10.158.125.189:8000`).

### 1. Configurar credenciales

El archivo **`.env`** en la raíz centraliza todas las credenciales. Revisalo y ajustá los valores antes de levantar nada:

```bash
# Editá el .env con tus credenciales reales
nano .env
```

> El `.env` **nunca se sube a Git** (ya está en `.gitignore`). Las contraseñas del repo son de ejemplo: **cambialas en producción**.

### 2. Levantar la plataforma

```bash
cd vm
docker compose up -d
```

En el **primer arranque**, `init.sql` crea automáticamente el esquema de la base de datos (tablas, índices y la función `match_face`).

### 3. Verificar que todo esté arriba

```bash
docker compose ps
```

### 4. Acceder

| Servicio | URL |
|----------|-----|
| **App (frontend)** | `https://soagbct2026.mooo.com/` |
| Keycloak (Admin) | `/auth/` |
| Grafana | `/grafana/` |
| Adminer | `/adminer/` |
| SeaweedFS | `/storage/` |

### 5. Primeros pasos en la app

1. **Registrate** desde la pantalla de login (crea tu usuario en Keycloak + tu persona en el padrón). Nacés con rol `viewer`.
2. **Enrolá tu rostro** y activá el **2FA** → la cuenta se promueve automáticamente a `operator`.
3. Ya podés **detectar objetos** y **reconocer rostros**.

---

## Roles y permisos

| Rol | Puede |
|-----|-------|
| **viewer** *(por defecto)* | Solo lectura. Subir su propio rostro y activar su 2FA. |
| **operator** | Detección de objetos, alta de personas, muestras faciales. |
| **admin** | Todo, incluidas operaciones destructivas (eliminar personas/cuentas). *Se otorga solo desde Keycloak.* |

> Doble control: el frontend oculta acciones según el rol **y** Node-RED las valida de verdad en el backend. Keycloak es la única fuente de la verdad sobre los roles.

---

## Operación y mantenimiento

| Tarea | Comando |
|-------|---------|
| Levantar todo | `docker compose up -d` |
| Ver estado | `docker compose ps` |
| Ver logs | `docker compose logs -f <servicio>` |
| Reiniciar Node-RED (tras tocar `settings.js`) | `docker compose restart nodered` |
| Recargar Nginx (tras tocar `nginx.conf`) | `docker compose exec nginx nginx -s reload` |
| Frontend | Editar archivos en `frontend/` y **recargar el navegador** (no hay build) |

> **Cuidado con Node-RED:** el editor es dueño de `flows.json`. Un *Deploy* desde una sesión vieja del editor puede pisar ediciones hechas al archivo por fuera.

### Volúmenes persistentes

`postgres_data` · `seaweedfs_data` · `influxdb_data` · `grafana_data` · `nodered_data`

---

## Estructura del repositorio

```
trabajo final soa/
├── .env                  # Credenciales centralizadas (NO se sube a Git)
├── .gitignore
├── README.md             # Este archivo
│
├── vm/                   # STACK FINAL (versión desplegada — ATALAYA)
│   ├── docker-compose.yml
│   ├── arquitectura.md   # Documentación técnica detallada
│   ├── init.sql          # Esquema inicial de PostgreSQL
│   ├── frontend/         # SPA Vue 3 (sin build)
│   ├── nginx/            # Config del reverse proxy + certs
│   ├── nodered_data/     # Flujos y config del backend
│   ├── telegraf/         # Config de recolección de métricas
│   ├── grafana_provisioning/
│   ├── modelos/          # Modelos YOLO (.pt)
│   └── ...               # volúmenes de datos persistentes
│
└── yolo/                 # PROTOTIPO ANTERIOR (Mongo/MySQL — legacy)
```

> **`vm/` es el stack vigente.** La carpeta `yolo/` es un prototipo previo (MongoDB/MySQL) que se conserva como referencia histórica.

---

<div align="center">

**ATALAYA** — Trabajo Final Integrador SOA · 2026

</div>
