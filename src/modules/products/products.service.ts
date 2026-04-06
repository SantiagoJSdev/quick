import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { BusinessSettings } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { idempotencyRecordTx } from '../../common/idempotency/idempotency-record.tx';
import {
  requestBodySha256Hex,
  toJsonSafeForCache,
} from '../../common/idempotency/request-body-hash';
import { InventoryService } from '../inventory/inventory.service';
import { MongoService } from '../../mongo/mongo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import type { CreateProductWithStockDto } from './dto/create-product-with-stock.dto';
import type { ProductReadSource } from './dto/products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { computeProductMarginDerivatives } from './product-margin-derivatives';
import { productSyncPullPayload } from './product-pull-payload';
import {
  buildProductOutboxPayload,
  type ProductForOutbox,
  productOutboxInclude,
} from './product-outbox.payload';
import {
  mongoProductReadToApiShape,
  type MongoProductReadDoc,
} from './products-read.mapper';

/** From `StoreConfiguredGuard` (`req.storeContext`). */
export type ProductStoreContext = {
  storeId: string;
  settings: BusinessSettings;
};

/** Cabecera `Idempotency-Key` en `POST /products-with-stock`. */
export const IDEMPOTENCY_SCOPE_POST_PRODUCTS_WITH_STOCK =
  'POST_v1_products-with-stock';

function idempotencyTtlMs(): number {
  const h = Number(process.env.IDEMPOTENCY_TTL_HOURS ?? '168');
  const hours =
    Number.isFinite(h) && h > 0 ? Math.min(h, 24 * 30) : 168;
  return hours * 3600 * 1000;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mongo: MongoService,
    private readonly inventory: InventoryService,
  ) {}

  async create(dto: CreateProductDto, ctx: ProductStoreContext) {
    const product = await this.prisma.$transaction((tx) =>
      this.persistProductCreatedTx(tx, dto),
    );
    return this.attachMarginDerivatives(product, ctx.settings);
  }

  /**
   * Alta atómica: `PRODUCT_CREATED` + `IN_ADJUST` stock inicial para `X-Store-Id`.
   * Si el ajuste falla, se revierte también el producto.
   *
   * Idempotencia: misma `Idempotency-Key` + mismo cuerpo → misma respuesta sin segundo producto.
   */
  async createWithStock(
    dto: CreateProductWithStockDto,
    ctx: ProductStoreContext,
    idempotencyKey: string,
  ): Promise<{ product: unknown; inventory: unknown }> {
    const requestHash = requestBodySha256Hex(dto);
    const ttlMs = idempotencyTtlMs();
    const maxAttempts = 4;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const now = new Date();
            const idem = idempotencyRecordTx(tx);

            const existing = await idem.findUnique({
              where: {
                storeId_scope_key: {
                  storeId: ctx.storeId,
                  scope: IDEMPOTENCY_SCOPE_POST_PRODUCTS_WITH_STOCK,
                  key: idempotencyKey,
                },
              },
            });

            if (existing) {
              if (existing.expiresAt <= now) {
                await idem.delete({
                  where: { id: existing.id },
                });
              } else {
                if (existing.requestHash !== requestHash) {
                  throw new ConflictException(
                    'Idempotency-Key was already used with a different request body',
                  );
                }
                return existing.responseJson as {
                  product: unknown;
                  inventory: unknown;
                };
              }
            }

            const { initialStock, ...productFields } = dto;
            const productDto = productFields as CreateProductDto;

            const productRow = await this.persistProductCreatedTx(
              tx,
              productDto,
            );
            await this.inventory.applyAdjustTx(tx, ctx.storeId, {
              productId: productRow.id,
              type: 'IN_ADJUST',
              quantity: initialStock.quantity,
              unitCostFunctional: initialStock.unitCostFunctional,
              reason: initialStock.reason ?? 'Inventario inicial',
              opId: initialStock.opId,
            });
            const inventoryRow = await tx.inventoryItem.findUnique({
              where: {
                productId_storeId: {
                  productId: productRow.id,
                  storeId: ctx.storeId,
                },
              },
              include: {
                product: {
                  select: {
                    id: true,
                    sku: true,
                    name: true,
                    active: true,
                    currency: true,
                  },
                },
              },
            });
            if (!inventoryRow) {
              throw new InternalServerErrorException(
                'Inventory line missing after initial adjust',
              );
            }

            const result = {
              product: this.attachMarginDerivatives(
                productRow,
                ctx.settings,
              ),
              inventory: inventoryRow,
            };
            const safe = toJsonSafeForCache(result);

            await idem.create({
              data: {
                storeId: ctx.storeId,
                scope: IDEMPOTENCY_SCOPE_POST_PRODUCTS_WITH_STOCK,
                key: idempotencyKey,
                requestHash,
                responseJson: safe as Prisma.InputJsonValue,
                expiresAt: new Date(now.getTime() + ttlMs),
              },
            });

            return result;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 10_000,
            timeout: 30_000,
          },
        );
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2034' &&
          attempt < maxAttempts - 1
        ) {
          this.logger.warn(
            `createWithStock: serialization conflict (attempt ${attempt + 1}), retrying`,
          );
          continue;
        }
        throw err;
      }
    }

    throw new ServiceUnavailableException(
      'Could not complete request after concurrency retries',
    );
  }

  private async persistProductCreatedTx(
    tx: Prisma.TransactionClient,
    dto: CreateProductDto,
  ): Promise<ProductForOutbox> {
    const skuFinal = await this.resolveCreateSku(tx, dto.sku);
    const barcodeVal = this.normalizeBarcodeInput(dto.barcode);

    const {
      sku: _s,
      barcode: _b,
      price,
      cost,
      marginPercentOverride,
      ...rest
    } = dto;

    const marginParsed = this.parseMarginPercentOverride(
      marginPercentOverride,
      'create',
    );

    const product = await tx.product.create({
      data: {
        ...rest,
        sku: skuFinal,
        barcode: barcodeVal,
        price: this.toDecimal(price),
        cost: this.toDecimal(cost),
        ...(marginParsed !== undefined
          ? { marginPercentOverride: marginParsed }
          : {}),
      },
      include: productOutboxInclude,
    });

    await tx.outboxEvent.create({
      data: {
        aggregateType: 'Product',
        aggregateId: product.id,
        eventType: 'PRODUCT_CREATED',
        payload: buildProductOutboxPayload(product),
      },
    });

    await tx.serverChangeLog.create({
      data: {
        opType: 'PRODUCT_CREATED',
        payload: productSyncPullPayload(product) as Prisma.InputJsonValue,
        storeScopeId: null,
      },
    });

    return product;
  }

  /**
   * Catalog list: Mongo `products_read` first when `source` is `auto` or `mongo`, else Postgres.
   * `auto` falls back to Postgres if Mongo is down or the query fails.
   */
  async findAllCatalog(
    includeInactive: boolean,
    source: ProductReadSource = 'auto',
    ctx: ProductStoreContext,
  ): Promise<{ data: unknown[]; readSource: 'mongo' | 'postgres' }> {
    const { settings } = ctx;
    if (source === 'postgres') {
      return {
        data: await this.findAllPostgres(includeInactive, settings),
        readSource: 'postgres',
      };
    }
    if (source === 'mongo') {
      return {
        data: await this.findAllMongoOrThrow(includeInactive, settings),
        readSource: 'mongo',
      };
    }
    const client = this.mongo.getClient();
    if (!client) {
      return {
        data: await this.findAllPostgres(includeInactive, settings),
        readSource: 'postgres',
      };
    }
    try {
      const data = await this.findAllMongo(includeInactive, client, settings);
      return { data, readSource: 'mongo' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Catalog list: Mongo failed (${message}) — falling back to Postgres`,
      );
      return {
        data: await this.findAllPostgres(includeInactive, settings),
        readSource: 'postgres',
      };
    }
  }

  /**
   * Single product: same resolution as list. In `auto`, if missing in Mongo, tries Postgres
   * (projection lag).
   */
  async findOneCatalog(
    id: string,
    source: ProductReadSource = 'auto',
    ctx: ProductStoreContext,
  ): Promise<{ data: unknown; readSource: 'mongo' | 'postgres' }> {
    const { settings } = ctx;
    if (source === 'postgres') {
      return {
        data: this.attachMarginDerivatives(
          await this.findProductByIdOrThrow(id),
          settings,
        ),
        readSource: 'postgres',
      };
    }
    if (source === 'mongo') {
      const doc = await this.findOneMongoOrThrow(id);
      if (!doc) {
        throw new NotFoundException('Product not found');
      }
      return {
        data: this.attachMarginDerivatives(
          mongoProductReadToApiShape(doc),
          settings,
        ),
        readSource: 'mongo',
      };
    }
    const client = this.mongo.getClient();
    if (!client) {
      return {
        data: this.attachMarginDerivatives(
          await this.findProductByIdOrThrow(id),
          settings,
        ),
        readSource: 'postgres',
      };
    }
    try {
      const doc = await this.findOneMongo(id, client);
      if (doc) {
        return {
          data: this.attachMarginDerivatives(
            mongoProductReadToApiShape(doc),
            settings,
          ),
          readSource: 'mongo',
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Catalog get ${id}: Mongo failed (${message}) — falling back to Postgres`,
      );
    }
    return {
      data: this.attachMarginDerivatives(
        await this.findProductByIdOrThrow(id),
        settings,
      ),
      readSource: 'postgres',
    };
  }

  private dbName() {
    return process.env.MONGODB_DATABASE_NAME?.trim() || 'quickmarket';
  }

  private async findAllPostgres(
    includeInactive: boolean,
    settings: BusinessSettings,
  ) {
    const rows = await this.prisma.product.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((p) => this.attachMarginDerivatives(p, settings));
  }

  private async findAllMongo(
    includeInactive: boolean,
    client: NonNullable<ReturnType<MongoService['getClient']>>,
    settings: BusinessSettings,
  ) {
    const coll = client
      .db(this.dbName())
      .collection<MongoProductReadDoc>('products_read');
    const filter = includeInactive ? {} : { active: true };
    const docs = await coll
      .find(filter)
      .sort({ 'pg.updatedAt': -1 })
      .toArray();
    return docs.map((d) =>
      this.attachMarginDerivatives(mongoProductReadToApiShape(d), settings),
    );
  }

  private async findAllMongoOrThrow(
    includeInactive: boolean,
    settings: BusinessSettings,
  ) {
    const client = this.mongo.getClient();
    if (!client) {
      throw new ServiceUnavailableException(
        'MongoDB read model is not configured or unavailable',
      );
    }
    return this.findAllMongo(includeInactive, client, settings);
  }

  private async findOneMongo(
    id: string,
    client: NonNullable<ReturnType<MongoService['getClient']>>,
  ) {
    const coll = client
      .db(this.dbName())
      .collection<MongoProductReadDoc>('products_read');
    return coll.findOne({ _id: id });
  }

  private async findOneMongoOrThrow(id: string) {
    const client = this.mongo.getClient();
    if (!client) {
      throw new ServiceUnavailableException(
        'MongoDB read model is not configured or unavailable',
      );
    }
    return this.findOneMongo(id, client);
  }

  private async findProductByIdOrThrow(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  private attachMarginDerivatives<T extends object>(
    row: T,
    settings: BusinessSettings,
  ): T & ReturnType<typeof computeProductMarginDerivatives> {
    return {
      ...row,
      ...computeProductMarginDerivatives(
        row as {
          pricingMode?: string | null;
          marginPercentOverride?: unknown;
          price?: unknown;
          cost?: unknown;
        },
        { defaultMarginPercent: settings.defaultMarginPercent },
      ),
    };
  }

  async update(id: string, dto: UpdateProductDto, ctx: ProductStoreContext) {
    await this.findProductByIdOrThrow(id);

    return this.prisma.$transaction(async (tx) => {
      const { price, cost, sku, barcode, marginPercentOverride, ...rest } = dto;
      const marginParsed = this.parseMarginPercentOverride(
        marginPercentOverride,
        'update',
      );
      // `as ProductUpdateInput`: needed if `prisma generate` did not refresh types (e.g. EPERM locking query_engine DLL on Windows).
      const data = {
        ...rest,
        ...(price !== undefined ? { price: this.toDecimal(price) } : {}),
        ...(cost !== undefined ? { cost: this.toDecimal(cost) } : {}),
        ...(sku !== undefined ? { sku: sku.trim() } : {}),
        ...(barcode !== undefined
          ? { barcode: barcode.trim() ? barcode.trim() : null }
          : {}),
        ...(marginParsed !== undefined
          ? { marginPercentOverride: marginParsed }
          : {}),
      } as Prisma.ProductUpdateInput;

      const product = await tx.product.update({
        where: { id },
        data,
        include: productOutboxInclude,
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Product',
          aggregateId: product.id,
          eventType: 'PRODUCT_UPDATED',
          payload: buildProductOutboxPayload(product),
        },
      });

      await tx.serverChangeLog.create({
        data: {
          opType: 'PRODUCT_UPDATED',
          payload: productSyncPullPayload(product) as Prisma.InputJsonValue,
          storeScopeId: null,
        },
      });

      return this.attachMarginDerivatives(product, ctx.settings);
    });
  }

  async remove(id: string, ctx: ProductStoreContext) {
    const existing = await this.findProductByIdOrThrow(id);
    if (!existing.active) {
      return this.attachMarginDerivatives(existing, ctx.settings);
    }

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: { active: false },
        include: productOutboxInclude,
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Product',
          aggregateId: product.id,
          eventType: 'PRODUCT_DEACTIVATED',
          payload: buildProductOutboxPayload(product),
        },
      });

      await tx.serverChangeLog.create({
        data: {
          opType: 'PRODUCT_DEACTIVATED',
          payload: productSyncPullPayload(product) as Prisma.InputJsonValue,
          storeScopeId: null,
        },
      });

      return this.attachMarginDerivatives(product, ctx.settings);
    });
  }

  private toDecimal(value?: string) {
    if (value === undefined) {
      return undefined;
    }
    return new Prisma.Decimal(value);
  }

  private parseMarginPercentOverride(
    value: string | null | undefined,
    mode: 'create' | 'update',
  ): Prisma.Decimal | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return mode === 'update' ? null : undefined;
    }
    const t = value.trim();
    if (t === '') {
      throw new BadRequestException('marginPercentOverride must not be empty');
    }
    const d = new Prisma.Decimal(t);
    if (d.lt(0) || d.gt(999)) {
      throw new BadRequestException(
        'marginPercentOverride must be between 0 and 999',
      );
    }
    return d;
  }

  /** Barcode: solo persiste si hay texto tras trim; si no, `null` (único sparse en Postgres). */
  private normalizeBarcodeInput(raw?: string | null): string | null {
    if (raw === undefined || raw === null) {
      return null;
    }
    const t = raw.trim();
    return t.length > 0 ? t : null;
  }

  private async bumpSkuCounter(tx: Prisma.TransactionClient): Promise<number> {
    await tx.$executeRaw`
      INSERT INTO "ProductSkuCounter" ("id", "nextNumber")
      VALUES ('global', 0)
      ON CONFLICT ("id") DO NOTHING
    `;
    const rows = await tx.$queryRaw<{ nextNumber: unknown }[]>`
      UPDATE "ProductSkuCounter"
      SET "nextNumber" = "nextNumber" + 1
      WHERE "id" = 'global'
      RETURNING "nextNumber"
    `;
    const n = rows[0]?.nextNumber;
    return typeof n === 'bigint' ? Number(n) : Number(n);
  }

  private async allocateGeneratedSku(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    for (let attempt = 0; attempt < 25; attempt++) {
      const n = await this.bumpSkuCounter(tx);
      const candidate = `SKU-${String(n).padStart(6, '0')}`;
      const clash = await tx.product.findUnique({ where: { sku: candidate } });
      if (!clash) {
        return candidate;
      }
    }
    throw new ConflictException(
      'Could not allocate auto SKU after retries; set sku explicitly in the request body',
    );
  }

  private async resolveCreateSku(
    tx: Prisma.TransactionClient,
    dtoSku?: string,
  ): Promise<string> {
    const t = dtoSku?.trim();
    if (t) {
      return t;
    }
    return this.allocateGeneratedSku(tx);
  }
}
