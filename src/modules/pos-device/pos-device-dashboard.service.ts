import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  generateDashboardAccessToken,
  hashDashboardAccessToken,
} from '../../common/crypto/dashboard-token';
import { PrismaService } from '../../prisma/prisma.service';
import type { PatchDashboardConfigDto } from './dto/patch-dashboard-config.dto';

@Injectable()
export class PosDeviceDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(storeId: string, deviceId: string) {
    const dev = await this.findDeviceInStore(storeId, deviceId);
    return this.toPublicConfig(dev);
  }

  async patchConfig(
    storeId: string,
    deviceId: string,
    dto: PatchDashboardConfigDto,
  ) {
    const dev = await this.findDeviceInStore(storeId, deviceId);

    let plainToken: string | undefined;
    const data: Prisma.POSDeviceUpdateInput = {};

    if (dto.dashboardEnabled !== undefined) {
      data.dashboardEnabled = dto.dashboardEnabled;
    }
    if (dto.deviceMode !== undefined) {
      data.deviceMode = dto.deviceMode;
    }
    if (dto.dashboardView !== undefined) {
      data.dashboardView = dto.dashboardView;
    }

    const needsToken =
      dto.regenerateToken === true ||
      ((dto.dashboardEnabled === true ||
        dto.deviceMode === 'DASHBOARD' ||
        dto.deviceMode === 'HYBRID') &&
        !dev.dashboardAccessTokenHash);

    if (needsToken) {
      plainToken = generateDashboardAccessToken();
      data.dashboardAccessTokenHash = hashDashboardAccessToken(plainToken);
    }

    if (dto.dashboardEnabled === false) {
      data.dashboardAccessTokenHash = null;
    }

    const updated = await this.prisma.pOSDevice.update({
      where: { deviceId: dev.deviceId },
      data,
    });

    const body = this.toPublicConfig(updated);
    if (plainToken) {
      return { ...body, dashboardAccessToken: plainToken };
    }
    return body;
  }

  private async findDeviceInStore(storeId: string, deviceId: string) {
    const trimmed = deviceId.trim();
    if (!trimmed) {
      throw new NotFoundException('POS device not found');
    }

    const dev = await this.prisma.pOSDevice.findUnique({
      where: { deviceId: trimmed },
    });
    if (!dev) {
      throw new NotFoundException('POS device not found');
    }
    if (dev.storeId !== storeId) {
      throw new ConflictException(
        'This device belongs to another store',
      );
    }
    return dev;
  }

  private toPublicConfig(dev: {
    id: string;
    deviceId: string;
    storeId: string;
    dashboardEnabled: boolean;
    deviceMode: string;
    dashboardView: string;
    dashboardAccessTokenHash: string | null;
    lastHeartbeatAt: Date | null;
    lastSeen: Date | null;
    appVersion: string | null;
  }) {
    return {
      id: dev.id,
      deviceId: dev.deviceId,
      storeId: dev.storeId,
      dashboardEnabled: dev.dashboardEnabled,
      deviceMode: dev.deviceMode,
      dashboardView: dev.dashboardView,
      hasDashboardToken: Boolean(dev.dashboardAccessTokenHash),
      lastHeartbeatAt: dev.lastHeartbeatAt?.toISOString() ?? null,
      lastSeen: dev.lastSeen?.toISOString() ?? null,
      appVersion: dev.appVersion,
    };
  }
}
