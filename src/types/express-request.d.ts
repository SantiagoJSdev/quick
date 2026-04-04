export {};

declare global {
  namespace Express {
    interface Request {
      /** UUID v4 (generado o cabecera `X-Request-Id`). */
      requestId: string;
    }
  }
}
