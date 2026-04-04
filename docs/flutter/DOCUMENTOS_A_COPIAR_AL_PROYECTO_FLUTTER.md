# Documentos del backend → dónde pegarlos en el proyecto Flutter

Copia estos archivos **desde el repo del backend** al **repo de tu app Flutter** para que Android Studio, Cursor o **Gemini** tengan el contrato siempre a mano. Rutas de destino sugeridas (creadas si no existen).

| Origen (backend) | Destino sugerido en Flutter |
|------------------|-----------------------------|
| `docs/FRONTEND_INTEGRATION_CONTEXT.md` | `docs/backend/FRONTEND_INTEGRATION_CONTEXT.md` (incluye §13 JSON por pantalla y §14 FX) |
| `docs/flutter/IMPLEMENTACION_FLUTTER_ANDROID_GEMINI.md` | `docs/backend/IMPLEMENTACION_FLUTTER_ANDROID_GEMINI.md` |
| `docs/flutter/DOCUMENTOS_A_COPIAR_AL_PROYECTO_FLUTTER.md` | `docs/backend/DOCUMENTOS_A_COPIAR.md` (este índice) |
| `docs/api/SYNC_CONTRACTS.md` | `docs/backend/SYNC_CONTRACTS.md` |
| `docs/domain/MULTI_CURRENCY_ARCHITECTURE.md` | `docs/backend/MULTI_CURRENCY_ARCHITECTURE.md` |
| `docs/api/RETURNS_POLICY.md` | `docs/backend/RETURNS_POLICY.md` (devoluciones, sprint posterior) |
| `docs/api/MONGO_PRODUCTS_READ.md` | `docs/backend/MONGO_PRODUCTS_READ.md` (opcional) |
| `docs/api/PRODUCT_SOFT_DELETE_POLICY.md` | `docs/backend/PRODUCT_SOFT_DELETE_POLICY.md` (opcional) |
| `postman/QuickMarket_API.postman_collection.json` | `assets/postman/QuickMarket_API.postman_collection.json` (opcional; importar también en Postman) |

**Convención:** mantén `docs/backend/` **solo lectura** (copias); la lógica vive en `lib/`. Cuando el backend cambie, vuelve a copiar o enlaza con un submódulo git.

**Variables de entorno Flutter (ej. `--dart-define`):**

- `API_BASE_URL` — ej. `https://tu-servidor.com/api/v1` (sin barra final duplicada en paths).
- `STORE_ID` — UUID de tienda (solo desarrollo; en producción flujo de “elegir tienda” o login futuro).
