# Plan B Fase 1 — Neon (Postgres) + Render (API)

Guía operativa cuando **AWS no está disponible** (tarjeta, región, etc.). Misma app NestJS; solo cambia dónde vive la DB y el HTTP.

| Componente | Servicio | Costo orientativo |
|------------|----------|-------------------|
| PostgreSQL | [Neon](https://neon.tech) free | $0 (0.5 GB) |
| API NestJS | [Render](https://render.com) Web Service free | $0 (duerme ~15 min sin tráfico) |

**Neon ya configurado** si completaste `DATABASE_URL` + `prisma migrate deploy` + `db:seed` en local.

---

## A — Prerrequisitos

- [ ] Cuenta [GitHub](https://github.com) con el repo del backend (rama `main` con el código actual)
- [ ] Proyecto Neon con connection string (Dashboard → Connection details)
- [ ] Cuenta [Render](https://dashboard.render.com/register) (GitHub login OK)

Anotar:

| Dato | Valor |
|------|-------|
| Neon `DATABASE_URL` | *(no commitear)* |
| `X-Store-Id` del seed | `902806e2-e432-4bfe-9f9c-5419767fcf08` *(o el que imprima `npm run db:seed`)* |

---

## B — Crear Web Service en Render (manual, recomendado la primera vez)

1. [Dashboard Render](https://dashboard.render.com) → **New +** → **Web Service**
2. Conectar el repositorio de GitHub (autorizar org/repo si pide)
3. Configuración:

| Campo | Valor |
|-------|-------|
| **Name** | `quickmarket-api` (o el que quieras) |
| **Region** | Ohio (US East) — cerca de Neon `us-east-1` |
| **Branch** | `main` |
| **Root Directory** | vacío si el repo **es** la carpeta `backend`; si el repo es monorepo, poner `backend` |
| **Runtime** | Node |
| **Build Command** | `npm ci && npx prisma generate && npm run build` |
| **Start Command** | `npm run start:prod` |
| **Plan** | Free |

4. **Advanced** → **Pre-Deploy Command** (importante):

```bash
npx prisma migrate deploy
```

5. **Health Check Path**: `/`

6. **Environment Variables** (Environment → Add):

| Key | Value | Notas |
|-----|-------|-------|
| `NODE_ENV` | `production` | Logger + Swagger off |
| `DATABASE_URL` | *(pegar Neon)* | Debe incluir `?sslmode=require` |
| `FEATURE_PRODUCT_IMAGES` | `0` | Fase 1: imágenes → 503 |
| `STORE_ONBOARDING_ENABLED` | `0` | `1` solo si onboarding POS desde internet |
| `OPS_SCHEDULER_ENABLED` | `0` | Free tier duerme; métricas bajo demanda |
| `TRUST_PROXY` | `1` | IP real detrás del proxy Render |
| `SWAGGER_ENABLED` | `0` | Forzar docs off |
| `OPS_API_KEY` | *(generar secreto largo)* | Protege `GET /api/v1/ops/metrics` |
| `DASHBOARD_ADMIN_PIN` | *(PIN operadores)* | PATCH dashboard POS |

`PORT` lo asigna Render automáticamente — no hace falta definirlo.

7. **Create Web Service** → esperar primer deploy (5–10 min la primera vez).

URL pública: `https://quickmarket-api.onrender.com` (el slug depende del nombre).

---

## C — Alternativa: Blueprint (`render.yaml`)

El repo incluye [`render.yaml`](../render.yaml). En Render:

**New +** → **Blueprint** → repo → Render crea el servicio con build/preDeploy/start.

Después del blueprint, en el servicio → **Environment** → pegar manualmente:

- `DATABASE_URL`
- `OPS_API_KEY`
- `DASHBOARD_ADMIN_PIN`

---

## D — Seed (solo una vez)

Si **nunca** corriste seed contra esa base Neon:

```bash
# En tu PC, con .env apuntando a Neon
npm run db:seed
```

Render **no** ejecuta seed en cada deploy (correcto para prod).

---

## E — Smoke tests (producción)

Sustituir `BASE` por tu URL Render (sin barra final).

```bash
# Health (sin auth)
curl https://BASE/

# Métricas ops (si definiste OPS_API_KEY)
curl -H "X-Ops-Api-Key: TU_OPS_API_KEY" https://BASE/api/v1/ops/metrics

# API con tienda
curl -H "X-Store-Id: 902806e2-e432-4bfe-9f9c-5419767fcf08" \
  "https://BASE/api/v1/sync/pull?since=0&limit=5"
```

Checklist:

- [ ] `GET /` → `Hello World!`
- [ ] `/api/docs` → **404** o no disponible (Swagger off)
- [ ] `GET /api/v1/sync/pull` con `X-Store-Id` → 200 JSON
- [ ] Upload imagen → **503** (`FEATURE_PRODUCT_IMAGES=0`)
- [ ] Primer request tras ~15 min idle → puede tardar **30–60 s** (cold start free)

---

## F — Flutter / POS

Base URL del cliente:

```text
https://TU-SERVICIO.onrender.com/api/v1
```

Header obligatorio en casi todos los endpoints:

```text
X-Store-Id: <uuid-de-tu-tienda-seed>
```

**Fase 1:** no usar endpoints de imágenes en prod.

---

## G — Deploys siguientes

1. Push a `main` en GitHub
2. Render redeploy automático (Settings → Auto-Deploy ON)
3. Cada deploy ejecuta `preDeployCommand` → `prisma migrate deploy`

No hace falta SSH ni PM2 (a diferencia de EC2).

---

## H — Free tier: limitaciones

| Tema | Comportamiento |
|------|----------------|
| Sleep | ~15 min sin HTTP → servicio apagado |
| Cold start | Primer request tras sleep: lento |
| Disco | Ephemeral — imágenes en disco no persisten (Fase 1: flag OFF) |
| Neon | 0.5 GB, compute limitado — OK para demo/POS pequeño |

Upgrade Render (~$7/mes) elimina sleep si lo necesitas en prod real.

---

## I — Seguridad mínima

- [ ] `DATABASE_URL`, `OPS_API_KEY`, `DASHBOARD_ADMIN_PIN` **solo** en Render Environment (Secret)
- [ ] No commitear `.env`
- [ ] `STORE_ONBOARDING_ENABLED=0` salvo red de confianza
- [ ] Rotar contraseña Neon si la expusiste en chat/screenshot

---

## J — Cuando AWS esté disponible

Este plan B no bloquea la migración a EC2 + RDS:

1. Export/import Postgres o apuntar RDS y `migrate deploy`
2. Cambiar base URL en Flutter
3. Seguir [`AWS_PHASE1_RUNBOOK.md`](./AWS_PHASE1_RUNBOOK.md)

---

## Referencias

- [`render.yaml`](../render.yaml) — blueprint Render
- [`.env.example`](../.env.example) — variables documentadas
- [`AWS_DEPLOY_READINESS.md`](./AWS_DEPLOY_READINESS.md) — checklist funcional Fase 1
- [`FRONTEND.md`](./FRONTEND.md) — contrato POS / sync
