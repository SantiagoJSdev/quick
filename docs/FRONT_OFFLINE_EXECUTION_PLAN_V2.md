# Frontend Execution Plan V2 - Offline + Compras + Fotos + Config URL

Documento para el equipo frontend con plan tecnico ejecutable.  
Objetivo: implementar experiencia fluida tipo Odoo/Square en compras, operar offline-first, soportar fotos de producto con carga liviana en segundo plano, y permitir configurar URL/IP del backend desde la app.

## 1) Resumen ejecutivo

## Lo que YA existe en backend (sin endpoints nuevos)

- Compra completa proveedor con impacto en stock: `POST /api/v1/purchases`.
- Sync offline operativo: `POST /api/v1/sync/push` y `GET /api/v1/sync/pull`.
- Inventario y movimientos: `GET /inventory`, `GET /inventory/:productId`, `POST /inventory/adjustments`.
- Catálogo y alta rápida: `POST /products`, `PATCH /products/:id`, `POST /products-with-stock` (idempotente por `Idempotency-Key`).
- Multi-moneda con snapshot FX en ventas/compras.
- Pago mixto en ventas:
  - `POST /api/v1/sales` acepta `payments` opcional.
  - `GET /api/v1/sales/:id` devuelve `payments`.
  - `sync/push` `SALE` soporta `payload.sale.payments`.

## Lo que YA existe para fotos en backend

- `POST /api/v1/uploads/products-image` (multipart) -> `{ fileId, url, mimeType, bytes }`.
- `GET /api/v1/uploads/products-image/:storeId/:fileName` (lectura imagen).
- `PATCH /api/v1/products/:id/image` con `{ imageUrl }` para vincular.
- `DELETE /api/v1/products/:id/image` para desvincular.

## Lo que es solo frontend (sin cambios backend)

- Configuración dinámica de URL/IP/puerto del backend desde Ajustes.
- Scheduler de sync por reconexión + cada intervalo.
- Cola local robusta de operaciones con reintentos y control de conflictos.

---

## 2) Requerimiento 1 - Factura completa de proveedor con entrada de stock

## 2.1 Estado actual backend

Ya está soportado de forma nativa por:

- `POST /api/v1/purchases`
  - recibe proveedor + líneas (`productId`, `quantity`, `unitCost`) + moneda documento + `fxSnapshot`,
  - crea compra,
  - genera movimientos `IN_PURCHASE`,
  - incrementa inventario y recalcula costo medio funcional.

Conclusión: **no hace falta endpoint nuevo** para “factura proveedor que llena stock”.

## 2.2 Implementación UX recomendada (inspiración Odoo/Square)

Patrón recomendado de pantalla “Nueva compra”:

1. **Header compacto**
   - proveedor,
   - fecha,
   - moneda documento,
   - tasa visible.
2. **Líneas tipo grid rápido**
   - buscar producto por nombre/SKU/barcode,
   - editar cantidad y costo unitario inline,
   - subtotal por línea en tiempo real.
3. **Resumen inferior fijo**
   - total ítems,
   - total documento,
   - referencia funcional.
4. **Acciones claras**
   - Guardar borrador local,
   - Confirmar compra.
5. **Comportamiento tipo Square**
   - feedback inmediato “Compra guardada / sincronizando”,
   - badge de estado de sync (`pendiente`, `sincronizado`, `error`).

## 2.3 Lógica offline recomendada

Si hay internet:

- enviar directo `POST /purchases`.

Si no hay internet:

- crear operación local `PURCHASE_RECEIVE` con `opId`,
- persistir payload completo (incluyendo `fxSnapshot`),
- actualizar UI local como “pendiente de sync”,
- al reconectar, enviar por `sync/push`.

## 2.4 Checklist de verificación para compras

- [ ] Cada compra confirmada crea entrada de stock en inventario local visible.
- [ ] Reintento con mismo `opId` no duplica compra ni stock.
- [ ] Si backend rechaza por validación (4xx), compra pasa a “revisión manual”.
- [ ] Si falla por red/timeout (5xx/red), queda en retry automático.
- [ ] Historial local refleja estado real: pendiente/sincronizada/error.

---

## 3) Requerimiento 2 - Fotos de producto livianas y en segundo plano

## 3.1 Diseño recomendado (mejor costo/beneficio)

Estrategia: **2 fases de subida**, para no bloquear UX:

1. Usuario selecciona foto.
2. Front genera versión optimizada local:
   - formato `webp` o `jpeg`,
   - ancho objetivo 720-1080px,
   - calidad 70-82,
   - metadatos EXIF removidos.
3. Se guarda preview local inmediatamente en card/form.
4. Upload se encola en background (job separado de UI).
5. Cuando backend confirma URL final, se actualiza `Product.imageUrl`.

Resultado: UI fluida, sin esperar la red para terminar el formulario.

## 3.2 Endpoints backend vigentes (MVP)

- `POST /api/v1/uploads/products-image` -> upload archivo de imagen.
- `PATCH /api/v1/products/:id/image` -> vincular URL.
- `DELETE /api/v1/products/:id/image` -> quitar foto del producto.
- `GET /api/v1/uploads/products-image/:storeId/:fileName` -> servir imagen.

## 3.3 Cambios de modelo sugeridos (backend)

- `Product.imageUrl String?`
- opcional:
  - `imageThumbUrl String?`
  - `imageUpdatedAt DateTime?`

## 3.4 Reglas frontend obligatorias para rendimiento

- No bloquear guardado del producto por foto pendiente.
- Si upload falla, mantener preview local + estado “pendiente”.
- Reintentos con backoff exponencial.
- Límite de tamaño antes de enviar (ej. 250-400 KB objetivo).
- Subida en isolate/background worker (Flutter) para evitar jank.

## 3.5 Checklist de verificación para fotos

- [ ] Card de producto muestra foto o placeholder consistente.
- [ ] Pantalla crear/editar permite tomar/seleccionar/cambiar/eliminar foto.
- [ ] Guardar producto funciona aunque upload siga en progreso.
- [ ] Si app se cierra, al abrir se retoma cola de uploads pendientes.
- [ ] En red lenta, lista de productos no se congela ni cae FPS.

---

## 4) Requerimiento 3 - Configurar URL/IP/puerto del backend desde frontend

## 4.1 Implementación recomendada (frontend)

Crear pantalla `Configuración de conexión` con:

- Base URL editable (ej. `http://192.168.0.190:3002/api/v1`),
- botón “Probar conexión” (`GET /` o endpoint health),
- selector de perfil (Producción / LAN / Local),
- persistencia segura local (SharedPreferences/SecureStorage según política).

## 4.2 Reglas de validación

- URL debe incluir protocolo (`http://` o `https://`).
- Normalizar slash final.
- Validar respuesta mínima antes de guardar como activa.
- Mostrar entorno activo en un badge visible.

## 4.3 Checklist de verificación de conectividad configurable

- [ ] Cambiar URL en ajustes redirige todas las llamadas posteriores.
- [ ] Al reiniciar app se conserva la URL elegida.
- [ ] Si URL cae, app entra en modo offline sin crash.
- [ ] Sync scheduler usa la URL actual sin reiniciar sesión.

---

## 5) Arquitectura offline objetivo en frontend (paso a paso)

## Fase 1 - Análisis (obligatoria)

- [ ] Inventario de pantallas y acciones por módulo.
- [ ] Matriz: `acción -> endpoint -> soporta offline -> estrategia`.
- [ ] Identificar acciones sin cobertura en `sync/push`.
- [ ] Definir prioridades de negocio (ventas/inventario/compras primero).

## Fase 2 - Núcleo offline

- [ ] `ConnectivityService` (stream online/offline).
- [ ] `SyncQueueRepository` en SQLite.
- [ ] `SyncEngine` con lock anti-concurrencia.
- [ ] `SyncScheduler` por reconexión + intervalo.
- [ ] `PullUpdater` incremental con `since`.

## Fase 3 - Flujos críticos

- [ ] Ventas offline completas.
- [ ] Ajustes inventario offline.
- [ ] Compras proveedor offline (draft + confirm + push).
- [ ] Producto+stock con `Idempotency-Key`.

## Fase 4 - Fotos y UX avanzada

- [ ] Cola de upload en background.
- [ ] Estados visuales de foto (`local`, `subiendo`, `sincronizada`, `error`).
- [ ] Compresión automática antes de upload.

## Fase 5 - Hardening QA

- [ ] Pruebas de reconexión intermitente.
- [ ] Pruebas de duplicidad/idempotencia.
- [ ] Pruebas de performance en catálogo con imágenes.
- [ ] Pruebas de cambio de Base URL en caliente.

---

## 6) Matriz final: qué cambió vs lo actual

| Tema | Estado |
|------|--------|
| Factura proveedor + entrada stock | **Ya implementado** en backend (`POST /purchases`) |
| Flujo offline general | **Ya soportado** por `sync/push` y `sync/pull` |
| URL/IP configurable desde app | **Nuevo en frontend** (sin endpoint nuevo) |
| Foto de producto en card/edición | **Backend ya implementado** (upload + attach/detach) |
| Upload foto background no bloqueante | **Frontend pendiente** (cola/background + reintentos) |

---

## 7) Instrucción directa para el equipo frontend

Implementar en este orden:

1. Ejecutar Fase 1 (análisis y checklist por pantalla).
2. Cerrar Fase 2 (núcleo offline robusto).
3. Activar Fase 3 para compras/ventas/inventario.
4. Implementar integración real de fotos contra endpoints vigentes.
5. Implementar pantalla de configuración de conexión y validarla en QA LAN.

Si durante la implementación se detecta un caso no cubierto por API actual, documentarlo con:

- endpoint actual usado,
- payload requerido,
- respuesta esperada,
- propuesta de cambio mínimo.

---

## 8) Pruebas manuales pendientes (QA front + backend)

Ejecutar en este orden y marcar evidencia (captura/video + request/response):

### A. Pago mixto (online)

- [ ] Crear venta en VES con `payments` (`CASH_USD` + `CASH_VES`) donde suma convertida == total.
- [ ] Verificar `200` en `POST /api/v1/sales`.
- [ ] Consultar `GET /api/v1/sales/:id` y validar que regrese `payments` persistidos.
- [ ] Repetir con suma inválida (menor al total) y validar error de negocio.

### B. Pago mixto (offline/sync)

- [ ] Generar op `SALE` local con `payments` y `opId`.
- [ ] Ejecutar `POST /api/v1/sync/push` al reconectar y validar `acked`.
- [ ] Reintentar con el mismo `opId` y mismo payload: validar `skipped`.
- [ ] Verificar que no se duplique venta ni movimiento de inventario.

### C. Factura proveedor completa + stock

- [ ] Crear compra con `POST /api/v1/purchases` (líneas + `fxSnapshot`).
- [ ] Verificar en `GET /api/v1/inventory/:productId` que aumentó stock.
- [ ] Simular reintento offline con mismo `opId` (`PURCHASE_RECEIVE`) y validar no duplicación.

### D. Fotos de producto (nuevo contrato upload)

- [ ] Subir imagen con `POST /api/v1/uploads/products-image` (multipart).
- [ ] Abrir URL devuelta y verificar render.
- [ ] Vincular foto con `PATCH /api/v1/products/:id/image`.
- [ ] Verificar `GET /api/v1/products/:id` con campo `image` actualizado.
- [ ] Quitar foto con `DELETE /api/v1/products/:id/image` y validar `image = null`.
- [ ] Probar archivo no imagen y validar rechazo (400).
- [ ] Probar archivo > 5MB y validar rechazo.

### E. URL/IP configurable en frontend

- [ ] Cambiar Base URL en ajustes (`http://ip:puerto/api/v1`) y guardar.
- [ ] Reiniciar app y validar persistencia de URL activa.
- [ ] Ejecutar flujo simple (`GET /products`) en nueva URL.
- [ ] Apagar backend y validar degradación limpia a modo offline (sin crash).

### F. Rendimiento y resiliencia

- [ ] Con red lenta, crear producto con foto y comprobar que UI no se bloquea.
- [ ] Cerrar y abrir app con cargas pendientes, validar reanudación de cola.
- [ ] Confirmar que catálogos/listas siguen utilizables mientras sync/upload corre.

### Criterio de cierre

Se considera listo para front cuando:

- [ ] todas las pruebas A-F están en verde,
- [ ] no hay duplicados por reintentos (`opId` / `Idempotency-Key`),
- [ ] evidencias QA adjuntas por módulo (ventas, compras, inventario, fotos, sync).

