import { SetMetadata } from '@nestjs/common';

export const SKIP_STORE_CONFIGURED_KEY = 'skipStoreConfigured';

/** Rutas que no exigen tienda configurada (ej. health / raiz). */
export const SkipStoreConfigured = () =>
  SetMetadata(SKIP_STORE_CONFIGURED_KEY, true);
