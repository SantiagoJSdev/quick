import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
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

function parseBearer(auth: string | undefined): string | null {
  if (!auth || typeof auth !== 'string') {
    return null;
  }
  const m = /^Bearer\s+(\S+)\s*$/i.exec(auth.trim());
  return m ? m[1] : null;
}

function clientIp(req: Request): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim().length > 0) {
    return xf.split(',')[0].trim();
  }
  if (Array.isArray(xf) && xf[0]) {
    return xf[0].split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '';
}

@Injectable()
export class OpsAuthGuard implements CanActivate {
  private readonly logger = new Logger(OpsAuthGuard.name);
  private warnedOpenAccess = false;

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const apiKey = (this.config.get<string>('OPS_API_KEY') ?? '').trim();
    const allowRaw = (this.config.get<string>('OPS_IP_ALLOWLIST') ?? '').trim();

    const allowlist = allowRaw
      ? allowRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    if (!apiKey && allowlist.length === 0) {
      if (!this.warnedOpenAccess) {
        this.warnedOpenAccess = true;
        const msg =
          'OPS_API_KEY and OPS_IP_ALLOWLIST unset: /ops/* is open. Set OPS_API_KEY (and optionally OPS_IP_ALLOWLIST) in production.';
        if (process.env.NODE_ENV === 'production') {
          this.logger.warn(msg);
        } else {
          this.logger.verbose(msg);
        }
      }
      return true;
    }

    if (allowlist.length > 0) {
      const ip = clientIp(req);
      const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
      const ok = allowlist.some((allowed) => {
        const a = allowed.startsWith('::ffff:') ? allowed.slice(7) : allowed;
        return a === normalized || allowed === ip;
      });
      if (!ok) {
        throw new ForbiddenException('Client IP not allowed for /ops');
      }
    }

    if (apiKey) {
      const headerKeyRaw = req.headers['x-ops-api-key'];
      const headerKey =
        typeof headerKeyRaw === 'string'
          ? headerKeyRaw.trim()
          : Array.isArray(headerKeyRaw)
            ? headerKeyRaw[0]?.trim() ?? ''
            : '';
      const bearer = parseBearer(
        typeof req.headers.authorization === 'string'
          ? req.headers.authorization
          : undefined,
      );
      const presented = headerKey || bearer || '';
      if (!presented || !timingSafeStringEqual(presented, apiKey)) {
        throw new UnauthorizedException(
          'Invalid or missing ops credentials (X-Ops-Api-Key or Authorization: Bearer)',
        );
      }
    }

    return true;
  }
}
