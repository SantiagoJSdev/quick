import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OutboxEvent, OutboxStatus } from '@prisma/client';
import { hostname } from 'os';
import type { MongoClient } from 'mongodb';
import { PrismaService } from '../prisma/prisma.service';
import { MongoService } from '../mongo/mongo.service';

const PRODUCT_AGGREGATE = 'Product';
const PRODUCT_EVENTS = new Set([
  'PRODUCT_CREATED',
  'PRODUCT_UPDATED',
  'PRODUCT_DEACTIVATED',
]);

const MAX_ATTEMPTS = 25;

@Injectable()
export class OutboxMongoWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxMongoWorker.name);
  private readonly workerId =
    process.env.WORKER_ID?.trim() || `nest-${hostname()}-${process.pid}`;
  private interval: ReturnType<typeof setInterval> | null = null;
  private runningTick = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mongo: MongoService,
  ) {}

  onModuleInit() {
    const ms = Number(process.env.OUTBOX_POLL_MS ?? '2000');
    const pollMs = Number.isFinite(ms) && ms >= 500 ? ms : 2000;
    this.interval = setInterval(() => {
      void this.tick();
    }, pollMs);
    this.logger.log(
      `OutboxMongoWorker: polling every ${pollMs}ms (workerId=${this.workerId})`,
    );
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async tick() {
    if (this.runningTick) {
      return;
    }
    this.runningTick = true;
    try {
      const client = this.mongo.getClient();
      if (!client) {
        return;
      }

      const batch = Number(process.env.OUTBOX_BATCH_SIZE ?? '10');
      const n = Number.isFinite(batch) && batch >= 1 ? Math.min(batch, 50) : 10;

      for (let i = 0; i < n; i++) {
        const event = await this.claimNext();
        if (!event) {
          break;
        }
        await this.processEvent(client, event);
      }
    } finally {
      this.runningTick = false;
    }
  }

  private async claimNext(): Promise<OutboxEvent | null> {
    return this.prisma.$transaction(async (tx) => {
      const next = await tx.outboxEvent.findFirst({
        where: {
          status: OutboxStatus.PENDING,
          availableAt: { lte: new Date() },
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!next) {
        return null;
      }

      const res = await tx.outboxEvent.updateMany({
        where: { id: next.id, status: OutboxStatus.PENDING },
        data: {
          status: OutboxStatus.PROCESSING,
          lockedAt: new Date(),
          lockedBy: this.workerId,
        },
      });

      if (res.count !== 1) {
        return null;
      }

      return tx.outboxEvent.findUnique({ where: { id: next.id } });
    });
  }

  private async processEvent(client: MongoClient, event: OutboxEvent) {
    const dbName =
      process.env.MONGODB_DATABASE_NAME?.trim() || 'quickmarket';
    const coll = client.db(dbName).collection('products_read');

    try {
      if (event.aggregateType !== PRODUCT_AGGREGATE) {
        this.logger.warn(
          `Outbox ${event.id}: skip unknown aggregateType=${event.aggregateType}`,
        );
        await this.markProcessed(event.id);
        return;
      }

      if (!PRODUCT_EVENTS.has(event.eventType)) {
        this.logger.warn(
          `Outbox ${event.id}: skip unknown eventType=${event.eventType}`,
        );
        await this.markProcessed(event.id);
        return;
      }

      const payload = event.payload as unknown;
      if (!this.isProductPayload(payload)) {
        throw new Error('Invalid outbox payload: missing product.id');
      }

      const doc = this.toProductsReadDoc(payload, event);
      await coll.replaceOne({ _id: doc._id }, doc, { upsert: true });

      await this.markProcessed(event.id);
      this.logger.debug(
        `Outbox ${event.id}: projected ${event.eventType} -> products_read (${doc.productId})`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.markFailure(event, message);
      this.logger.warn(`Outbox ${event.id}: failed — ${message}`);
    }
  }

  private isProductPayload(
    p: unknown,
  ): p is { product: Record<string, unknown> } {
    if (typeof p !== 'object' || p === null || !('product' in p)) {
      return false;
    }
    const prod = (p as { product: unknown }).product;
    if (typeof prod !== 'object' || prod === null) {
      return false;
    }
    return typeof (prod as { id?: unknown }).id === 'string';
  }

  private toProductsReadDoc(
    payload: { product: Record<string, unknown> },
    event: OutboxEvent,
  ): Record<string, unknown> {
    const p = payload.product;
    const id = p.id as string;
    const now = new Date().toISOString();

    return {
      _id: id,
      productId: id,
      sku: p.sku,
      barcode: p.barcode ?? null,
      name: p.name,
      description: p.description ?? null,
      image: p.image ?? null,
      type: p.type,
      category: p.category ?? null,
      unit: p.unit,
      currency: p.currency,
      price: p.price,
      cost: p.cost,
      tax: p.tax ?? null,
      supplier: p.supplier ?? null,
      active: p.active,
      pg: { updatedAt: p.updatedAt },
      sync: {
        lastEventId: event.id,
        lastEventType: event.eventType,
        lastProjectedAt: now,
      },
    };
  }

  private async markProcessed(id: string) {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        status: OutboxStatus.PROCESSED,
        processedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    });
  }

  private async markFailure(event: OutboxEvent, message: string) {
    const attempts = event.attempts + 1;
    const backoffMs = Math.min(60_000, 1000 * 2 ** Math.min(attempts, 16));

    if (attempts >= MAX_ATTEMPTS) {
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: OutboxStatus.FAILED,
          attempts,
          lastError: message.slice(0, 2000),
          lockedAt: null,
          lockedBy: null,
        },
      });
      return;
    }

    await this.prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: OutboxStatus.PENDING,
        attempts,
        lastError: message.slice(0, 2000),
        availableAt: new Date(Date.now() + backoffMs),
        lockedAt: null,
        lockedBy: null,
      },
    });
  }
}
