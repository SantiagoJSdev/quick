# GEMINI — Arquitectura, Guía de Estilo y Roadmap

## Propósito
Proyecto para gestionar un minimarket: productos, inventarios, ventas en puntos de venta móviles (POS) y sincronización con una tienda principal.

## Objetivos inmediatos
- Definir arquitectura backend y reglas de Clean Code.
- Tener un backend funcional con CRUD de productos e inventario.
- Definir y comenzar la estrategia de sincronización offline para POS.

## Arquitectura propuesta (resumen)
- Topología: Tienda Principal (servidor central) + múltiples Puntos de Venta (dispositivos móviles/instalaciones POS).
- Puntos de venta: cliente offline-first (SQLite local) que registra operaciones y sincroniza con la principal.
- Comunicación: REST `api/v1` para operaciones y endpoints de sincronización; WebSocket opcional para notificaciones/real-time.
- Persistencia central: PostgreSQL (Prisma ORM). Opcional: Redis para colas/locking y worker de reconciliación.

## Stack recomendado
- Lenguaje: TypeScript (strict).
- Framework backend: NestJS.
- ORM: Prisma + PostgreSQL.
- Cliente POS: React Native o klotin / Electron (usar SQLite local para offline).
- Tests: Jest.
- Calidad: ESLint, Prettier, Husky, commitlint.

## Estructura propuesta del backend
- `src/modules/` por dominio: `products`, `inventory`, `sales`, `auth`, `sync`, `users`, `shared`.
- `src/common/` utilidades y logger.
- `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.ts`.

## Modelos de datos (conceptuales)
- `Product`: id, sku, name, description, price, cost, categories, unit, createdAt, updatedAt.
- `InventoryItem`: id, productId, storeId, stock, reserved, lastAdjustedAt.
- `Store`: id, name, type (main|pos), timezone, metadata.
- `POSDevice`: id, storeId, deviceId, lastSeen, appVersion.
- `Sale`: id, storeId, deviceId, userId, total, status, createdAt.
- `SaleLine`: id, saleId, productId, quantity, price, discount.
- `StockMovement`: id, productId, storeId, delta, reason, referenceId, createdAt.
- `SyncOperation` (oplog): id, deviceId, opType, payload, timestamp, status, serverAppliedAt.
- `User`: id, email, name, role, passwordHash, lastLogin.

## Endpoints principales (contratos)
- `POST /api/v1/auth/login` — JWT.
- `GET/POST/PUT/DELETE /api/v1/products` — CRUD productos.
- `GET /api/v1/inventory/:storeId` — inventario por tienda.
- `POST /api/v1/sales` — registrar venta (generar StockMovement).
- `POST /api/v1/sync/push` — enviar operaciones locales desde POS.
- `GET  /api/v1/sync/pull?since=VERSION` — obtener operaciones nuevas desde servidor.

## Estrategia de sincronización (alto nivel)
- Offline-first: POS registra operaciones en un `oplog` local con `opId`, `deviceId`, `timestamp`.
- Sincronización push/pull: el dispositivo envía ops al servidor (`/sync/push`) y luego solicita el delta del servidor (`/sync/pull`).
- Aplicación en servidor: aplicar operaciones en orden por `timestamp`/`opId` y generar ack con `serverVersion`.
- Conflictos: detectar por versionado o por reglas de negocio; políticas:
  - Preferir operaciones idempotentes y basadas en eventos (operational transforms).
  - Para stock: usar movimientos (`StockMovement`) y reconciliar sumas.
  - Cuando no sea posible resolver automáticamente: marcar conflicto y generar tarea manual de revisión.

### Idempotencia y `opId` (requisito crítico)

- Cada operación enviada desde un POS (venta, ajuste, recepción) debe llevar un `opId` único (UUID) generado por el cliente.
- En la base de datos, `StockMovement.opId` y `SyncOperation.opId` serán campos opcionales y únicos; el servidor debe usar `opId` para detectar reintentos y evitar duplicados.
- Flujo de aplicación en servidor:
  1. Al recibir un batch en `/sync/push`, validar `opId` de cada op. Si un `opId` ya existe, saltar la operación (idempotencia).
  2. Aplicar la operación dentro de una transacción: crear `StockMovement`(s), crear/actualizar `Sale`/`Purchase` según corresponda y actualizar `InventoryItem.quantity` con operaciones atómicas (`increment`/`decrement`).
  3. Registrar `SyncOperation` con `opId`, `status` y `serverVersion` cuando se aplique.

### Contratos mínimos para endpoints de sincronización

- `POST /api/v1/sync/push` — Request (batch):

```json
{
  "ops": [
    {
      "opId": "uuid-v4",
      "opType": "SALE",
      "payload": { "sale": { /* sale + lines */ } },
      "timestamp": "2026-01-14T12:00:00Z"
    }
  ]
}
```

- Server response (successful apply):

```json
{
  "acked": [ { "opId": "uuid-v4", "serverVersion": 123 } ],
  "skipped": [ { "opId": "uuid-old", "reason": "already_applied" } ]
}
```

- `GET /api/v1/sync/pull?since=VERSION` — Devuelve ops del servidor con `serverVersion > VERSION`.

### Reglas operativas y recomendaciones para los endpoints

- El servidor debe aplicar cada op de forma idempotente: comprobar primero `opId` y solo si no existe, aplicar la lógica.
- Para la creación de ventas (`/sales`) el backend debe usar transacciones que:
  - crear `Sale` y `SaleLine`s,
  - insertar `StockMovement` tipo `OUT_SALE` con `opId` (si viene del cliente) o con nuevo `opId` generado por el servidor,
  - actualizar `InventoryItem.quantity` usando `increment: -x` (operación atómica).
- Registrar siempre `StockMovement` con `opId` si la operación proviene de sincronización, así los reintentos del POS no duplicarán movimientos.

### Ejemplo rápido: payload de `SALE` en `SyncOperation.payload`

```json
{
  "sale": {
    "id": "sale-uuid-client",
    "storeId": "store-uuid",
    "deviceId": "device-123",
    "userId": "user-uuid",
    "total": "100.00",
    "lines": [ { "productId": "p-1", "quantity": 2, "price": "25.00" } ]
  }
}
```

### Reconciliación y jobs

- Implementar un job periódico que recalcula stock por sumatoria de `StockMovement` y compara con `InventoryItem.quantity`. Si hay desviaciones, crear `StockMovement` tipo `IN_ADJUST`/`OUT_ADJUST` para corregir y alertar al equipo.

---
Agrega estas reglas al inicio del desarrollo de endpoints para estandarizar el comportamiento del equipo.

## Reglas de Clean Code / patrones (prácticas)
- SRP: cada servicio tiene una responsabilidad clara.
- Controladores (controllers): validación y mapeo de peticiones; delegar lógica a services.
- Services: lógica de negocio; repositories para acceso a datos.
- DTOs/Validators: usar `class-validator` y `class-transformer` en DTOs.
- Tipado estricto: evitar `any`; declarar tipos de retorno en funciones públicas.
- Nombres explícitos: `calculateSaleTotal()` en vez de `doStuff()`.
- Errores: lanzar `HttpException` con códigos y mensajes claros; centralizar manejo de errores.
- Logs: usar logger estructurado; no usar `console.log` en producción.

## Estilo y herramientas (configuración mínima)
- TypeScript `tsconfig` con `strict: true`.
- ESLint + Prettier (configurar reglas base y formato automático).
- Husky + commitlint (mensajes de commit convencionales).
- Lint en CI y pre-commit hooks para tests rápidos.

## Testing
- Unit tests para services y utilidades con Jest.
- Tests de integración para endpoints críticos (`/sales`, `/sync`).

## Prioridades y próximos pasos sugeridos (inmediatos)
1. Definir `prisma/schema.prisma` con los modelos básicos (Product, InventoryItem, Store, Sale, StockMovement, SyncOperation, User).
2. Generar migraciones y `seed` con datos de ejemplo.
3. Implementar autenticación (`auth` + JWT) y pruebas de login.
4. CRUD de `products` y testeo básico.
5. Implementar `sales` que cree `Sale` + `SaleLine` y genere `StockMovement`.
6. Endpoints `/sync/push` y `/sync/pull` con op-log simple.

## Recomendación para sincronización en dispositivos POS
- Cliente local: SQLite (expo-sqlite o better-sqlite3 según plataforma).
- Guardar ops locales en tabla `local_ops` con estado `pending|sent|ack`.
- Sincronizar por batches y respaldar ops enviados hasta recibir ack.

## Comandos útiles (desarrollo)
Para crear migración y ejecutar servidor en desarrollo:

```bash
npx prisma migrate dev --name init
npm run start:dev
```

## Dónde continuar ahora
- Siguiente acción recomendada: implementar `prisma/schema.prisma` y la migración inicial, luego el módulo `auth` y `products`.

## Documentación y mantenimiento
- Mantener este archivo como la referencia de arquitectura y actualizarlo con decisiones de diseño.
- Crear una carpeta `docs/` para diagramas, workflows y casos de conflicto de sincronización.

---
Actualizado: guía básica para empezar el backend y la sincronización offline.
