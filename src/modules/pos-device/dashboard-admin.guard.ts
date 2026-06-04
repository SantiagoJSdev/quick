import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

function timingSafeStringEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) {
    return false;
  }
  return timingSafeEqual(x, y);
}

/**
 * Protege PATCH de dashboard-config. Requiere `X-Dashboard-Admin-Pin` = `DASHBOARD_ADMIN_PIN`
 * (o `OPS_API_KEY` como alternativa para operaciones desde servidor).
 */
@Injectable()
export class DashboardAdminGuard implements CanActivate {
  private readonly logger = new Logger(DashboardAdminGuard.name);
  private warnedOpen = false;

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const pin = (this.config.get<string>('DASHBOARD_ADMIN_PIN') ?? '').trim();
    const opsKey = (this.config.get<string>('OPS_API_KEY') ?? '').trim();

    if (!pin && !opsKey) {
      if (!this.warnedOpen) {
        this.warnedOpen = true;
        const msg =
          'DASHBOARD_ADMIN_PIN and OPS_API_KEY unset: dashboard-config PATCH is open. Set DASHBOARD_ADMIN_PIN in production.';
        if (process.env.NODE_ENV === 'production') {
          this.logger.warn(msg);
        } else {
          this.logger.verbose(msg);
        }
      }
      return true;
    }

    const pinHeaderRaw = req.headers['x-dashboard-admin-pin'];
    const pinHeader =
      typeof pinHeaderRaw === 'string'
        ? pinHeaderRaw.trim()
        : Array.isArray(pinHeaderRaw)
          ? pinHeaderRaw[0]?.trim() ?? ''
          : '';

    const opsHeaderRaw = req.headers['x-ops-api-key'];
    const opsHeader =
      typeof opsHeaderRaw === 'string'
        ? opsHeaderRaw.trim()
        : Array.isArray(opsHeaderRaw)
          ? opsHeaderRaw[0]?.trim() ?? ''
          : '';

    if (pin && pinHeader && timingSafeStringEqual(pinHeader, pin)) {
      return true;
    }

    if (opsKey && opsHeader && timingSafeStringEqual(opsHeader, opsKey)) {
      return true;
    }

    throw new UnauthorizedException(
      'Invalid or missing dashboard admin credentials (X-Dashboard-Admin-Pin or X-Ops-Api-Key)',
    );
  }
}
