# AWS Deploy Readiness — Revisión backend (EC2 t4g.micro + RDS)

Revisión tipo **senior backend** del estado actual del backend NestJS para desplegar en AWS con bajo costo.

**Fecha revisión:** 2026-06-10  
**Alcance actual:** **Fase 1 — solo deploy** (EC2 + RDS). Imágenes S3 = **Fase 2** (después de prod estable).  
**Veredicto:** **Código P0 listo** — pendiente **P0 infra AWS** (RDS, EC2, env, PM2) para primer deploy.

---

## Roadmap por fases (acordado)

| Fase | Qué incluye | Documento | Estado |
|------|-------------|-----------|--------|
| **Fase 1** | Deploy EC2 + RDS, seguridad, sync; **imágenes OFF** (`FEATURE_PRODUCT_IMAGES=0`) | **Este archivo** | **En curso** |
| **Fase 2** | S3 + WebP + `product_images` + habilitar imágenes en prod | [`PRODUCT_IMAGES_S3_IMPLEMENTATION.md`](./PRODUCT_IMAGES_S3_IMPLEMENTATION.md) | **Pospuesto** |

**En Fase 1 en producción:** endpoints de imágenes responden **503**; no forman parte del flujo validado de salida a AWS.

---

## Índice

0. [Roadmap por fases](#roadmap-por-fases-acordado)
1. [Veredicto ejecutivo](#1-veredicto-ejecutivo)
2. [Logging](#2-logging)
3. [Base de datos (PostgreSQL / RDS)](#3-base-de-datos-postgresql--rds)
4. [CPU y memoria (t4g.micro)](#4-cpu-y-memoria-t4gmicro)
5. [Payloads y validaciones](#5-payloads-y-validaciones)
6. [Manejo de errores](#6-manejo-de-errores)
7. [Configuración para producción](#7-configuración-para-producción)
8. [Seguridad básica](#8-seguridad-básica)
9. [Checklist de implementación](#9-checklist-de-implementación)
10. [Orden recomendado de trabajo](#10-orden-recomendado-de-trabajo)
11. [Política de ramas y GitHub Actions](#11-política-de-ramas-y-github-actions)
12. [Imágenes — fuera de alcance Fase 1](#12-imágenes--fuera-de-alcance-fase-1)
13. [Runbook operativo](#13-runbook-operativo)

---

## 1. Veredicto ejecutivo

### Estado general

| Área | Estado | Comentario |
|------|--------|------------|
| Logging | 🟡 Aceptable | Sin `console.log`; pocos logs; falta config explícita prod |
| PostgreSQL / RDS | 🟡 Aceptable con reservas | Prisma sin SQL verbose; algunos listados sin paginación |
| CPU / memoria | 🟡 OK para POS pequeño | Sync batch + reportes en memoria acotados (~31 días) |
| Payloads | 🟢 Bien en general | ValidationPipe global; sync limitado a 200 ops |
| Errores | 🟢 Bien | `ApiExceptionFilter` global unificado |
| Prod config | 🔴 Incompleto | Sin PM2, `@prisma/client` en devDeps, Swagger siempre ON |
| Seguridad | 🔴 Gaps P0 | `/ops` y dashboard PATCH abiertos si faltan env vars |

### Veredicto

> **Fase 1:** desplegar con bajo riesgo en EC2 + RDS.  
> **Fase 2 (después):** imágenes S3 — ver plan aparte, no bloquea este deploy.

Después de completar **P0 infra** (§9): **sí puedes desplegar** para un POS pequeño/mediano. **Imágenes de producto no forman parte del alcance operativo Fase 1** (ver §12).

---

## 2. Logging

### Qué hay hoy

| Aspecto | Hallazgo |
|---------|----------|
| Niveles usados | `log`, `warn`, `error` en bootstrap, Prisma connect, ops scheduler |
| `debug` | Solo en `SyncService` (3 líneas: SALE, PURCHASE, SALE_RETURN acked) |
| `verbose` | Guards ops/dashboard en **dev** cuando endpoints quedan abiertos |
| `console.log` | **Ninguno** en `src/` ✅ |
| Bodies / buffers | **No** se loguean payloads completos ✅ |
| SQL Prisma | **Sin** `log: ['query']` — solo connect log ✅ |

### Riesgos

| Problema | Riesgo | Sugerencia |
|----------|--------|------------|
| Ops scheduler WARN cada 2 min | **Solo en desarrollo** (`NODE_ENV !== production`); prod usa `GET /ops/metrics` | ✅ Implementado en código |
| Nest default log level incluye `log` + `debug` en dev | En prod sin config, `debug` de sync **no sale** (Nest prod default = log,warn,error) | Explicitar en `main.ts`: prod → `['error','warn','log']` |
| Stack traces en 500 | Correcto para diagnóstico; no van al cliente | Mantener; no loguear request body junto al stack |
| Swagger + bootstrap `log` con URLs | Bajo costo; OK | — |

### Config recomendada producción

```typescript
// main.ts — al crear la app
const app = await NestFactory.create(AppModule, {
  logger:
    process.env.NODE_ENV === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
});
```

CloudWatch (infra AWS, no código):

- Retención log group: **3–7 días**
- No usar Logs Insights de forma continua

### Checklist logging

- [x] **L-1** Configurar `logger` en `NestFactory.create` según `NODE_ENV`
- [ ] **L-2** Confirmar que no se añaden `console.log` en features nuevas
- [ ] **L-3** CloudWatch: retención 3–7 días en el log group de EC2
- [ ] **L-4** Limpiar sync ops `failed` históricas en dev (opcional; ya no spamean WARN en prod)
- [x] **L-5** WARN periódicos del ops scheduler **solo en desarrollo** (`ops-scheduler.service.ts`)
- [ ] **L-5b** (Opcional) Quitar `logger.debug` en sync o gate con `NODE_ENV !== 'production'`

---

## 3. Base de datos (PostgreSQL / RDS)

### Qué está bien

| Endpoint / área | Paginación / límite |
|-----------------|---------------------|
| `GET /sales` | Cursor + default 50; rango máx **31 días** |
| `GET /suppliers` | Cursor + default 50 |
| `GET /sync/pull` | `limit` máx **500** |
| `GET /inventory/.../movements` | `limit` máx **500** |
| Reportes | Rango acotado vía `resolveSaleListUtcRange` (31 días) |
| Prisma | Sin logging SQL verbose |
| Ops metrics | `failedSamples` limit **30** |

### Riesgos — queries sin paginación (REST)

| Endpoint | Problema | Riesgo | Sugerencia |
|----------|----------|--------|------------|
| **`GET /products`** | `findMany` sin `take` | Payload grande si miles de SKUs vía REST directo | Ver **§3.1 POS** — no bloqueante si Flutter usa sync |
| **`GET /inventory`** | `findMany` + `include product` sin límite | Igual para consulta REST online | Bootstrap POS + deltas; paginar REST solo si admin web crece |
| **`StoreConfiguredGuard`** | 2 queries por request | Latencia menor | Cache in-memory TTL corto (P2) |
| **Reconciliación inventario** (job) | Scan global en background | CPU RDS en tiendas grandes | Job sigue corriendo; WARN solo en dev |
| **Reportes timeseries** | Carga ventas 1–31 días en RAM | OK al inicio | Agregación SQL (P2) |

### 3.1 Catálogo POS — sync por versiones vs paginación REST (decisión acordada)

**Tu intuición es correcta:** el POS offline debe tener **todo el catálogo + stock usable** en SQLite local para vender sin red. Eso **no contradice** el sync incremental por versiones.

Son **dos capas distintas**:

| Capa | Mecanismo | Quién lo usa |
|------|-----------|--------------|
| **Offline / POS** | `GET /sync/pull?since=<version>&limit=500` | Flutter `SyncEngine` |
| **REST directo** | `GET /products`, `GET /inventory` | Admin, debug, herramientas online |

#### Cómo funciona hoy el sync incremental (ya implementado)

```
ServerChangeLog.serverVersion  (contador global monotónico)
        │
        ▼
GET /sync/pull?since=120&limit=500
        │
        ├─► ops: PRODUCT_CREATED, PRODUCT_UPDATED, PRODUCT_DEACTIVATED, SUPPLIER_*, ...
        ├─► toVersion: 145
        └─► hasMore: true → repetir pull hasta ponerse al día
```

El POS guarda en SQLite `lastPullVersion = 145`. En el próximo ciclo (~90 s o al reconectar):

```
GET /sync/pull?since=145
        │
        └─► Solo ops nuevas (productos que cambiaron) — NO baja todo el catálogo otra vez
```

**Conclusión backend:** no hace falta paginar `GET /products` **para el POS** si Flutter implementa bien pull incremental. Eso es **ajuste de front**, no bloqueante para deploy.

#### Bootstrap inicial (primera instalación o reset)

Cuando `lastPullVersion = 0`, el POS debe **llenar SQLite** con el catálogo completo. Opciones:

| Estrategia | Cómo | Pros |
|------------|------|------|
| **A — Pull histórico** | Loop `sync/pull` desde `since=0` hasta `hasMore=false` | Solo deltas server-side; coherente con offline |
| **B — REST full + luego pull** | Una vez `GET /products` + `GET /inventory`; guardar version actual del servidor | Simple; REST full solo al inicio |
| **C — REST paginado al inicio** | Si añadimos cursor en REST, el front pagina hasta completar | Útil si catálogo >5k SKUs |

**Recomendación Quick Market (POS pequeño/mediano):**

1. **Operación normal:** solo `sync/pull` incremental (estrategia A continua).
2. **Bootstrap:** estrategia A o B según implemente Flutter — **punto final de ajuste front** documentado en `FRONTEND.md` §5.
3. **Paginación REST `GET /products`:** **P2 / opcional** — solo si habrá panel admin web o catálogos muy grandes (>2–3k SKUs).

#### Inventario en el POS

- Stock local se actualiza con: ventas/compras/ajustes aplicados (sync push ack + movimientos locales).
- `GET /inventory` REST full es útil en **bootstrap** o pantalla inventario online; no reemplaza al sync para deltas de catálogo.
- Checklist Flutter (no backend P0):

- [ ] **FE-1** Persistir `lastPullVersion` en SQLite
- [ ] **FE-2** Loop pull hasta `hasMore=false` al bootstrap
- [ ] **FE-3** Pull incremental en scheduler ~90 s + al reconectar
- [ ] **FE-4** Aplicar ops `PRODUCT_*` sobre cache local (upsert/deactivate)
- [ ] **FE-5** Bootstrap stock: `GET /inventory` una vez o derivar de sync + movimientos

#### Imágenes y versiones

Cuando migres a S3 con `version` en URL (plan imágenes), el pull incluirá URL nueva → el cliente actualiza solo filas afectadas. Encaja con el mismo modelo.

### Índices

El schema Prisma ya tiene índices razonables (`Product.catalogStoreId`, `SyncOperation.storeId+clientTimestamp`, etc.). No se detectaron anti-patrones graves tipo N+1 masivo en el hot path.

### Checklist base de datos

- [ ] **DB-1** `DATABASE_URL` producción apunta a RDS (no localhost)
- [ ] **DB-2** Añadir `?sslmode=require` (o equivalente) en URL RDS si aplica
- [ ] **DB-3** Deploy migraciones con `npx prisma migrate deploy` (nunca `migrate dev` en prod)
- [ ] **DB-4** (Flutter) Pull incremental `sync/pull` con `since` — ver §3.1 FE-1..FE-5
- [ ] **DB-5** (P2) Paginar `GET /products` / `GET /inventory` solo si admin web o catálogo muy grande
- [ ] **DB-6** (P2) Evaluar cache de `Store` + `BusinessSettings` en guard

---

## 4. CPU y memoria (t4g.micro)

**t4g.micro:** ~1 vCPU burstable, **1 GB RAM** — suficiente para POS pequeño si no abusas de payloads grandes.

### Carga por request

| Operación | Peso | Notas |
|-----------|------|-------|
| CRUD producto / venta | Bajo | Transacciones Prisma acotadas |
| **`POST /sync/push`** | Medio–alto | Hasta **200 ops** por batch; transacciones largas |
| **Reportes** | Medio | Carga ventas 1–31 días en RAM; loops Luxon |
| **Imágenes** (hoy) | Bajo | Disco local 5 MB; futuro sharp + S3 será el pico CPU |
| **Ops scheduler** | Bajo; WARN periódicos **solo en dev** | Prod: consultar `GET /ops/metrics` manual o alarm |

### Riesgos

| Problema | Riesgo | Sugerencia |
|----------|--------|------------|
| Sync batch 200 ops | Picos CPU / lock DB prolongado | OK al inicio; monitorear; cliente puede enviar lotes más pequeños |
| Sin graceful shutdown | Conexiones Prisma colgadas al reiniciar EC2 | Llamar `prisma.enableShutdownHooks(app)` en `main.ts` |
| Sin process manager | Caída silenciosa, no restart | PM2 o systemd |
| Memoria global | No se detectan leaks obvios | — |

### Checklist CPU/memoria

- [ ] **CPU-1** PM2 o systemd con restart automático
- [x] **CPU-2** `enableShutdownHooks` en bootstrap
- [ ] **CPU-3** Monitorear CPU credit balance (t4g burstable) primera semana
- [ ] **CPU-4** (P2) Reducir `OPS_SCHEDULER_INTERVAL_MS` a 5–10 min si no necesitas 2 min

---

## 5. Payloads y validaciones

### Qué está bien

- `ValidationPipe` global: `whitelist`, `forbidNonWhitelisted`, `transform`
- `SyncPushDto`: máx **200 ops** por push
- Upload imagen: **5 MB**, 1 archivo, `image/*`
- Ventas / compras: DTOs con class-validator
- Sync supplier: validación estricta de tipos (tu error `phone must be a string` es correcto)

### Riesgos

| Problema | Riesgo | Sugerencia |
|----------|--------|------------|
| Sin límite global body JSON Express | Default ~100kb puede romper sync grande **o** permitir bodies grandes si se sube límite sin cuidado | Documentar; si aumentas límite, cap en 1–2 MB |
| `sync/push` payload op = `Record<string, unknown>` | Flexible pero errores en runtime | OK para offline; cliente debe tipar bien (Flutter) |
| `PatchProductImageDto` sin class-validator | Validación manual débil | Migrar a DTO con validators (P2, reemplazo S3) |
| Imagen 5 MB en disco EC2 | Costo disco + RAM multer | Plan S3: 1 MB + WebP (ver `PRODUCT_IMAGES_S3_IMPLEMENTATION.md`) |

### Checklist payloads

- [ ] **PL-1** Confirmar que Flutter envía tipos correctos en sync (ej. `phone` string)
- [ ] **PL-2** (P1) Revisar límite body parser si sync crece
- [ ] **PL-3** (P2) DTOs con class-validator en endpoints legacy de imágenes

---

## 6. Manejo de errores

### Qué hay hoy

- **`ApiExceptionFilter`** global (`@Catch()`)
- Respuesta unificada: `{ statusCode, error, message[], requestId }`
- 500 genérico al cliente; stack solo en log servidor ✅
- Sync: ops fallidas → `failed` en DB + respuesta con `reason`/`details` (no retry infinito server-side)
- Mismo `opId` fallido → rechazo idempotente (no loop de aplicación)

### Riesgos

| Problema | Riesgo | Sugerencia |
|----------|--------|------------|
| Cliente POS reintenta mismo `opId` fallido | Usuario ve error permanente hasta nuevo opId | Documentado; fix en Flutter |
| Ops WARN cada 2 min por failed histórico | Confusión en dev | ✅ En prod silenciado; limpiar failed en dev si molesta |

### Checklist errores

- [ ] **ERR-1** Verificar que `X-Request-Id` fluye en logs de soporte
- [ ] **ERR-2** Limpiar sync `failed` de dev/staging antes de prod
- [ ] **ERR-3** Runbook: correlacionar por `opId` vía `GET /ops/metrics`

---

## 7. Configuración para producción

### Qué hay hoy vs qué falta

| Ítem | Estado | Acción |
|------|--------|--------|
| `npm run build` + `start:prod` | ✅ Existe | Usar en EC2 |
| `NODE_ENV=production` | ⚠️ No forzado en código | Set en env EC2 |
| Swagger `/api/docs` | 🔴 **Siempre activo** | Desactivar o proteger en prod |
| PM2 / systemd | 🔴 No documentado | Añadir |
| `@prisma/client` | 🔴 En **devDependencies** | Mover a `dependencies` |
| `prisma migrate deploy` | ⚠️ Solo documentado en README | Script deploy |
| `.env` | ✅ gitignored | Usar env en EC2, no commitear |
| `storage/products-images` | ⚠️ No en `.gitignore` | Ignorar carpeta uploads |
| CI | Parcial | No corre tests ni migrate deploy completo |
| Docker compose | Solo dev Postgres | No usar pgadmin en prod |

### Bootstrap recomendado (fragmento)

```typescript
// main.ts
async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create(AppModule, {
    logger: isProd ? ['error', 'warn', 'log'] : undefined,
  });

  if (isProd && process.env.SWAGGER_ENABLED !== '1') {
    // no montar Swagger
  } else {
    // ... SwaggerModule.setup existente
  }

  const prisma = app.get(PrismaService);
  await prisma.enableShutdownHooks(app);
  // ...
}
```

### Checklist producción

- [ ] **PROD-1** `NODE_ENV=production` en EC2
- [x] **PROD-2** Mover `@prisma/client` → `dependencies`
- [x] **PROD-3** Build en CI o EC2: `npm ci && npx prisma generate && npm run build`
- [ ] **PROD-4** Migrar RDS: `npx prisma migrate deploy`
- [ ] **PROD-5** Arrancar con `node dist/main` vía PM2/systemd
- [x] **PROD-6** Desactivar Swagger en prod (o `SWAGGER_ENABLED=1` solo staging)
- [ ] **PROD-7** No exponer puerto 5432; RDS solo desde SG EC2
- [x] **PROD-8** Añadir `storage/` a `.gitignore`
- [ ] **PROD-9** Documentar script deploy mínimo (ver §10)

---

## 8. Seguridad básica (obligatorio en producción)

### Modelo actual

- **Auth principal:** header `X-Store-Id` (UUID tienda descargado en el POS) — sin login usuario
- Adecuado para POS en LAN/VPN o API detrás de HTTPS con UUID no adivinable
- **No sustituye** auth fuerte si la URL es pública en Internet sin más capas

### Matriz de endpoints sensibles

| Ruta | Protección hoy | Riesgo si mal configurado | Acción producción |
|------|----------------|---------------------------|-------------------|
| CRUD productos, ventas, sync | `X-Store-Id` + store exists | Medio: quien tenga UUID opera como esa tienda | HTTPS; rotar UUID solo con re-onboarding |
| **`GET /ops/metrics`** | `OpsAuthGuard` | 🔴 **Abierto** sin `OPS_API_KEY` | **P0:** definir `OPS_API_KEY` |
| **`PATCH .../dashboard-config`** | `DashboardAdminGuard` | 🔴 **Abierto** sin PIN | **P0:** `DASHBOARD_ADMIN_PIN` |
| **`PUT /stores/:id`** onboarding | `STORE_ONBOARDING_ENABLED=1` | 🔴 Crear tiendas sin login | **P0:** `=0` en prod |
| **`GET /uploads/products-image/...`** | Público | Medio | **Fase 1:** OK en disco EC2; **Fase 2:** migrar S3 |
| **`GET /api/docs`** Swagger | Público si montado | Medio: expone contrato API | **P0:** desactivar en prod |
| **`GET /`** health | Público | Bajo | OK |

### Variables de entorno — producción (copiar a EC2)

```bash
NODE_ENV=production
PORT=3000

# PostgreSQL RDS — nunca localhost en prod
DATABASE_URL=postgresql://USER:PASS@rds-endpoint:5432/quickmarket?schema=public&sslmode=require

# Seguridad API (P0 — obligatorio)
OPS_API_KEY=<generar-32+-chars-aleatorios>
DASHBOARD_ADMIN_PIN=<pin-solo-operadores>
STORE_ONBOARDING_ENABLED=0

# Tras nginx/ALB
TRUST_PROXY=1

# Ops job — sigue corriendo; WARN en logs solo en dev
OPS_SCHEDULER_ENABLED=1
OPS_SCHEDULER_INTERVAL_MS=300000

# Opcional capa extra
# OPS_IP_ALLOWLIST=<ip-oficina>
# SWAGGER_ENABLED=0
```

**Nunca en producción:** credenciales AWS access keys en `.env` (usar IAM Role EC2 cuando haya S3).

### Infraestructura AWS — checklist seguridad

| Recurso | Configuración mínima |
|---------|---------------------|
| **EC2 SG** | Inbound: 443 (o 3000) desde 0.0.0.0/0 **solo si** hay HTTPS; SSH solo desde tu IP |
| **RDS SG** | Inbound: 5432 **solo** desde SG de EC2 — RDS **no** público |
| **EC2 IAM** | Role mínimo (S3 `products/*` cuando aplique) — sin AdministratorAccess |
| **Secrets** | `.env` en disco EC2 con permisos 600; no commitear; no loguear |
| **HTTPS** | nginx/Caddy/ALB con certificado — no exponer HTTP plano a Internet |
| **CloudWatch** | Retención 3–7 días — no "Never expire" |

### Implicaciones `X-Store-Id`

| Escenario | Mitigación |
|-----------|------------|
| UUID filtrado en logs cliente | No loguear `X-Store-Id` en apps de terceros |
| Dispositivo robado | UUID en SQLite del POS — riesgo físico; fuera de alcance backend v1 |
| API pública Internet | Considerar API key por tienda o VPN (P2) |

### Checklist seguridad

- [ ] **SEC-1** `OPS_API_KEY` en EC2 (ver §8 plantilla `.env`)
- [ ] **SEC-2** `DASHBOARD_ADMIN_PIN` en EC2
- [ ] **SEC-3** `STORE_ONBOARDING_ENABLED=0`
- [ ] **SEC-4** EC2 SG: 443/HTTPS; SSH restringido a tu IP
- [ ] **SEC-5** RDS privado; SG solo desde EC2
- [ ] **SEC-6** `TRUST_PROXY=1` detrás de reverse proxy
- [x] **SEC-7** Swagger desactivado en prod (`PROD-6`)
- [ ] **SEC-8** (P1) HTTPS terminado en nginx/ALB
- [ ] **SEC-9** (P1) Verificar `.env` permisos 600 en EC2
- [ ] **SEC-10** (P2) Rate limit en `sync/push` y upload imagen

---

## 9. Checklist de implementación

Marcar `[x]` al completar. **Solo Fase 1** en este checklist.  
Prioridad: **P0** bloqueante → **P1** post-deploy → **P2** mejoras (sin S3).

> **Imágenes S3:** no está en P0/P1. Todo el plan S3 vive en **Fase 2** → [`PRODUCT_IMAGES_S3_IMPLEMENTATION.md`](./PRODUCT_IMAGES_S3_IMPLEMENTATION.md).

### P0 — Antes del primer deploy

- [ ] **P0-1** `OPS_API_KEY` configurado en EC2
- [ ] **P0-2** `DASHBOARD_ADMIN_PIN` configurado en EC2
- [ ] **P0-3** `STORE_ONBOARDING_ENABLED=0` (o justificación + red cerrada)
- [ ] **P0-4** `NODE_ENV=production`
- [x] **P0-5** Mover `@prisma/client` a `dependencies`
- [x] **P0-6** Pipeline build: `prisma generate` + `nest build`
- [ ] **P0-7** RDS: `prisma migrate deploy` + `DATABASE_URL` con SSL
- [ ] **P0-8** PM2 o systemd para `node dist/main`
- [x] **P0-9** Desactivar Swagger en producción
- [x] **P0-10** Logger Nest explícito para prod (sin debug/verbose)
- [ ] **P0-11** Security groups EC2 + RDS correctos
- [ ] **P0-12** Limpiar sync ops `failed` de prueba en DB destino
- [x] **P0-14** `FEATURE_PRODUCT_IMAGES=0` en build/deploy workflow
- [x] **P0-15** GitHub Actions deploy solo en `main` (`.github/workflows/deploy-phase1.yml`)

### P1 — Primera semana post-deploy

- [ ] **P1-1** CloudWatch log retention 3–7 días
- [x] **P1-2** `enableShutdownHooks` Prisma
- [ ] **P1-3** (Flutter) Sync pull incremental + bootstrap — §3.1 FE-1..FE-5
- [ ] **P1-4** (Flutter) Fix `supplier.phone` como string en sync push
- [ ] **P1-5** HTTPS (nginx/Caddy/ALB)
- [x] **P1-6** Añadir `storage/` a `.gitignore`
- [ ] **P1-7** Smoke test: sync push/pull, venta, producto, reporte
- [ ] **P1-8** Alarm básica CPU EC2 + espacio RDS

### P2 — Mejoras Fase 1 (opcional, sin S3)

- [ ] **P2-2** Cache store context en guard
- [ ] **P2-3** Paginación REST `GET /products` / `GET /inventory` (solo si catálogo grande o admin web)
- [ ] **P2-4** Rate limiting sync/upload
- [ ] **P2-5** Job limpieza `SyncOperation` failed antiguas (>30 días)
- [ ] **P2-6** CI: `npm test` + migrate deploy en pipeline

### Fase 2 — Imágenes S3 (después de deploy estable)

**No hacer ahora.** Checklist completo en [`PRODUCT_IMAGES_S3_IMPLEMENTATION.md`](./PRODUCT_IMAGES_S3_IMPLEMENTATION.md).

- [ ] **F2-0** Bucket S3 + IAM role EC2
- [ ] **F2-1..9** Módulo storage, Prisma `ProductImage`, sharp, endpoints — ver doc S3

---

## 10. Orden recomendado de trabajo

### Fase 1 — Deploy (ahora)

```
✅ P0 código (Prisma, logger, swagger, shutdown hooks) — hecho
⏳ P0 infra: RDS + EC2 + SG + .env prod + PM2
⏳ migrate deploy + smoke tests
⏳ P1: HTTPS, Flutter sync, monitoreo
```

**Imágenes en prod Fase 1:** **desactivadas** (`FEATURE_PRODUCT_IMAGES=0`). Flutter no debe usar upload/serve hasta Fase 2.

### Fase 2 — Imágenes S3 (después)

Cuando Fase 1 esté estable en producción (sync, ventas, POS OK), retomar [`PRODUCT_IMAGES_S3_IMPLEMENTATION.md`](./PRODUCT_IMAGES_S3_IMPLEMENTATION.md) desde Fase 0 (AWS bucket).

### Script deploy mínimo (EC2)

```bash
git pull
npm ci
npx prisma generate
npm run build
npx prisma migrate deploy
pm2 restart quickmarket-api   # o start si primera vez
```

### Env producción mínimo (.env en EC2)

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@rds-endpoint:5432/quickmarket?schema=public&sslmode=require
OPS_API_KEY=...
DASHBOARD_ADMIN_PIN=...
STORE_ONBOARDING_ENABLED=0
FEATURE_PRODUCT_IMAGES=0
TRUST_PROXY=1
OPS_SCHEDULER_ENABLED=1
OPS_SCHEDULER_INTERVAL_MS=300000
```

---

## 11. Política de ramas y GitHub Actions

### Ramas

| Rama | Uso | Deploy AWS Fase 1 |
|------|-----|-------------------|
| **`develop`** | Desarrollo e integración interna | **Prohibido** |
| **`main`** | Única rama autorizada para producción | **Sí** |

Flujo: merge `develop` → `main` solo cuando el release esté listo; el deploy corre **solo** en `main`.

### Workflows (`.github/workflows/`)

| Archivo | Trigger | Propósito |
|---------|---------|-----------|
| **`ci.yml`** | `push` / `PR` en `develop` y `main` | Build + tests (integración interna) |
| **`deploy-phase1.yml`** | **`push` solo `main`** + `workflow_dispatch` | Gate de deploy; valida rama en job y paso deploy |

Validaciones en `deploy-phase1.yml`:

1. Trigger limitado a `branches: [main]`
2. Job `assert-main-branch` falla si `github.ref != refs/heads/main`
3. Job `deploy` con `if: github.ref == 'refs/heads/main'` + re-validación antes del paso deploy
4. Build de release con `NODE_ENV=production` y `FEATURE_PRODUCT_IMAGES=0`

El paso deploy a EC2 (SSH/SSM) se cablea cuando tengas host; el gate de rama ya está listo.

### Checklist ramas / CI

- [x] **GIT-1** `ci.yml` en `.github/workflows/` (develop + main)
- [x] **GIT-2** `deploy-phase1.yml` solo `main` + assert branch
- [ ] **GIT-3** Proteger `main` en GitHub (PR obligatorio, no push directo si aplica)
- [ ] **GIT-4** Conectar deploy real a EC2 en `deploy-phase1.yml`
- [ ] **GIT-5** Eliminar/migrar `workflows/ci.yml` legacy en raíz (hecho: movido a `.github`)

---

## 12. Imágenes — fuera de alcance Fase 1

### Feature flag obligatoria

```bash
FEATURE_PRODUCT_IMAGES=0   # producción Fase 1 (obligatorio)
```

| Valor | Comportamiento |
|-------|----------------|
| `0` / `false` | Imágenes **no disponibles** — HTTP **503** |
| `1` / `true` | Endpoints legacy activos (solo dev/staging) |
| *(unset)* | Dev: ON; **production: OFF** (default seguro) |

### Endpoints bloqueados cuando flag = 0

- `POST /uploads/products-image`
- `GET /uploads/products-image/:storeId/:fileName`
- `PATCH /products/:id/image`
- `DELETE /products/:id/image`
- `PATCH /products/:id` o `POST /products` con campo `image`

Implementación: `ProductImagesFeatureService` + `ProductImagesEnabledGuard` + validación en `ProductsService`.

### Limitación operativa (disco EC2)

Aunque exista carpeta `storage/products-images/` en la instancia, **no es alcance aprobado Fase 1** usarla en prod con la flag en 0.

Persistencia si se usara en dev/staging:

| Volumen | Comportamiento |
|---------|----------------|
| **Instance store** | Se pierde al terminar/reemplazar la instancia |
| **EBS** | Persiste según `DeleteOnTermination` y lifecycle del volumen |

Fase 2 migra a S3; no depender de disco local en producción.

### Checklist imágenes Fase 1

- [x] **IMG-1** `FEATURE_PRODUCT_IMAGES` implementado en código
- [ ] **IMG-2** `FEATURE_PRODUCT_IMAGES=0` en `.env` EC2 producción
- [ ] **IMG-3** Flutter: no llamar endpoints de imágenes en prod Fase 1
- [ ] **IMG-4** Smoke test deploy: upload imagen → **503** esperado

---

## 13. Runbook operativo

Guía detallada **desde crear cuenta AWS** hasta smoke tests:

→ **[AWS_PHASE1_RUNBOOK.md](./AWS_PHASE1_RUNBOOK.md)**

---

## Referencias

| Doc | Tema |
|-----|------|
| `docs/PROJECT_CONTEXT.md` | Arquitectura general |
| `docs/api/OPS_METRICS.md` | Sync failed / ops metrics |
| `docs/PRODUCT_IMAGES_S3_IMPLEMENTATION.md` | **Fase 2** — Imágenes S3 (después del deploy) |
| `.env.example` | Variables disponibles |

---

**Próximo paso (Fase 1):** seguir [`AWS_PHASE1_RUNBOOK.md`](./AWS_PHASE1_RUNBOOK.md) desde **A — Cuenta AWS**. Código P0 del repo ya está listo; falta infra + deploy en EC2.
