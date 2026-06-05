# Documentación Quick Market

## Empieza aquí

| Audiencia | Documento |
|-----------|-----------|
| **Backend / full-stack** | [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) |
| **Modelo de datos (tablas)** | **[DATABASE_SCHEMA_GUIDE.md](./DATABASE_SCHEMA_GUIDE.md)** |
| **Flutter / POS** | **[FRONTEND.md](./FRONTEND.md)** |
| **Contratos HTTP** | [api/README.md](./api/README.md) |

## Estructura mínima

```text
docs/
  README.md                 ← índice
  PROJECT_CONTEXT.md        ← backend: arquitectura, módulos, flujos
  DATABASE_SCHEMA_GUIDE.md  ← tablas, relaciones, SQL útil
  FRONTEND.md               ← Flutter (único doc front)
  api/                      ← contratos HTTP (sync, compras, ops)
```

Fuente técnica del esquema: `prisma/schema.prisma` + guía legible [DATABASE_SCHEMA_GUIDE.md](./DATABASE_SCHEMA_GUIDE.md).

## Mantenimiento

1. Negocio / backend → `PROJECT_CONTEXT.md`
2. Flutter → **`FRONTEND.md` only** (no crear más .md front)
3. Contrato HTTP → `docs/api/<modulo>.md`

## Herramientas

- Swagger: `http://localhost:3000/api/docs`
- Postman: `postman/QuickMarket_API.postman_collection.json`
