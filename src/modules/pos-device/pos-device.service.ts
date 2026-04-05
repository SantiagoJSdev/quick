import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type TouchPosDeviceOpts = {
  /** Si se envía y no está vacío, se guarda o actualiza en el registro del dispositivo. */
  appVersion?: string | null;
};

/**
 * Registro / heartbeat de terminales POS por `deviceId` estable (ej. UUID de instalación).
 * Misma semántica que el sync: un dispositivo solo puede estar asociado a una tienda.
 */
@Injectable()
export class PosDeviceService {
  async touchOrRegister(
    tx: Prisma.TransactionClient,
    storeId: string,
    deviceId: string,
    opts?: TouchPosDeviceOpts,
  ): Promise<string> {
    const trimmed = deviceId.trim();
    if (!trimmed) {
      throw new BadRequestException('deviceId must be non-empty when provided');
    }

    const appVersion =
      typeof opts?.appVersion === 'string' && opts.appVersion.trim() !== ''
        ? opts.appVersion.trim()
        : undefined;

    const dev = await tx.pOSDevice.findUnique({
      where: { deviceId: trimmed },
    });
    if (dev) {
      if (dev.storeId !== storeId) {
        throw new ConflictException(
          'This device is registered to another store',
        );
      }
      await tx.pOSDevice.update({
        where: { deviceId: trimmed },
        data: {
          lastSeen: new Date(),
          ...(appVersion != null ? { appVersion } : {}),
        },
      });
      return trimmed;
    }

    await tx.pOSDevice.create({
      data: {
        deviceId: trimmed,
        storeId,
        ...(appVersion != null ? { appVersion } : {}),
      },
    });
    return trimmed;
  }
}
