import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { verifyDashboardAccessToken } from '../../common/crypto/dashboard-token';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DeviceDashboardGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const deviceId = (req.params as { deviceId?: string }).deviceId?.trim();
    if (!deviceId) {
      throw new UnauthorizedException('deviceId is required');
    }

    const raw = req.headers['x-device-token'];
    const token = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!token) {
      throw new UnauthorizedException(
        'Header X-Device-Token is required for dashboard device access',
      );
    }

    const dev = await this.prisma.pOSDevice.findUnique({
      where: { deviceId },
    });
    if (!dev) {
      throw new UnauthorizedException('Invalid device or token');
    }

    if (!dev.dashboardEnabled) {
      throw new ForbiddenException('Dashboard is not enabled for this device');
    }

    if (
      dev.deviceMode !== 'DASHBOARD' &&
      dev.deviceMode !== 'HYBRID'
    ) {
      throw new ForbiddenException(
        'Device mode does not allow dashboard access',
      );
    }

    if (
      !verifyDashboardAccessToken(token, dev.dashboardAccessTokenHash)
    ) {
      throw new UnauthorizedException('Invalid device or token');
    }

    req.dashboardDeviceContext = {
      deviceId: dev.deviceId,
      storeId: dev.storeId,
      posDeviceRowId: dev.id,
    };

    return true;
  }
}
