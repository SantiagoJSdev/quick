import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MongoService } from '../../mongo/mongo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import type { ProductReadSource } from './dto/products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { productSyncPullPayload } from './product-pull-payload';
import {
  buildProductOutboxPayload,
  productOutboxInclude,
} from './product-outbox.payload';
import {
  mongoProductReadToApiShape,
  type MongoProductReadDoc,
} from './products-read.mapper';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mongo: MongoService,
  ) {}

  async create(dto: CreateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      const skuFinal = await this.resolveCreateSku(tx, dto.sku);
      const barcodeVal = this.normalizeBarcodeInput(dto.barcode);

      const { sku: _s, barcode: _b, price, cost, ...rest } = dto;

      const product = await tx.product.create({
        data: {
          ...rest,
          sku: skuFinal,
          barcode: barcodeVal,
          price: this.toDecimal(price),
          cost: this.toDecimal(cost),
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
    });
  }

  /**
   * Catalog list: Mongo `products_read` first when `source` is `auto` or `mongo`, else Postgres.
   * `auto` falls back to Postgres if Mongo is down or the query fails.
   */
  async findAllCatalog(
    includeInactive: boolean,
    source: ProductReadSource = 'auto',
  ): Promise<{ data: unknown[]; readSource: 'mongo' | 'postgres' }> {
    if (source === 'postgres') {
      return {
        data: await this.findAllPostgres(includeInactive),
        readSource: 'postgres',
      };
    }
    if (source === 'mongo') {
      return {
        data: await this.findAllMongoOrThrow(includeInactive),
        readSource: 'mongo',
      };
    }
    const client = this.mongo.getClient();
    if (!client) {
      return {
        data: await this.findAllPostgres(includeInactive),
        readSource: 'postgres',
      };
    }
    try {
      const data = await this.findAllMongo(includeInactive, client);
      return { data, readSource: 'mongo' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Catalog list: Mongo failed (${message}) — falling back to Postgres`,
      );
      return {
        data: await this.findAllPostgres(includeInactive),
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
  ): Promise<{ data: unknown; readSource: 'mongo' | 'postgres' }> {
    if (source === 'postgres') {
      return { data: await this.findOnePostgres(id), readSource: 'postgres' };
    }
    if (source === 'mongo') {
      const doc = await this.findOneMongoOrThrow(id);
      if (!doc) {
        throw new NotFoundException('Product not found');
      }
      return { data: mongoProductReadToApiShape(doc), readSource: 'mongo' };
    }
    const client = this.mongo.getClient();
    if (!client) {
      return { data: await this.findOnePostgres(id), readSource: 'postgres' };
    }
    try {
      const doc = await this.findOneMongo(id, client);
      if (doc) {
        return { data: mongoProductReadToApiShape(doc), readSource: 'mongo' };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Catalog get ${id}: Mongo failed (${message}) — falling back to Postgres`,
      );
    }
    return { data: await this.findOnePostgres(id), readSource: 'postgres' };
  }

  private dbName() {
    return process.env.MONGODB_DATABASE_NAME?.trim() || 'quickmarket';
  }

  private async findAllPostgres(includeInactive: boolean) {
    return this.prisma.product.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async findAllMongo(
    includeInactive: boolean,
    client: NonNullable<ReturnType<MongoService['getClient']>>,
  ) {
    const coll = client
      .db(this.dbName())
      .collection<MongoProductReadDoc>('products_read');
    const filter = includeInactive ? {} : { active: true };
    const docs = await coll
      .find(filter)
      .sort({ 'pg.updatedAt': -1 })
      .toArray();
    return docs.map((d) => mongoProductReadToApiShape(d));
  }

  private async findAllMongoOrThrow(includeInactive: boolean) {
    const client = this.mongo.getClient();
    if (!client) {
      throw new ServiceUnavailableException(
        'MongoDB read model is not configured or unavailable',
      );
    }
    return this.findAllMongo(includeInactive, client);
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

  private async findOnePostgres(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOnePostgres(id);

    return this.prisma.$transaction(async (tx) => {
      const { price, cost, sku, barcode, ...rest } = dto;
      const data: Prisma.ProductUpdateInput = { ...rest };
      if (price !== undefined) {
        data.price = this.toDecimal(price);
      }
      if (cost !== undefined) {
        data.cost = this.toDecimal(cost);
      }
      if (sku !== undefined) {
        data.sku = sku.trim();
      }
      if (barcode !== undefined) {
        data.barcode = barcode.trim() ? barcode.trim() : null;
      }

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

      return product;
    });
  }

  async remove(id: string) {
    const existing = await this.findOnePostgres(id);
    if (!existing.active) {
      return existing;
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

      return product;
    });
  }

  private toDecimal(value?: string) {
    if (value === undefined) {
      return undefined;
    }
    return new Prisma.Decimal(value);
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
