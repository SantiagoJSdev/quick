# Documentación Quick Market

## Empieza aquí

| Audiencia | Documento |
|-----------|-----------|
| **Backend / full-stack** | [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) |
| **Flutter / POS** | **[FRONTEND.md](./FRONTEND.md)** ← único doc front |
| **Contratos HTTP** | [api/README.md](./api/README.md) |

## Estructura mínima

```text
docs/
  README.md           ← este índice
  PROJECT_CONTEXT.md  ← backend: arquitectura, módulos, datos, flujos
  FRONTEND.md         ← Flutter: integración, offline, pago mixto, fotos, dashboard…
  api/                ← contratos HTTP detallados (sync, compras, ops)
```

Fuente técnica del esquema: `prisma/schema.prisma` + resumen en PROJECT_CONTEXT §5.

## Mantenimiento

1. Negocio / backend → `PROJECT_CONTEXT.md`
2. Flutter → **`FRONTEND.md` only** (no crear más .md front)
3. Contrato HTTP → `docs/api/<modulo>.md`

## Herramientas

- Swagger: `http://localhost:3000/api/docs`
- Postman: `postman/QuickMarket_API.postman_collection.json`
