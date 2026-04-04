import type { BusinessSettings } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      storeContext?: { storeId: string; settings: BusinessSettings };
    }
  }
}

export {};
