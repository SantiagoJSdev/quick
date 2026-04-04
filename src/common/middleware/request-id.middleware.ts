import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const MAX_LEN = 128;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const raw = req.headers['x-request-id'];
    const id =
      typeof raw === 'string' && raw.trim().length > 0
        ? raw.trim().slice(0, MAX_LEN)
        : randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
