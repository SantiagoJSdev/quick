import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { SKIP_STORE_CONFIGURED_KEY } from '../metadata';

@Injectable()
export class StoreConfiguredGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_STORE_CONFIGURED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const raw = req.headers['x-store-id'];
    const headerStoreId = Array.isArray(raw) ? raw[0] : raw;
    const trimmed = headerStoreId?.trim();

    if (!trimmed) {
      throw new BadRequestException(
        'Header X-Store-Id is required. Configure the store and send its UUID.',
      );
    }

    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(trimmed)) {
      throw new BadRequestException('X-Store-Id must be a valid UUID');
    }

    const paramStoreId = (req.params as { storeId?: string })?.storeId;
    if (paramStoreId && paramStoreId !== trimmed) {
      throw new BadRequestException(
        'X-Store-Id must match the store id in the URL',
      );
    }

    const store = await this.prisma.store.findUnique({
      where: { id: trimmed },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const settings = await this.prisma.businessSettings.findUnique({
      where: { storeId: trimmed },
    });
    if (!settings) {
      throw new BadRequestException(
        'Store has no business settings. Run seed or create BusinessSettings for this store first.',
      );
    }

    req.storeContext = { storeId: trimmed, settings };
    return true;
  }
}
