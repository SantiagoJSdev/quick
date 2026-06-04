import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    dashboardDeviceContext?: {
      deviceId: string;
      storeId: string;
      posDeviceRowId: string;
    };
  }
}
