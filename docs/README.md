# Documentación Quick Market

## Empieza aquí

| Audiencia | Documento |
|-----------|-----------|
| **Backend / full-stack** | [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) |
| **Modelo de datos (tablas)** | **[DATABASE_SCHEMA_GUIDE.md](./DATABASE_SCHEMA_GUIDE.md)** |
| **Flutter / POS** | **[FRONTEND.md](./FRONTEND.md)** |
| **Contratos HTTP** | [api/README.md](./api/README.md) |
| **Deploy AWS (Fase 1)** | [AWS_DEPLOY_READINESS.md](./AWS_DEPLOY_READINESS.md) |
| **Runbook AWS paso a paso** | [AWS_PHASE1_RUNBOOK.md](./AWS_PHASE1_RUNBOOK.md) |
| **Plan B sin AWS (Neon + Render)** | **[NEON_RENDER_PHASE1_RUNBOOK.md](./NEON_RENDER_PHASE1_RUNBOOK.md)** ← empezar aquí |
| **Imágenes S3 (Fase 2 — después)** | [PRODUCT_IMAGES_S3_IMPLEMENTATION.md](./PRODUCT_IMAGES_S3_IMPLEMENTATION.md) |

## Estructura mínima

```text
docs/
  README.md                 ← índice
  PROJECT_CONTEXT.md        ← backend: arquitectura, módulos, flujos
  DATABASE_SCHEMA_GUIDE.md  ← tablas, relaciones, SQL útil
  FRONTEND.md               ← Flutter (único doc front)
  api/                      ← contratos HTTP (sync, compras, ops)
  AWS_DEPLOY_READINESS.md              ← Fase 1: análisis + checklist P0/P1
  AWS_PHASE1_RUNBOOK.md                ← Fase 1 AWS (cuando haya cuenta/tarjeta)
  NEON_RENDER_PHASE1_RUNBOOK.md        ← Fase 1 Plan B: Neon + Render (OPERATIVO)
  PRODUCT_IMAGES_S3_IMPLEMENTATION.md  ← Fase 2: plan S3 imágenes (DESPUÉS)
```

Fuente técnica del esquema: `prisma/schema.prisma` + guía legible [DATABASE_SCHEMA_GUIDE.md](./DATABASE_SCHEMA_GUIDE.md).

## Mantenimiento

1. Negocio / backend → `PROJECT_CONTEXT.md`
2. Flutter → **`FRONTEND.md` only** (no crear más .md front)
3. Contrato HTTP → `docs/api/<modulo>.md`

## Herramientas

- Swagger: `http://localhost:3000/api/docs`
- Postman: `postman/QuickMarket_API.postman_collection.json`
