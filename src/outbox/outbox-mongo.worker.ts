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

const EXCHANGE_RATE_AGGREGATE = 'ExchangeRate';
const EXCHANGE_RATE_EVENTS = new Set(['EXCHANGE_RATE_UPSERTED']);

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

  private dbName() {
    return process.env.MONGODB_DATABASE_NAME?.trim() || 'quickmarket';
  }

  private async processEvent(client: MongoClient, event: OutboxEvent) {
    try {
      if (
        event.aggregateType === PRODUCT_AGGREGATE &&
        PRODUCT_EVENTS.has(event.eventType)
      ) {
        await this.processProductEvent(client, event);
        return;
      }

      if (
        event.aggregateType === EXCHANGE_RATE_AGGREGATE &&
        EXCHANGE_RATE_EVENTS.has(event.eventType)
      ) {
        await this.processExchangeRateEvent(client, event);
        return;
      }

      this.logger.warn(
        `Outbox ${event.id}: unknown aggregate/event (${event.aggregateType}/${event.eventType}) — marked processed`,
      );
      await this.markProcessed(event.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.markFailure(event, message);
      this.logger.warn(`Outbox ${event.id}: failed — ${message}`);
    }
  }

  private async processProductEvent(client: MongoClient, event: OutboxEvent) {
    const coll = client.db(this.dbName()).collection('products_read');
    const payload = event.payload as unknown;
    if (!this.isProductPayload(payload)) {
      throw new Error('Invalid outbox payload: missing product.id');
    }

    const doc = this.toProductsReadDoc(payload, event);
    await coll.replaceOne({ _id: doc._id as never }, doc, { upsert: true });

    await this.markProcessed(event.id);
    this.logger.debug(
      `Outbox ${event.id}: ${event.eventType} -> products_read (${doc.productId})`,
    );
  }

  private async processExchangeRateEvent(
    client: MongoClient,
    event: OutboxEvent,
  ) {
    const coll = client.db(this.dbName()).collection('fx_rates_read');
    const payload = event.payload as unknown;
    if (!this.isExchangeRatePayload(payload)) {
      throw new Error('Invalid outbox payload: missing exchangeRate.storeId');
    }

    const x = payload.exchangeRate;
    const storeId = x.storeId as string;
    const base = x.baseCurrencyCode as string;
    const quote = x.quoteCurrencyCode as string;
    const _id = `${storeId}_${base}_${quote}`;

    const now = new Date().toISOString();
    const doc: Record<string, unknown> = {
      _id,
      storeId,
      baseCurrencyCode: base,
      quoteCurrencyCode: quote,
      rateQuotePerBase: x.rateQuotePerBase,
      effectiveDate: x.effectiveDate,
      source: x.source ?? null,
      notes: x.notes ?? null,
      postgresExchangeRateId: x.id,
      convention: `1 ${base} = rateQuotePerBase ${quote}`,
      sync: {
        lastEventId: event.id,
        lastEventType: event.eventType,
        lastProjectedAt: now,
      },
    };

    await coll.replaceOne({ _id: _id as never }, doc, { upsert: true });

    await this.markProcessed(event.id);
    this.logger.debug(
      `Outbox ${event.id}: ${event.eventType} -> fx_rates_read (${_id})`,
    );
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

  private isExchangeRatePayload(
    p: unknown,
  ): p is { exchangeRate: Record<string, unknown> } {
    if (typeof p !== 'object' || p === null || !('exchangeRate' in p)) {
      return false;
    }
    const x = (p as { exchangeRate: unknown }).exchangeRate;
    if (typeof x !== 'object' || x === null) {
      return false;
    }
    const o = x as Record<string, unknown>;
    return (
      typeof o.storeId === 'string' &&
      typeof o.baseCurrencyCode === 'string' &&
      typeof o.quoteCurrencyCode === 'string' &&
      typeof o.rateQuotePerBase === 'string'
    );
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
