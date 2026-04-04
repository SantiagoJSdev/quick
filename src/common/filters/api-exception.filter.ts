import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Errores HTTP JSON unificados para `api/v1` (M0).
 * Incluye siempre `requestId` (cabecera `X-Request-Id` + cuerpo).
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = req.requestId ?? 'unknown';

    if (!res.headersSent) {
      res.setHeader('X-Request-Id', requestId);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      let message: string | string[];
      let errorName = HttpStatus[status] ?? 'Error';

      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const o = body as Record<string, unknown>;
        if (typeof o.error === 'string') {
          errorName = o.error;
        }
        if (o.message !== undefined) {
          message = o.message as string | string[];
        } else {
          message = exception.message;
        }
      } else {
        message = exception.message;
      }

      const normalized = Array.isArray(message) ? message : [String(message)];

      res.status(status).json({
        statusCode: status,
        error: errorName,
        message: normalized,
        requestId,
      });
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: ['An unexpected error occurred'],
      requestId,
    });
  }
}
